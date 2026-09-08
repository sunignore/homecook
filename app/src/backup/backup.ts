// Export / restore. Implements docs/data-model.md §6.
//
// Export is the only durability story this app has (ADR-0001), so restore is
// treated as the important half: it validates the whole archive before touching
// anything, and replaces in one transaction so a failed restore leaves the
// existing data intact rather than half-erased.

import { unzipSync, zipSync } from 'fflate';
import { db, HomecookDB } from '../db/db';
import type { Photo } from '../db/types';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupFormatError,
  CURRENT_SCHEMA_VERSION,
  MANIFEST_NAME,
  PHOTO_DIR,
  photoExtension,
  validateManifest,
  type BackupManifest,
  type PhotoEntry,
} from './format';

const LAST_BACKUP_KEY = 'homecook:lastBackupAt';

/** yyyy-MM-dd in local time — a UTC date would misname an evening export. */
function localDateStamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function backupFileName(at: Date = new Date()): string {
  return `homecook-backup-${localDateStamp(at)}.zip`;
}

/** Build a complete backup archive. */
export async function exportBackup(database: HomecookDB = db): Promise<Blob> {
  const [recipes, ingredients, cookLogs, photos, pantryItems, mealPlans, shoppingItems] = await Promise.all([
    database.recipes.toArray(),
    database.ingredients.toArray(),
    database.cookLogs.toArray(),
    database.photos.toArray(),
    database.pantryItems.toArray(),
    database.mealPlans.toArray(),
    database.shoppingItems.toArray(),
  ]);

  const files: Record<string, Uint8Array> = {};
  const photoEntries: PhotoEntry[] = [];

  for (const photo of photos) {
    const type = photo.blob.type || 'application/octet-stream';
    const file = `${PHOTO_DIR}/${photo.id}.${photoExtension(type)}`;
    files[file] = new Uint8Array(await photo.blob.arrayBuffer());
    photoEntries.push({ id: photo.id, createdAt: photo.createdAt, file, type });
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    counts: {
      recipes: recipes.length,
      ingredients: ingredients.length,
      cookLogs: cookLogs.length,
      photos: photos.length,
      pantryItems: pantryItems.length,
      mealPlans: mealPlans.length,
      shoppingItems: shoppingItems.length,
    },
    recipes,
    ingredients,
    cookLogs,
    photos: photoEntries,
    pantryItems,
    mealPlans,
    shoppingItems,
  };

  files[MANIFEST_NAME] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

  // Photos are already compressed; level 0 for them keeps export fast on a phone.
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/zip' });
}

export interface RestorePreview {
  manifest: BackupManifest;
  archive: Record<string, Uint8Array>;
}

/**
 * Read and validate an archive WITHOUT writing anything.
 *
 * Split from the write so the UI can show the user what a restore would replace
 * their data with, and so a corrupt file is rejected while the archive is still
 * intact.
 */
export async function readBackup(file: Blob): Promise<RestorePreview> {
  // Read outside the try: only a genuine unzip failure should be reported as a
  // corrupt archive. Catching the read too would relabel unrelated errors and
  // send the user hunting for a broken file that is fine.
  const bytes = new Uint8Array(await file.arrayBuffer());

  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new BackupFormatError('압축 파일을 열 수 없습니다. 백업 파일이 손상되었을 수 있습니다.');
  }

  const raw = archive[MANIFEST_NAME];
  if (!raw) {
    throw new BackupFormatError(`백업 파일에 ${MANIFEST_NAME}이 없습니다.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new BackupFormatError('백업 내용을 해석할 수 없습니다.');
  }

  const manifest = validateManifest(parsed);

  // Fail here rather than silently restoring recipes whose photos vanished.
  const missing = manifest.photos.filter(p => !archive[p.file]);
  if (missing.length > 0) {
    throw new BackupFormatError(`백업에서 사진 ${missing.length}장이 빠져 있습니다.`);
  }

  return { manifest, archive };
}

/**
 * Replace the entire archive with the contents of a validated backup.
 *
 * Full replace, not merge — merge-import is an explicit non-goal
 * (docs/data-model.md §6). Runs in one transaction: if anything throws, Dexie
 * rolls back and the user keeps what they had.
 */
export async function restoreBackup(
  preview: RestorePreview,
  database: HomecookDB = db,
): Promise<BackupManifest['counts']> {
  const { manifest, archive } = preview;

  const photos: Photo[] = manifest.photos.map(entry => {
    // Copy into a plain ArrayBuffer-backed view: fflate hands back a
    // Uint8Array over ArrayBufferLike, which BlobPart does not accept.
    const source = archive[entry.file]!;
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    return {
      id: entry.id,
      blob: new Blob([bytes], { type: entry.type }),
      createdAt: entry.createdAt,
    };
  });

  await database.transaction(
    'rw',
    [
      database.recipes,
      database.ingredients,
      database.cookLogs,
      database.photos,
      database.pantryItems,
      database.mealPlans,
      database.shoppingItems,
    ],
    async () => {
      await Promise.all([
        database.recipes.clear(),
        database.ingredients.clear(),
        database.cookLogs.clear(),
        database.photos.clear(),
        database.pantryItems.clear(),
        database.mealPlans.clear(),
        database.shoppingItems.clear(),
      ]);

      await database.ingredients.bulkAdd(manifest.ingredients);
      await database.recipes.bulkAdd(manifest.recipes);
      await database.cookLogs.bulkAdd(manifest.cookLogs);
      if (photos.length > 0) await database.photos.bulkAdd(photos);
      if (manifest.pantryItems.length > 0) await database.pantryItems.bulkAdd(manifest.pantryItems);
      if (manifest.mealPlans.length > 0) await database.mealPlans.bulkAdd(manifest.mealPlans);
      if (manifest.shoppingItems.length > 0) await database.shoppingItems.bulkAdd(manifest.shoppingItems);
    },
  );

  return manifest.counts;
}

// ── last-backup tracking ─────────────────────────────────────────────────────
// Kept in localStorage rather than IndexedDB on purpose: this records when THIS
// device last exported. Storing it with the data would mean a restore also
// restored a stale "last backed up" date, which is exactly the moment the user
// most needs the number to be true.

export function recordBackupTaken(at: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(at));
  } catch {
    // Private mode or blocked site data — the export still happened.
  }
}

export function lastBackupAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const STALE_AFTER_DAYS = 14;

export function backupIsStale(now: number = Date.now()): boolean {
  const last = lastBackupAt();
  if (last === null) return true;
  return now - last > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

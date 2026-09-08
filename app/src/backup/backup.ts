// Export / restore. Implements docs/data-model.md §6.
//
// Export is the only durability story this app has (ADR-0001), so restore is
// treated as the important half: it validates the whole archive before touching
// anything, and replaces in one transaction so a failed restore leaves the
// existing data intact rather than half-erased.

import { unzipSync, zipSync } from 'fflate';
import { db, HomecookDB } from '../db/db';
import type { Photo } from '../db/types';
import { photoPayload } from '../photos/photoBytes';
import { snapshotSchema } from '../household/contracts';
import { server } from '../household/client';
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
  const households = (await database.householdCache.toArray()).map(row => snapshotSchema.parse(row.snapshot));
  for (const row of await database.householdRecovery.toArray()) {
    const recovered = snapshotSchema.parse(row.snapshot);
    if (!households.some(h => h.householdId === recovered.householdId)) households.push(recovered);
  }
  const householdPhotos: NonNullable<BackupManifest['householdPhotos']> = [];
  const paths = [...new Set(households.flatMap(s => [...s.menu.map(m => m.recipe), ...s.orders.flatMap(o => o.items), ...s.plans.flatMap(p => p.items)]).flatMap(d => d.photoPath ? [d.photoPath] : []))];
  for (const path of paths) {
    let photo = await database.householdPhotos.get(path);
    if (!photo && database === db) {
      const result = await server().storage.from('household-photos').download(path);
      if (result.error) throw new BackupFormatError('공유 사진을 백업하지 못했습니다. 인터넷 연결 후 다시 시도해주세요.');
      photo = { id: path, bytes: await result.data.arrayBuffer(), type: result.data.type };
      await database.householdPhotos.put(photo);
    }
    if (!photo) throw new BackupFormatError('공유 사진이 누락되었습니다.');
    const file = 'household-photos/' + path.replace(/[^a-f0-9]/g, '');
    files[file] = new Uint8Array(photo.bytes);
    householdPhotos.push({ path, file, type: photo.type });
  }
  const photoEntries: PhotoEntry[] = [];

  for (const photo of photos) {
    // Reads both row shapes, so a backup taken right after the upgrade still
    // carries photos written as Blobs (src/photos/photoBytes.ts).
    const { bytes, type } = await photoPayload(photo);
    const file = `${PHOTO_DIR}/${photo.id}.${photoExtension(type)}`;
    files[file] = bytes;
    photoEntries.push({ id: photo.id, createdAt: photo.createdAt, file, type });
  }

  const manifest: BackupManifest = {
    households, householdPhotos, originalPlans: (await database.householdOriginals.toArray()).map(row => row.plan),
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
  for (const photo of manifest.householdPhotos ?? []) {
    if (!archive[photo.file]) throw new BackupFormatError('공유 사진이 누락된 백업입니다.');
  }
  const sharedPaths = new Set((manifest.householdPhotos ?? []).map(photo => photo.path));
  for (const household of manifest.households ?? []) {
    const dishes = [...household.menu.map(m => m.recipe), ...household.orders.flatMap(o => o.items), ...household.plans.flatMap(p => p.items)];
    if (dishes.some(dish => dish.photoPath && !sharedPaths.has(dish.photoPath))) throw new BackupFormatError('공유 사진 참조가 누락된 백업입니다.');
  }

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
    // Copied into a standalone ArrayBuffer: fflate hands back a Uint8Array that
    // may be a view onto a larger shared buffer, and storing that would persist
    // the whole archive behind every photo.
    const source = archive[entry.file]!;
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    return {
      id: entry.id,
      bytes: bytes.buffer,
      type: entry.type,
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
      database.householdRecovery,
      database.householdPhotos,
      database.householdOriginals,
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
      if (manifest.mealPlans.length > 0) await database.mealPlans.bulkAdd(manifest.mealPlans.map(plan => {
        if (!plan.householdId) return plan;
        // Archive restoration creates a local recovery plan, never a live order.
        const { householdId: _household, sourceOrderId: _order, ...local } = plan;
        return { ...local, id: crypto.randomUUID() };
      }));
      if (manifest.shoppingItems.length > 0) await database.shoppingItems.bulkAdd(manifest.shoppingItems);
      for (const snapshot of manifest.households ?? []) await database.householdRecovery.put({ id: snapshot.householdId, snapshot });
      for (const entry of manifest.householdPhotos ?? []) {
        const source = archive[entry.file]!;
        const bytes = new Uint8Array(source.length); bytes.set(source);
        await database.householdPhotos.put({ id: entry.path, bytes: bytes.buffer, type: entry.type });
      }
      for (const plan of manifest.originalPlans ?? []) await database.householdOriginals.put({ id: plan.id, plan });
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

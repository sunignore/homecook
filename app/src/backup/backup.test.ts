import { beforeEach, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { HomecookDB, saveRecipe } from '../db/db';
import type { CookLog, Ingredient, Recipe } from '../db/types';
import { backupFileName, exportBackup, readBackup, restoreBackup } from './backup';
import { BACKUP_FORMAT, BackupFormatError, MANIFEST_NAME } from './format';

// Export is the only durability story this app has (ADR-0001). The test that
// matters is the round trip through a full wipe — anything less does not prove
// the user could actually recover.

const now = 1_757_000_000_000;

let db: HomecookDB;

function ingredient(id: string, name: string): Ingredient {
  return {
    id,
    name,
    aliases: [],
    category: 'vegetable',
    defaultUnit: 'g',
    isStaple: false,
    createdAt: now,
    updatedAt: now,
  };
}

function recipeInput(id: string, title: string, ingredientIds: string[]) {
  return {
    id,
    title,
    servings: 2,
    tags: ['한식'],
    ingredients: ingredientIds.map(ingredientId => ({
      ingredientId,
      qty: 1,
      unit: 'ea',
      optional: false,
    })),
    steps: [{ text: '10분 끓인다', durationSec: 600 }],
    createdAt: now,
  };
}

function cookLog(id: string, recipeId: string): CookLog {
  return {
    id,
    recipeId,
    cookedAt: now,
    rating: 4,
    memo: '다음엔 설탕 반으로',
    createdAt: now,
    updatedAt: now,
  };
}

async function seed() {
  await db.ingredients.bulkAdd([ingredient('i-a', '두부'), ingredient('i-b', '대파')]);
  await saveRecipe(recipeInput('r-1', '된장찌개', ['i-a', 'i-b']), db);
  await saveRecipe(recipeInput('r-2', '김치찌개', ['i-a']), db);
  await db.cookLogs.add(cookLog('c-1', 'r-1'));
  await db.photos.add({
    id: 'p-1',
    blob: new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' }),
    createdAt: now,
  });
}

async function wipe() {
  await Promise.all([
    db.recipes.clear(),
    db.ingredients.clear(),
    db.cookLogs.clear(),
    db.photos.clear(),
  ]);
}

beforeEach(async () => {
  db = new HomecookDB(`homecook-backup-${crypto.randomUUID()}`);
  await db.open();
});

describe('exportBackup', () => {
  it('writes a manifest and one file per photo', async () => {
    await seed();
    const blob = await exportBackup(db);
    const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));

    expect(Object.keys(archive)).toContain(MANIFEST_NAME);
    expect(Object.keys(archive).some(k => k.startsWith('photos/'))).toBe(true);

    const manifest = JSON.parse(new TextDecoder().decode(archive[MANIFEST_NAME]!));
    expect(manifest.format).toBe(BACKUP_FORMAT);
    expect(manifest.counts).toEqual({ recipes: 2, ingredients: 2, cookLogs: 1, photos: 1 });
  });

  it('exports an empty archive without failing', async () => {
    const blob = await exportBackup(db);
    const { manifest } = await readBackup(blob);
    expect(manifest.counts.recipes).toBe(0);
  });

  it('names the file by local date, not UTC', () => {
    // 2026-09-07 22:30 local — a UTC-derived name would say the 8th east of UTC.
    const at = new Date(2026, 8, 7, 22, 30);
    expect(backupFileName(at)).toBe('homecook-backup-2026-09-07.zip');
  });
});

describe('restore round trip', () => {
  it('brings back every recipe, ingredient, log and photo after a full wipe', async () => {
    await seed();
    const blob = await exportBackup(db);

    await wipe();
    expect(await db.recipes.count()).toBe(0);

    const restored = await restoreBackup(await readBackup(blob), db);

    expect(restored).toEqual({ recipes: 2, ingredients: 2, cookLogs: 1, photos: 1 });
    expect(await db.recipes.count()).toBe(2);
    expect(await db.ingredients.count()).toBe(2);
    expect(await db.cookLogs.count()).toBe(1);
    expect(await db.photos.count()).toBe(1);
  });

  it('preserves photo bytes and mime type', async () => {
    await seed();
    const blob = await exportBackup(db);
    await wipe();
    await restoreBackup(await readBackup(blob), db);

    const photo = await db.photos.get('p-1');
    expect(photo?.blob.type).toBe('image/png');
    expect(new Uint8Array(await photo!.blob.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    );
  });

  it('keeps ingredient references resolvable after restore', async () => {
    await seed();
    const blob = await exportBackup(db);
    await wipe();
    await restoreBackup(await readBackup(blob), db);

    const recipe = await db.recipes.get('r-1');
    for (const ri of recipe!.ingredients) {
      expect(await db.ingredients.get(ri.ingredientId)).toBeDefined();
    }
  });

  it('keeps the derived index queryable after restore', async () => {
    await seed();
    const blob = await exportBackup(db);
    await wipe();
    await restoreBackup(await readBackup(blob), db);

    // If ingredientIds did not survive, every M3 suggestion would silently
    // return nothing after a restore.
    const found = await db.recipes.where('ingredientIds').equals('i-a').toArray();
    expect(found.map(r => r.id).sort()).toEqual(['r-1', 'r-2']);
  });

  it('replaces rather than merges', async () => {
    await seed();
    const blob = await exportBackup(db);

    await saveRecipe(recipeInput('r-9', '나중에 넣은 레시피', ['i-a']), db);
    expect(await db.recipes.count()).toBe(3);

    await restoreBackup(await readBackup(blob), db);

    expect(await db.recipes.count()).toBe(2);
    expect(await db.recipes.get('r-9')).toBeUndefined();
  });
});

describe('rejecting bad archives', () => {
  it('rejects a file that is not a zip', async () => {
    const blob = new Blob([new TextEncoder().encode('not a zip')]);
    await expect(readBackup(blob)).rejects.toBeInstanceOf(BackupFormatError);
  });

  it('rejects a zip with no manifest', async () => {
    const { zipSync } = await import('fflate');
    const zipped = zipSync({ 'readme.txt': new TextEncoder().encode('hello') });
    await expect(readBackup(new Blob([zipped]))).rejects.toThrow(/data\.json/);
  });

  it('rejects a backup from a newer app version', async () => {
    const { zipSync } = await import('fflate');
    const manifest = {
      format: BACKUP_FORMAT,
      version: 99,
      schemaVersion: 1,
      exportedAt: now,
      counts: { recipes: 0, ingredients: 0, cookLogs: 0, photos: 0 },
      recipes: [],
      ingredients: [],
      cookLogs: [],
      photos: [],
    };
    const zipped = zipSync({
      [MANIFEST_NAME]: new TextEncoder().encode(JSON.stringify(manifest)),
    });
    await expect(readBackup(new Blob([zipped]))).rejects.toThrow(/업데이트/);
  });

  it('rejects an archive whose photo files are missing', async () => {
    const { zipSync } = await import('fflate');
    const manifest = {
      format: BACKUP_FORMAT,
      version: 1,
      schemaVersion: 1,
      exportedAt: now,
      counts: { recipes: 0, ingredients: 0, cookLogs: 0, photos: 1 },
      recipes: [],
      ingredients: [],
      cookLogs: [],
      photos: [{ id: 'p-1', createdAt: now, file: 'photos/p-1.png', type: 'image/png' }],
    };
    const zipped = zipSync({
      [MANIFEST_NAME]: new TextEncoder().encode(JSON.stringify(manifest)),
    });
    await expect(readBackup(new Blob([zipped]))).rejects.toThrow(/사진/);
  });

  it('leaves existing data untouched when a restore is rejected', async () => {
    await seed();
    const before = await db.recipes.count();

    await expect(readBackup(new Blob([new TextEncoder().encode('junk')]))).rejects.toThrow();

    // Validation happens before anything destructive — the archive is intact.
    expect(await db.recipes.count()).toBe(before);
  });
});

describe('restoring into a database that already failed mid-way', () => {
  it('rolls back when a restore throws, leaving the previous data', async () => {
    await seed();
    const blob = await exportBackup(db);
    const preview = await readBackup(blob);

    // A duplicate primary key inside the payload makes bulkAdd throw partway.
    preview.manifest.recipes.push(preview.manifest.recipes[0] as Recipe);

    await expect(restoreBackup(preview, db)).rejects.toThrow();

    expect(await db.recipes.count()).toBe(2);
    expect(await db.ingredients.count()).toBe(2);
  });
});

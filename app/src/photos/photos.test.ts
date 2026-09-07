import { beforeEach, describe, expect, it } from 'vitest';
import { HomecookDB, saveRecipe } from '../db/db';
import { fitWithin, MAX_EDGE } from './resizeImage';
import { pruneOrphanPhotos, putPhoto, replaceRecipePhoto } from './photoStore';

// preparePhoto itself needs a real canvas, so it is exercised in the browser.
// What is unit-tested here is the sizing arithmetic and the storage bookkeeping —
// the parts where a mistake leaks quota silently.

describe('fitWithin', () => {
  it('scales a landscape photo down by its long edge', () => {
    expect(fitWithin({ width: 4032, height: 3024 })).toEqual({ width: 1280, height: 960 });
  });

  it('scales a portrait photo down by its long edge', () => {
    expect(fitWithin({ width: 3024, height: 4032 })).toEqual({ width: 960, height: 1280 });
  });

  it('leaves a small photo alone rather than upscaling it', () => {
    // Enlarging produces a bigger file with no more detail.
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it('keeps the long edge exactly at the limit', () => {
    const fitted = fitWithin({ width: 5000, height: 1000 });
    expect(Math.max(fitted.width, fitted.height)).toBe(MAX_EDGE);
  });

  it('never rounds a dimension down to zero', () => {
    const fitted = fitWithin({ width: 10000, height: 3 });
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });

  it('handles a degenerate size without dividing by zero', () => {
    expect(fitWithin({ width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
  });
});

const now = 1_757_000_000_000;
let db: HomecookDB;

function blob(byte: number): Blob {
  return new Blob([new Uint8Array([byte, byte, byte])], { type: 'image/jpeg' });
}

function recipeInput(id: string, photoId?: string) {
  return {
    id,
    title: '김치찌개',
    servings: 2,
    tags: [],
    ingredients: [{ ingredientId: 'i-a', qty: 1, unit: 'ea', optional: false }],
    steps: [{ text: '끓인다' }],
    createdAt: now,
    ...(photoId ? { photoId } : {}),
  };
}

beforeEach(async () => {
  db = new HomecookDB(`homecook-photos-${crypto.randomUUID()}`);
  await db.open();
});

describe('putPhoto', () => {
  it('stores the blob and returns its id', async () => {
    const id = await putPhoto(blob(1), db);
    const stored = await db.photos.get(id);
    expect(stored?.blob.type).toBe('image/jpeg');
  });
});

describe('replaceRecipePhoto', () => {
  it('attaches a photo to a recipe that had none', async () => {
    await saveRecipe(recipeInput('r-1'), db);

    const id = await replaceRecipePhoto('r-1', blob(1), db);

    expect((await db.recipes.get('r-1'))?.photoId).toBe(id);
    expect(await db.photos.count()).toBe(1);
  });

  it('discards the previous photo instead of leaking it', async () => {
    const oldId = await putPhoto(blob(1), db);
    await saveRecipe(recipeInput('r-1', oldId), db);

    const newId = await replaceRecipePhoto('r-1', blob(2), db);

    // An orphan blob is invisible in the UI but keeps counting against quota
    // and inflates every backup.
    expect(await db.photos.get(oldId)).toBeUndefined();
    expect(await db.photos.count()).toBe(1);
    expect((await db.recipes.get('r-1'))?.photoId).toBe(newId);
  });

  it('removes the photo when passed null', async () => {
    const oldId = await putPhoto(blob(1), db);
    await saveRecipe(recipeInput('r-1', oldId), db);

    await replaceRecipePhoto('r-1', null, db);

    expect(await db.photos.count()).toBe(0);
    expect((await db.recipes.get('r-1'))?.photoId).toBeUndefined();
  });

  it('does nothing for a recipe that does not exist', async () => {
    await replaceRecipePhoto('missing', blob(1), db);
    expect(await db.photos.count()).toBe(0);
  });

  it('stamps updatedAt so the list reorders', async () => {
    await saveRecipe(recipeInput('r-1'), db);
    const before = (await db.recipes.get('r-1'))!.updatedAt;

    await replaceRecipePhoto('r-1', blob(1), db);

    expect((await db.recipes.get('r-1'))!.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('pruneOrphanPhotos', () => {
  it('removes photos no recipe points at', async () => {
    const kept = await putPhoto(blob(1), db);
    await putPhoto(blob(2), db);
    await putPhoto(blob(3), db);
    await saveRecipe(recipeInput('r-1', kept), db);

    expect(await pruneOrphanPhotos(db)).toBe(2);
    expect(await db.photos.count()).toBe(1);
    expect(await db.photos.get(kept)).toBeDefined();
  });

  it('is a no-op when everything is referenced', async () => {
    const id = await putPhoto(blob(1), db);
    await saveRecipe(recipeInput('r-1', id), db);

    expect(await pruneOrphanPhotos(db)).toBe(0);
    expect(await db.photos.count()).toBe(1);
  });
});

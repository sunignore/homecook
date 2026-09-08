// Photo persistence, kept separate from the recipe write so a failed image
// never blocks saving the recipe itself.

import { db, HomecookDB } from '../db/db';
import { toPhotoRecord } from './photoBytes';

/**
 * Store a prepared image and return its id.
 *
 * The caller passes an already-downscaled blob (see preparePhoto) — this layer
 * does not resize, so nothing can accidentally persist a 5 MB original.
 */
export async function putPhoto(blob: Blob, database: HomecookDB = db): Promise<string> {
  const photo = await toPhotoRecord(blob, crypto.randomUUID());
  await database.photos.add(photo);
  return photo.id;
}

/**
 * Point a recipe at a new photo, discarding the one it had.
 *
 * Done in one transaction: an orphaned blob is invisible in the UI but keeps
 * counting against the storage quota and inflates every backup, and nothing
 * would ever clean it up.
 */
export async function replaceRecipePhoto(
  recipeId: string,
  blob: Blob | null,
  database: HomecookDB = db,
): Promise<string | undefined> {
  let newId: string | undefined;

  // Encoded before the transaction opens: reading a Blob is not an IndexedDB
  // operation, and awaiting one inside a transaction lets it auto-commit.
  const record = blob ? await toPhotoRecord(blob, crypto.randomUUID()) : null;

  await database.transaction('rw', database.recipes, database.photos, async () => {
    const recipe = await database.recipes.get(recipeId);
    if (!recipe) return;

    if (recipe.photoId) await database.photos.delete(recipe.photoId);

    if (record) {
      newId = record.id;
      await database.photos.add(record);
    }

    await database.recipes.update(recipeId, { photoId: newId, updatedAt: Date.now() });
  });

  return newId;
}

/**
 * Delete photo rows no recipe points at.
 *
 * A safety net rather than the main mechanism — the write paths clean up after
 * themselves — because a leak here is silent: it shows up only as a backup that
 * keeps growing.
 */
export async function pruneOrphanPhotos(database: HomecookDB = db): Promise<number> {
  let removed = 0;

  await database.transaction('rw', database.recipes, database.photos, async () => {
    const recipes = await database.recipes.toArray();
    const referenced = new Set(recipes.map(r => r.photoId).filter(Boolean) as string[]);
    const ids = (await database.photos.toArray()).map(p => p.id);
    const orphans = ids.filter(id => !referenced.has(id));

    if (orphans.length > 0) {
      await database.photos.bulkDelete(orphans);
      removed = orphans.length;
    }
  });

  return removed;
}

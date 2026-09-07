// Cook log — what actually happened when this recipe was made.
//
// The tweak field is the point of the whole feature: "half the sugar next time"
// is the note that otherwise lives in someone's head and is gone by the next
// attempt (docs/product-brief.md §3, M1).

import { db, HomecookDB } from '../db/db';
import type { CookLog, Rating } from '../db/types';

export interface CookLogDraft {
  recipeId: string;
  rating: Rating;
  memo?: string;
  tweaks?: string;
  /** Defaults to now; settable so a meal can be logged after the fact. */
  cookedAt?: number;
}

export class UnknownRecipeError extends Error {
  constructor(recipeId: string) {
    super(`No recipe with id ${recipeId}`);
    this.name = 'UnknownRecipeError';
  }
}

/**
 * Record one cooking session.
 *
 * Verifies the recipe exists first: a log pointing at a deleted recipe would be
 * unreachable from every screen while still counting in the totals.
 */
export async function addCookLog(
  draft: CookLogDraft,
  database: HomecookDB = db,
): Promise<string> {
  const now = Date.now();
  const id = crypto.randomUUID();

  await database.transaction('rw', database.recipes, database.cookLogs, async () => {
    const recipe = await database.recipes.get(draft.recipeId);
    if (!recipe) throw new UnknownRecipeError(draft.recipeId);

    await database.cookLogs.add({
      id,
      recipeId: draft.recipeId,
      cookedAt: draft.cookedAt ?? now,
      rating: draft.rating,
      memo: draft.memo?.trim() || undefined,
      tweaks: draft.tweaks?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
  });

  return id;
}

/** Logs for one recipe, most recent first. */
export async function cookLogsFor(
  recipeId: string,
  database: HomecookDB = db,
): Promise<CookLog[]> {
  const logs = await database.cookLogs.where('recipeId').equals(recipeId).toArray();
  return logs.sort((a, b) => b.cookedAt - a.cookedAt);
}

export async function deleteCookLog(id: string, database: HomecookDB = db): Promise<void> {
  await database.cookLogs.delete(id);
}

export interface CookSummary {
  count: number;
  lastCookedAt: number | null;
  /** Mean rating, rounded to one decimal; null when never cooked. */
  averageRating: number | null;
}

export function summarize(logs: readonly CookLog[]): CookSummary {
  if (logs.length === 0) return { count: 0, lastCookedAt: null, averageRating: null };

  const total = logs.reduce((sum, l) => sum + l.rating, 0);
  return {
    count: logs.length,
    lastCookedAt: Math.max(...logs.map(l => l.cookedAt)),
    averageRating: Math.round((total / logs.length) * 10) / 10,
  };
}

/**
 * Delete a recipe and everything that only exists because of it.
 *
 * Deleting the recipe alone would strand its cook logs: nothing lists them, but
 * they keep counting in Settings and in a backup, which makes the archive look
 * larger than it is and never shrinks.
 */
export async function deleteRecipeWithLogs(
  recipeId: string,
  database: HomecookDB = db,
): Promise<{ logsDeleted: number }> {
  let logsDeleted = 0;

  await database.transaction('rw', database.recipes, database.cookLogs, database.photos, async () => {
    const recipe = await database.recipes.get(recipeId);
    logsDeleted = await database.cookLogs.where('recipeId').equals(recipeId).delete();
    if (recipe?.photoId) await database.photos.delete(recipe.photoId);
    await database.recipes.delete(recipeId);
  });

  return { logsDeleted };
}

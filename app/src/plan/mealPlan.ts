// Weekly meal plan — implements docs/data-model.md §2 (M4). One entry per
// (date, slot): setting a slot again replaces what was there rather than
// stacking a second entry, since a calendar cell can only hold one plan.

import { db, HomecookDB } from '../db/db';
import type { MealPlan, MealSlot } from '../db/types';
import { cachedSnapshot } from '../household/cache';
import { configured } from '../household/config';

export interface MealPlanDraft {
  date: string;
  slot: MealSlot;
  recipeId?: string;
  freeText?: string;
}

// Writing a plan is the ordinary local path, so the shared-server bundle is
// fetched only once this device is actually paired — a local-only user never
// downloads it (design.md E6). Both checks come from Supabase-free modules.
async function shareWrite(
  draft: Pick<MealPlan, 'date' | 'slot' | 'recipeId' | 'freeText'>,
  clear = false,
): Promise<boolean> {
  if (!configured || !(await cachedSnapshot())) return false;
  const { writeSharedPlan } = await import('../household/client');
  return writeSharedPlan(draft, clear);
}

async function findEntry(
  date: string,
  slot: MealSlot,
  database: HomecookDB,
): Promise<MealPlan | undefined> {
  return database.mealPlans
    .where('date')
    .equals(date)
    .filter(p => p.slot === slot)
    .first();
}

export async function setMealPlan(draft: MealPlanDraft, database: HomecookDB = db): Promise<string> {
  if (database === db && await shareWrite(draft)) return 'shared';
  const now = Date.now();

  return database.transaction('rw', database.mealPlans, async () => {
    const existing = await findEntry(draft.date, draft.slot, database);

    if (existing) {
      await database.mealPlans.update(existing.id, {
        recipeId: draft.recipeId,
        freeText: draft.freeText,
        updatedAt: now,
      });
      return existing.id;
    }

    const id = crypto.randomUUID();
    await database.mealPlans.add({
      id,
      date: draft.date,
      slot: draft.slot,
      recipeId: draft.recipeId,
      freeText: draft.freeText,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
}

export async function clearMealPlan(
  date: string,
  slot: MealSlot,
  database: HomecookDB = db,
): Promise<void> {
  if (database === db && await shareWrite({ date, slot }, true)) return;
  await database.mealPlans
    .where('date')
    .equals(date)
    .filter(p => p.slot === slot)
    .delete();
}

/** Every plan entry across a set of dates, e.g. one calendar week. */
export async function mealPlansForDates(
  dates: readonly string[],
  database: HomecookDB = db,
): Promise<MealPlan[]> {
  if (dates.length === 0) return [];
  return database.mealPlans.where('date').anyOf(dates as string[]).toArray();
}

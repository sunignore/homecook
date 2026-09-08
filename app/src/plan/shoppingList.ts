// Shopping list — implements docs/data-model.md §2 (M4): plan -> shopping
// list, aggregating ingredients and subtracting pantry stock (docs/product-brief.md
// §3), and "check off -> restock pantry".

import { db, HomecookDB } from '../db/db';
import { restockPantry } from '../pantry/pantry';
import type { ShoppingItem } from '../db/types';

/**
 * Marks a row as generated from the plan rather than added by hand.
 *
 * `ShoppingItem.sourceMealPlanId` is documented as "null = manually added",
 * but a generated row aggregates ingredients across every meal plan entry
 * that needs them, so it cannot point at a single contributing entry. This
 * sentinel is the simplest thing that satisfies the actual distinction the
 * field exists for.
 */
export const GENERATED_MARKER = 'plan';

interface NeededAmount {
  ingredientId: string;
  unit: string;
  qty: number;
}

/** Aggregate qty per (ingredientId, unit) across a set of recipes. Units are
 *  never auto-converted (docs/data-model.md §5), so "onion 2 ea" and "onion
 *  100 g" stay two separate lines rather than being guessed into one. */
function aggregateNeeded(recipes: readonly { ingredients: readonly { ingredientId: string; unit: string; qty: number | null; optional: boolean }[] }[]): Map<string, NeededAmount> {
  const needed = new Map<string, NeededAmount>();
  for (const recipe of recipes) {
    for (const ri of recipe.ingredients) {
      // "To taste" needs no specific amount, and an optional ingredient isn't
      // required for the dish to work — neither belongs on a shopping list
      // generated automatically.
      if (ri.optional || ri.qty === null) continue;
      const key = `${ri.ingredientId}::${ri.unit}`;
      const existing = needed.get(key);
      if (existing) existing.qty += ri.qty;
      else needed.set(key, { ingredientId: ri.ingredientId, unit: ri.unit, qty: ri.qty });
    }
  }
  return needed;
}

/**
 * Generate the shopping list for a set of plan dates.
 *
 * Replaces the previously generated, not-yet-bought rows — regenerating
 * reflects the plan as it stands now. Rows already checked off (bought) and
 * anything the user added by hand are left untouched.
 */
export async function generateShoppingList(
  dates: readonly string[],
  database: HomecookDB = db,
): Promise<{ added: number }> {
  return database.transaction(
    'rw',
    database.mealPlans,
    database.recipes,
    database.pantryItems,
    database.shoppingItems,
    async () => {
      const plans = dates.length === 0 ? [] : await database.mealPlans.where('date').anyOf(dates as string[]).toArray();
      const planned = plans.filter(p => p.recipeId);
      const byId = new Map(
        (await database.recipes.bulkGet([...new Set(planned.map(p => p.recipeId!))]))
          .filter(r => r !== undefined)
          .map(r => [r.id, r]),
      );

      // One entry PER PLANNED MEAL, not per distinct recipe: cooking the same
      // dish twice in a week needs two batches of its ingredients. Deduplicating
      // here would shop for one and send the user back to the shop mid-week.
      const recipesToShopFor = planned
        .map(p => byId.get(p.recipeId!))
        .filter(r => r !== undefined);

      const needed = aggregateNeeded(recipesToShopFor);

      const pantryItems = await database.pantryItems.toArray();
      const pantryByKey = new Map<string, number>();
      for (const item of pantryItems) {
        const key = `${item.ingredientId}::${item.unit}`;
        pantryByKey.set(key, (pantryByKey.get(key) ?? 0) + item.qty);
      }

      const toBuy = [...needed.entries()]
        .map(([key, need]) => ({ ...need, remaining: need.qty - (pantryByKey.get(key) ?? 0) }))
        .filter(n => n.remaining > 0);

      await database.shoppingItems.filter(i => i.sourceMealPlanId === GENERATED_MARKER && !i.checked).delete();

      const now = Date.now();
      if (toBuy.length > 0) {
        await database.shoppingItems.bulkAdd(
          toBuy.map(n => ({
            id: crypto.randomUUID(),
            ingredientId: n.ingredientId,
            qty: n.remaining,
            unit: n.unit,
            checked: false,
            sourceMealPlanId: GENERATED_MARKER,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      return { added: toBuy.length };
    },
  );
}

export interface ShoppingItemDraft {
  ingredientId: string;
  qty: number;
  unit: string;
}

export async function addShoppingItem(
  draft: ShoppingItemDraft,
  database: HomecookDB = db,
): Promise<string> {
  const now = Date.now();
  const id = crypto.randomUUID();
  await database.shoppingItems.add({
    id,
    ingredientId: draft.ingredientId,
    qty: draft.qty,
    unit: draft.unit,
    checked: false,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function deleteShoppingItem(id: string, database: HomecookDB = db): Promise<void> {
  await database.shoppingItems.delete(id);
}

/**
 * Check or uncheck a shopping item.
 *
 * Checking it off restocks the pantry (docs/product-brief.md §3, M4) — the
 * whole point of closing the loop back to "what's in the fridge" rather than
 * leaving the shopping trip as a dead end. Unchecking does not reverse the
 * restock: by the time someone unchecks a box the groceries are usually
 * already put away, and guessing otherwise risks silently removing pantry
 * stock that's actually sitting on the counter.
 */
export async function toggleShoppingItem(
  id: string,
  checked: boolean,
  database: HomecookDB = db,
): Promise<void> {
  await database.transaction('rw', database.shoppingItems, database.pantryItems, async () => {
    const item = await database.shoppingItems.get(id);
    if (!item) return;

    if (checked && !item.checked) {
      // Restock wherever this ingredient already lives — defaulting to a
      // fixed location would fragment the pantry into a duplicate row every
      // time someone buys more of something they already keep in the fridge
      // or freezer. 'pantry' is only a fallback for an ingredient with no
      // existing stock at all.
      const existing = await database.pantryItems.where('ingredientId').equals(item.ingredientId).first();
      await restockPantry(
        {
          ingredientId: item.ingredientId,
          qty: item.qty,
          unit: item.unit,
          location: existing?.location ?? 'pantry',
          boughtAt: Date.now(),
        },
        database,
      );
    }

    await database.shoppingItems.update(id, { checked, updatedAt: Date.now() });
  });
}

export async function clearChecked(database: HomecookDB = db): Promise<number> {
  return database.shoppingItems.filter(i => i.checked).delete();
}

export function sortShoppingItems(items: readonly ShoppingItem[]): ShoppingItem[] {
  // Unchecked first (what's left to buy), each group oldest first so the
  // list doesn't reshuffle under the shopper's thumb as items are checked.
  return [...items].sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    return a.createdAt - b.createdAt;
  });
}

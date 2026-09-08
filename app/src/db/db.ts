// Dexie database — implements docs/data-model.md §3-§4.
//
// Versioning policy (data-model §3): never edit a shipped version(n) block; add
// version(n+1). Planned: v1 = M1, v2 = pantryItems (M3), v3 = mealPlans +
// shoppingItems (M4).

import Dexie, { type Table } from 'dexie';
import type { CookLog, Ingredient, MealPlan, PantryItem, Recipe, ShoppingItem, StoredPhoto } from './types';

export class HomecookDB extends Dexie {
  householdCache!: Table<{ id: string; snapshot: unknown; syncedAt: number }, string>;
  householdOriginals!: Table<{ id: string; plan: MealPlan }, string>;
  householdPhotos!: Table<{ id: string; bytes: ArrayBuffer; type: string }, string>;
  householdRecovery!: Table<{ id: string; snapshot: unknown }, string>;
  ingredients!: Table<Ingredient, string>;
  recipes!: Table<Recipe, string>;
  photos!: Table<StoredPhoto, string>;
  cookLogs!: Table<CookLog, string>;
  pantryItems!: Table<PantryItem, string>;
  mealPlans!: Table<MealPlan, string>;
  shoppingItems!: Table<ShoppingItem, string>;

  constructor(name = 'homecook') {
    super(name);

    // v1 — M1. `*ingredientIds` is the index behind the M3 "which recipes use
    // what I have" query. It indexes the derived flat array, NOT
    // `ingredients[].ingredientId`: IndexedDB cannot resolve a dotted keyPath
    // through an array of objects, and such an index matches nothing while
    // looking perfectly correct in the schema string.
    this.version(1).stores({
      ingredients: 'id, name, category, isStaple, *aliases',
      recipes: 'id, title, updatedAt, *tags, *ingredientIds',
      photos: 'id',
      cookLogs: 'id, recipeId, cookedAt',
    });

    // v2 — M3. Adds only a table, so no upgrade function is needed (data-model
    // §3). `expiresAt` is indexed for the expiry-first pantry ordering.
    this.version(2).stores({
      pantryItems: 'id, ingredientId, expiresAt, location',
    });

    // v3 — M4. Adds only tables, so no upgrade function is needed either.
    this.version(3).stores({
      mealPlans: 'id, date, slot, recipeId',
      shoppingItems: 'id, ingredientId, checked, sourceMealPlanId',
    });
    this.version(4).stores({
      householdCache: 'id',
      householdOriginals: 'id',
      householdPhotos: 'id',
      householdRecovery: 'id',
    });
  }
}

export const db = new HomecookDB();

/** Derive the flat index array from a recipe's ingredient references. */
export function deriveIngredientIds(recipe: Pick<Recipe, 'ingredients'>): string[] {
  return [...new Set(recipe.ingredients.map(i => i.ingredientId))];
}

/**
 * The only supported write path for recipes.
 *
 * Keeps the derived `ingredientIds` index array in sync with `ingredients` and
 * stamps `updatedAt`. Writing a recipe with `db.recipes.put()` directly will
 * compile, but leaves the index stale and quietly breaks M3 suggestions.
 */
export async function saveRecipe(
  recipe: Omit<Recipe, 'ingredientIds' | 'updatedAt'> & Partial<Pick<Recipe, 'updatedAt'>>,
  database: HomecookDB = db,
): Promise<string> {
  return database.recipes.put({
    ...recipe,
    ingredientIds: deriveIngredientIds(recipe),
    updatedAt: Date.now(),
  });
}

/**
 * Ask the browser to exempt this origin from storage eviction.
 *
 * There is no server copy of any of this (ADR-0001), so eviction is permanent
 * data loss. Best-effort: the browser may refuse, and Safari ignores it until
 * the app is added to the home screen — which is why an explicit backup export
 * is an M1 completion requirement rather than a later convenience.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

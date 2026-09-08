// Deterministic "what can I cook" scoring — docs/product-brief.md §5. No model
// inference: a personal recipe archive is small enough that a simple ratio
// over the normalized ingredient references (ADR-0002) is both correct and
// cheap enough to recompute on every pantry change.
//
// Pure functions over plain arrays/maps rather than reading the database
// directly, so the scoring rules are testable without IndexedDB.

import type { CookLog, Ingredient, PantryItem, Recipe } from '../db/types';

export interface Suggestion {
  recipe: Recipe;
  /** (required, non-staple ingredients present in pantry) / (required,
   *  non-staple ingredients). 1 when the recipe needs nothing the pantry
   *  doesn't have — including a recipe built entirely from staples. */
  score: number;
  requiredCount: number;
  presentCount: number;
  /** Required, non-staple ingredient ids not currently in the pantry. */
  missing: string[];
  /** Soonest expiry among pantry items this recipe would use, if any —
   *  the tie-break that surfaces "use this before it goes off". */
  soonestExpiryUsed?: number;
  lastCookedAt?: number;
}

/** Every ingredient a recipe requires (not marked optional), deduplicated. */
function requiredIngredientIds(recipe: Recipe): string[] {
  return [...new Set(recipe.ingredients.filter(ri => !ri.optional).map(ri => ri.ingredientId))];
}

export function scoreRecipe(
  recipe: Recipe,
  ingredientsById: ReadonlyMap<string, Ingredient>,
  pantryByIngredient: ReadonlyMap<string, PantryItem[]>,
): Omit<Suggestion, 'recipe' | 'lastCookedAt'> {
  const required = requiredIngredientIds(recipe);
  // Staples are assumed always present, so they're excluded from both sides
  // of the ratio rather than counted as an automatic "present" — otherwise a
  // recipe padded with five staples and one missing vegetable would still
  // score 5/6.
  const scored = required.filter(id => !ingredientsById.get(id)?.isStaple);

  // Having stock means a positive quantity, not merely a surviving row. A row
  // edited down to 0 as it is used up would otherwise keep scoring the recipe
  // as fully cookable, which is exactly when the answer must change.
  const inStock = (id: string) =>
    (pantryByIngredient.get(id) ?? []).reduce((sum, item) => sum + item.qty, 0) > 0;

  const present = scored.filter(inStock);
  const missing = scored.filter(id => !inStock(id));

  const score = scored.length === 0 ? 1 : present.length / scored.length;

  const expiries = scored
    .flatMap(id => pantryByIngredient.get(id) ?? [])
    .filter(p => p.qty > 0)
    .map(p => p.expiresAt)
    .filter((e): e is number => e !== undefined);

  return {
    score,
    requiredCount: scored.length,
    presentCount: present.length,
    missing,
    soonestExpiryUsed: expiries.length > 0 ? Math.min(...expiries) : undefined,
  };
}

/** Most recent `cookedAt` per recipe, for the "least recently cooked" tie-break. */
export function lastCookedByRecipe(cookLogs: readonly CookLog[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const log of cookLogs) {
    const current = map.get(log.recipeId);
    if (current === undefined || log.cookedAt > current) map.set(log.recipeId, log.cookedAt);
  }
  return map;
}

export function groupPantryByIngredient(
  pantryItems: readonly PantryItem[],
): Map<string, PantryItem[]> {
  const map = new Map<string, PantryItem[]>();
  for (const item of pantryItems) {
    const list = map.get(item.ingredientId);
    if (list) list.push(item);
    else map.set(item.ingredientId, [item]);
  }
  return map;
}

/**
 * Rank every recipe by how cookable it is right now.
 *
 * Order (docs/product-brief.md §5): score desc, then the soonest-expiring
 * pantry ingredient the recipe would use, then least recently cooked (never
 * cooked sorts first — it's the most "not recently cooked" a recipe can be).
 */
export function suggestRecipes(
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
  pantryItems: readonly PantryItem[],
  cookLogs: readonly CookLog[],
): Suggestion[] {
  const ingredientsById = new Map(ingredients.map(i => [i.id, i]));
  const pantryByIngredient = groupPantryByIngredient(pantryItems);
  const lastCooked = lastCookedByRecipe(cookLogs);

  return recipes
    .map(recipe => ({
      recipe,
      ...scoreRecipe(recipe, ingredientsById, pantryByIngredient),
      lastCookedAt: lastCooked.get(recipe.id),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aExpiry = a.soonestExpiryUsed ?? Infinity;
      const bExpiry = b.soonestExpiryUsed ?? Infinity;
      if (aExpiry !== bExpiry) return aExpiry - bExpiry;
      const aCooked = a.lastCookedAt ?? -Infinity;
      const bCooked = b.lastCookedAt ?? -Infinity;
      return aCooked - bCooked;
    });
}

/** The most actionable surface in practice: exactly one ingredient away. */
export function oneIngredientAway(suggestions: readonly Suggestion[]): Suggestion[] {
  return suggestions.filter(s => s.missing.length === 1);
}

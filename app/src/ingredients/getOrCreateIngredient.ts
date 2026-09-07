// Shared "type a name, get a resolved ingredient" step for the Pantry quick-add
// and the shopping list's manual-add — the same job importRecipe.ts does per
// row, extracted so a second copy does not drift from the alias/staple
// matching rules in ADR-0002.

import { db, HomecookDB } from '../db/db';
import type { Ingredient } from '../db/types';
import { findIngredient, guessCategory, guessIsStaple } from '../import/resolveIngredients';

export async function getOrCreateIngredient(
  name: string,
  database: HomecookDB = db,
): Promise<Ingredient> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('재료 이름을 입력해 주세요.');

  return database.transaction('rw', database.ingredients, async () => {
    // Re-checked inside the transaction, not from a stale render — the same
    // reason importRecipe.ts re-resolves rather than trusting the caller.
    const existing = await database.ingredients.toArray();
    const found = findIngredient(trimmed, existing);
    if (found) return found.match;

    const now = Date.now();
    const ingredient: Ingredient = {
      id: crypto.randomUUID(),
      name: trimmed,
      aliases: [],
      category: guessCategory(trimmed),
      defaultUnit: '',
      isStaple: guessIsStaple(trimmed),
      createdAt: now,
      updatedAt: now,
    };
    await database.ingredients.add(ingredient);
    return ingredient;
  });
}

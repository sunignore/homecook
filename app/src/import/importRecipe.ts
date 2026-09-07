// Persists a corrected import draft: creates any genuinely new Ingredient rows,
// then writes the Recipe through saveRecipe() so the derived index array stays
// in sync (docs/data-model.md §4).

import { db, HomecookDB, saveRecipe } from '../db/db';
import type { Ingredient, IngredientCategory, Recipe, RecipeStep } from '../db/types';
import { findIngredient, guessCategory, guessIsStaple, normalizeIngredientName } from './resolveIngredients';

/** One row of the correction table, after the user has edited it. */
export interface DraftIngredient {
  /** Canonical name the user settled on. */
  name: string;
  qty: number | null;
  unit: string;
  note?: string;
  optional: boolean;
  /**
   * Existing ingredient this row was matched (or manually pointed) to.
   * Absent means "create a new ingredient with this name".
   */
  ingredientId?: string;
  category?: IngredientCategory;
}

export interface RecipeDraft {
  title: string;
  servings: number;
  tags: string[];
  ingredients: DraftIngredient[];
  steps: RecipeStep[];
  sourceUrl?: string;
  sourceText?: string;
  notes?: string;
}

export class EmptyRecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyRecipeError';
  }
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Save an import draft.
 *
 * Runs in a single transaction: a recipe is never written referencing ingredient
 * rows that failed to be created, and a half-imported recipe never appears in
 * the archive.
 *
 * Returns the new recipe's id.
 */
export async function importRecipe(
  draft: RecipeDraft,
  database: HomecookDB = db,
): Promise<string> {
  return persistDraft(draft, undefined, database);
}

/**
 * Update an existing recipe from an edited draft.
 *
 * Goes through the same ingredient resolution as an import, so renaming an
 * ingredient while editing can resolve onto an existing one rather than forking
 * the vocabulary (ADR-0002). `createdAt` is preserved — the recipe was not
 * created again.
 */
export async function updateRecipe(
  recipeId: string,
  draft: RecipeDraft,
  database: HomecookDB = db,
): Promise<string> {
  return persistDraft(draft, recipeId, database);
}

async function persistDraft(
  draft: RecipeDraft,
  existingId: string | undefined,
  database: HomecookDB,
): Promise<string> {
  const title = draft.title.trim();
  if (!title) {
    throw new EmptyRecipeError('A recipe needs a title.');
  }

  const rows = draft.ingredients.filter(i => i.name.trim().length > 0);
  const now = Date.now();
  const recipeId = existingId ?? newId();

  await database.transaction('rw', database.ingredients, database.recipes, async () => {
    // Re-check inside the transaction rather than trusting the resolution the
    // correction UI computed: the archive may have changed since it rendered,
    // and creating a duplicate ingredient is the exact failure ADR-0002 exists
    // to prevent.
    const existing = await database.ingredients.toArray();
    const byKey = new Map<string, string>();
    for (const ing of existing) {
      byKey.set(normalizeIngredientName(ing.name), ing.id);
      for (const alias of ing.aliases) byKey.set(normalizeIngredientName(alias), ing.id);
    }

    const created: Ingredient[] = [];
    const resolvedIds: string[] = [];

    for (const row of rows) {
      const name = row.name.trim();
      const key = normalizeIngredientName(name);

      // An explicit id from the correction UI wins — that is the user telling
      // us which ingredient this is.
      if (row.ingredientId && existing.some(e => e.id === row.ingredientId)) {
        resolvedIds.push(row.ingredientId);
        continue;
      }

      const known = byKey.get(key);
      if (known) {
        resolvedIds.push(known);
        continue;
      }

      const ingredient: Ingredient = {
        id: newId(),
        name,
        aliases: [],
        category: row.category ?? guessCategory(name),
        defaultUnit: row.unit || '',
        isStaple: guessIsStaple(name),
        createdAt: now,
        updatedAt: now,
      };
      created.push(ingredient);
      byKey.set(key, ingredient.id);
      resolvedIds.push(ingredient.id);
    }

    if (created.length > 0) await database.ingredients.bulkAdd(created);

    const previous = existingId ? await database.recipes.get(existingId) : undefined;
    if (existingId && !previous) {
      throw new EmptyRecipeError('수정하려는 레시피를 찾을 수 없습니다.');
    }

    const recipe: Omit<Recipe, 'ingredientIds' | 'updatedAt'> = {
      id: recipeId,
      title,
      servings: draft.servings > 0 ? draft.servings : 1,
      tags: draft.tags.map(t => t.trim()).filter(Boolean),
      ingredients: rows.map((row, index) => ({
        ingredientId: resolvedIds[index]!,
        qty: row.qty,
        unit: row.unit,
        note: row.note?.trim() || undefined,
        optional: row.optional,
      })),
      steps: draft.steps.filter(s => s.text.trim().length > 0),
      createdAt: previous?.createdAt ?? now,
      ...(draft.sourceUrl ? { sourceUrl: draft.sourceUrl } : {}),
      ...(draft.sourceText ? { sourceText: draft.sourceText } : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
    };

    await saveRecipe(recipe, database);
  });

  return recipeId;
}

/** Resolve a name against the archive — used by the correction UI as it edits. */
export async function lookupIngredient(name: string, database: HomecookDB = db) {
  const existing = await database.ingredients.toArray();
  return findIngredient(name, existing);
}

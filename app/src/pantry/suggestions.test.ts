import { describe, expect, it } from 'vitest';
import type { CookLog, Ingredient, PantryItem, Recipe } from '../db/types';
import { oneIngredientAway, scoreRecipe, suggestRecipes } from './suggestions';

const now = 1_757_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function ingredient(id: string, isStaple = false): Ingredient {
  return {
    id,
    name: id,
    aliases: [],
    category: 'other',
    defaultUnit: 'g',
    isStaple,
    createdAt: now,
    updatedAt: now,
  };
}

function pantryItem(ingredientId: string, patch: Partial<PantryItem> = {}): PantryItem {
  return {
    id: `p-${ingredientId}-${Math.random()}`,
    ingredientId,
    qty: 1,
    unit: 'ea',
    location: 'pantry',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function recipe(id: string, ingredientIds: [string, boolean?][]): Recipe {
  return {
    id,
    title: id,
    servings: 2,
    tags: [],
    ingredients: ingredientIds.map(([ingredientId, optional]) => ({
      ingredientId,
      qty: 1,
      unit: 'ea',
      optional: optional ?? false,
    })),
    ingredientIds: ingredientIds.map(([id2]) => id2),
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('scoreRecipe', () => {
  const ingredientsById = new Map([
    ['salt', ingredient('salt', true)],
    ['onion', ingredient('onion')],
    ['garlic', ingredient('garlic')],
  ]);

  it('scores 1 when every non-staple required ingredient is in the pantry', () => {
    const pantryByIngredient = new Map([
      ['onion', [pantryItem('onion')]],
      ['garlic', [pantryItem('garlic')]],
    ]);
    const r = recipe('r1', [['salt'], ['onion'], ['garlic']]);
    const result = scoreRecipe(r, ingredientsById, pantryByIngredient);
    expect(result.score).toBe(1);
    expect(result.requiredCount).toBe(2); // salt excluded — it's a staple
    expect(result.missing).toEqual([]);
  });

  it('excludes staples from both sides of the ratio, not just the numerator', () => {
    const r = recipe('r1', [['salt']]);
    const result = scoreRecipe(r, ingredientsById, new Map());
    // All-staple recipe: nothing external needed, so fully cookable.
    expect(result.score).toBe(1);
    expect(result.requiredCount).toBe(0);
  });

  it('scores partial availability as a fraction and lists what is missing', () => {
    const pantryByIngredient = new Map([['onion', [pantryItem('onion')]]]);
    const r = recipe('r1', [['onion'], ['garlic']]);
    const result = scoreRecipe(r, ingredientsById, pantryByIngredient);
    expect(result.score).toBe(0.5);
    expect(result.missing).toEqual(['garlic']);
  });

  it('excludes optional ingredients from scoring entirely', () => {
    const r = recipe('r1', [['onion'], ['garlic', true]]);
    const result = scoreRecipe(r, ingredientsById, new Map());
    expect(result.requiredCount).toBe(1);
    expect(result.missing).toEqual(['onion']);
  });

  it('reports the soonest expiry among pantry items the recipe would use', () => {
    const pantryByIngredient = new Map([
      ['onion', [pantryItem('onion', { expiresAt: now + 5 * DAY })]],
      ['garlic', [pantryItem('garlic', { expiresAt: now + DAY })]],
    ]);
    const r = recipe('r1', [['onion'], ['garlic']]);
    const result = scoreRecipe(r, ingredientsById, pantryByIngredient);
    expect(result.soonestExpiryUsed).toBe(now + DAY);
  });
});

describe('suggestRecipes ordering', () => {
  const ingredients = [ingredient('onion'), ingredient('garlic'), ingredient('beef')];

  it('orders by score descending first', () => {
    const pantryItems = [pantryItem('onion'), pantryItem('garlic')];
    const full = recipe('full', [['onion'], ['garlic']]);
    const partial = recipe('partial', [['onion'], ['beef']]);

    const ranked = suggestRecipes([partial, full], ingredients, pantryItems, []);
    expect(ranked.map(s => s.recipe.id)).toEqual(['full', 'partial']);
  });

  it('breaks a score tie by the soonest-expiring pantry ingredient used', () => {
    const pantryItems = [
      pantryItem('onion', { expiresAt: now + 10 * DAY }),
      pantryItem('garlic', { expiresAt: now + DAY }),
    ];
    const usesOnion = recipe('uses-onion', [['onion']]);
    const usesGarlic = recipe('uses-garlic', [['garlic']]);

    const ranked = suggestRecipes([usesOnion, usesGarlic], ingredients, pantryItems, []);
    expect(ranked.map(s => s.recipe.id)).toEqual(['uses-garlic', 'uses-onion']);
  });

  it('breaks a further tie by least recently cooked, never-cooked first', () => {
    const pantryItems = [pantryItem('onion'), pantryItem('garlic')];
    const cookedRecently = recipe('cooked-recently', [['onion']]);
    const neverCooked = recipe('never-cooked', [['garlic']]);
    const cookLogs: CookLog[] = [
      { id: 'c1', recipeId: 'cooked-recently', cookedAt: now, rating: 5, createdAt: now, updatedAt: now },
    ];

    const ranked = suggestRecipes([cookedRecently, neverCooked], ingredients, pantryItems, cookLogs);
    expect(ranked.map(s => s.recipe.id)).toEqual(['never-cooked', 'cooked-recently']);
  });
});

describe('oneIngredientAway', () => {
  it('keeps only recipes missing exactly one ingredient', () => {
    const ingredients = [ingredient('onion'), ingredient('garlic'), ingredient('beef')];
    const pantryItems = [pantryItem('onion')];
    const oneAway = recipe('one-away', [['onion'], ['garlic']]);
    const twoAway = recipe('two-away', [['garlic'], ['beef']]);
    const complete = recipe('complete', [['onion']]);

    const ranked = suggestRecipes([oneAway, twoAway, complete], ingredients, pantryItems, []);
    expect(oneIngredientAway(ranked).map(s => s.recipe.id)).toEqual(['one-away']);
  });
});

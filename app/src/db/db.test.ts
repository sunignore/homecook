import { beforeEach, describe, expect, it } from 'vitest';
import { HomecookDB, deriveIngredientIds, saveRecipe } from './db';
import type { Ingredient, Recipe } from './types';

// Guards the two schema commitments that are expensive to get wrong later:
// normalized ingredient references (ADR-0002) and the multi-entry index that
// makes the M3 "what can I cook" query cheap (docs/data-model.md §4).

let db: HomecookDB;

const now = 1_757_000_000_000;

function ingredient(id: string, name: string, aliases: string[] = []): Ingredient {
  return {
    id,
    name,
    aliases,
    category: 'vegetable',
    defaultUnit: 'g',
    isStaple: false,
    createdAt: now,
    updatedAt: now,
  };
}

type RecipeInput = Omit<Recipe, 'ingredientIds' | 'updatedAt'>;

function recipe(id: string, title: string, ingredientIds: string[]): RecipeInput {
  return {
    id,
    title,
    servings: 2,
    tags: ['한식'],
    ingredients: ingredientIds.map(ingredientId => ({
      ingredientId,
      qty: 1,
      unit: 'ea',
      optional: false,
    })),
    steps: [{ text: '10분 끓인다', durationSec: 600 }],
    createdAt: now,
  };
}

beforeEach(async () => {
  db = new HomecookDB(`homecook-test-${crypto.randomUUID()}`);
  await db.open();
});

describe('schema v1', () => {
  it('stores a recipe with ingredient references rather than strings', async () => {
    await db.ingredients.add(ingredient('i-daepa', '대파', ['파', 'welsh onion']));
    await saveRecipe(recipe('r-1', '대파 계란국', ['i-daepa']), db);

    const stored = await db.recipes.get('r-1');
    expect(stored?.ingredients[0]?.ingredientId).toBe('i-daepa');

    const resolved = await db.ingredients.get(stored!.ingredients[0]!.ingredientId);
    expect(resolved?.name).toBe('대파');
  });

  it('finds recipes by ingredient through the multi-entry index', async () => {
    await db.ingredients.bulkAdd([ingredient('i-a', '감자'), ingredient('i-b', '양파')]);
    await saveRecipe(recipe('r-1', '감자조림', ['i-a']), db);
    await saveRecipe(recipe('r-2', '감자 양파 볶음', ['i-a', 'i-b']), db);
    await saveRecipe(recipe('r-3', '양파절임', ['i-b']), db);

    const withPotato = await db.recipes.where('ingredientIds').equals('i-a').toArray();

    expect(withPotato.map(r => r.id).sort()).toEqual(['r-1', 'r-2']);
  });

  it('matches an ingredient by alias', async () => {
    await db.ingredients.add(ingredient('i-daepa', '대파', ['파', 'welsh onion']));

    const found = await db.ingredients.where('aliases').equals('welsh onion').toArray();
    expect(found.map(i => i.name)).toEqual(['대파']);
  });

  it('keeps step durations so cook mode can build timers from M1 data', async () => {
    await saveRecipe(recipe('r-1', '된장찌개', []), db);

    const stored = await db.recipes.get('r-1');
    expect(stored?.steps[0]?.durationSec).toBe(600);
  });

  it('treats a null quantity as "to taste", not as missing data', async () => {
    await saveRecipe(
      {
        ...recipe('r-1', '나물무침', []),
        ingredients: [{ ingredientId: 'i-salt', qty: null, unit: '', optional: false }],
      },
      db,
    );

    const stored = await db.recipes.get('r-1');
    expect(stored?.ingredients[0]?.qty).toBeNull();
  });
  it('derives ingredientIds from ingredients, deduplicated', async () => {
    await saveRecipe(
      {
        ...recipe('r-1', '양파 듬뿍 카레', []),
        // The same ingredient can legitimately appear twice — e.g. half now,
        // half at the end — but the index array must list it once.
        ingredients: [
          { ingredientId: 'i-onion', qty: 1, unit: 'ea', optional: false },
          { ingredientId: 'i-onion', qty: 1, unit: 'ea', note: '마지막에', optional: false },
          { ingredientId: 'i-curry', qty: 100, unit: 'g', optional: false },
        ],
      },
      db,
    );

    const stored = await db.recipes.get('r-1');
    expect(stored?.ingredientIds.sort()).toEqual(['i-curry', 'i-onion']);
  });

  it('keeps the derived index in sync when ingredients change', async () => {
    await saveRecipe(recipe('r-1', '김치찌개', ['i-kimchi', 'i-pork']), db);
    await saveRecipe(recipe('r-1', '김치찌개', ['i-kimchi', 'i-tofu']), db);

    const byPork = await db.recipes.where('ingredientIds').equals('i-pork').toArray();
    const byTofu = await db.recipes.where('ingredientIds').equals('i-tofu').toArray();

    expect(byPork).toHaveLength(0);
    expect(byTofu.map(r => r.id)).toEqual(['r-1']);
  });

  it('deriveIngredientIds matches what is persisted', () => {
    const input = recipe('r-1', '비빔밥', ['i-a', 'i-b', 'i-a']);
    expect(deriveIngredientIds(input)).toEqual(['i-a', 'i-b']);
  });
});

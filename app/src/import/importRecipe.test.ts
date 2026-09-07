import { beforeEach, describe, expect, it } from 'vitest';
import { HomecookDB } from '../db/db';
import type { Ingredient } from '../db/types';
import { EmptyRecipeError, importRecipe, type RecipeDraft } from './importRecipe';
import {
  findIngredient,
  guessCategory,
  guessIsStaple,
  newIngredientNames,
  normalizeIngredientName,
  resolveIngredients,
} from './resolveIngredients';
import { parseRecipeText } from './parseRecipeText';
import { FORMAT_A_ALTERNATING } from '../test/fixtures/pasteFormats';

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

describe('normalizeIngredientName', () => {
  it('ignores spacing, which Korean compounds are written with inconsistently', () => {
    expect(normalizeIngredientName('다진 마늘')).toBe(normalizeIngredientName('다진마늘'));
  });

  it('ignores case for Latin names', () => {
    expect(normalizeIngredientName('Olive Oil')).toBe(normalizeIngredientName('olive oil'));
  });
});

describe('findIngredient', () => {
  const existing = [
    ingredient('i-garlic', '다진마늘'),
    ingredient('i-daepa', '대파', ['파', 'welsh onion']),
  ];

  it('matches on the canonical name despite spacing', () => {
    expect(findIngredient('다진 마늘', existing)).toMatchObject({ via: 'name' });
  });

  it('matches on an alias', () => {
    const found = findIngredient('welsh onion', existing);
    expect(found).toMatchObject({ via: 'alias' });
    expect(found?.match.id).toBe('i-daepa');
  });

  it('returns nothing for an unknown ingredient', () => {
    expect(findIngredient('두부', existing)).toBeUndefined();
  });

  it('returns nothing for an empty name', () => {
    expect(findIngredient('   ', existing)).toBeUndefined();
  });
});

describe('resolveIngredients', () => {
  it('flags unmatched entries instead of silently creating them', () => {
    const parsed = parseRecipeText(FORMAT_A_ALTERNATING).ingredients;
    const resolved = resolveIngredients(parsed, [ingredient('i-daepa', '대파')]);

    expect(resolved).toHaveLength(parsed.length);
    expect(resolved.filter(r => r.match)).toHaveLength(1);
    expect(newIngredientNames(resolved)).toContain('묵은지');
    expect(newIngredientNames(resolved)).not.toContain('대파');
  });

  it('lists each new ingredient once even when it repeats', () => {
    const parsed = parseRecipeText('재료\n양파 1개\n양파 1/2개\n대파 1대').ingredients;
    expect(newIngredientNames(resolveIngredients(parsed, []))).toEqual(['양파', '대파']);
  });
});

describe('category and staple guesses', () => {
  it.each([
    ['간장', 'sauce'],
    ['돼지고기 목살', 'meat'],
    ['고등어', 'seafood'],
    ['계란', 'dairy'],
    ['당면', 'grain'],
    ['양파', 'vegetable'],
    ['보늬밤', 'other'],
  ])('%s → %s', (name, expected) => {
    expect(guessCategory(name)).toBe(expected);
  });

  it('marks pantry staples so M3 scoring can exclude them', () => {
    expect(guessIsStaple('소금')).toBe(true);
    expect(guessIsStaple('식용유')).toBe(true);
    expect(guessIsStaple('돼지고기')).toBe(false);
  });
});

describe('importRecipe', () => {
  let db: HomecookDB;

  beforeEach(async () => {
    db = new HomecookDB(`homecook-import-${crypto.randomUUID()}`);
    await db.open();
  });

  function draft(overrides: Partial<RecipeDraft> = {}): RecipeDraft {
    return {
      title: '김치찌개',
      servings: 2,
      tags: ['한식'],
      ingredients: [
        { name: '묵은지', qty: 300, unit: 'g', optional: false },
        { name: '두부', qty: 0.5, unit: '모', optional: false },
      ],
      steps: [{ text: '끓인다', durationSec: 600 }],
      ...overrides,
    };
  }

  it('creates the recipe and its new ingredients together', async () => {
    const id = await importRecipe(draft(), db);

    const recipe = await db.recipes.get(id);
    expect(recipe?.title).toBe('김치찌개');
    expect(recipe?.ingredients).toHaveLength(2);
    expect(await db.ingredients.count()).toBe(2);
  });

  it('stores ingredient references, never names', async () => {
    const id = await importRecipe(draft(), db);
    const recipe = await db.recipes.get(id);

    for (const ri of recipe!.ingredients) {
      expect(await db.ingredients.get(ri.ingredientId)).toBeDefined();
    }
  });

  it('reuses an existing ingredient rather than forking the vocabulary', async () => {
    await db.ingredients.add(ingredient('i-kimchi', '묵은지'));

    await importRecipe(draft(), db);

    // 묵은지 already existed; only 두부 is new.
    expect(await db.ingredients.count()).toBe(2);
    const kimchi = await db.ingredients.where('name').equals('묵은지').toArray();
    expect(kimchi).toHaveLength(1);
    expect(kimchi[0]?.id).toBe('i-kimchi');
  });

  it('matches an existing ingredient across a spacing difference', async () => {
    await db.ingredients.add(ingredient('i-garlic', '다진마늘'));

    await importRecipe(
      draft({ ingredients: [{ name: '다진 마늘', qty: 1, unit: '큰술', optional: false }] }),
      db,
    );

    expect(await db.ingredients.count()).toBe(1);
  });

  it('does not create the same new ingredient twice within one import', async () => {
    await importRecipe(
      draft({
        ingredients: [
          { name: '양파', qty: 1, unit: '개', optional: false },
          { name: '양파', qty: 1, unit: '개', note: '마지막에', optional: false },
        ],
      }),
      db,
    );

    expect(await db.ingredients.count()).toBe(1);
  });

  it('honours an explicit ingredientId chosen in the correction UI', async () => {
    await db.ingredients.add(ingredient('i-daepa', '대파', ['파']));

    const id = await importRecipe(
      draft({
        ingredients: [{ name: '쪽파', qty: 1, unit: '대', optional: false, ingredientId: 'i-daepa' }],
      }),
      db,
    );

    const recipe = await db.recipes.get(id);
    expect(recipe?.ingredients[0]?.ingredientId).toBe('i-daepa');
    expect(await db.ingredients.count()).toBe(1);
  });

  it('keeps the derived index array in sync so M3 queries work', async () => {
    const id = await importRecipe(draft(), db);
    const recipe = await db.recipes.get(id);

    expect(recipe?.ingredientIds).toHaveLength(2);
    const found = await db.recipes.where('ingredientIds').equals(recipe!.ingredientIds[0]!).toArray();
    expect(found.map(r => r.id)).toEqual([id]);
  });

  it('rejects a recipe with no title instead of saving an unfindable one', async () => {
    await expect(importRecipe(draft({ title: '  ' }), db)).rejects.toBeInstanceOf(EmptyRecipeError);
    expect(await db.recipes.count()).toBe(0);
    expect(await db.ingredients.count()).toBe(0);
  });

  it('drops blank ingredient rows left behind in the correction table', async () => {
    const id = await importRecipe(
      draft({
        ingredients: [
          { name: '두부', qty: 1, unit: '모', optional: false },
          { name: '   ', qty: null, unit: '', optional: false },
        ],
      }),
      db,
    );

    expect((await db.recipes.get(id))?.ingredients).toHaveLength(1);
    expect(await db.ingredients.count()).toBe(1);
  });

  it('imports a parsed paste end to end', async () => {
    const parsed = parseRecipeText(FORMAT_A_ALTERNATING);

    const id = await importRecipe(
      {
        title: '김치찌개',
        servings: 2,
        tags: [],
        sourceText: FORMAT_A_ALTERNATING,
        ingredients: parsed.ingredients.map(i => ({
          name: i.name,
          qty: i.qty,
          unit: i.unit,
          note: i.note,
          optional: false,
        })),
        steps: parsed.steps,
      },
      db,
    );

    const recipe = await db.recipes.get(id);
    expect(recipe?.ingredients).toHaveLength(10);
    expect(recipe?.sourceText).toBe(FORMAT_A_ALTERNATING);
    expect(await db.ingredients.count()).toBe(10);
  });
});

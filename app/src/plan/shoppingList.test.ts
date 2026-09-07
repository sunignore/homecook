import { beforeEach, describe, expect, it } from 'vitest';
import { HomecookDB, saveRecipe } from '../db/db';
import { addPantryItem } from '../pantry/pantry';
import { setMealPlan } from './mealPlan';
import {
  GENERATED_MARKER,
  addShoppingItem,
  clearChecked,
  deleteShoppingItem,
  generateShoppingList,
  sortShoppingItems,
  toggleShoppingItem,
} from './shoppingList';

let db: HomecookDB;
const now = 1_757_000_000_000;

function recipeInput(
  id: string,
  ingredients: { ingredientId: string; qty: number | null; unit: string; optional?: boolean }[],
) {
  return {
    id,
    title: id,
    servings: 2,
    tags: [],
    ingredients: ingredients.map(i => ({ ...i, optional: i.optional ?? false })),
    steps: [],
    createdAt: now,
  };
}

beforeEach(async () => {
  db = new HomecookDB(`homecook-shopping-${crypto.randomUUID()}`);
  await db.open();
});

describe('generateShoppingList', () => {
  it('aggregates the same ingredient and unit across recipes in the plan', async () => {
    await saveRecipe(recipeInput('r-1', [{ ingredientId: 'onion', qty: 1, unit: 'ea' }]), db);
    await saveRecipe(recipeInput('r-2', [{ ingredientId: 'onion', qty: 2, unit: 'ea' }]), db);
    await setMealPlan({ date: '2026-09-07', slot: 'lunch', recipeId: 'r-1' }, db);
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-2' }, db);

    const { added } = await generateShoppingList(['2026-09-07'], db);
    expect(added).toBe(1);

    const items = await db.shoppingItems.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ingredientId: 'onion', unit: 'ea', qty: 3, checked: false });
    expect(items[0]?.sourceMealPlanId).toBe(GENERATED_MARKER);
  });

  it('subtracts pantry stock in the same unit', async () => {
    await saveRecipe(recipeInput('r-1', [{ ingredientId: 'onion', qty: 3, unit: 'ea' }]), db);
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-1' }, db);
    await addPantryItem({ ingredientId: 'onion', qty: 1, unit: 'ea', location: 'pantry' }, db);

    await generateShoppingList(['2026-09-07'], db);

    const items = await db.shoppingItems.toArray();
    expect(items[0]?.qty).toBe(2);
  });

  it('omits an ingredient the pantry already fully covers', async () => {
    await saveRecipe(recipeInput('r-1', [{ ingredientId: 'onion', qty: 1, unit: 'ea' }]), db);
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-1' }, db);
    await addPantryItem({ ingredientId: 'onion', qty: 5, unit: 'ea', location: 'pantry' }, db);

    const { added } = await generateShoppingList(['2026-09-07'], db);
    expect(added).toBe(0);
    expect(await db.shoppingItems.count()).toBe(0);
  });

  it('does not aggregate across mismatched units', async () => {
    await saveRecipe(recipeInput('r-1', [{ ingredientId: 'onion', qty: 1, unit: 'ea' }]), db);
    await saveRecipe(recipeInput('r-2', [{ ingredientId: 'onion', qty: 100, unit: 'g' }]), db);
    await setMealPlan({ date: '2026-09-07', slot: 'lunch', recipeId: 'r-1' }, db);
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-2' }, db);

    const { added } = await generateShoppingList(['2026-09-07'], db);
    expect(added).toBe(2);
  });

  it('skips "to taste" and optional ingredients', async () => {
    await saveRecipe(
      recipeInput('r-1', [
        { ingredientId: 'salt', qty: null, unit: '' },
        { ingredientId: 'garnish', qty: 1, unit: 'ea', optional: true },
      ]),
      db,
    );
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-1' }, db);

    const { added } = await generateShoppingList(['2026-09-07'], db);
    expect(added).toBe(0);
  });

  it('regenerating replaces the previous generated, unchecked list without touching manual items', async () => {
    await saveRecipe(recipeInput('r-1', [{ ingredientId: 'onion', qty: 1, unit: 'ea' }]), db);
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-1' }, db);
    await addShoppingItem({ ingredientId: 'napkins', qty: 1, unit: 'pack' }, db);

    await generateShoppingList(['2026-09-07'], db);
    await generateShoppingList(['2026-09-07'], db);

    const items = await db.shoppingItems.toArray();
    expect(items).toHaveLength(2);
    expect(items.some(i => i.ingredientId === 'napkins')).toBe(true);
    expect(items.filter(i => i.ingredientId === 'onion')).toHaveLength(1);
  });

  it('leaves an already-checked generated item alone on regenerate', async () => {
    await saveRecipe(recipeInput('r-1', [{ ingredientId: 'onion', qty: 1, unit: 'ea' }]), db);
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-1' }, db);
    await generateShoppingList(['2026-09-07'], db);

    const [item] = await db.shoppingItems.toArray();
    await toggleShoppingItem(item!.id, true, db);

    await generateShoppingList(['2026-09-07'], db);

    expect(await db.shoppingItems.count()).toBe(1);
    expect((await db.shoppingItems.get(item!.id))?.checked).toBe(true);
  });
});

describe('toggleShoppingItem', () => {
  it('restocks the pantry when checked', async () => {
    const id = await addShoppingItem({ ingredientId: 'onion', qty: 3, unit: 'ea' }, db);
    await toggleShoppingItem(id, true, db);

    const pantry = await db.pantryItems.where('ingredientId').equals('onion').toArray();
    expect(pantry).toHaveLength(1);
    expect(pantry[0]?.qty).toBe(3);
    expect((await db.shoppingItems.get(id))?.checked).toBe(true);
  });

  it('merges into existing pantry stock of the same unit and location', async () => {
    await addPantryItem({ ingredientId: 'onion', qty: 2, unit: 'ea', location: 'pantry' }, db);
    const id = await addShoppingItem({ ingredientId: 'onion', qty: 3, unit: 'ea' }, db);
    await toggleShoppingItem(id, true, db);

    const pantry = await db.pantryItems.where('ingredientId').equals('onion').toArray();
    expect(pantry).toHaveLength(1);
    expect(pantry[0]?.qty).toBe(5);
  });

  it('restocks into whatever location the ingredient already lives in, not a fixed default', async () => {
    await addPantryItem({ ingredientId: 'onion', qty: 1, unit: 'ea', location: 'fridge' }, db);
    const id = await addShoppingItem({ ingredientId: 'onion', qty: 2, unit: 'ea' }, db);
    await toggleShoppingItem(id, true, db);

    const pantry = await db.pantryItems.where('ingredientId').equals('onion').toArray();
    expect(pantry).toHaveLength(1);
    expect(pantry[0]).toMatchObject({ location: 'fridge', qty: 3 });
  });

  it('does not restock again when checking an already-checked item', async () => {
    const id = await addShoppingItem({ ingredientId: 'onion', qty: 3, unit: 'ea' }, db);
    await toggleShoppingItem(id, true, db);
    await toggleShoppingItem(id, true, db);

    const pantry = await db.pantryItems.where('ingredientId').equals('onion').toArray();
    expect(pantry[0]?.qty).toBe(3);
  });

  it('unchecking does not remove pantry stock', async () => {
    const id = await addShoppingItem({ ingredientId: 'onion', qty: 3, unit: 'ea' }, db);
    await toggleShoppingItem(id, true, db);
    await toggleShoppingItem(id, false, db);

    const pantry = await db.pantryItems.where('ingredientId').equals('onion').toArray();
    expect(pantry[0]?.qty).toBe(3);
    expect((await db.shoppingItems.get(id))?.checked).toBe(false);
  });
});

describe('clearChecked / deleteShoppingItem', () => {
  it('clearChecked removes only checked items', async () => {
    const a = await addShoppingItem({ ingredientId: 'onion', qty: 1, unit: 'ea' }, db);
    const b = await addShoppingItem({ ingredientId: 'garlic', qty: 1, unit: 'ea' }, db);
    await toggleShoppingItem(a, true, db);

    const removed = await clearChecked(db);
    expect(removed).toBe(1);
    expect(await db.shoppingItems.get(a)).toBeUndefined();
    expect(await db.shoppingItems.get(b)).toBeDefined();
  });

  it('deleteShoppingItem removes one item by id', async () => {
    const id = await addShoppingItem({ ingredientId: 'onion', qty: 1, unit: 'ea' }, db);
    await deleteShoppingItem(id, db);
    expect(await db.shoppingItems.get(id)).toBeUndefined();
  });
});

describe('sortShoppingItems', () => {
  it('lists unchecked items before checked ones', () => {
    const items = [
      { id: 'a', ingredientId: 'x', qty: 1, unit: 'ea', checked: true, createdAt: 1, updatedAt: 1 },
      { id: 'b', ingredientId: 'y', qty: 1, unit: 'ea', checked: false, createdAt: 2, updatedAt: 2 },
    ];
    expect(sortShoppingItems(items).map(i => i.id)).toEqual(['b', 'a']);
  });
});

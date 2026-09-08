import { beforeEach, describe, expect, it } from 'vitest';
import { HomecookDB } from '../db/db';
import { clearMealPlan, mealPlansForDates, setMealPlan } from './mealPlan';

let db: HomecookDB;

beforeEach(async () => {
  db = new HomecookDB(`homecook-mealplan-${crypto.randomUUID()}`);
  await db.open();
});

describe('setMealPlan', () => {
  it('creates a new entry for a date and slot', async () => {
    const id = await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-1' }, db);
    const stored = await db.mealPlans.get(id);
    expect(stored?.date).toBe('2026-09-07');
    expect(stored?.slot).toBe('dinner');
    expect(stored?.recipeId).toBe('r-1');
  });

  it('replaces the existing entry for the same date and slot rather than adding a second', async () => {
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-1' }, db);
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-2' }, db);

    const all = await db.mealPlans.where('date').equals('2026-09-07').toArray();
    expect(all).toHaveLength(1);
    expect(all[0]?.recipeId).toBe('r-2');
  });

  it('keeps different slots on the same date separate', async () => {
    await setMealPlan({ date: '2026-09-07', slot: 'lunch', recipeId: 'r-1' }, db);
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-2' }, db);

    expect(await db.mealPlans.where('date').equals('2026-09-07').count()).toBe(2);
  });

  it('accepts free text instead of a recipe', async () => {
    const id = await setMealPlan({ date: '2026-09-07', slot: 'lunch', freeText: '외식' }, db);
    const stored = await db.mealPlans.get(id);
    expect(stored?.freeText).toBe('외식');
    expect(stored?.recipeId).toBeUndefined();
  });
});

describe('clearMealPlan', () => {
  it('removes only the targeted slot', async () => {
    await setMealPlan({ date: '2026-09-07', slot: 'lunch', recipeId: 'r-1' }, db);
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-2' }, db);

    await clearMealPlan('2026-09-07', 'lunch', db);

    const remaining = await db.mealPlans.where('date').equals('2026-09-07').toArray();
    expect(remaining.map(p => p.slot)).toEqual(['dinner']);
  });
});

describe('mealPlansForDates', () => {
  it('returns entries across the given dates only', async () => {
    await setMealPlan({ date: '2026-09-07', slot: 'dinner', recipeId: 'r-1' }, db);
    await setMealPlan({ date: '2026-09-08', slot: 'dinner', recipeId: 'r-2' }, db);
    await setMealPlan({ date: '2026-09-20', slot: 'dinner', recipeId: 'r-3' }, db);

    const found = await mealPlansForDates(['2026-09-07', '2026-09-08'], db);
    expect(found.map(p => p.recipeId).sort()).toEqual(['r-1', 'r-2']);
  });

  it('returns an empty array for an empty date list', async () => {
    expect(await mealPlansForDates([], db)).toEqual([]);
  });
});

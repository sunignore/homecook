import { beforeEach, describe, expect, it } from 'vitest';
import { HomecookDB, saveRecipe } from '../db/db';
import {
  addCookLog,
  cookLogsFor,
  deleteCookLog,
  deleteRecipeWithLogs,
  summarize,
  UnknownRecipeError,
} from './cookLog';
import type { CookLog } from '../db/types';

const now = 1_757_000_000_000;
const day = 24 * 60 * 60 * 1000;

let db: HomecookDB;

function recipeInput(id: string, title: string) {
  return {
    id,
    title,
    servings: 2,
    tags: [],
    ingredients: [{ ingredientId: 'i-a', qty: 1, unit: 'ea', optional: false }],
    steps: [{ text: '끓인다' }],
    createdAt: now,
  };
}

beforeEach(async () => {
  db = new HomecookDB(`homecook-cooklog-${crypto.randomUUID()}`);
  await db.open();
  await saveRecipe(recipeInput('r-1', '김치찌개'), db);
});

describe('addCookLog', () => {
  it('records a cooking session against the recipe', async () => {
    const id = await addCookLog({ recipeId: 'r-1', rating: 4, memo: '맛있었다' }, db);

    const log = await db.cookLogs.get(id);
    expect(log).toMatchObject({ recipeId: 'r-1', rating: 4, memo: '맛있었다' });
  });

  it('keeps the tweak, which is the note that otherwise gets lost', async () => {
    const id = await addCookLog(
      { recipeId: 'r-1', rating: 3, tweaks: '다음엔 설탕 반으로' },
      db,
    );

    expect((await db.cookLogs.get(id))?.tweaks).toBe('다음엔 설탕 반으로');
  });

  it('drops whitespace-only notes rather than storing empty strings', async () => {
    const id = await addCookLog({ recipeId: 'r-1', rating: 5, memo: '   ', tweaks: '' }, db);

    const log = await db.cookLogs.get(id);
    expect(log?.memo).toBeUndefined();
    expect(log?.tweaks).toBeUndefined();
  });

  it('accepts a past date so a meal can be logged after the fact', async () => {
    const yesterday = now - day;
    const id = await addCookLog({ recipeId: 'r-1', rating: 4, cookedAt: yesterday }, db);

    expect((await db.cookLogs.get(id))?.cookedAt).toBe(yesterday);
  });

  it('refuses to log against a recipe that does not exist', async () => {
    // A log pointing at a missing recipe is unreachable from every screen while
    // still counting in the totals and in backups.
    await expect(addCookLog({ recipeId: 'nope', rating: 4 }, db)).rejects.toBeInstanceOf(
      UnknownRecipeError,
    );
    expect(await db.cookLogs.count()).toBe(0);
  });
});

describe('cookLogsFor', () => {
  it('returns only this recipe’s logs, most recent first', async () => {
    await saveRecipe(recipeInput('r-2', '된장찌개'), db);

    await addCookLog({ recipeId: 'r-1', rating: 3, cookedAt: now - 2 * day }, db);
    await addCookLog({ recipeId: 'r-1', rating: 5, cookedAt: now }, db);
    await addCookLog({ recipeId: 'r-2', rating: 4, cookedAt: now - day }, db);

    const logs = await cookLogsFor('r-1', db);
    expect(logs).toHaveLength(2);
    expect(logs.map(l => l.rating)).toEqual([5, 3]);
  });

  it('returns nothing for a recipe never cooked', async () => {
    expect(await cookLogsFor('r-1', db)).toEqual([]);
  });
});

describe('deleteCookLog', () => {
  it('removes one entry and leaves the rest', async () => {
    const keep = await addCookLog({ recipeId: 'r-1', rating: 4 }, db);
    const drop = await addCookLog({ recipeId: 'r-1', rating: 2 }, db);

    await deleteCookLog(drop, db);

    const logs = await cookLogsFor('r-1', db);
    expect(logs.map(l => l.id)).toEqual([keep]);
  });
});

describe('summarize', () => {
  const log = (rating: 1 | 2 | 3 | 4 | 5, cookedAt: number): CookLog => ({
    id: crypto.randomUUID(),
    recipeId: 'r-1',
    cookedAt,
    rating,
    createdAt: now,
    updatedAt: now,
  });

  it('reports nothing for a recipe never cooked', () => {
    expect(summarize([])).toEqual({ count: 0, lastCookedAt: null, averageRating: null });
  });

  it('averages the ratings to one decimal', () => {
    expect(summarize([log(5, now), log(4, now - day)]).averageRating).toBe(4.5);
    expect(summarize([log(5, now), log(4, now), log(4, now)]).averageRating).toBe(4.3);
  });

  it('takes the latest cook date regardless of list order', () => {
    const summary = summarize([log(3, now - 5 * day), log(4, now), log(2, now - day)]);
    expect(summary.lastCookedAt).toBe(now);
    expect(summary.count).toBe(3);
  });
});

describe('deleteRecipeWithLogs', () => {
  it('removes the recipe and its logs together', async () => {
    await addCookLog({ recipeId: 'r-1', rating: 4 }, db);
    await addCookLog({ recipeId: 'r-1', rating: 5 }, db);

    const { logsDeleted } = await deleteRecipeWithLogs('r-1', db);

    expect(logsDeleted).toBe(2);
    expect(await db.recipes.get('r-1')).toBeUndefined();
    expect(await db.cookLogs.count()).toBe(0);
  });

  it('leaves other recipes and their logs alone', async () => {
    await saveRecipe(recipeInput('r-2', '된장찌개'), db);
    await addCookLog({ recipeId: 'r-1', rating: 4 }, db);
    await addCookLog({ recipeId: 'r-2', rating: 5 }, db);

    await deleteRecipeWithLogs('r-1', db);

    expect(await db.recipes.get('r-2')).toBeDefined();
    expect(await cookLogsFor('r-2', db)).toHaveLength(1);
  });

  it('removes the recipe photo so it does not linger in backups', async () => {
    await db.photos.add({
      id: 'p-1',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      createdAt: now,
    });
    await saveRecipe({ ...recipeInput('r-3', '제육볶음'), photoId: 'p-1' }, db);

    await deleteRecipeWithLogs('r-3', db);

    expect(await db.photos.get('p-1')).toBeUndefined();
  });
});

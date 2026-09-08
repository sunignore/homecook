import { beforeEach, describe, expect, it } from 'vitest';
import { HomecookDB } from '../db/db';
import type { PantryItem } from '../db/types';
import {
  addPantryItem,
  deletePantryItem,
  isExpired,
  isExpiringSoon,
  restockPantry,
  sortByExpiry,
  updatePantryItem,
} from './pantry';

let db: HomecookDB;
const now = 1_757_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  db = new HomecookDB(`homecook-pantry-${crypto.randomUUID()}`);
  await db.open();
});

describe('addPantryItem / updatePantryItem / deletePantryItem', () => {
  it('adds an item and reads it back', async () => {
    const id = await addPantryItem(
      { ingredientId: 'i-onion', qty: 2, unit: 'ea', location: 'pantry' },
      db,
    );
    const stored = await db.pantryItems.get(id);
    expect(stored?.ingredientId).toBe('i-onion');
    expect(stored?.qty).toBe(2);
  });

  it('mark used up deletes the row rather than flagging it', async () => {
    const id = await addPantryItem(
      { ingredientId: 'i-onion', qty: 2, unit: 'ea', location: 'pantry' },
      db,
    );
    await deletePantryItem(id, db);
    expect(await db.pantryItems.get(id)).toBeUndefined();
  });

  it('updates fields and stamps updatedAt', async () => {
    const id = await addPantryItem(
      { ingredientId: 'i-onion', qty: 2, unit: 'ea', location: 'pantry' },
      db,
    );
    const before = (await db.pantryItems.get(id))!.updatedAt;
    await updatePantryItem(id, { qty: 5 }, db);
    const after = await db.pantryItems.get(id);
    expect(after?.qty).toBe(5);
    expect(after?.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('restockPantry', () => {
  it('creates a new row when nothing matches', async () => {
    const id = await restockPantry(
      { ingredientId: 'i-onion', qty: 2, unit: 'ea', location: 'pantry' },
      db,
    );
    expect((await db.pantryItems.toArray()).map(p => p.id)).toEqual([id]);
  });

  it('merges into an existing row with the same ingredient, unit and location', async () => {
    await restockPantry({ ingredientId: 'i-onion', qty: 2, unit: 'ea', location: 'pantry' }, db);
    await restockPantry({ ingredientId: 'i-onion', qty: 3, unit: 'ea', location: 'pantry' }, db);

    const all = await db.pantryItems.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]?.qty).toBe(5);
  });

  it('does not merge across different units or locations', async () => {
    await restockPantry({ ingredientId: 'i-onion', qty: 2, unit: 'ea', location: 'pantry' }, db);
    await restockPantry({ ingredientId: 'i-onion', qty: 100, unit: 'g', location: 'pantry' }, db);
    await restockPantry({ ingredientId: 'i-onion', qty: 1, unit: 'ea', location: 'fridge' }, db);

    expect(await db.pantryItems.count()).toBe(3);
  });
});

function item(id: string, patch: Partial<PantryItem> = {}): PantryItem {
  return {
    id,
    ingredientId: 'i-x',
    qty: 1,
    unit: 'ea',
    location: 'pantry',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

describe('sortByExpiry', () => {
  it('orders soonest expiry first and undated items last', () => {
    const items = [
      item('a', { expiresAt: now + 5 * DAY }),
      item('b', { expiresAt: undefined }),
      item('c', { expiresAt: now + DAY }),
    ];

    expect(sortByExpiry(items).map(i => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('breaks a tie among undated items by oldest purchase first', () => {
    const items = [
      item('newer', { expiresAt: undefined, boughtAt: now }),
      item('older', { expiresAt: undefined, boughtAt: now - DAY }),
    ];

    expect(sortByExpiry(items).map(i => i.id)).toEqual(['older', 'newer']);
  });
});

describe('expiry status', () => {
  it('isExpired is true only once the date has passed', () => {
    expect(isExpired({ expiresAt: now - 1 }, now)).toBe(true);
    expect(isExpired({ expiresAt: now + 1 }, now)).toBe(false);
    expect(isExpired({ expiresAt: undefined }, now)).toBe(false);
  });

  it('isExpiringSoon excludes items already expired', () => {
    expect(isExpiringSoon({ expiresAt: now - DAY }, now, 3)).toBe(false);
    expect(isExpiringSoon({ expiresAt: now + DAY }, now, 3)).toBe(true);
    expect(isExpiringSoon({ expiresAt: now + 10 * DAY }, now, 3)).toBe(false);
  });
});

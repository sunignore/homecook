// Pantry inventory — implements docs/data-model.md §2 (M3) and the
// expiry-first ordering from docs/product-brief.md §3.
//
// Deletion, not a "used up" flag: a pantry item that has been consumed has no
// further use to any screen, and keeping a dead row around only means every
// query (sorting, suggestion scoring, shopping subtraction) has to filter it
// back out again.

import { db, HomecookDB } from '../db/db';
import type { PantryItem, PantryLocation } from '../db/types';

export interface PantryItemDraft {
  ingredientId: string;
  qty: number;
  unit: string;
  location: PantryLocation;
  boughtAt?: number;
  expiresAt?: number;
}

export async function addPantryItem(
  draft: PantryItemDraft,
  database: HomecookDB = db,
): Promise<string> {
  const now = Date.now();
  const id = crypto.randomUUID();
  await database.pantryItems.add({
    id,
    ingredientId: draft.ingredientId,
    qty: draft.qty,
    unit: draft.unit,
    location: draft.location,
    boughtAt: draft.boughtAt,
    expiresAt: draft.expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updatePantryItem(
  id: string,
  patch: Partial<PantryItemDraft>,
  database: HomecookDB = db,
): Promise<void> {
  await database.pantryItems.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deletePantryItem(id: string, database: HomecookDB = db): Promise<void> {
  await database.pantryItems.delete(id);
}

/**
 * Add stock for an ingredient — used both by manual "quick add" and by
 * checking off a shopping item (docs/product-brief.md §3, M4 "restock
 * pantry").
 *
 * Merges into an existing item with the same ingredient, unit and location
 * rather than creating a second row, so the pantry list does not fragment
 * into "양파 1개" three times over from three separate shopping trips.
 */
export async function restockPantry(
  entry: PantryItemDraft,
  database: HomecookDB = db,
): Promise<string> {
  return database.transaction('rw', database.pantryItems, async () => {
    const existing = await database.pantryItems
      .where('ingredientId')
      .equals(entry.ingredientId)
      .filter(p => p.unit === entry.unit && p.location === entry.location)
      .first();

    if (existing) {
      await database.pantryItems.update(existing.id, {
        qty: existing.qty + entry.qty,
        // A later purchase's expiry is the more useful one to show — the
        // earlier batch is presumably closer to being used up first anyway.
        expiresAt: entry.expiresAt ?? existing.expiresAt,
        boughtAt: entry.boughtAt ?? existing.boughtAt,
        updatedAt: Date.now(),
      });
      return existing.id;
    }

    return addPantryItem(entry, database);
  });
}

/**
 * Expiry-first ordering (docs/product-brief.md §3): soonest expiry first,
 * items with no expiry date last since there's nothing urgent to say about
 * them. Ties broken by oldest purchase first.
 */
export function sortByExpiry(items: readonly PantryItem[]): PantryItem[] {
  return [...items].sort((a, b) => {
    if (a.expiresAt !== undefined && b.expiresAt !== undefined) return a.expiresAt - b.expiresAt;
    if (a.expiresAt !== undefined) return -1;
    if (b.expiresAt !== undefined) return 1;
    return (a.boughtAt ?? a.createdAt) - (b.boughtAt ?? b.createdAt);
  });
}

export function isExpired(item: Pick<PantryItem, 'expiresAt'>, now: number = Date.now()): boolean {
  return item.expiresAt !== undefined && item.expiresAt < now;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Within the window and not already expired — expired items get their own,
 *  more urgent banner rather than being buried in "expiring soon". */
export function isExpiringSoon(
  item: Pick<PantryItem, 'expiresAt'>,
  now: number = Date.now(),
  withinDays = 3,
): boolean {
  if (item.expiresAt === undefined || isExpired(item, now)) return false;
  return item.expiresAt - now <= withinDays * DAY_MS;
}

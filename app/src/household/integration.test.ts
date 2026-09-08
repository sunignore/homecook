import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { HomecookDB } from '../db/db';
import { commandSchema, dishSchema, type Snapshot } from './contracts';
import { generateShoppingList } from '../plan/shoppingList';
import { clearSession, loadSession, newSession, saveSession } from '../cook/session';
import { remainingSeconds, startTimer } from '../cook/timers';
import { exportBackup, readBackup, restoreBackup } from '../backup/backup';

const householdId = '44444444-4444-4444-8444-444444444444';
const id = '55555555-5555-4555-8555-555555555555';
const ingredientId = '66666666-6666-4666-8666-666666666666';
const dish = dishSchema.parse({ id, title: 'Soup', servings: 4,
  ingredients: [{ ingredientId, name: 'Onion', qty: 100, unit: 'g', optional: false }],
  steps: [{ text: 'Boil', durationSec: 300 }], tags: [] });
const opened: HomecookDB[] = [];
function database() { const db = new HomecookDB('household-' + crypto.randomUUID()); opened.push(db); return db; }
afterEach(async () => { for (const db of opened.splice(0)) await db.delete(); clearSession(); });

describe('existing workflow integration', () => {
  it('scales each dish and repeated meal before subtracting pantry stock once', async () => {
    const db = database();
    const side = { ...dish, id: crypto.randomUUID(), servings: 2, ingredients: [{ ...dish.ingredients[0]!, qty: 20 }] };
    await db.mealPlans.bulkAdd([
      { id: 'a', date: '2026-09-08', slot: 'dinner', dishes: [dish, side], diners: 2, createdAt: 0, updatedAt: 0 },
      { id: 'b', date: '2026-09-09', slot: 'dinner', dishes: [dish], diners: 4, createdAt: 0, updatedAt: 0 },
    ]);
    await db.pantryItems.add({ id: 'stock', ingredientId, qty: 30, unit: 'g', location: 'pantry', createdAt: 0, updatedAt: 0 });
    await generateShoppingList(['2026-09-08', '2026-09-09'], db);
    expect((await db.shoppingItems.toArray())[0]?.qty).toBe(140);
  });
  it('upgrades a shipped v3 database without changing local plans or recipes', async () => {
    const db = database();
    const legacy = new Dexie(db.name);
    legacy.version(3).stores({
      ingredients: 'id, name, category, isStaple, *aliases', recipes: 'id, title, updatedAt, *tags, *ingredientIds',
      photos: 'id', cookLogs: 'id, recipeId, cookedAt', pantryItems: 'id, ingredientId, expiresAt, location',
      mealPlans: 'id, date, slot, recipeId', shoppingItems: 'id, ingredientId, checked, sourceMealPlanId',
    });
    await legacy.table('mealPlans').add({ id: 'old', date: '2026-09-08', slot: 'dinner', freeText: 'Eat out', createdAt: 0, updatedAt: 0 });
    legacy.close();
    await db.open();
    expect((await db.mealPlans.get('old'))?.freeText).toBe('Eat out');
    expect(await db.householdCache.count()).toBe(0);
    expect(db.verno).toBe(4);
  });
  it('keeps two recipe timers across reload and finishes only one session', () => {
    const now = Date.now();
    const first = newSession('order:soup', dish.steps, now);
    first.timers[0] = startTimer(first.timers[0]!, now);
    saveSession(first, now);
    const second = newSession('order:side', dish.steps, now);
    saveSession(second, now);
    expect(remainingSeconds(loadSession('order:soup', now + 60000)!.timers[0]!, now + 60000)).toBe(240);
    clearSession('order:side');
    expect(loadSession('order:side', now)).toBeNull();
    expect(loadSession('order:soup', now)).not.toBeNull();
  });
  it('restores the legacy session without losing it when another dish starts', () => {
    const now = Date.now();
    const old = newSession('old', dish.steps, now); old.stepIndex = 1;
    localStorage.setItem('homecook:cookSession', JSON.stringify(old));
    saveSession(newSession('other', dish.steps, now), now);
    expect(loadSession('old', now)?.stepIndex).toBe(1);
  });
  it('round-trips shared snapshots and photos without restoring live credentials', async () => {
    const source = database(); const target = database();
    const path = householdId + '/' + 'a'.repeat(64);
    const photoDish = { ...dish, photoPath: path };
    const snapshot: Snapshot = { householdId, role: 'husband', name: 'Kitchen', calendarReady: true,
      menu: [{ id, recipe: photoDish, available: true, version: 1 }], orders: [], plans: [] };
    await source.householdCache.put({ id: 'private-user-session', snapshot, syncedAt: 1 });
    await source.householdPhotos.put({ id: path, bytes: new Uint8Array([1, 2, 3]).buffer, type: 'image/jpeg' });
    await source.mealPlans.put({ id: 'shared:plan', householdId, sourceOrderId: crypto.randomUUID(), date: '2026-09-08', slot: 'dinner', dishes: [photoDish], diners: 2, createdAt: 0, updatedAt: 0 });
    const preview = await readBackup(await exportBackup(source));
    expect(JSON.stringify(preview.manifest)).not.toContain('private-user-session');
    await restoreBackup(preview, target);
    expect(await target.householdCache.count()).toBe(0);
    expect(await target.householdRecovery.count()).toBe(1);
    expect(new Uint8Array((await target.householdPhotos.get(path))!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect((await target.mealPlans.toArray())[0]?.householdId).toBeUndefined();
    expect((await target.mealPlans.toArray())[0]?.dishes?.[0]?.title).toBe('Soup');
  });
});

describe('network contracts', () => {
  const selection = [{ id, version: 1 }];
  it('rejects invalid dates, fractional diners, repeated menus and injected fields', () => {
    const valid = { action: 'submit', date: '2026-09-08', slot: 'dinner', diners: 2, note: '', selection };
    expect(commandSchema.safeParse(valid).success).toBe(true);
    for (const changed of [{ date: '2026-02-30' }, { diners: 1.5 }, { selection: [...selection, ...selection] }, { role: 'husband' }]) {
      expect(commandSchema.safeParse({ ...valid, ...changed }).success).toBe(false);
    }
  });
  it('rejects zero base servings and malformed ingredient quantities', () => {
    expect(dishSchema.safeParse({ ...dish, servings: 0 }).success).toBe(false);
    expect(dishSchema.safeParse({ ...dish, ingredients: [{ ...dish.ingredients[0], qty: -2 }] }).success).toBe(false);
  });
});

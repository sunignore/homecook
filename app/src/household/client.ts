import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { db, saveRecipe } from '../db/db';
import type { MealPlan, Recipe } from '../db/types';
import { photoBlob } from '../photos/photoBytes';
import { cachedSnapshot, setActiveUser } from './cache';
import { configured } from './config';
import { commandSchema, dishSchema, snapshotSchema, type Command, type Dish, type Snapshot } from './contracts';

// Re-exported so existing call sites keep one import, while screens that only
// read shared state can import ./cache and ./config directly and stay clear of
// the Supabase bundle.
export { cachedSnapshot } from './cache';
export { configured } from './config';

let client: SupabaseClient | undefined;
let sharedQueue: Promise<unknown> = Promise.resolve();
function sequential<T>(task: () => Promise<T>): Promise<T> {
  const next = sharedQueue.then(task, task);
  sharedQueue = next.catch(() => undefined);
  return next;
}
export function server(): SupabaseClient {
  if (!configured) throw new Error('공유 서버 연결 설정이 필요합니다.');
  if (!client) {
    const url = z.string().url().parse(import.meta.env.VITE_SUPABASE_URL);
    const key = z.string().min(20).parse(import.meta.env.VITE_SUPABASE_ANON_KEY);
    client = createClient(url, key);
  }
  return client;
}
export async function identity(): Promise<string> {
  const { data, error } = await server().auth.getSession();
  if (error) throw error;
  if (data.session) return data.session.user.id;
  const signed = await server().auth.signInAnonymously();
  if (signed.error) throw signed.error;
  return signed.data.user!.id;
}
async function rpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await server().rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function saveSnapshot(raw: unknown): Promise<Snapshot | null> {
  const user = await identity();
  if (raw === null) {
    const previous = await db.householdCache.get(user);
    if (previous) {
      const old = snapshotSchema.parse(previous.snapshot);
      await db.mealPlans.filter(p => p.householdId === old.householdId).delete();
    }
    await db.householdCache.delete(user);
    setActiveUser(null);
    window.dispatchEvent(new Event('household-updated'));
    return null;
  }
  const snapshot = snapshotSchema.parse(raw);
  await db.transaction('rw', db.householdCache, db.mealPlans, db.ingredients, async () => {
    await db.householdCache.put({ id: user, snapshot, syncedAt: Date.now() });
    // Published IDs preserve the chef's canonical ingredient references.
    for (const p of snapshot.plans) {
      for (const dish of p.items) for (const ingredient of dish.ingredients) {
        if (!(await db.ingredients.get(ingredient.ingredientId))) {
          await db.ingredients.add({ id: ingredient.ingredientId, name: ingredient.name, aliases: [], category: 'other',
            defaultUnit: ingredient.unit, isStaple: false, createdAt: Date.now(), updatedAt: Date.now() });
        }
      }
    }
    await db.mealPlans.filter(p => p.householdId === snapshot.householdId).delete();
    for (const p of snapshot.plans) {
      const local = await db.mealPlans.where('date').equals(p.date).filter(row => row.slot === p.slot && !row.householdId).first();
      // Never overwrite an unmigrated local plan.
      if (local) continue;
      await db.mealPlans.put({
        id: 'shared:' + snapshot.householdId + ':' + p.date + ':' + p.slot, date: p.date, slot: p.slot,
        householdId: snapshot.householdId, sourceOrderId: p.order_id ?? undefined,
        dishes: p.items, diners: p.diners, freeText: p.free_text,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    }
  });
  // Names the identity ./cache should read, so a snapshot survives a reload
  // without anyone having to construct the Supabase client to find it.
  setActiveUser(user);
  window.dispatchEvent(new Event('household-updated'));
  return snapshot;
}
async function fetchSnapshot(): Promise<Snapshot | null> {
  await identity();
  return saveSnapshot(await rpc('hc_snapshot'));
}
export function refresh(): Promise<Snapshot | null> { return sequential(fetchSnapshot); }
export async function join(token: string, role: 'husband' | 'wife'): Promise<Snapshot | null> {
  await identity();
  z.string().regex(/^[a-f0-9]{64}$/).parse(token);
  return saveSnapshot(await rpc('hc_join', { token, chosen_role: role }));
}
export async function invite(): Promise<string> {
  return z.string().regex(/^[a-f0-9]{64}$/).parse(await rpc('hc_invite'));
}
export function command(body: Command, commandId: string = crypto.randomUUID()): Promise<Snapshot> {
  return sequential(() => executeCommand(body, commandId));
}
async function executeCommand(body: Command, commandId: string): Promise<Snapshot> {
  commandSchema.parse(body);
  const user = await identity();
  const signature = JSON.stringify(body);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user + signature))), b => b.toString(16).padStart(2, '0')).join('');
  const retryKey = 'homecook:retry:' + digest;
  const savedId = localStorage.getItem(retryKey);
  if (savedId) commandId = z.string().uuid().parse(savedId);
  else localStorage.setItem(retryKey, commandId);
  const snapshot = await saveSnapshot(await rpc('hc_command', { command_id: commandId, body }));
  if (!snapshot) throw new Error('기기 연결을 다시 확인해주세요.');
  localStorage.removeItem(retryKey);
  return snapshot;
}
export async function localDish(recipe: Recipe, uploadPhoto = false): Promise<Dish> {
  let photoPath: string | undefined;
  if (uploadPhoto && recipe.photoId) {
    const household = await cachedSnapshot();
    const photo = photoBlob(await db.photos.get(recipe.photoId));
    if (photo && household) {
      const bytes = await photo.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      photoPath = household.householdId + '/' + hash;
      const bucket = server().storage.from('household-photos');
      const upload = await bucket.upload(photoPath, photo, { upsert: false });
      if (upload.error && upload.error.message !== 'The resource already exists') throw upload.error;
      const verify = await bucket.download(photoPath);
      if (verify.error) throw verify.error;
      const verified = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await verify.data.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== verified) throw new Error('사진 검증에 실패했습니다. 다시 시도해주세요.');
      await db.householdPhotos.put({ id: photoPath, bytes, type: photo.type });
    }
  }
  const ingredients = await Promise.all(recipe.ingredients.map(async item => ({
    ...item, name: (await db.ingredients.get(item.ingredientId))?.name ?? '이름 없는 재료',
  })));
  return dishSchema.parse({ id: recipe.id, title: recipe.title, servings: recipe.servings, ingredients, steps: recipe.steps, tags: recipe.tags, ...(photoPath ? { photoPath } : {}) });
}
export async function migratePlans(): Promise<void> {
  const snapshot = await refresh();
  if (!snapshot || snapshot.role !== 'husband') throw new Error('셰프 연결이 필요합니다.');
  const originals = await db.mealPlans.filter(p => !p.householdId).toArray();
  for (const p of originals) {
    const recipe = p.recipeId ? await db.recipes.get(p.recipeId) : undefined;
    const items = recipe ? [{ ...await localDish(recipe), servings: 2 }] : p.dishes ?? [];
    // The original plan command ID makes retry after a lost response safe.
    const result = await command({ action: 'importPlan', date: p.date, slot: p.slot, items,
      diners: p.diners ?? 2, freeText: p.freeText ?? '', clear: false }, p.id);
    const copied = result.plans.find(row => row.date === p.date && row.slot === p.slot);
    if (!copied || copied.order_id || JSON.stringify(copied.items.map(i => dishSchema.parse(i))) !== JSON.stringify(items.map(i => dishSchema.parse(i))) || copied.free_text !== (p.freeText ?? '') || copied.diners !== (p.diners ?? 2)) {
      throw new Error('식단 복사 결과가 다릅니다. 원본을 유지했습니다.');
    }
    // Keep the original content as a local recovery record until backup replacement.
    await db.transaction('rw', db.householdOriginals, db.mealPlans, async () => {
      await db.householdOriginals.put({ id: p.id, plan: p });
      await db.mealPlans.delete(p.id);
    });
  }
  await command({ action: 'activate' });
  await refresh();
}
export async function writeSharedPlan(draft: Pick<MealPlan, 'date' | 'slot' | 'recipeId' | 'freeText'>, clear = false): Promise<boolean> {
  const snapshot = await cachedSnapshot();
  if (!snapshot) return false;
  const recipe = draft.recipeId ? await db.recipes.get(draft.recipeId) : undefined;
  if (!snapshot.calendarReady) throw new Error('우리집 식당에서 기존 식단 연결을 먼저 완료해주세요.');
  await command({ action: 'plan', date: draft.date, slot: draft.slot, items: recipe ? [{ ...await localDish(recipe), servings: 2 }] : [],
    diners: 2, freeText: draft.freeText ?? '', clear });
  return true;
}
export async function subscribePush(): Promise<void> {
  const key = z.string().min(80).parse(import.meta.env.VITE_VAPID_PUBLIC_KEY);
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('홈 화면에 앱을 추가한 뒤 다시 열어주세요.');
  if (await Notification.requestPermission() !== 'granted') throw new Error('아이폰 설정에서 알림을 허용해주세요.');
  const registration = await navigator.serviceWorker.ready;
  const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  await rpc('hc_subscribe', { payload: subscription.toJSON() });
}

/** Bring an archived menu back into the local archive without publishing it. */
export async function recoverRecipe(dish: Dish): Promise<void> {
  dishSchema.parse(dish);
  await db.transaction('rw', db.recipes, db.ingredients, db.photos, db.householdPhotos, async () => {
    const ingredients = [];
    for (const item of dish.ingredients) {
      const existing = await db.ingredients.get(item.ingredientId);
      const ingredientId = existing && existing.name !== item.name ? crypto.randomUUID() : item.ingredientId;
      if (!existing || ingredientId !== item.ingredientId) await db.ingredients.add({
        id: ingredientId, name: item.name, aliases: [], category: 'other', defaultUnit: item.unit,
        isStaple: false, createdAt: Date.now(), updatedAt: Date.now(),
      });
      ingredients.push({ ...item, ingredientId });
    }
    let photoId: string | undefined;
    if (dish.photoPath) {
      const photo = await db.householdPhotos.get(dish.photoPath);
      if (!photo) throw new Error('복원할 사진이 없습니다.');
      photoId = crypto.randomUUID();
      await db.photos.put({ id: photoId, bytes: photo.bytes, type: photo.type, createdAt: Date.now() });
    }
    await saveRecipe({ id: crypto.randomUUID(), title: dish.title, servings: dish.servings,
      tags: dish.tags, ingredients, steps: dish.steps, photoId, createdAt: Date.now() });
  });
}

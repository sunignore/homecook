import { z } from 'zod';

const text = z.string().max(1000);
export const slotSchema = z.enum(['breakfast', 'lunch', 'dinner']);
export const roleSchema = z.enum(['husband', 'wife']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const date = new Date(v + 'T12:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === v;
}, '날짜를 확인해주세요.');
export const dishSchema = z.object({
  id: z.string().uuid(), title: z.string().min(1).max(200),
  servings: z.number().positive().max(1000),
  ingredients: z.array(z.object({
    ingredientId: z.string().uuid(), name: z.string().min(1).max(200),
    qty: z.number().nonnegative().max(1000000).nullable(), unit: z.string().max(80),
    note: text.optional(), optional: z.boolean(),
  }).strict()).max(200),
  steps: z.array(z.object({ text: z.string().min(1).max(10000), durationSec: z.number().int().positive().max(604800).optional() }).strict()).max(200),
  tags: z.array(z.string().max(100)).max(100),
  photoPath: z.string().max(300).optional(),
}).strict();
export type Dish = z.infer<typeof dishSchema>;
export const orderSchema = z.object({
  id: z.string().uuid(), date: dateSchema, slot: slotSchema, diners: z.number().int().min(1).max(20),
  items: z.array(dishSchema).min(1).max(20), note: text,
  status: z.enum(['pending', 'accepted', 'cooking', 'ready', 'rejected', 'cancelled']),
  version: z.number().int().positive(), cancellation: z.boolean(), thanks: z.boolean(),
  events: z.array(z.object({ action: z.string().max(30), role: roleSchema, comment: text, at: z.string().max(50) }).strict()).max(10000),
  created_at: z.string().max(50),
}).strict();
export type Order = z.infer<typeof orderSchema>;
export const snapshotSchema = z.object({
  householdId: z.string().uuid(), role: roleSchema, name: z.string().min(1).max(80), calendarReady: z.boolean(),
  menu: z.array(z.object({ id: z.string().uuid(), recipe: dishSchema, available: z.boolean(), version: z.number().int().positive() }).strict()).max(10000),
  orders: z.array(orderSchema).max(10000),
  plans: z.array(z.object({
    date: dateSchema, slot: slotSchema, order_id: z.string().uuid().nullable(),
    items: z.array(dishSchema).max(20), diners: z.number().int().min(1).max(20), free_text: text,
  }).strict()).max(10000),
}).strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
const selection = z.array(z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict()).min(1).max(20)
  .refine(items => new Set(items.map(i => i.id)).size === items.length);
const draft = { date: dateSchema, slot: slotSchema, diners: z.number().int().min(1).max(20), note: text, selection };
const orderRef = { id: z.string().uuid(), version: z.number().int().positive(), comment: text };
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('activate') }).strict(),
  z.object({ action: z.literal('submit'), ...draft }).strict(),
  z.object({ action: z.literal('edit'), ...draft, id: z.string().uuid(), version: z.number().int().positive() }).strict(),
  ...(['accept', 'reject', 'cancel', 'requestCancel', 'declineCancel', 'cook', 'ready', 'thanks'] as const).map(action => z.object({ action: z.literal(action), ...orderRef }).strict()),
  z.object({ action: z.literal('publish'), recipe: dishSchema, available: z.boolean() }).strict(),
  z.object({ action: z.literal('name'), name: z.string().trim().min(1).max(80) }).strict(),
  ...(['plan', 'importPlan'] as const).map(action => z.object({ action: z.literal(action), date: dateSchema, slot: slotSchema, items: z.array(dishSchema).max(20), diners: z.number().int().min(1).max(20), freeText: text, clear: z.boolean() }).strict()),
]);
export type Command = z.infer<typeof commandSchema>;
export const statusLabels: Record<Order['status'], string> = {
  pending: '접수 대기', accepted: '접수 완료', cooking: '조리 중', ready: '식사 준비 완료', rejected: '거절', cancelled: '취소',
};
export const slotLabels = { breakfast: '아침', lunch: '점심', dinner: '저녁' };

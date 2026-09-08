import { z } from 'zod';

export const cloudIngredientCategorySchema = z.enum([
  'vegetable', 'meat', 'seafood', 'dairy', 'grain', 'sauce', 'other',
]);
const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const nullableText = (maximum: number) => z.string().max(maximum).nullable();

export const cloudRecipeStepInputSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  durationSec: z.number().int().min(1).max(86400).nullable(),
}).strict();

export const cloudRecipeIngredientInputSchema = z.object({
  ingredientId: uuid.nullable(),
  name: z.string().trim().min(1).max(200),
  category: cloudIngredientCategorySchema,
  defaultUnit: z.string().max(80),
  isStaple: z.boolean(),
  qty: z.number().min(0).max(1_000_000).nullable(),
  unit: z.string().max(80),
  note: z.string().max(1000),
  optional: z.boolean(),
}).strict();

export const cloudRecipeSaveInputSchema = z.object({
  id: uuid,
  title: z.string().trim().min(1).max(200),
  servings: z.number().positive().max(1000),
  sourceUrl: nullableText(4000),
  sourceText: nullableText(100_000),
  notes: z.string().max(10_000),
  tags: z.array(z.string().trim().min(1).max(80)).max(50),
  steps: z.array(cloudRecipeStepInputSchema).max(200),
  photoId: uuid.nullable(),
  ingredients: z.array(cloudRecipeIngredientInputSchema).max(200),
}).strict();

export const cloudIngredientSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(200),
  aliases: z.array(z.string()),
  category: cloudIngredientCategorySchema,
  defaultUnit: z.string().max(80),
  isStaple: z.boolean(),
  version: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const cloudPhotoSchema = z.object({
  id: uuid,
  objectPath: z.string().min(1).max(80),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteSize: z.number().int().min(1).max(5_242_880),
  version: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const cloudRecipeIngredientSchema = z.object({
  ingredientId: uuid,
  qty: z.number().min(0).max(1_000_000).nullable(),
  unit: z.string().max(80),
  note: z.string().max(1000),
  optional: z.boolean(),
}).strict();

export const cloudRecipeSchema = z.object({
  id: uuid,
  title: z.string().min(1).max(200),
  servings: z.number().positive().max(1000),
  sourceUrl: nullableText(4000),
  sourceText: nullableText(100_000),
  notes: z.string().max(10_000),
  tags: z.array(z.string().max(80)).max(50),
  steps: z.array(cloudRecipeStepInputSchema).max(200),
  photoId: uuid.nullable(),
  orderable: z.boolean(),
  version: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  ingredients: z.array(cloudRecipeIngredientSchema).max(200),
}).strict();

export const cloudRecipeSnapshotSchema = z.object({
  householdId: uuid,
  revision: z.number().int().nonnegative(),
  ingredients: z.array(cloudIngredientSchema),
  photos: z.array(cloudPhotoSchema),
  recipes: z.array(cloudRecipeSchema),
}).strict();

export const cloudVersionResultSchema = z.object({
  id: uuid,
  version: z.number().int().positive(),
}).strict();

export const cloudPhotoBeginResultSchema = z.object({
  id: uuid,
  objectPath: z.string().min(1).max(80),
  uploadRequired: z.boolean(),
}).strict();

export const cloudPhotoFinalizeResultSchema = z.object({
  id: uuid,
  version: z.number().int().positive(),
  objectPath: z.string().min(1).max(80),
}).strict();

export type CloudRecipeSaveInput = z.infer<typeof cloudRecipeSaveInputSchema>;
export type CloudRecipeSnapshot = z.infer<typeof cloudRecipeSnapshotSchema>;
export type CloudPhoto = z.infer<typeof cloudPhotoSchema>;
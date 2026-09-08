// Domain types — implements docs/data-model.md §2.
//
// Ingredients are references, never free strings (ADR-0002). `steps[].durationSec`
// and the whole Ingredient table exist from schema v1 even though only M1 reads
// them, because retrofitting either one is a full migration of every recipe the
// user has already typed in.

export type IngredientCategory =
  | 'vegetable'
  | 'meat'
  | 'seafood'
  | 'dairy'
  | 'grain'
  | 'sauce'
  | 'other';

export interface Ingredient {
  id: string;
  /** Canonical display name, e.g. "대파". */
  name: string;
  /** Alternate spellings matched during paste-parse, e.g. ["파", "welsh onion"]. */
  aliases: string[];
  category: IngredientCategory;
  defaultUnit: string;
  /** Assumed always in the kitchen; excluded from M3 suggestion scoring. */
  isStaple: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RecipeIngredient {
  ingredientId: string;
  /** null means "to taste" — a real value in recipes, not a missing one. */
  qty: number | null;
  unit: string;
  note?: string;
  /** Excluded from M3 required-ingredient scoring. */
  optional: boolean;
}

export interface RecipeStep {
  text: string;
  /** Parsed from phrases like "simmer for 10 minutes"; drives the M2 timer. */
  durationSec?: number;
}

export interface Recipe {
  id: string;
  title: string;
  sourceUrl?: string;
  /** The original pasted text, kept so a recipe can be re-parsed if the parser
   *  or the alias set improves, rather than re-typed (ADR-0002). */
  sourceText?: string;
  servings: number;
  tags: string[];
  ingredients: RecipeIngredient[];
  /**
   * Derived index field: every `ingredients[].ingredientId`, deduplicated.
   *
   * IndexedDB cannot build a multi-entry index through an array of objects — a
   * keyPath like `ingredients.ingredientId` resolves to undefined, so the index
   * silently matches nothing. A flat array of primitives is the only shape a
   * `*` multiEntry index accepts, and this is the index the M3 "which recipes
   * use what I have" query depends on (docs/data-model.md §4).
   *
   * Never assign this by hand — write recipes through `saveRecipe()`, which
   * derives it, so it cannot drift from `ingredients`.
   */
  ingredientIds: string[];
  steps: RecipeStep[];
  photoId?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Photo {
  id: string;
  /**
   * JPEG bytes, resized to a 1280px long edge before storing
   * (docs/data-model.md §1). Stored as an ArrayBuffer rather than a Blob —
   * see src/photos/photoBytes.ts for why.
   */
  bytes: ArrayBuffer;
  /** MIME type of `bytes`, so a read can rebuild the Blob without guessing. */
  type: string;
  createdAt: number;
}

/** Row shape written before photos moved to ArrayBuffer. Read-only. */
export interface LegacyPhoto {
  id: string;
  blob: Blob;
  createdAt: number;
}

/** What the photos table may actually contain. Writes always use `Photo`. */
export type StoredPhoto = Photo | LegacyPhoto;

export type Rating = 1 | 2 | 3 | 4 | 5;

export interface CookLog {
  id: string;
  recipeId: string;
  cookedAt: number;
  rating: Rating;
  memo?: string;
  /** "half the sugar next time" — the note that otherwise gets lost. */
  tweaks?: string;
  createdAt: number;
  updatedAt: number;
}

// ── M3 ──────────────────────────────────────────────────────────────────────

export type PantryLocation = 'fridge' | 'freezer' | 'pantry';

export interface PantryItem {
  id: string;
  ingredientId: string;
  qty: number;
  unit: string;
  boughtAt?: number;
  /** Drives expiry-first ordering and the Home "expiring soon" warning. */
  expiresAt?: number;
  location: PantryLocation;
  createdAt: number;
  updatedAt: number;
}

// ── M4 ──────────────────────────────────────────────────────────────────────

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export interface MealPlan {
  id: string;
  /** 'YYYY-MM-DD' local date, not a timestamp — a plan is for a calendar day,
   *  not an instant, so it must not shift with the reader's timezone. */
  date: string;
  slot: MealSlot;
  recipeId?: string;
  /** "eat out", "leftovers" — a slot doesn't have to resolve to a recipe. */
  freeText?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ShoppingItem {
  id: string;
  ingredientId: string;
  qty: number;
  unit: string;
  checked: boolean;
  /** Set when generated from the plan; undefined for a manually added item. */
  sourceMealPlanId?: string;
  createdAt: number;
  updatedAt: number;
}

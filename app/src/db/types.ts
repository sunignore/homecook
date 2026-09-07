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
  /** Resized to a 1280px long edge before storing (docs/data-model.md §1). */
  blob: Blob;
  createdAt: number;
}

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

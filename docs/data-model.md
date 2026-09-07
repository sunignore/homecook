# Data Model — homecook

## Status
Active — M1 schema is binding

## Created
2026-09-07

All persistence is local IndexedDB via Dexie (see [ADR-0001](adr/0001-local-first-no-backend.md)).
There is no server-side schema.

## 1. Design rules

1. **Ingredients are references, never free strings.** A recipe never stores
   `"대파 1대"`. It stores `{ ingredientId, qty, unit, note }`. See
   [ADR-0002](adr/0002-normalized-ingredients-from-m1.md).
2. **M1 carries fields that only M2–M4 use.** Specifically `Recipe.steps[].durationSec`
   and the whole `Ingredient` table. Adding them later means migrating every recipe
   already entered, so they ship in the first schema version even though nothing
   reads them yet.
3. **Index arrays are derived, never hand-written.** IndexedDB cannot build a
   multi-entry index through an array of objects, so `Recipe` carries a flat
   `ingredientIds: string[]` alongside `ingredients`. It is derived on every
   write by `saveRecipe()` — see §4.
4. **Photos are Blobs in a separate table.** Never inline in the recipe record —
   `useLiveQuery` over the recipe list must not deserialize image bytes.
5. **Every table has `createdAt` / `updatedAt`.** Backup/restore and future conflict
   handling both need them, and they are free to add now.

## 2. Tables

```ts
// ── M1 ────────────────────────────────────────────────────────────────────────

// Canonical ingredient dictionary. Seeded with a small starter set,
// grown as the user types new ingredients.
interface Ingredient {
  id: string;              // uuid
  name: string;            // canonical display name, e.g. "대파"
  aliases: string[];        // "파", "쪽파", "welsh onion" — matched during paste-parse
  category: string;         // vegetable | meat | seafood | dairy | grain | sauce | other
  defaultUnit: string;      // g | ml | ea | tbsp | tsp | cup | 대 | 쪽 ...
  isStaple: boolean;        // assumed always present; excluded from M3 scoring
  createdAt: number;
  updatedAt: number;
}

interface Recipe {
  id: string;
  title: string;
  sourceUrl?: string;
  sourceText?: string;      // the original pasted text, kept for re-parsing
  servings: number;
  tags: string[];
  ingredients: RecipeIngredient[];
  ingredientIds: string[];  // DERIVED from ingredients — see §4. Never set by hand.
  steps: RecipeStep[];
  photoId?: string;         // → Photo.id
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

interface RecipeIngredient {
  ingredientId: string;     // → Ingredient.id
  qty: number | null;       // null = "to taste"
  unit: string;
  note?: string;            // "finely chopped", "optional"
  optional: boolean;        // excluded from M3 required-ingredient scoring
}

interface RecipeStep {
  text: string;
  durationSec?: number;     // parsed from "simmer for 10 minutes" → M2 timer
}

interface Photo {
  id: string;
  blob: Blob;               // resized to max 1280px on the long edge before store
  createdAt: number;
}

interface CookLog {
  id: string;
  recipeId: string;
  cookedAt: number;
  rating: 1 | 2 | 3 | 4 | 5;
  memo?: string;
  tweaks?: string;          // "half the sugar next time" — the thing that gets lost
  createdAt: number;
  updatedAt: number;
}

// ── M3 ────────────────────────────────────────────────────────────────────────

interface PantryItem {
  id: string;
  ingredientId: string;     // → Ingredient.id
  qty: number;
  unit: string;
  boughtAt?: number;
  expiresAt?: number;       // drives expiry-first ordering and Home warnings
  location: 'fridge' | 'freezer' | 'pantry';
  createdAt: number;
  updatedAt: number;
}

// ── M4 ────────────────────────────────────────────────────────────────────────

interface MealPlan {
  id: string;
  date: string;             // 'YYYY-MM-DD' local date, not a timestamp
  slot: 'breakfast' | 'lunch' | 'dinner';
  recipeId?: string;
  freeText?: string;        // "eat out", "leftovers"
  createdAt: number;
  updatedAt: number;
}

interface ShoppingItem {
  id: string;
  ingredientId: string;
  qty: number;
  unit: string;
  checked: boolean;
  sourceMealPlanId?: string; // null = manually added
  createdAt: number;
  updatedAt: number;
}
```

## 3. Dexie versioning policy

Every schema change is an explicit `db.version(n).stores({...}).upgrade(tx => ...)`
step. Rules:

- **Never edit a shipped `version(n)` block.** Add `version(n+1)`.
- Version bumps that only add tables or indexes need no `upgrade` function.
- Any bump that changes the shape of existing records **must** have an `upgrade`
  function and a unit test that runs it against a fixture database from the previous
  version.
- Planned versions: `v1` = M1 tables, `v2` = `pantryItems` (M3),
  `v3` = `mealPlans` + `shoppingItems` (M4).

## 4. Indexes

```ts
db.version(1).stores({
  ingredients: 'id, name, category, isStaple, *aliases',
  recipes:     'id, title, updatedAt, *tags, *ingredientIds',
  photos:      'id',
  cookLogs:    'id, recipeId, cookedAt',
});
```

`*ingredientIds` is the multi-entry index that makes the M3 "which recipes use
what I have" query an index lookup instead of a full table scan.

### Why a derived array rather than indexing the objects directly

The obvious schema is `*ingredients.ingredientId`, indexing the reference inside
each `RecipeIngredient`. **It does not work.** IndexedDB cannot resolve a dotted
keyPath through an array of objects: the path evaluates to `undefined`, the index
is built empty, and every query against it silently returns no rows. Dexie accepts
the schema string without complaint, so the failure surfaces only as "suggestions
never find anything" — exactly the kind of bug that is cheap to catch now and
expensive to diagnose in M3.

A `*` multi-entry index requires a flat array of primitives, hence the derived
`ingredientIds` field.

The derivation is enforced at the write path, not by convention:

```ts
// src/db/db.ts — the only supported way to write a recipe
await saveRecipe(recipe);   // derives ingredientIds, stamps updatedAt
```

`db.recipes.put()` still compiles, but leaves the index stale. Anything that
writes recipes goes through `saveRecipe()`. `src/db/db.test.ts` covers both
deduplication and index freshness after an ingredient list changes.

## 5. Unit handling

Units are **not** auto-converted in M1–M3. Aggregation in M4 sums only within the
same unit and lists mismatched units as separate shopping lines
("onion 2 ea" + "onion 100 g" → two lines).

Automatic conversion needs a density table per ingredient to be correct, which is
disproportionate effort for a single-user app. Revisit only if mismatched lines
turn out to be common in real use.

## 6. Backup format

Because there is no server, export/import is the only safety net and is therefore
an M1 completion requirement, not a nice-to-have.

- Export: a single `.zip` — `data.json` (all tables, photos referenced by id) plus
  `photos/<id>.<ext>`.
- Import: full replace, with an explicit confirmation step. Merge-import is a
  non-goal.
- The acceptance test is: export → wipe IndexedDB → import → every recipe, photo and
  cook log is back.

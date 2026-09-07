# ADR-0002: Normalized Ingredient References From M1

## Status
Accepted

## Type
Architectural

## Created
2026-09-07

## Deciders
- architect
- pm

## Context

Three of the four planned milestones depend on the app knowing that two differently
written ingredients are the same thing:

- **M3 (pantry → suggestions)** must intersect "what the recipe needs" with "what is
  in the fridge".
- **M4 (meal plan → shopping list)** must aggregate the same ingredient appearing in
  several recipes into one shopping line, then subtract what is already in the
  pantry.
- **M1 (paste-to-parse import)** must resolve a parsed ingredient line to something
  stable, or every import creates duplicates.

Korean cooking vocabulary makes this concrete and unavoidable. "대파 1대",
"파 한 뿌리" and "쪽파 50g" are written differently, use different counting units,
and are related but not identical. English sources add "spring onion" / "scallion"
/ "welsh onion" for the same shelf item.

Only M1 ships first. The temptation is therefore to store
`ingredients: string[]` now — it is faster to build, and nothing in M1 reads the
structure.

## Problem Statement

Ingredient representation is chosen in the **M1 recipe schema**, but it is only
*exercised* in M3 and M4. That gap is the trap: by the time the weakness is felt,
the user has entered dozens of recipes by hand, and every one of them is a free-text
record that no migration can reliably restructure.

Recovering structure later means either re-parsing free text with the same ambiguity
that caused the problem, or asking the user to re-enter their archive. Both are ways
to lose the app.

## Decision

**Ingredients are stored as references from M1 onward, not as strings.**

```ts
// in Recipe
ingredients: { ingredientId, qty, unit, note?, optional }[]

// separate canonical table, present in schema v1
Ingredient { id, name, aliases[], category, defaultUnit, isStaple, ... }
```

Supporting rules:

- The `ingredients` table exists in Dexie schema **version 1**, with a multi-entry
  index on `aliases` and on `recipes.*ingredients.ingredientId`.
- The paste parser resolves each parsed line against `name` and `aliases`. On no
  match it creates a new `Ingredient` and shows it flagged in the correction table,
  so the user notices and can merge instead of duplicating.
- `Recipe.sourceText` retains the original pasted text. If the parser or the alias
  set improves later, a recipe can be re-parsed from source rather than re-typed.
- `isStaple` lives on the ingredient (not a separate list) so M3 scoring can exclude
  pantry staples with a single index lookup.
- **M1's UI stays simple**: a plain autocomplete field. Alias management, merging and
  category editing are not built in M1. Only the *data* is normalized; the interface
  cost is deferred.

## Consequences

### Positive

- M3 and M4 become straightforward queries over existing indexes instead of
  migrations plus queries.
- Import duplicates are visible at entry time, when the user still remembers the
  recipe, rather than discovered months later in a broken shopping list.
- Renaming an ingredient is a single-record edit that propagates everywhere.

### Negative

| Consequence | Handling |
|-------------|----------|
| M1 costs more than the string version — a table, a resolver, an autocomplete. | Accepted. This is the whole point of the ADR: the cost is small now and unbounded later. |
| The alias set starts near-empty, so early imports create near-duplicates. | The correction table flags newly created ingredients. A merge tool is scheduled for M3, when there is enough real data to merge against. |
| A wrong autocomplete pick silently mislabels an ingredient. | The recipe detail view shows the canonical name, so a mismatch is visible on the next read. |

### Not decided here

Whether "대파" and "쪽파" should be one ingredient with aliases or two related
ingredients is a **data** question, not a schema question. The schema supports
either. It is settled per-ingredient as the archive grows.

Unit conversion is explicitly out of scope — see
[data-model.md](../data-model.md) §5.

## Alternatives Considered

**Free-text strings with fuzzy matching at query time.** Cheapest in M1. Rejected:
it moves an unbounded ambiguity problem into every M3/M4 query, makes results
non-deterministic from the user's point of view, and still leaves the archive
unstructured.

**Normalize later, at the start of M3, via a migration.** Rejected: the migration
input is exactly the free text whose ambiguity is the problem. Best case it needs
manual review of every recipe; worst case the user abandons the app at the migration
prompt.

**A large pre-seeded ingredient database.** Rejected as premature. A small starter
set covering staples, grown from actual use, fits a single-user app and avoids
maintaining a dictionary nobody asked for.

## References

- [product-brief.md](../product-brief.md) §4 Risk B
- [data-model.md](../data-model.md)
- [ADR-0001 — Local-first, no backend](0001-local-first-no-backend.md)

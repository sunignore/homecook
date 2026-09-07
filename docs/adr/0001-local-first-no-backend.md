# ADR-0001: Local-First Storage, No Backend

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

homecook is a single-user personal cooking app. The user explicitly scoped it to
"me only" — no family sharing, no public service (see
[product-brief.md](../product-brief.md) §1).

The primary usage context is a phone propped up on a kitchen counter. Kitchens are
frequently the worst Wi-Fi location in a home, and the moments the app is most
needed — mid-recipe, hands wet, timer running — are exactly the moments when a
network round-trip failure is least acceptable.

The four planned milestones (recipe archive, cook mode, pantry, meal plan) all
operate on a data set measured in hundreds of records and a few dozen photos. None
of them requires server-side computation: the M3 suggestion score is a deterministic
set-intersection over local data.

## Problem Statement

The default reflex for an app with structured data is a backend: an API, a database,
and accounts to scope the data to a user. For this app that would mean building and
operating authentication, a hosted database, a deployment pipeline and a backup
strategy — before the first recipe can be saved.

That cost buys exactly one capability the user asked for: nothing. Sharing and
multi-device access are explicit non-goals.

## Decision

**No backend. All data lives in the browser's IndexedDB on the device, accessed
through Dexie.**

Concretely:

- Storage: IndexedDB via `dexie`, with `dexie-react-hooks`' `useLiveQuery` for
  reactive reads.
- Delivery: a PWA (`vite-plugin-pwa` / Workbox) so the app installs to the home
  screen and its shell is cached for offline launch.
- No accounts, no authentication, no network requests in the core flows.
- Durability is provided by explicit **export / import** of a backup file, surfaced
  in Settings.

Because there is no server cache to mirror, no server-state library (TanStack Query)
and no separate client store (Zustand, Redux) is introduced. `useLiveQuery` is the
single reactive read path.

## Consequences

### Positive

- The app works with the phone in airplane mode, which is the real kitchen
  condition.
- Zero hosting cost and zero operational surface. Nothing to patch, rotate or pay
  for.
- No personal data leaves the device, so the privacy design surface is close to
  empty.
- First useful version is reachable in days rather than weeks.

### Negative — and how each is handled

| Consequence | Handling |
|-------------|----------|
| **No cross-device access.** Recipes entered on the phone are not on the laptop. | Accepted. Explicit non-goal. Backup export/import is the manual bridge. |
| **Browser data eviction can destroy everything.** IndexedDB is evictable under storage pressure, and clearing site data wipes it. | Request `navigator.storage.persist()` on first launch. Backup export is an **M1 completion requirement**, not a later feature. Settings shows the date of the last export and warns when it is stale. |
| **No server-side backup.** | The exported file is the user's responsibility to store (cloud drive, etc.). Documented in the user guide. |
| **Photos consume device quota.** | Images are resized to a 1280px long edge before storing. Settings surfaces current usage via `navigator.storage.estimate()`. |

### Reversibility

This decision is deliberately cheap to reverse in one direction. All data access is
confined to a repository layer over Dexie; the schema in
[data-model.md](../data-model.md) is already normalized with stable ids and
`createdAt`/`updatedAt` on every record. If sync is ever wanted, that layer is the
seam to implement it behind, and the timestamps are the raw material for conflict
resolution.

## Alternatives Considered

**Supabase / Firebase.** Would give sync and hosted backup with modest setup. Rejected:
it introduces accounts and a network dependency in the kitchen path to serve two
explicit non-goals, and it makes offline correctness harder, not easier.

**localStorage.** Rejected: synchronous, string-only, roughly 5MB, and cannot hold
photo Blobs. Unsuitable for the recipe corpus.

**SQLite via wa-sqlite / OPFS.** More powerful querying. Rejected as premature — the
query patterns in §4 of the data model are index lookups over hundreds of rows, well
inside what IndexedDB handles, and the added build and worker complexity would slow
M1 down.

## References

- [product-brief.md](../product-brief.md)
- [data-model.md](../data-model.md)
- [ADR-0002 — Normalized ingredients from M1](0002-normalized-ingredients-from-m1.md)

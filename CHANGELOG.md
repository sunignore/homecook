# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] 2026-09-07

### Added
- **[2026-09-07]**: Product planning set for the homecook app: `docs/product-brief.md` (problem, M1–M4 milestones, the two risks that decide adoption, non-goals), `docs/data-model.md` (Dexie schema, versioning policy, backup format) and `docs/design.md` (kitchen-context design evidence → principles → decisions → 3-layer tokens, WCAG 2.1 AA).
- **[2026-09-07]**: `docs/adr/0001-local-first-no-backend.md` — IndexedDB/Dexie only, no server or accounts; backup export/import is the durability story.
- **[2026-09-07]**: `docs/adr/0002-normalized-ingredients-from-m1.md` — recipes reference an `Ingredient` table from schema v1 rather than storing ingredient strings, so M3 suggestions and M4 shopping aggregation do not require a later migration of hand-typed recipes.
- **[2026-09-07]**: `app/` — Vite + React + TypeScript PWA shell (`vite-plugin-pwa`, 276 KiB precache), Dexie schema v1, five routes and a bottom tab bar.
- **[2026-09-07]**: `app/scripts/compile-tokens.ts` — compiles `src/styles/tokens.json` (SSOT) to CSS custom properties and fails the build on any primitive → semantic → component layer violation.
- **[2026-09-07]**: `app/src/import/parseRecipeText.ts` — paste-to-parse recipe importer covering Korean and English sources: quantity-first and quantity-last orders, fractions and mixed numbers, ranges, to-taste amounts, parenthesised notes, and step-duration extraction for the M2 timers. Unclassifiable lines are surfaced in `unparsed`, never dropped.

### Fixed
- **[2026-09-07]**: `.gitignore` — ignore `*.tsbuildinfo`, and untrack `app/tsconfig.tsbuildinfo`, which was committed as a build artifact in the initial import.
- **[2026-09-07]**: `scripts/SCRIPTS.md` — `upgrade-project.ts` registry row was tagged layer `L0` while the file ships into scaffolded projects, so `verify-scripts.ts` skipped the row and then reported the copied file as unregistered, failing the audit on a fresh scaffold. Corrected to `L0+L1` to match the workspace-root registry.
- **[2026-09-07]**: `docs/user-guide.md`, `docs/user-guide_ko.md` — dropped the `../GEMINI.md` link, which is dangling in a project scaffolded with `--platform claude`.

## [Unreleased] 2026-09-01

- **[2026-09-07]**: docs: design-foundation.md §2b — design process pipeline (principles→tokens→style guide→icons→components→patterns→screens) and design-phase gate; style-neutral (ADR-0066)
- **[2026-09-07]**: docs/_templates: design-review-checklist-template.md added
- **[2026-09-07]**: skills: k-dart 2.0.0 → 2.1.0 — corp_code fallback chain with company.json cross-validation, financial account normalization + summation integrity checks, CFS→BFS fallback, disclosure search presets, shareholder signal, source-document text extraction, shared fetch gate (concurrency/backoff/daily budget)

## [Unreleased]

### Added
- **[2026-09-07]**: `k-kosis` skill (Korean Statistical Information Service / KOSIS OpenAPI) — promoted from `co-pitch/skills/k-kosis`, registered in `skills/SKILLS.md` (scope: common, l2_propagate).

### Changed
### Fixed
- **[2026-09-07]**: `agents/pm.md` — removed the 5-line `lifecycle:` frontmatter block (L0-only field, forbidden in L1 by `audit.ts`'s L1 pm.md check). Pre-existing defect left on main since #605; surfaced as a blocking FAIL during the co-hr promotion gate and cleared under that PR (single-root-PR pattern per #605 precedent). Restores ADR-0033 extends-pattern conformance; no other content touched.
### Removed

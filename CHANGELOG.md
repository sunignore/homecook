# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] 2026-09-07

### Fixed
- **[2026-09-07]**: Vercel build then failed with `tsc: command not found`. The Install Command was still `echo skip` — a value from the removed root config that had been saved into the Vercel project settings, so no dependencies were installed and every build tool was missing. `app/vercel.json` now sets `installCommand` explicitly; values in `vercel.json` take precedence over dashboard settings, so the deployment no longer depends on a setting someone has to remember to clear.
- **[2026-09-07]**: Vercel build failed with `cd: app: No such file or directory`. Vercel runs the build *inside* the project's Root Directory (`app`), so a repository-root `vercel.json` whose build command began with `cd app` was already there. Config moved to `app/vercel.json` with plain, location-independent commands (`bun run build` → `dist`); the root config is removed so there is one source of truth. Deployment setup is documented in the README: Root Directory must be `app`.

### Added
- **[2026-09-07]**: **Backup export / restore** — the M1 completion requirement, and the app's entire durability story given there is no server copy (ADR-0001). Settings exports one `.zip` (`data.json` plus `photos/`) and restores from it. Restore validates the whole archive *before* touching anything and replaces in a single transaction, so a corrupt file or a mid-restore failure leaves the existing data intact rather than half-erased. Verified end to end in the browser: export → wipe IndexedDB completely → restore → recipes, ingredient references, the derived index and step timers all return.
- **[2026-09-07]**: Settings shows the uncomfortable numbers on purpose: record counts, storage used, whether the browser agreed to persist the data, and how long since the last export (warning past 14 days). The last-export date lives in `localStorage`, not the database — storing it with the data would mean a restore also restored a stale "last backed up" date, at exactly the moment the number most needs to be true.
- **[2026-09-07]**: `vercel.json` — deployment config building `app/` into `app/dist`, with the SPA rewrite the router requires (`/recipes/<id>` would otherwise 404 on refresh) and `sw.js` kept uncached so a new version is picked up.
- **[2026-09-07]**: `app/src/styles/components.css` — shared button, field, banner and tag primitives, imported by `global.css`. Settings had been relying on styles defined in `RecipeImport.css`, a file it does not import; that only worked because Vite bundles all CSS together.
- **[2026-09-07]**: Product planning set for the homecook app: `docs/product-brief.md` (problem, M1–M4 milestones, the two risks that decide adoption, non-goals), `docs/data-model.md` (Dexie schema, versioning policy, backup format) and `docs/design.md` (kitchen-context design evidence → principles → decisions → 3-layer tokens, WCAG 2.1 AA).
- **[2026-09-07]**: `docs/adr/0001-local-first-no-backend.md` — IndexedDB/Dexie only, no server or accounts; backup export/import is the durability story.
- **[2026-09-07]**: `docs/adr/0002-normalized-ingredients-from-m1.md` — recipes reference an `Ingredient` table from schema v1 rather than storing ingredient strings, so M3 suggestions and M4 shopping aggregation do not require a later migration of hand-typed recipes.
- **[2026-09-07]**: `app/` — Vite + React + TypeScript PWA shell (`vite-plugin-pwa`, 276 KiB precache), Dexie schema v1, five routes and a bottom tab bar.
- **[2026-09-07]**: `app/scripts/compile-tokens.ts` — compiles `src/styles/tokens.json` (SSOT) to CSS custom properties and fails the build on any primitive → semantic → component layer violation.
- **[2026-09-07]**: `app/src/import/parseRecipeText.ts` — paste-to-parse recipe importer covering Korean and English sources: quantity-first and quantity-last orders, fractions and mixed numbers, ranges, to-taste amounts, parenthesised notes, and step-duration extraction for the M2 timers. Unclassifiable lines are surfaced in `unparsed`, never dropped.

### Added
- **[2026-09-07]**: **Recipe input path** — recipes now enter the app through the user rather than living in source. `app/src/routes/RecipeImport.tsx` is the paste → correct → save flow: paste a recipe, review the parsed draft in an editable table, save. `app/src/routes/Recipes.tsx` lists what is stored, and `app/src/routes/RecipeDetail.tsx` shows one, resolving ingredient references back to names.
- **[2026-09-07]**: `app/src/import/resolveIngredients.ts` — matches parsed names against the archive's canonical ingredients before anything is written. Matching ignores whitespace, so `다진마늘` resolves to an existing `다진 마늘` instead of forking the vocabulary (ADR-0002). Unmatched entries are flagged as new in the correction table rather than silently created, and category / pantry-staple hints are supplied for the ones that really are new.
- **[2026-09-07]**: `app/src/import/importRecipe.ts` — persists a corrected draft in a single transaction, re-checking the archive inside it so a stale correction screen cannot introduce duplicate ingredients, and writing through `saveRecipe()` so the derived index stays valid.
- **[2026-09-07]**: `parseRecipeText` now reports `optional` per ingredient, detected from markers such as `(선택)`. M3 counts only non-optional ingredients as required, so dropping this at parse time would make every suggestion stricter than the recipe is.
- **[2026-09-07]**: `app/src/test/fixtures/pasteFormats.ts` — six paste-format fixtures covering the layouts observed on public Korean recipe pages, plus notes from that format survey. Original text; only the structure is reproduced. Moved out of `src/import/` so recipe content cannot be mistaken for app source.

### Fixed
- **[2026-09-07]**: Backup export revoked the object URL synchronously after `click()`, which cancels the download in some browsers — a silent no-file failure at the exact moment the user believes they are covered. The anchor is now attached to the document (Firefox requires it) and the URL outlives the click.
- **[2026-09-07]**: `app/src/import/parseRecipeText.ts` — four defects found by testing against real paste formats rather than assumed ones:
  - **[2026-09-07]**: Ingredient name and amount are rendered in separate cells on the dominant Korean recipe layout, so a paste alternates name line / amount line. The parser assumed one line per ingredient and produced bogus ingredients literally named `700ml`. Amount-only lines now attach to the ingredient above them.
  - **[2026-09-07]**: Bracketed section labels (`[재료]`, `[양념]`) never matched, because the heading anchor did not allow a closing bracket — so nothing below such a heading was scanned.
  - **[2026-09-07]**: `주재료` was missing from the ingredient-heading vocabulary (`부재료` was present), silently dropping every ingredient in that section.
  - **[2026-09-07]**: Serving counts stayed in the parsed title (`잡채 (4인분)`), duplicating a value already captured separately.
- **[2026-09-07]**: `app/src/import/parseRecipeText.ts` — bracketed asides (e.g. a ratio hint) are no longer parsed as ingredients, substitution notes (`또는 목살`) move into the note field, promotional boilerplate is kept out of the step list, and common English count units (clove, slice, can…) are recognised.
- **[2026-09-07]**: `app/src/import/parseRecipeText.ts` — parenthetical notes are now lifted before quantity matching, and from anywhere in the phrase rather than only the end. A trailing note sat between the quantity and the end of the line and defeated the quantity-last anchor, so `청양고추 1개 (선택)` parsed with its amount stranded inside the name.
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

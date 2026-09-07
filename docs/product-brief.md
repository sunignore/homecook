# Product Brief — homecook

## Status
Active — M1 in progress

## Created
2026-09-07

## 1. What this is

A personal home-cooking app for a single user. It is a mobile-first PWA that runs
offline on a phone propped up in the kitchen. There is no account, no server, and
no sharing.

The success criterion is not feature completeness. It is:

> **I still open this app in week 6.**

Every scope decision below is subordinate to that one.

## 2. The problem

Home cooking for one household breaks down at four separate points, and each one
feeds the next:

1. **"What do I make with what I have?"** — ingredients are bought, then forgotten,
   then thrown out. The decision of what to cook is made at 7pm with the fridge
   door open and no memory of what is behind the yoghurt.
2. **"Where did that recipe go?"** — recipes live scattered across browser
   bookmarks, screenshots, YouTube descriptions and messages. The version that
   actually worked — with the tweak that fixed it — is nowhere.
3. **"What do I need to buy?"** — without a plan, shopping is guesswork, which
   loops back into problem 1.
4. **"What was step 4 again?"** — during cooking, hands are wet and busy, the phone
   screen sleeps, and multiple things need timing at once.

These are not four apps. They are one loop:

```
Pantry ──▶ What should I cook? ──▶ Cook mode ──▶ Cook log
   ▲                                               │
   └──── Shopping list ◀── Meal plan ◀─────────────┘
```

## 3. Milestones

The loop is closed one arc at a time. Each milestone must survive a week of real
use before the next one starts.

| # | Milestone | Scope | Done when |
|---|-----------|-------|-----------|
| **M1** | Recipe archive + cook log | Recipe CRUD, paste-to-parse import, tags, search, photo, cook log (rating, memo, tweaks), backup/restore | 15 real recipes are in it, and a cook log entry exists |
| **M2** | Cook mode | Full-screen step view, multiple timers, Wake Lock, large type and touch targets, hands-off advance, finishes into the cook log | A full meal was cooked from the phone screen |
| **M3** | Pantry + suggestions | Ingredient inventory (quantity, expiry, storage location), expiry-first ordering, "can cook now" scoring | The pantry tab decided a dinner |
| **M4** | Meal plan + shopping | 7-day calendar (breakfast/lunch/dinner), plan → shopping list (aggregate ingredients, subtract pantry stock), check off → restock pantry | The list was open in the shop |

**Why M2 before M3**: cook mode is the cheapest to build and the most immediately
felt. It needs nothing beyond M1 data. M3 and M4 both depend on ingredient
normalization maturing, so they come after there is real recipe data to normalize
against.

**If a milestone does not get used for a week, the next step is to fix that
milestone — not to build the next one.**

## 4. The two risks that decide whether this survives

### Risk A — Recipe entry friction

Personal recipe archives die because adding one recipe takes ten minutes. If entry
is a form with a repeating ingredient row, the app is abandoned at roughly recipe
twenty.

**Mitigation** — three-tier entry, in this order:

1. **Paste first.** Paste a whole blog post or video description. A heuristic parser
   splits the ingredient block from the step block (ingredient lines match
   `name + quantity + unit`; step lines are numbered or paragraph-shaped) and
   produces a structured draft.
2. **Correct.** The draft is shown as an editable table. The parser only has to be
   right about 80% of the time to be worth it.
3. **Manual entry** remains as the fallback.

LLM-assisted parsing is deliberately **not** in the MVP: it conflicts with the
offline-first decision (ADR-0001) and adds a dependency before we know the
heuristic is insufficient. Revisit only if measured parser accuracy on real pasted
sources is too low to be useful.

### Risk B — Ingredient normalization

If the app cannot tell that "대파 1대", "파 한 뿌리" and "쪽파 50g" refer to related
ingredients, then M3 suggestions and M4 shopping aggregation are both impossible.

This is decided by the **M1 recipe schema**, not by M3. Retrofitting it later is a
full data migration of every recipe already entered.

**Mitigation** — from M1, ingredients are stored as
`{ ingredientId, qty, unit, note }` against a normalized `ingredients` table
(canonical name, aliases, category, default unit). In M1 the UI is only
autocomplete; the data is already normalized underneath. See ADR-0002.

## 5. Suggestion scoring (M3)

Deterministic, no model inference required:

```
staples = ingredients assumed always present (salt, soy sauce, sugar, cooking oil…),
          editable in settings

score(recipe) = (required ingredients present in pantry)
              / (required ingredients, excluding staples)

order by: score desc
       → soonest-expiring pantry ingredient used
       → least recently cooked
```

The most useful surface in practice is a separate **"one ingredient away"** section:
recipes where exactly one item is missing.

## 6. Screens

Mobile-first, four bottom tabs plus settings.

| Tab | Screen | Milestone |
|-----|--------|-----------|
| Home | What should I cook — suggestion cards, today's plan, expiring soon | M1 (stub) → M3 |
| Recipes | List / search / tag filter → detail → **[Start cooking]** → cook mode → cook log | M1, M2 |
| Pantry | Ingredients ordered by expiry, quick add, mark used up | M3 |
| Plan | Weekly calendar ↔ shopping list | M4 |
| Settings | Backup / restore, staples, theme | M1 |

Cook mode is a dedicated full-screen route with the tab bar hidden — an accidental
tap with wet hands must not navigate away mid-recipe.

## 7. Non-goals

Revisit this list whenever a new feature is tempting. For a single-user app, feature
creep is the primary failure mode.

- Accounts, login, cross-device sync — replaced by backup/restore files
- Recipe sharing, community, social feed
- Automatic nutrition or calorie calculation
- Recipe crawling or scraping — paste is sufficient
- Voice control — reconsider only after M2 has been used for real
- Native app store distribution

## 8. References

- [ADR-0001 — Local-first, no backend](adr/0001-local-first-no-backend.md)
- [ADR-0002 — Normalized ingredients from M1](adr/0002-normalized-ingredients-from-m1.md)
- [Data model](data-model.md)

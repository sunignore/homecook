# Design Guide — homecook

## Status
Active — derived per [design-foundation.md](design-foundation.md)

## Created
2026-09-07

## Accessibility target
**WCAG 2.1 Level AA** across the app. **Cook mode targets AAA contrast (7:1)** for body
text — see §6.

---

## 1. Domain evidence

Design here is driven by one unusual operating context: the app is used **in a kitchen,
while cooking**. That is not a decorative detail; it invalidates several defaults that
would be fine for a normal mobile app.

| # | Evidence | Source | Design consequence |
|---|----------|--------|--------------------|
| E1 | The phone sits propped on a counter, roughly **0.5–1m from the eyes**, not held at reading distance. | product-brief §2, M2 | Cook-mode type must be far larger than a normal mobile body size. |
| E2 | Hands are **wet, greasy or holding something**. Taps are imprecise; some are made with a knuckle. | product-brief §2 | Large touch targets; no small controls in the cooking path; destructive actions away from the tap flow. |
| E3 | Kitchen lighting is **either bright daylight or dim evening**, often with glare on the screen. | operating context | Both light and dark themes are first-class, not an afterthought. High contrast, no low-contrast grey-on-grey. |
| E4 | The **phone screen sleeps** mid-recipe, and re-finding the step costs attention the user does not have. | product-brief §2 | Wake Lock in cook mode; step position survives reload; cook mode is a locked full-screen route. |
| E5 | **Several things are timed at once** (rice, simmer, oven). | product-brief §2, M2 | Multiple concurrent timers must be simultaneously visible, not stacked in a modal. |
| E6 | The user is often **offline or on weak Wi-Fi** in the kitchen. | ADR-0001 | The offline shell must be small. No large runtime font or icon downloads. |
| E7 | **All data is local and evictable.** There is no server copy to restore from. | ADR-0001 | Destructive actions need real confirmation; backup state must be visible, not buried. |
| E8 | Content is **primarily Korean**, with mixed Latin from imported sources. | product-brief §4 | Body face must render Korean well at every size, including small quantity annotations. |
| E9 | Quantities and timers are **columns of figures** the user compares at a glance. | data-model §2 | Numeric role with `tabular-nums`; digits must not shift width as a timer counts down. |

---

## 2. Design principles

1. **Readable from a metre away.** The cooking screen is read at counter distance, not
   reading distance. When in doubt, larger. *(E1, E3)*
2. **Assume clumsy hands.** Every control in the cooking path is hittable with a wet
   knuckle. Precision is never required to make progress. *(E2)*
3. **Never lose the user's place.** Cook mode does not navigate away by accident and
   does not forget where it was. *(E4)*
4. **Show the whole state at once.** Concurrent timers, remaining steps, and what is
   next are visible together — the user cannot afford to go looking. *(E5)*
5. **The data is irreplaceable; act like it.** Deletion confirms, backup status is
   surfaced, and nothing destructive shares a gesture with something routine. *(E7)*
6. **Ship nothing the kitchen has to download.** Offline weight is a design constraint,
   not an optimization. *(E6)*

---

## 3. Design decisions

```yaml
design_decisions:
  philosophy:
    - principle: "Readable from a metre away"
      rationale: "E1 — the phone is propped on a counter at 0.5-1m, not held; standard 16px mobile body text is unreadable at that distance while cooking."
    - principle: "Assume clumsy hands"
      rationale: "E2 — taps during cooking are made with wet, greasy or occupied hands, often with a knuckle; controls requiring precision fail exactly when they are needed."
    - principle: "Never lose the user's place"
      rationale: "E4 — the screen sleeps mid-recipe and an accidental tap navigating away costs attention the user does not have while food is on the heat."
    - principle: "Show the whole state at once"
      rationale: "E5 — several dishes are timed concurrently; hiding a running timer behind navigation makes the app worse than a kitchen timer."
    - principle: "The data is irreplaceable; act like it"
      rationale: "E7 — ADR-0001 means there is no server copy; an accidental delete or a browser eviction is permanent loss."
    - principle: "Ship nothing the kitchen has to download"
      rationale: "E6 — the app is used on weak or absent Wi-Fi; every runtime asset is a failure mode at the worst moment."

  color:
    selected: "HSL primitive scales (neutral + warm accent + 3 status hues), mapped to semantic roles per theme via [data-theme]"
    rationale: "E3 — kitchen light swings between glare and dim, so light and dark are both first-class and must be produced from one semantic set rather than a hand-tuned second palette. HSL keeps lightness steps legible and adjustable when a contrast pair fails AA."

  typography:
    body:
      selected: "System Korean stack — -apple-system, 'Apple SD Gothic Neo', 'Pretendard Variable', Pretendard, 'Noto Sans KR', 'Malgun Gothic', sans-serif"
      rationale: "E8 + E6 — content is primarily Korean, and a self-hosted Korean webfont costs roughly 1MB even subsetted, which must then be precached into the offline shell. Modern iOS and Android system Korean faces render excellently at every size, cost zero bytes, and match platform expectations. Pretendard is honoured if the user already has it installed."
    heading:
      selected: "Same stack, weight 700, tighter tracking"
      rationale: "E6 — a second family means a second download for the offline shell. Weight and scale give sufficient hierarchy in an app this small; a display face would buy nothing the kitchen can use."
    numeric:
      selected: "Same stack with font-variant-numeric: tabular-nums; ui-monospace fallback for the cook-mode timer readout"
      rationale: "E9 — quantities are compared in columns and timers count down continuously; proportional digits make the readout jitter, which is distracting at a glance from across the counter."

  spacing:
    scale: "4px base — 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64"
    rationale: "E2 — a 4px base gives fine control for dense list content while stepping cleanly up to the 64px rhythm cook mode needs; a single scale keeps normal and cook-mode layouts in the same system."

  radius:
    scale: "4 steps — 6 / 10 / 16 / full"
    rationale: "Moderate radii suit a content app with photos; a distinct 'full' step is reserved for the circular timer and tag chips so those read as a different control class."

  motion:
    policy: "150ms for state feedback, 250ms for route transitions, shared ease-out curve. No motion in cook mode beyond the timer ring. prefers-reduced-motion: reduce disables all non-essential transitions."
    rationale: "E4 + E5 — animation during cooking competes for the attention the app is supposed to save. Timer state must be legible from its numbers alone, never from motion, so a reduced-motion user loses no information."

  iconography:
    library: "Lucide (lucide-react), 24px default, 2px stroke; 32px in cook mode"
    rationale: "E6 — Lucide ships as tree-shaken inline SVG components, so only the icons actually used enter the bundle and nothing is fetched at runtime. Consistent 2px stroke stays legible at counter distance where thin-stroke sets disappear."

  layout:
    density: "Single column, comfortable density. Max content width 640px, centred above that. Bottom tab bar with safe-area inset padding. Baseline viewport 375x812."
    rationale: "E1 + E2 — one column removes any horizontal target-hunting; 640px keeps line length readable if the app is opened on a tablet or desktop without introducing a second responsive layout to maintain."
```

---

## 4. Token architecture

Three layers, strict reference rule (design-foundation §5). Source of truth is
`app/src/styles/tokens.json`, compiled to CSS custom properties.

```
Primitive   --hc-neutral-50 … --hc-neutral-950, --hc-accent-*, --hc-green/amber/red-*
    ↓        theme-neutral raw values
Semantic    --background, --foreground, --surface, --border, --muted-foreground,
    ↓        --accent, --accent-foreground, --green-bg/fg/border, --amber-*, --red-*
Component   --button-primary-bg, --card-bg, --timer-ring, --step-text, --tab-active-fg
    ↓        references semantic tokens only
Components  consume component tokens (or semantic directly for one-offs); never raw values
```

Rules, per design-foundation §5:

- Semantic tokens reference **only** primitives; component tokens reference **only**
  semantics. Bypassing a layer is a lint violation.
- Theme variation lives entirely in the semantic layer, keyed on
  `[data-theme="light"]` / `[data-theme="dark"]`. **No `.dark` class mechanism.**
- Primitives are theme-neutral: one value each.
- Status semantics ship complete **bg / fg / border triplets** for green (fresh),
  amber (expiring soon) and red (expired / destructive).
- `docs/design-tokens.template.css` is the starting scaffold.

Status colours map to real domain state, which is why all three triplets are required
rather than optional: pantry items are fresh, expiring, or expired (data-model §2,
`PantryItem.expiresAt`).

---

## 5. Type scale

Two scales. Cook mode is not "the app, bigger" — it is a separate scale derived from
viewing distance (E1).

| Role | App | Cook mode |
|------|-----|-----------|
| Body | 16px / 1.6 | **24px / 1.5** |
| Step text | — | **28px / 1.45** |
| Heading | 20–28px, weight 700 | 32px |
| Timer readout | — | **48px, tabular-nums** |
| Caption / annotation | 14px | 18px |

14px is the floor anywhere in the app. Nothing below it, including ingredient
annotations.

---

## 6. Accessibility

Target: **WCAG 2.1 Level AA**, with the exceptions noted below where the domain
demands better.

| Area | Commitment | Verification |
|------|-----------|--------------|
| Contrast | AA (4.5:1 body, 3:1 large) for every semantic role pair, in **both** themes. **Cook mode body text targets AAA (7:1)** because of viewing distance E1. | `accessibility-audit` skill (axe-core); contrast pairs asserted in a unit test over tokens.json |
| Touch targets | 44x44px minimum app-wide (exceeds AA 2.5.8's 24px). **64x64px minimum in cook mode** per E2. | Component test asserting minimum box size on interactive elements |
| Focus | Visible `:focus-visible` ring on every interactive element, 2px, using `--focus-ring`, never removed. | axe-core + manual keyboard pass |
| Keyboard | Full keyboard operability including cook-mode step advance and timer control. | Manual keyboard pass per milestone |
| Non-colour encoding | Status is **always** colour + icon + text. Pantry freshness never relies on colour alone (E3: glare washes out hue). | Review checklist; axe-core cannot catch this |
| Icon-only controls | Every icon-only button carries an `aria-label`. | axe-core |
| Motion | `prefers-reduced-motion: reduce` disables all non-essential transitions. Timers convey state numerically, so no information is lost. | Manual check with the OS setting on |
| Timers | Countdown announced via `aria-live="polite"`; completion is audible **and** visible (E2: the user may not be looking). | Manual screen-reader pass |
| Language | `lang="ko"` on the document; imported Latin content is not separately marked (acceptable at AA). | — |

Feature-level design docs must carry their own Accessibility section per ADR-0065.
This section covers the design-system layer only.

---

## 7. Validation

Against the design-foundation §7 contract:

**[Required]** — ✓ design.md with complete `design_decisions` · ✓ tokens.json + compiled
CSS · ✓ light + dark semantic themes · ✓ bg/fg/border triplets for green/amber/red ·
✓ body/heading/numeric roles · ✓ Lucide declared · ✓ WCAG 2.1 AA declared · ✓ focus
state defined · ✓ non-colour encoding defined.

**[Consistency]** — enforced by the `token-usage-lint` skill (no raw hex, `rgb()`/`hsl()`
literals, or raw px spacing in components) plus review for layer bypass and
`aria-label` coverage.

Run `accessibility-audit` (axe-core, WCAG 2.1 AA) at the end of each milestone, not
ad hoc.

---

## 8. References

- [design-foundation.md](design-foundation.md) — the procedure this document implements
- [product-brief.md](product-brief.md) — evidence source
- [data-model.md](data-model.md) — status semantics
- [ADR-0001](adr/0001-local-first-no-backend.md) — offline constraint behind E6/E7

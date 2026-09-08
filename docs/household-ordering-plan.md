# Household ordering extension

Status: local implementation added; hosted deployment and physical iPhone
acceptance checks remain pending. This document records the agreed design.
Date: 2026-09-08

Implementation notes: the first version uses foreground polling every 15 seconds
and refreshes on reconnect rather than a realtime channel. Invitations use links
and pasteable codes. Restaurant naming and receipt/thanks elements are included;
custom personal nicknames are deferred. See the
[deployment runbook](household-deployment.md) for setup and remaining device checks.

This extends the existing homecook PWA and its M1-M4 cooking workflow. The
requirements below supersede the original product's single-user scope for the
planned household mode. Existing local use remains supported.

## 1. Confirmed requirements

| Topic | User decision |
|-------|---------------|
| People and devices | Husband and wife, each using an iPhone |
| Roles | Husband receives orders as chef; wife orders as customer |
| Entry | Choose Husband or Wife; no email/password account form |
| Menu | Select from the existing recipe collection |
| Schedule | Choose a date and breakfast, lunch, or dinner |
| Contents | Multiple dishes per order, including soup, main, and sides |
| Servings | Default two people; change for each order |
| Confirmation | Meal becomes confirmed only when husband accepts |
| Rejection | Reject the entire order and leave a comment; no partial acceptance |
| Notifications | Phone notification even while the app is closed |
| Cost | Start within free service tiers |
| Experience | A playful restaurant/order-taking experience within homecook |

The following are implementation defaults, not additional answers from the user:
one active order per meal slot; edit/cancel before acceptance; a cancellation
request after acceptance; restaurant name, nicknames, and a thank-you reaction.
They can be adjusted during implementation without changing the core flow.

## 2. First-use and recurring flows

1. Husband opens existing homecook, keeps a local backup, and selects Husband.
2. One-time owner setup binds his device to the private household. A deployment
   setup credential authorizes this first binding; selecting a role alone never
   grants access to an existing household.
3. He confirms which existing recipes become available on the shared menu.
4. He shares an expiring, single-use invite link or QR with his wife. The app
   provides this sharing action; no invitation is sent automatically.
5. Wife opens homecook from her iPhone Home Screen, selects Wife, and consumes
   the invitation. Do not assume two browsing contexts share a session: prefer
   sending the code over the link, support pasting it into the installed app, and
   refuse pairing outright inside a messenger's in-app browser, which would
   otherwise consume the single-use token in storage the installed app cannot see.
6. Each device requests notification permission after an explicit button tap,
   then receives a test notification. Normal subsequent visits restore its role.
7. Wife selects date, meal, dishes, diners, and an optional request, then reviews
   a receipt and submits. A server response establishes that the order was sent.
8. Husband sees the receipt in his inbox and accepts or rejects the whole order.
9. Acceptance updates the shared meal plan. Husband can start cooking and mark
   the meal ready; wife sees the status and can send a thank-you reaction.

Example: Friday dinner, two diners, soup + pork main + a vegetable side.
Acceptance creates one dinner entry containing all three dishes. Their ingredient
requirements are scaled separately from each recipe's base servings.

## 3. Existing screens and proposed additions

Preserve the existing five-tab shell and full-screen cook mode. Put the restaurant
entry and current order summary on Home, with supporting routes beneath it.
This avoids removing existing recipe, pantry, or planning access.

| Surface | Change |
|---------|--------|
| Home | Household summary; customer menu shortcut; chef pending-order count |
| Restaurant/menu | Available recipe cards, search, dish selection, schedule and diners |
| Order receipt | Dishes, date, meal, diners, notes, status history, permitted actions |
| Chef inbox | Pending first, then accepted/cooking/ready and past orders |
| Recipes | Chef-only publish/unpublish action; recipe editing stays in existing screens |
| Plan | Multiple dishes in an accepted-order cell; link back to the order |
| Cook mode | Select an order dish and retain separate progress/timers when switching |
| Settings | Household connection, invitation/recovery, restaurant name, notifications |

Customer access to shared data is read-only except their orders and reactions.
Recipe publishing, shared plan edits, and order acceptance are chef operations.
Pantry, shopping check-offs, and cooking logs remain on the chef's device in this
release; sharing these independently is outside this feature's scope.

## 4. Order rules

| Current state | Action and actor | Result |
|---------------|------------------|--------|
| Draft (device only) | Customer submits | Pending |
| Pending | Customer edits | Pending with a new version and refreshed snapshots |
| Pending | Customer cancels | Cancelled |
| Pending | Chef accepts | Accepted and meal plan committed together |
| Pending | Chef rejects with nonblank comment | Rejected |
| Accepted | Chef starts cooking | Cooking |
| Accepted or Cooking | Customer requests cancellation | State retained; separate request awaits chef |
| Accepted or Cooking | Chef approves cancellation, or cancels with a reason | Cancelled and linked plan removed together |
| Accepted or Cooking | Chef declines cancellation with a comment | State retained; request closed |
| Cooking | Chef marks ready | Ready |
| Ready | Customer sends thanks | Ready; one replaceable reaction |

After acceptance, contents/date/diners are immutable. To change them, request
cancellation and submit a replacement after approval. No partial acceptance,
substitution negotiation, automatic acceptance, or silent expiry is introduced.

- Treat pending, accepted, cooking, and ready as occupying their meal slot.
  Rejected and cancelled orders release it. An unresolved cancellation request
  also prevents another order for that slot.
- Use the household time zone, initially Asia/Seoul. Store the meal date as a
  calendar date, not a UTC timestamp; reject new orders for past dates. Since
  meals have no exact time yet, same-day ordering remains possible.
- Validate at least one distinct available dish, integer diners 1-20, at most
  20 dishes and 1,000 characters per note/comment. These limits are defaults.
- Server rechecks menu availability and version on submission/edit. On mismatch,
  preserve the draft and show which item needs review. Unpublishing later does
  not rewrite an already submitted order.
- Every command carries an idempotency key and expected order version. Repeating
  a request returns the original result; stale actions return a conflict with the
  latest receipt. Accept/edit and accept/cancel races cannot both succeed.
- If a manual plan already occupies the slot, acceptance stops with a conflict.
  Chef must explicitly clear or reschedule that plan before retrying. Nothing
  silently overwrites the existing meal.

## 5. Architecture and data ownership

Use Supabase as the proposed shared backend: Postgres, anonymous authentication,
private photo storage, and Edge Functions for push delivery. Retain React, Vite,
Dexie, and the existing PWA shell. See [ADR-0003](adr/0003-household-sharing.md).

| Data | Authority and proposed structure |
|------|----------------------------------|
| Household | Server: id, name, timeZone, defaultDiners |
| Membership | Server: householdId, authUserId, role, revokedAt; one active member per role |
| Invitation | Server: token hash, householdId, permitted role, expiry, usedAt |
| Menu recipe | Server published snapshot: local source ID, version, availability, recipe, ingredient dictionary, private photo key |
| Order | Server: household/date/slot, diners, status, version, notes, request author and timestamps |
| Order item | Immutable submitted recipe snapshot: title, ingredients, base servings, steps, menu version, photo reference |
| Order event | Server: actor, command ID, previous/new state, comment, timestamp |
| Shared meal plan | Server: household/date/slot, sourceOrderId or manual entry, dishes, diners, version |
| Push subscription | Server: member/device, endpoint, keys, last success/failure |
| Notification outbox | Server: event/recipient uniqueness, attempts, next attempt, delivered/expired status |
| Device cache | Dexie: validated snapshots scoped by household and user, revision, last sync |
| Local data | Existing recipes, photos, pantry, cook logs and drafts; retained on original device |

Use normalized relational records and transactions rather than a single mutable
household JSON document. JSON snapshots on menu/order items preserve historical
content without making the whole household a write-conflict boundary.

All shared tables and private storage enforce household membership. Anonymous
authentication provides a device identity, not permission by itself. Deny direct
client writes to protected order states: narrow server-side transaction functions
validate actor, state, version, slot uniqueness, snapshots, plan and outbox. Bind
all authorization to the authenticated user, never a client-supplied role.
Use Zod at network/config boundaries and equivalent database constraints.

The browser receives only public project configuration. Service-role keys, VAPID
private keys and setup credentials remain server-side. Invite tokens are random,
hashed at rest, expire, and are consumed atomically; keep them out of logs and
remove them from navigation history after use. Rate-limit setup and invite attempts.

On reconnection, foreground entry, and a realtime event, fetch the authoritative
snapshot and update the local cache. Realtime is a refresh hint, not proof that
every change arrived; use a bounded foreground polling fallback. Display the last
sync time when offline. Allow offline recipe viewing/cooking and local order
drafts; submission and shared state changes require server acknowledgement.

Recovery: a still-authorized partner device can issue a narrowly scoped replacement
invite for the other role. It revokes the old binding and subscriptions atomically.
If both devices are lost, the deployment owner rebinds through server administration;
role selection alone cannot recover access. Never erase local recipes on logout.

## 6. Existing meal plan, shopping and cooking integration

The current `MealPlan` has one `recipeId`; extend it with dish entries and an
optional shared origin. Convert existing single-recipe entries to one-item entries
while keeping their original quantity semantics. Preserve free-text plans.

On the first household activation, copy the chef's existing plans to the server
with stable source IDs. Resolve occupied slots before enabling shared planning.
After activation, the server owns the household calendar, including manual plans;
Dexie holds its projection. Keep pre-migration originals in the backup, and avoid
showing both the original and its shared projection as two meals. Local-only mode
continues to own its own plan. Household plan writes require connectivity.

Accepting an order writes the order state, all plan dishes, event and notification
outbox in one database transaction. A network failure after commit is resolved by
retrying the same command ID. Cache failures cannot undo a server-accepted order.

Shopping amount per dish = snapshot ingredient quantity x order diners / snapshot
base servings. Sum across every occurrence in the selected week, then subtract
pantry stock once per ingredient/unit. Preserve existing rules for optional and
unknown quantities, different units, manual shopping rows and purchased rows.
Maintain a verified mapping from shared ingredient IDs to chef-local canonical
IDs so pantry subtraction works. No guessing conversions or merging by name alone.
Changes to confirmed meals mark the generated shopping list as needing refresh;
regeneration remains an explicit action and preserves purchases.

Cook sessions must be keyed by order-item ID for order cooking, or recipe ID for
ordinary cooking. Migrate the legacy single-session key on first read. Store timer
deadlines so switching dishes/reloading restores elapsed time; clear only the
finished dish's session. Cook against the order snapshot even if the original
recipe changes. Completing a dish does not mark the whole order ready automatically.
Background order push does not imply guaranteed background cooking-timer audio.

## 7. iPhone notifications and delivery failures

Support Web Push on iOS 16.4+ Home Screen web apps. Request permission only from
an explicit user action, then store the device's subscription. Keep one service
worker responsible for both the offline shell and push handling. A notification
opens the relevant receipt on the same origin; it never contains credentials.
Source: [WebKit Web Push guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

Notify chef about submitted/edited/cancelled pending orders and cancellation
requests. Notify customer about acceptance, rejection, cancellation decisions and
ready status. Keep other status changes in the receipt to avoid excessive alerts.

Persist notifications with the state change, send asynchronously, and retry failed
deliveries with bounded backoff using a scheduled worker. Deduplicate by event and
recipient; tolerate transport duplicates with notification tags. Retire expired
subscriptions, validate allowed push destinations, and never turn push failure
into order failure. Opening the app always refreshes the receipt. Test denied
permission, revoked subscriptions, Focus mode, offline devices and delayed delivery.

Free hosting may pause inactive projects or reach quotas. Show service-unavailable
states with retry and retained drafts; do not promise uninterrupted push delivery.
Document dashboard recovery and quota checks before launch. Do not enable a paid
upgrade automatically. Source: [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

## 8. Migration and backups

1. Export and validate a backup of all existing local tables and photos.
2. Present recipe/plan counts and let chef select what to publish. No public menu.
3. Upload immutable photos to private storage and copy recipe/ingredient records
   with a migration batch ID and stable source IDs.
4. Verify counts, references, content hashes and downloadable photo bytes before
   marking the batch complete. Retry resumes the batch rather than duplicating it.
5. Activate shared projections only after verification. Preserve local originals
   through failure; clean orphan uploads separately after successful recovery.

Add a new Dexie version; never edit shipped versions. Retain reading of existing
backup archives. Extend backup export to include versioned household snapshots
and photos, but exclude sessions, invitation secrets and push credentials. Restoring
a local archive never overwrites the live household: recover it into local data,
then use an explicit chef import/reconciliation process for server publication.

## 9. Accessibility and playful elements

Target WCAG 2.1 AA and reuse [the existing design system](design.md) and
`app/src/styles/tokens.json`. Use semantic forms, labelled multi-select controls,
visible focus, large touch targets, error associations, and polite live announcements
for submission/status updates. Status always includes text, not just a color/stamp.
Check VoiceOver reading order, keyboard navigation, text zoom and reduced motion.

Initial fun elements: restaurant name and nicknames, a receipt-style order, a
textual accepted stamp, a ready message and a thank-you reaction. Avoid currency,
checkout/payment metaphors, competitive scoring, or effects that obscure actions.

## 10. Implementation sequence and release checks

Each stage builds on the previous one; all are required before calling the requested
feature complete. If delivered as separate PRs, merge each before branching the next.

| Stage | Main files/areas | Exit criteria |
|-------|------------------|---------------|
| 1. Contracts and shared backend | New `supabase/` migrations/functions; `app/src/household/` schemas/client | Two isolated identities; cross-household/role writes rejected; invite expiry/replay/recovery tested |
| 2. Pairing and migration | Settings, Recipes, Dexie version, photo and backup modules | Existing fixture data survives copy failure/retry; both phones see selected recipes and photos |
| 3. Menu and orders | App routing, Home, new menu/inbox/receipt routes | Multi-dish ordering and all transitions; edit/accept/cancel races and duplicate submissions verified |
| 4. Existing workflow | `db/types.ts`, `plan/mealPlan.ts`, `plan/shoppingList.ts`, Plan, Home, CookMode, `cook/session.ts` | Atomic acceptance; occupied-slot conflict; serving math; old plans; distinct timer recovery; snapshot history |
| 5. Push and iPhone onboarding | `vite.config.ts`, service worker, subscriptions, outbox worker | Two real iPhones receive closed-app alerts and open correct receipts; retries and expired subscriptions tested |
| 6. Release validation | App tests/build, backup round trip, user guide, deployment runbook | Offline cooking regression; VoiceOver review; two-device full scenario; free-tier and recovery setup recorded |

Run meaningful domain tests, database authorization/transaction integration tests,
previous-version Dexie migration tests, and the existing app test suite. Typecheck
and production build must pass. Automated browser testing covers separate customer
and chef sessions; physical iPhones are required for the push release check.

Deployment inputs still needed: Supabase project configuration, a stable HTTPS
origin, server-only push credentials, and access to both phones for verification.
These do not block implementing or testing local code; actual remote deployment
and closed-app notification success must remain explicitly unverified until tested.

## References

- [Existing product brief](product-brief.md)
- [Existing data model](data-model.md)
- [Proposed architecture decision](adr/0003-household-sharing.md)
- [Korean plan summary](ko/household-ordering-plan.md)
- [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase row level security](https://supabase.com/docs/guides/database/postgres/row-level-security)

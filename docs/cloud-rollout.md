# Cloud rollout

## Approved behavior

The owner approved implementation on 2026-09-08:
all content lives in Supabase; both fixed users can use every ordinary feature;
Husband administers codes; a role plus a persistent code signs in on any device.
There is no existing user data to migrate. Device pairing tests are on hold.

## Delivery state

| Stage | Deliverable | State |
| --- | --- | --- |
| 1 | ADR, cloud tables, private photo boundary, session enrollment and revocation foundation | Implemented locally; PR review pending |
| 2 | Bootstrap, code gateway, credential management, accessible login UI | Pending |
| 3 | Recipes, ingredients and photos through server repositories | Pending |
| 4 | Pantry, meal plans, shopping and cooking history | Pending |
| 5 | Both-role order actions, frozen receipts, cooking handoff | Pending |
| 6 | Realtime/refetch, personal caches, shared-device memory mode | Pending |
| 7 | Multiple push subscriptions, full export, hosted acceptance | Pending |

Merge each PR before branching the next stage. A foundation merge does not activate
cloud mode. Keep the existing client until the full cloud flow passes validation.
No automatic deployment of SQL or authentication secrets is part of local work.

## Data and authorization

All cloud content is scoped by household_id. Fixed memberships reference permanent
Auth users. Unique (household_id, role) represents two people, not two devices;
multiple cloud_sessions can belong to either person. Composite foreign keys prevent
recipes, ingredients, photos, orders and plans from linking across households.

Both roles read the same content. Browser table writes are closed in stage 1.
Subsequent RPCs must validate all fields, compare expected versions, preserve
references, return strict DTOs and record an idempotency key in the same transaction.
Order acceptance and plan insertion remain atomic. Shopping completion must retain
the existing pantry-restock behavior and avoid restocking twice on retries.

Private photos transition from pending to ready only after upload verification.
Their object paths are household/photo UUIDs. Hash metadata supports deduplication;
later reference checks protect images retained by historical receipts from cleanup.

Revision rows serialize committed changes within a household. Future snapshot RPCs
return data and revision from a consistent database snapshot. Realtime is an
invalidation hint; clients refetch on startup, reconnect and missed revisions.
An update or deletion never relies on the device clock.

## Authentication implementation requirements

- Bootstrap uses a server-only one-time secret and an atomic initialization lock.
  Retries must finish or recover provisioning without creating another household.
  Existing trial households are reviewed separately; never rerun legacy setup as
  the new initialization flow.
- Codes contain at least 12 characters, including letters and digits, with a
  bounded maximum. Offer a random generator; never log input or reveal saved codes.
- Hide internal account identifiers from the UI. Use Auth password hashing plus
  server-keyed code derivation; do not implement a parallel password hash database.
- Rate-limit the gateway and test the public Auth bypass path, including retries,
  generic errors, and anonymous visitors. Never expose a server signing/admin key.
- Register only actual Auth sessions for the permanent member at the captured
  access version. A failed enrollment must not become an authorized login.
- Verify Husband's live enrolled session before any administrative operation.
  Rotate codes separately from explicit revoke-all. Revoked sessions remain denied
  after token refresh. A new login at the new access version restores access.
- Owner code recovery uses a private deployment administration procedure.
  Personal login persistence is optional; shared-device mode stays in memory.
- Revocation stops subsequent server access, not requests already in progress or
  copies already downloaded. Do not claim remote deletion.

## Offline and shared-device behavior

All ordinary saves require connectivity. Preserve an unsaved form on connection
loss and show retry, not a success message. Personal-device caches provide last-known
recipes/plans/photos. Offline cooking keeps absolute timer deadlines locally;
handoff on reconnect must compare the controller and version before persisting.

Shared-device mode must audit all private persistence surfaces: IndexedDB, localStorage,
service worker caches, image HTTP caches, drafts, and logout cleanup. The app shell
may remain cached; household content must not. Logout cannot erase screenshots or
files a user deliberately downloaded.

## Export and notifications

Export a consistent server snapshot plus every referenced image. Validate counts,
hashes and missing files before reporting completion. Do not include credentials.
Interactive whole-server restore and local-data migration are deferred.

Push subscriptions belong to devices/sessions, with delivery attempts per
subscription so a failure on one phone does not resend to every successful phone.
Reuse the event outbox pattern, but migrate the current user-primary-key subscription
design before deploying the new worker. VAPID, worker secrets and scheduling remain
deployment work; basic cloud login and CRUD do not depend on push.

## Release acceptance

- Fresh browsers show the same full recipes/photos, pantry, plans, shopping and logs.
- Both roles can create and accept orders and edit all ordinary content.
- A second device never evicts the first; re-login restores server content.
- A revoked token cannot read database rows or protected photos, including after refresh.
- Invalid/cross-household references and direct table writes fail.
- Duplicate saves and concurrent edits do not silently overwrite or repeat stock changes.
- Photo upload failures are recoverable and never reported as a complete save.
- Offline viewing/cooking and explicit cooking handoff work without overwriting a peer.
- Shared-device logout leaves no app-managed persistent private data.
- Multiple iPhones receive push independently; export contains all referenced files.
- Keyboard and VoiceOver cover login, errors, conflicts and connection status.

## Deployment checkpoint

Migrations 001 and 002 were applied by the owner, with Vercel public configuration
and anonymous Auth enabled for the legacy app. A trial household exists.
Migration 003 is additive and creates no users or households. Do not confuse the
legacy anonymous authentication switch with the future code gateway.
The current browser app does not yet read cloud_* tables.

Before production cutover: deploy and test the complete gateway, validated commands,
Storage authorization, client and push changes in a private environment. Keep all
server secrets in hosted secret stores; no local token login on the shared PC.

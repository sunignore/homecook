# ADR-0004: Store all household data in Supabase

## Status

Accepted by the owner, 2026-09-08. Implementation is staged.
The first PR adds the database foundation only; no hosted changes have been applied
by the agent. The currently deployed app still uses ADR-0003 device pairing.

## Context

The couple needs the same recipes, photos, pantry, calendar, shopping checks,
cooking history and orders on every device. Selective menu publication and anonymous
device identities cannot provide this experience. The owner confirmed there is no
user data to migrate and approved role-and-code login without email entry.

## Decision

Supabase is authoritative for all household content. Two permanent Auth users map
to Husband and Wife. Both can use every cooking and ordering action. Husband alone
manages credentials and access. Role selection chooses an identity; it grants no
permission by itself. Codes are persistent login secrets, managed through a server
gateway, backed by Supabase Auth password hashing, and never stored in application
tables or logs.

The login gateway must enroll a verified Auth session in a server-only registry.
RLS checks the current user, actual Auth session, enrollment, enabled membership
and access version on every database request. Incrementing the membership access
version revokes previously enrolled sessions even while their JWTs remain valid.
Capture that version before verifying a login code to reject stale in-flight
logins after revocation. Refreshing the same revoked Auth session cannot re-enroll it.

Code rotation and access revocation are separate operations. Rotation prevents new
logins with the previous code; explicit access revocation denies subsequent server
requests from existing sessions. Already downloaded data cannot be remotely erased.
The login gateway must address direct Auth endpoint bypass: its registration gate
prevents an unenrolled session from reading data, but does not itself rate-limit
password guessing against Auth. Before rollout, verify Auth-level throttling and
use a server-side keyed derivation of user codes for internal passwords so raw
codes cannot be guessed through the public Auth password endpoint. Keep the
derivation secret stable; rotation needs a coordinated credential reset.

Recipes contain their entire original content. Orderable is a menu setting, not a
sharing boundary. Order and accepted-plan snapshots preserve historical content.
Photos use a new private bucket, with ready metadata required before reading.
Authenticated downloads recheck access; avoid long-lived signed URLs that would
outlive revocation.

Use online writes with optimistic version checks and idempotent command IDs.
Server writes increment versions and a household revision transactionally.
Realtime signals cause a refetch; reconnect takes a consistent snapshot rather
than trusting client clocks or assuming no events were missed. Soft deletion
preserves references and allows other devices to remove stale cached content.

Personal-device caches support offline viewing and cooking. Shared-device sessions
remain in memory and do not persist private content. Login persistence is opt-in.
An active cooking session has one controlling session; online takeover is explicit
and versioned. Reconnecting offline cooking must not overwrite another controller.

## Foundation boundaries

Migration 003 adds separate cloud_* tables and cloud-photos, preserving legacy hc_*
tables and household-photos. Legacy pairing cannot enroll cloud sessions.
Authenticated users receive SELECT only, subject to session-aware RLS. Future
validated command RPCs will grant specific mutation capabilities. Structured JSON
steps, timers and frozen dishes require strict runtime validation in those RPC/gateway
boundaries before writes are enabled; this PR does not expose generic JSON writes.

Session enrollment and access revocation helpers are service-role-only. Their
future Edge callers must independently verify administrator authorization where
needed; holding a service-role credential bypasses RLS by design.

No data transfer, server-wide reset, user provisioning, login endpoint, Realtime
publication, push worker conversion or browser storage switch is included in
the foundation. Existing tables are not silently deleted.

## Alternatives

- Anonymous per-device pairing: rejected because recovery requires a separate
  pairing mechanism and one device could replace another.
- Email OTP: rejected by the owner in favor of administrator-assigned codes.
- Role buttons without a credential: rejected because public visitors could read
  and change private content.
- All-purpose JSON household document: rejected because record-level references,
  concurrent updates and image lifecycle need explicit boundaries.
- Full offline mutation queue: deferred to avoid silently resolving conflicting
  orders, inventory changes and recipe edits in the initial release.

## Accessibility

The foundation has no UI. Subsequent screens target WCAG 2.1 AA: labeled role/code
inputs, keyboard operation, visible focus, text errors linked to fields, announced
save/reconnect status, and accessible conflict/takeover dialogs. Verify with
keyboard and iPhone VoiceOver in the final acceptance pass.

## Rollout and evidence

See [cloud rollout](../cloud-rollout.md) for the approved scope, PR order and
remaining work. Apply additional migrations through the owner's private dashboard;
do not store production credentials on the shared classroom machine.
PGlite tests cover Postgres constraints and RLS with Auth/Storage schema shims.
Hosted Auth, Storage gateway behavior and physical iPhone behavior require separate
verification before cutover.

This decision supersedes local-only authority in
[ADR-0001](0001-local-first-no-backend.md) and selective sharing/device binding in
[ADR-0003](0003-household-sharing.md) when the cloud UI is released.

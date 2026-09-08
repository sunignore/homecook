# ADR-0003: Add private household sharing to homecook

## Status

Accepted for implementation, 2026-09-08. Local application and server migrations
are implemented; hosted deployment and physical iPhone verification remain pending.

## Context

The existing app implements local recipes, cooking, pantry and planning. The user
now wants two iPhones to share a menu, submit multi-dish orders for a meal slot,
accept/reject them, and receive notifications while the app is closed. Device-only
storage cannot coordinate acceptance or originate remote push notifications.

## Decision

Extend the existing PWA with a private household service using Supabase Postgres,
anonymous device identities, membership-based authorization, private photo storage
and a notification worker. Keep the user interface to Husband/Wife role selection
plus one-time secure device pairing. A role button is not an authorization mechanism.

The server owns shared menu publications, orders and the household calendar.
Retain Dexie for local data and validated offline projections. Recipe publication
is explicit; orders freeze their recipe versions. Transactional state changes
include plan updates, event history and notification outbox records.

This proposal supersedes the no-backend/no-sharing part of
[ADR-0001](0001-local-first-no-backend.md) only for household mode when implemented.
Its offline cooking and local-data durability requirements continue to apply.
The original ADR remains applicable to local-only use and the previously deployed
application until this extension is deployed.

## Alternatives

| Option | Assessment |
|--------|------------|
| Keep only IndexedDB and exchange backups | Cannot deliver live orders or closed-app notifications |
| Public shared ID plus role stored in localStorage | Cannot restrict access to the couple or enforce chef permissions |
| Email/password or social sign-in | Adds an account flow the user explicitly does not want |
| Native iOS app | Adds distribution and maintenance scope; existing PWA supports the required push path |
| One household JSON document | Simple prototype but makes unrelated changes conflict and constraints harder to enforce |
| Normalized Postgres with frozen item snapshots | Selected: explicit permissions, uniqueness, transactions and stable order history |

## Consequences

Two devices can coordinate meal decisions without replacing the existing app.
Shared mutations require connectivity; offline drafts and cached cooking remain
available. Re-pairing is needed when anonymous device credentials are lost. Free
service limits and inactivity pauses become operational concerns. Push delivery
is asynchronous and does not replace the durable order receipt.

Migration must preserve the original archive, and restoring a backup must not
silently replace the shared household. Service-role and push private keys stay on
the server. Two physical iPhones are part of release validation.

## Specification

See the [household ordering plan](../household-ordering-plan.md) for state rules,
ownership, data migration, security, accessibility, implementation stages and tests.

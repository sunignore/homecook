# Deploying household ordering

The app remains usable locally without shared configuration. Remote verification
requires a Supabase project, a stable HTTPS origin, and two physical iPhones.

## Database and first connection

1. Create a free Supabase project and enable Anonymous Sign-Ins in Auth.
2. For legacy device pairing, apply migrations 001 and 002 in timestamp order using
   the SQL editor or Supabase CLI. Tables are private; do not disable row level security.
3. Run `supabase/setup-household.sql` once. Privately copy the returned 30-minute
   token. On the chef's Home Screen app, open Home > restaurant, choose Husband
   and paste the token. This creates no email/password flow.
4. Download the existing local backup and confirm it has been saved. Publish the
   selected recipes, then run the existing-plan connection action before accepting
   orders. A duplicate slot is reported rather than overwritten.
5. Generate the partner invitation in restaurant settings and send the **code**,
   not the link. A link tapped inside a messenger opens in that app's own webview,
   whose storage is separate from the Home Screen app: pairing there consumes the
   single-use token and leaves the installed app unpaired with a code that no
   longer works, and push cannot be registered there either. The screen detects a
   known in-app browser, refuses to pair, and offers the code to copy instead. The
   wife opens the installed app, chooses Wife and pastes it. A link still works
   when opened in Safari or Chrome; its token is removed from the navigation
   history after reading.

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the public anon key), and
`VITE_VAPID_PUBLIC_KEY` on the existing Vercel app, whose build root is `app/`.
See `app/.env.sample`. Rebuild after changing these variables.
Never put the service-role key, private VAPID key, or worker secret in VITE variables.

## Permanent code authentication staging

This flow is implemented separately from legacy anonymous pairing and does not switch
application data to the cloud by itself.

1. Apply migrations 003, 004, and 005 in timestamp order. Migration 004 is
   retry-safe for the same partially provisioned Husband identity and refuses a
   second household. Migration 005 adds recipe commands and private photo upload
   policies, but does not switch the existing screens to cloud data.
2. In Supabase Edge Function secrets, set HOMECOOK_AUTH_PEPPER to a stable random
   value of at least 32 characters, HOMECOOK_BOOTSTRAP_SECRET to a separate random
   value of at least 24 characters, and HOMECOOK_APP_ORIGINS to the exact allowed
   HTTPS origins separated by commas. Do not prefix any of these with VITE_.
3. Deploy cloud-auth. JWT verification is disabled at the platform edge because
   bootstrap and login begin without a JWT. The function enforces exact origins,
   rate limits attempts, and independently verifies a live enrolled Husband session
   for credential administration.
4. Open /cloud-access, enter the one-time bootstrap secret and choose the Husband
   code. After login, set the Wife code in the administrator section. Codes are
   12–64 characters and must contain letters and numbers.
5. Rotate the bootstrap secret after initialization and retain the authentication
   pepper in the private deployment secret store. Losing or changing the pepper
   invalidates code derivation and requires an administrator credential reset.

The UI offers persistent login for a personal phone and memory-only login for a
shared device. Code rotation affects future logins. The separate role-wide logout
increments the access version so enrolled sessions immediately lose subsequent
database and protected-photo access. Neither operation can erase data already
downloaded by a device.

The browser receives only the existing public Supabase URL and publishable key.
Never expose SUPABASE_SERVICE_ROLE_KEY, either authentication secret, internal
derived passwords, or Auth account identifiers through Vercel client variables.

## Push delivery

Generate a persistent VAPID key pair with the web-push CLI and store it privately.
Set Edge Function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` (a mailto contact), and `PUSH_WORKER_SECRET` (at least 32 random
characters). Supabase supplies the function's project URL and service-role key.
Deploy `push-orders`; gateway JWT verification is disabled because a cron-specific
secret authorizes this endpoint. The function itself rejects unauthenticated calls.

Enable Cron, pg_net and Vault. Store `homecook_push_url` (the full HTTPS
`/functions/v1/push-orders` URL) and `homecook_push_secret` in Vault.
Schedule this SQL once per minute through the Cron dashboard:

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='homecook_push_url'),
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='homecook_push_secret')
  ),
  body := '{}'::jsonb
);
```

The worker leases up to 20 pending events, retries transient errors at most eight
times within 24 hours, and removes expired subscriptions. Discarded alerts are
recorded separately from delivered alerts. A failed alert never rolls back an order.
The one-minute schedule means delivery is not instantaneous.

## Acceptance on two iPhones

Use iOS 16.4+ and add the HTTPS app to each Home Screen. Open it there and tap
the notification button; accept permission and verify the test push. Repeat with
the app closed and the phone locked. Check notification tap opens the correct
receipt, including after a PWA update. Test denied permission and Focus mode.

Submit three dishes for two diners. Accept from the other phone, verify the
existing Plan tab and scaled shopping list, switch between dishes in cook mode,
mark ready, and receive the ready alert. Then test whole rejection with comment,
cancellation request/approval, duplicate taps and a stale order open on two screens.

## Recovery and operations

The other paired device can issue a replacement invitation for the lost role.
Consuming it revokes that role's former membership and push subscription. When
both sessions are lost, the deployment owner creates a new expiring invite in
the SQL editor for the existing household; do not create another household.
Clearing browser data loses anonymous credentials, so role selection is not recovery.

Free projects can pause or hit quotas. Check Supabase usage and dashboard state if
shared requests fail. Keep local backup files and monitor outbox rows with
`attempts >= 8 and sent_at is null`. Fix the delivery issue before explicitly
resetting their attempt counters. Old order receipts remain authoritative.

Shared backup export may need connectivity to retrieve photos not yet cached on
this device. It reports missing photos instead of producing a misleading complete
archive. After restoration, the restaurant screen exposes preserved order history
and lets the user copy menu recipes into the local archive before republishing.

The local test suite covers PostgreSQL business rules with PGlite and Supabase
schema shims. It does not establish hosted RLS/storage configuration, Edge runtime
delivery, or physical iPhone behavior. Those checks must be recorded after deployment.

The shared-server code is split out of the main bundle: `/restaurant` is a lazy
route, and every other screen reaches household state through `household/cache`
and `household/config`, which do not import `@supabase/supabase-js`. The entry
bundle is therefore unchanged by household mode for the offline cooking path
(design.md E6). The Supabase chunk is still precached so the installed app stays
complete offline.

Local verification on 2026-09-08: 281 tests across 20 files passed; TypeScript and
the production PWA build passed; both the code-auth Edge Function and its strict
request contracts passed Deno checking. Hosted authentication remains a deployment
checkpoint because no production secret or migration was applied from this computer.
Existing memory-file line-ending warnings remain.

Sources: [Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous),
[scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions),
[WebKit iPhone push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

# Deploying household ordering

The app remains usable locally without shared configuration. Remote verification
requires a Supabase project, a stable HTTPS origin, and two physical iPhones.

## Database and first connection

1. Create a free Supabase project and enable Anonymous Sign-Ins in Auth.
2. Apply both files in `supabase/migrations/` in timestamp order using the SQL
   editor or Supabase CLI. Tables are private; do not disable row level security.
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

Local verification on 2026-09-08: 248 tests across 16 files passed; TypeScript and
the production PWA build passed; the Edge Function passed Deno checking; the
workspace audit passed after regenerating the ADR relationship graph. The entry
bundle measured 459 KB with the shared-server chunk at 228 KB loaded on demand.
Existing memory-file line-ending warnings remain.

Sources: [Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous),
[scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions),
[WebKit iPhone push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

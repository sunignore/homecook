import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7';
import { z } from 'npm:zod@4.1.5';

const env = z.object({
  SUPABASE_URL: z.string().url(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  PUSH_WORKER_SECRET: z.string().min(32), VAPID_PUBLIC_KEY: z.string().min(80),
  VAPID_PRIVATE_KEY: z.string().min(40), VAPID_SUBJECT: z.string().startsWith('mailto:'),
}).parse(Deno.env.toObject());
const server = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const endpoint = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    (url.hostname.endsWith('.push.apple.com') || url.hostname === 'push.apple.com' ||
      ['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname));
});
const subscriptionSchema = z.object({
  endpoint, expirationTime: z.number().nullable().optional(),
  keys: z.object({ auth: z.string().min(20).max(30), p256dh: z.string().min(80).max(100) }).strict(),
}).strict();
const jobSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), attempts: z.number().int(),
  payload: z.object({ title: z.string().max(100), body: z.string().max(500), url: z.string().startsWith('/restaurant').max(200), tag: z.string().max(100) }).strict(),
  subscription: z.unknown(),
}).strict();

Deno.serve(async request => {
  if (request.method !== 'POST' || request.headers.get('x-worker-secret') !== env.PUSH_WORKER_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }
  const claimed = await server.rpc('hc_claim_push');
  if (claimed.error) return new Response('Queue unavailable', { status: 503 });
  const jobs = z.array(jobSchema).max(20).safeParse(claimed.data);
  if (!jobs.success) return new Response('Invalid queue payload', { status: 500 });
  let sent = 0;
  for (const job of jobs.data) {
    try {
      const subscription = subscriptionSchema.parse(job.subscription);
      await webpush.sendNotification(subscription, JSON.stringify(job.payload), {
        TTL: 3600, timeout: 10000,
        vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
      });
      const update = await server.from('hc_outbox').update({ sent_at: new Date().toISOString() }).eq('id', job.id).eq('attempts', job.attempts);
      if (!update.error) sent++;
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 0;
      if ([404, 410].includes(status) || error instanceof z.ZodError) {
        // Do not remove a new subscription that replaced this failed one.
        await server.from('hc_subscriptions').delete().eq('user_id', job.user_id).eq('subscription', job.subscription);
        await server.from('hc_outbox').update({ discarded_at: new Date().toISOString() }).eq('id', job.id).eq('attempts', job.attempts);
      }
      // The lease/backoff permits retry after a transient failure or worker crash.
      // Never log private endpoints, keys, or order contents.
    }
  }
  return Response.json({ sent, processed: jobs.data.length });
});

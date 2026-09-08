import { createClient, type Session, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.57.4';
import { z } from 'npm:zod@4.1.5';

const roleSchema = z.enum(['husband', 'wife']);
const codeSchema = z.string().min(12).max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => /[A-Za-z]/.test(value) && /[0-9]/.test(value));
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({
    action: z.literal('bootstrap'),
    bootstrapSecret: z.string().min(24).max(256),
    householdName: z.string().trim().min(1).max(80),
    code: codeSchema,
  }).strict(),
  z.object({ action: z.literal('login'), role: roleSchema, code: codeSchema }).strict(),
  z.object({
    action: z.literal('set-code'),
    role: roleSchema,
    code: codeSchema,
  }).strict(),
  z.object({ action: z.literal('revoke-all'), role: roleSchema }).strict(),
]);
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  HOMECOOK_AUTH_PEPPER: z.string().min(32),
  HOMECOOK_BOOTSTRAP_SECRET: z.string().min(24),
  HOMECOOK_APP_ORIGINS: z.string().min(1),
}).strict();
const authContextSchema = z.object({
  householdId: z.string().uuid(),
  role: roleSchema,
  name: z.string().min(1).max(80),
  accessVersion: z.number().int().positive(),
}).strict();
const statusSchema = z.object({
  initialized: z.boolean(),
  wifeConfigured: z.boolean(),
}).strict();
const jwtSchema = z.object({ session_id: z.string().uuid() }).passthrough();

const env = envSchema.parse({
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  HOMECOOK_AUTH_PEPPER: Deno.env.get('HOMECOOK_AUTH_PEPPER'),
  HOMECOOK_BOOTSTRAP_SECRET: Deno.env.get('HOMECOOK_BOOTSTRAP_SECRET'),
  HOMECOOK_APP_ORIGINS: Deno.env.get('HOMECOOK_APP_ORIGINS'),
});
const allowedOrigins = new Set(env.HOMECOOK_APP_ORIGINS.split(',').map(value => value.trim()).filter(Boolean));
const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function headers(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  };
}
function response(origin: string, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}
function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    difference |= (a[index % Math.max(a.length, 1)] ?? 0) ^ (b[index % Math.max(b.length, 1)] ?? 0);
  }
  return difference === 0;
}
async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.HOMECOOK_AUTH_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
async function internalPassword(role: z.infer<typeof roleSchema>, code: string): Promise<string> {
  const digest = await hmac('password:' + role + ':' + code);
  return 'Hc!' + digest;
}
function internalEmail(role: z.infer<typeof roleSchema>): string {
  return role + '@identity.homecook.invalid';
}
function publicSession(session: Session) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
  };
}
function sessionId(accessToken: string): string {
  const encoded = accessToken.split('.')[1];
  if (!encoded) throw new Error('Invalid Auth session');
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
  return jwtSchema.parse(payload).session_id;
}
function passwordClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
async function signIn(role: z.infer<typeof roleSchema>, code: string): Promise<{ user: User; session: Session }> {
  const result = await passwordClient().auth.signInWithPassword({
    email: internalEmail(role),
    password: await internalPassword(role, code),
  });
  if (result.error || !result.data.user || !result.data.session ||
      result.data.user.app_metadata?.homecook_role !== role) {
    throw new Error('Invalid credentials');
  }
  return { user: result.data.user, session: result.data.session };
}
async function createOrRecover(role: z.infer<typeof roleSchema>, code: string): Promise<User> {
  const created = await service.auth.admin.createUser({
    email: internalEmail(role),
    password: await internalPassword(role, code),
    email_confirm: true,
    app_metadata: { homecook_role: role },
  });
  if (created.data.user) return created.data.user;
  return (await signIn(role, code)).user;
}
async function rateLimit(request: Request, action: 'bootstrap' | `login:${z.infer<typeof roleSchema>}`): Promise<string> {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
  const fingerprint = await hmac('request:' + address);
  for (const [key, attempts] of [[fingerprint, 5], [await hmac('global'), 20]] as const) {
    const checked = await service.rpc('cloud_auth_attempt', {
      request_fingerprint: key,
      request_action: action,
      allowed_attempts: attempts,
    });
    if (checked.error || checked.data !== true) throw new Error('Rate limited');
  }
  return fingerprint;
}
async function resetRate(fingerprint: string, action: string): Promise<void> {
  await service.rpc('cloud_auth_reset_limit', {
    request_fingerprint: fingerprint,
    request_action: action,
  });
}
async function register(user: User, session: Session, expectedVersion: number): Promise<void> {
  const registered = await service.rpc('cloud_register_session', {
    target_user: user.id,
    target_session: sessionId(session.access_token),
    expected_version: expectedVersion,
  });
  if (registered.error) throw registered.error;
}
async function memberForRole(role: z.infer<typeof roleSchema>) {
  const setup = await service.from('cloud_auth_setup').select('household_id').eq('singleton', true).maybeSingle();
  if (setup.error || !setup.data) return null;
  const member = await service.from('cloud_members')
    .select('user_id,access_version,enabled').eq('household_id', setup.data.household_id)
    .eq('role', role).maybeSingle();
  if (member.error || !member.data || !member.data.enabled) return null;
  return member.data;
}
async function authorizeHusband(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Unauthorized');
  const checked = await service.auth.getUser(token);
  if (checked.error || !checked.data.user) throw new Error('Unauthorized');
  const scoped = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const context = await scoped.rpc('cloud_auth_context');
  const parsed = authContextSchema.safeParse(context.data);
  if (context.error || !parsed.success || parsed.data.role !== 'husband') throw new Error('Unauthorized');
  return { user: checked.data.user, context: parsed.data };
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? '';
  if (!allowedOrigins.has(origin)) return new Response('Forbidden', { status: 403 });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
  if (request.method !== 'POST') return response(origin, 405, { error: '요청을 처리할 수 없습니다.' });

  try {
    const body = requestSchema.parse(await request.json());
    if (body.action === 'status') {
      const result = await service.rpc('cloud_auth_status');
      if (result.error) throw result.error;
      return response(origin, 200, statusSchema.parse(result.data));
    }
    if (body.action === 'bootstrap') {
      const fingerprint = await rateLimit(request, 'bootstrap');
      if (!safeEqual(body.bootstrapSecret, env.HOMECOOK_BOOTSTRAP_SECRET)) throw new Error('Invalid bootstrap');

      const user = await createOrRecover('husband', body.code);
      const initialized = await service.rpc('cloud_initialize_household', {
        target_user: user.id,
        household_name: body.householdName,
      });
      if (initialized.error) throw initialized.error;
      const member = await memberForRole('husband');
      if (!member || member.user_id !== user.id) throw new Error('Bootstrap incomplete');
      const signed = await signIn('husband', body.code);
      await register(signed.user, signed.session, member.access_version);
      await resetRate(fingerprint, 'bootstrap');
      return response(origin, 200, { session: publicSession(signed.session) });
    }
    if (body.action === 'login') {
      const action = `login:${body.role}` as const;
      const fingerprint = await rateLimit(request, action);
      const member = await memberForRole(body.role);
      if (!member) throw new Error('Invalid credentials');
      const expectedVersion = member.access_version;
      const signed = await signIn(body.role, body.code);
      if (signed.user.id !== member.user_id) throw new Error('Invalid credentials');
      await register(signed.user, signed.session, expectedVersion);
      await resetRate(fingerprint, action);
      return response(origin, 200, { session: publicSession(signed.session) });
    }

    const admin = await authorizeHusband(request);
    const target = await memberForRole(body.role);
    if (body.action === 'set-code') {
      if (body.role === 'husband') {
        if (!target || target.user_id !== admin.user.id) throw new Error('Administrator required');
        const changed = await service.auth.admin.updateUserById(target.user_id, {
          password: await internalPassword('husband', body.code),
        });
        if (changed.error) throw changed.error;
      } else if (target) {
        const changed = await service.auth.admin.updateUserById(target.user_id, {
          password: await internalPassword('wife', body.code),
        });
        if (changed.error) throw changed.error;
      } else {
        const wife = await createOrRecover('wife', body.code);
        const provisioned = await service.rpc('cloud_provision_wife', {
          actor_user: admin.user.id,
          target_user: wife.id,
        });
        if (provisioned.error) throw provisioned.error;
      }
      return response(origin, 200, { ok: true });
    }

    if (!target) throw new Error('Member unavailable');
    const revoked = await service.rpc('cloud_revoke_access', { target_user: target.user_id });
    if (revoked.error) throw revoked.error;
    return response(origin, 200, { ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return response(origin, 400, { error: '입력값을 확인해주세요.' });
    const message = error instanceof Error ? error.message : '';
    if (message === 'Rate limited') return response(origin, 429, { error: '잠시 후 다시 시도해주세요.' });
    if (message === 'Unauthorized') return response(origin, 401, { error: '관리자 로그인이 필요합니다.' });
    if (message === 'Already initialized') return response(origin, 409, { error: '이미 초기 설정이 완료되었습니다.' });
    return response(origin, 401, { error: '역할 또는 코드를 확인해주세요.' });
  }
});

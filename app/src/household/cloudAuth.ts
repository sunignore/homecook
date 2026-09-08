import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const cloudRoleSchema = z.enum(['husband', 'wife']);
export const accessCodeSchema = z.string().min(12, '코드는 12자 이상이어야 합니다.').max(64)
  .regex(/^[A-Za-z0-9_-]+$/, '영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.')
  .refine(value => /[A-Za-z]/.test(value) && /[0-9]/.test(value), '영문과 숫자를 모두 포함해주세요.');
export const cloudContextSchema = z.object({
  householdId: z.string().uuid(),
  role: cloudRoleSchema,
  name: z.string().min(1).max(80),
  accessVersion: z.number().int().positive(),
}).strict();
const statusSchema = z.object({ initialized: z.boolean(), wifeConfigured: z.boolean() }).strict();
const sessionSchema = z.object({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(20),
  expiresAt: z.number().int().positive().optional(),
}).strict();
const sessionResponseSchema = z.object({ session: sessionSchema }).strict();
const okSchema = z.object({ ok: z.literal(true) }).strict();
const errorSchema = z.object({ error: z.string().min(1).max(200) }).strict();

export type CloudRole = z.infer<typeof cloudRoleSchema>;
export type CloudContext = z.infer<typeof cloudContextSchema>;
export type CloudAuthStatus = z.infer<typeof statusSchema>;

const url = z.string().url().optional().parse(import.meta.env.VITE_SUPABASE_URL || undefined);
const key = z.string().min(20).optional().parse(import.meta.env.VITE_SUPABASE_ANON_KEY || undefined);
let personalClient: SupabaseClient | undefined;
let sharedClient: SupabaseClient | undefined;
let currentClient: SupabaseClient | undefined;

function client(persist: boolean): SupabaseClient {
  if (!url || !key) throw new Error('공유 서버 연결 설정이 필요합니다.');
  if (persist) {
    personalClient ??= createClient(url, key, {
      auth: { persistSession: true, storageKey: 'homecook-cloud-auth', autoRefreshToken: true },
    });
    return personalClient;
  }
  sharedClient ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  return sharedClient;
}

async function gateway(body: unknown, token?: string): Promise<unknown> {
  if (!url || !key) throw new Error('공유 서버 연결 설정이 필요합니다.');
  const response = await fetch(url + '/functions/v1/cloud-auth', {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
  const raw: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = errorSchema.safeParse(raw);
    throw new Error(parsed.success ? parsed.data.error : '인증 서버 요청에 실패했습니다.');
  }
  return raw;
}

async function acceptSession(raw: unknown, persist: boolean): Promise<CloudContext> {
  const session = sessionResponseSchema.parse(raw).session;
  const selected = client(persist);
  const saved = await selected.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  if (saved.error || !saved.data.session) throw new Error('로그인 세션을 저장하지 못했습니다.');
  currentClient = selected;
  try {
    return await cloudAuthContext();
  } catch (error) {
    await selected.auth.signOut({ scope: 'local' });
    currentClient = undefined;
    throw error;
  }
}

export async function cloudAuthStatus(): Promise<CloudAuthStatus> {
  return statusSchema.parse(await gateway({ action: 'status' }));
}

export async function bootstrapCloud(
  bootstrapSecret: string,
  householdName: string,
  code: string,
  persist: boolean,
): Promise<CloudContext> {
  accessCodeSchema.parse(code);
  return acceptSession(await gateway({
    action: 'bootstrap', bootstrapSecret, householdName, code,
  }), persist);
}

export async function loginCloud(role: CloudRole, code: string, persist: boolean): Promise<CloudContext> {
  cloudRoleSchema.parse(role);
  accessCodeSchema.parse(code);
  return acceptSession(await gateway({ action: 'login', role, code }), persist);
}

async function sessionClient(): Promise<SupabaseClient | null> {
  if (currentClient) {
    const active = await currentClient.auth.getSession();
    if (active.data.session) return currentClient;
  }
  const persisted = client(true);
  const active = await persisted.auth.getSession();
  if (active.data.session) {
    currentClient = persisted;
    return persisted;
  }
  return null;
}

export async function cloudAuthContext(): Promise<CloudContext> {
  const selected = await sessionClient();
  if (!selected) throw new Error('로그인이 필요합니다.');
  const result = await selected.rpc('cloud_auth_context');
  const parsed = cloudContextSchema.safeParse(result.data);
  if (result.error || !parsed.success) throw new Error('로그인이 만료되었거나 접근이 해제되었습니다.');
  return parsed.data;
}

async function adminRequest(body: unknown): Promise<void> {
  const selected = await sessionClient();
  const session = await selected?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new Error('관리자 로그인이 필요합니다.');
  okSchema.parse(await gateway(body, token));
}

export async function setCloudCode(role: CloudRole, code: string): Promise<void> {
  cloudRoleSchema.parse(role);
  accessCodeSchema.parse(code);
  await adminRequest({ action: 'set-code', role, code });
}

export async function revokeCloudSessions(role: CloudRole): Promise<void> {
  cloudRoleSchema.parse(role);
  await adminRequest({ action: 'revoke-all', role });
}

export async function logoutCloud(): Promise<void> {
  const clients = [currentClient, personalClient, sharedClient].filter(
    (value, index, all): value is SupabaseClient => Boolean(value) && all.indexOf(value) === index,
  );
  await Promise.all(clients.map(value => value.auth.signOut({ scope: 'local' })));
  currentClient = undefined;
  sharedClient = undefined;
}

export function generateAccessCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const alphabet = letters + digits;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const characters = [
    letters[bytes[0]! % letters.length]!,
    digits[bytes[1]! % digits.length]!,
    ...Array.from(bytes.slice(2), byte => alphabet[byte % alphabet.length]!),
  ];
  for (let index = characters.length - 1; index > 0; index--) {
    const swap = bytes[index]! % (index + 1);
    [characters[index], characters[swap]] = [characters[swap]!, characters[index]!];
  }
  return characters.join('');
}

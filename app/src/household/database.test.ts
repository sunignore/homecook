// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { snapshotSchema } from './contracts';

let pg: PGlite;
const husband = '11111111-1111-4111-8111-111111111111';
const wife = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const household = '44444444-4444-4444-8444-444444444444';
const dish = { id: '55555555-5555-4555-8555-555555555555', title: 'Soup', servings: 4, ingredients: [], steps: [{ text: 'Boil', durationSec: 60 }], tags: [] };
async function user(id: string) {
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function cmd(body: Record<string, unknown>, id = crypto.randomUUID()) {
  const result = await pg.query<{ value: unknown }>('select public.hc_command($1,$2) as value', [id, body]);
  return snapshotSchema.parse(result.rows[0]!.value);
}
const submit = () => ({ action: 'submit', date: '2099-09-09', slot: 'dinner', diners: 2, note: '', selection: [{ id: dish.id, version: 1 }] });

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,name text,bucket_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
    grant usage on schema public,auth,storage to authenticated;
  `);
  await pg.exec(readFileSync(resolve(process.cwd(), '../supabase/migrations/202609080001_household.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(process.cwd(), '../supabase/migrations/202609080002_push_queue.sql'), 'utf8'));
  await pg.exec('grant select,insert,update,delete on all tables in schema public to authenticated');
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec('reset role; truncate public.hc_households,auth.users cascade');
  await pg.query('insert into auth.users values($1),($2),($3)', [husband, wife, outsider]);
  await pg.query('insert into public.hc_households(id,calendar_ready) values($1,true)', [household]);
  await pg.query("insert into public.hc_members values($1,$3,'husband'),($2,$3,'wife')", [husband, wife, household]);
  await pg.exec('set role authenticated');
  await user(husband);
  await cmd({ action: 'publish', recipe: dish, available: true });
});
describe('household database boundary', () => {
  it('rejects invalid recipe payloads and fractional diners on the server', async () => {
    await expect(cmd({ action: 'publish', recipe: { ...dish, servings: 0 }, available: true })).rejects.toThrow('레시피');
    await expect(cmd({ action: 'publish', recipe: { ...dish, steps: [{ text: 'Boil', durationSec: -3 }] }, available: true })).rejects.toThrow('레시피');
    await user(wife);
    await expect(cmd({ ...submit(), diners: 1.5 })).rejects.toThrow('인원');
    await expect(cmd({ ...submit(), selection: null })).rejects.toThrow();
    await expect(pg.query('select public.hc_subscribe($1)', [null])).rejects.toThrow('알림');
  });
  it('requires calendar activation and preserves imported slots on replay', async () => {
    await pg.exec('reset role');
    await pg.query('update public.hc_households set calendar_ready=false where id=$1', [household]);
    await pg.exec('set role authenticated');
    const plan = { action: 'importPlan', date: '2099-09-10', slot: 'lunch', items: [], diners: 2, freeText: 'Local', clear: false };
    const key = crypto.randomUUID();
    await cmd(plan, key);
    expect((await cmd(plan, key)).plans).toHaveLength(1);
    await expect(cmd(plan)).rejects.toThrow('해당 시간');
    await user(wife);
    const order = (await cmd(submit())).orders[0]!;
    await user(husband);
    await expect(cmd({ action: 'accept', id: order.id, version: 1, comment: '' })).rejects.toThrow('식단 연결');
    await cmd({ action: 'activate' });
    expect((await cmd({ action: 'accept', id: order.id, version: 1, comment: '' })).orders[0]?.status).toBe('accepted');
  });
  it('leases notifications once and denies queue access to ordinary members', async () => {
    await pg.query('select public.hc_subscribe($1)', [{ endpoint: 'https://web.push.apple.com/test', keys: { auth: 'a'.repeat(22), p256dh: 'a'.repeat(87) } }]);
    await expect(pg.query('select public.hc_claim_push()')).rejects.toThrow();
    await pg.exec('reset role');
    const claimed = await pg.query<{ value: unknown[] }>('select public.hc_claim_push() as value');
    expect(claimed.rows[0]?.value).toHaveLength(1);
    expect((await pg.query<{ value: unknown[] }>('select public.hc_claim_push() as value')).rows[0]?.value).toHaveLength(0);
  });
  it('accepts exactly once with a frozen meal plan and transactional outbox', async () => {
    await user(wife);
    const requestId = crypto.randomUUID();
    const ordered = await cmd(submit(), requestId);
    expect((await cmd(submit(), requestId)).orders).toHaveLength(1);
    const order = ordered.orders[0]!;
    await user(husband);
    const accepted = await cmd({ action: 'accept', id: order.id, version: 1, comment: '' });
    expect(accepted.plans[0]?.items[0]?.title).toBe('Soup');
    await cmd({ action: 'publish', recipe: { ...dish, title: 'New title' }, available: false });
    expect((await cmd({ action: 'name', name: 'Kitchen' })).orders[0]?.items[0]?.title).toBe('Soup');
    await pg.exec('reset role');
    expect((await pg.query('select * from public.hc_outbox')).rows).toHaveLength(2);
  });
  it('denies forged chef actions and reads/writes by outsiders', async () => {
    await user(wife);
    const order = (await cmd(submit())).orders[0]!;
    await expect(cmd({ action: 'accept', id: order.id, version: 1, comment: '' })).rejects.toThrow('셰프');
    await user(outsider);
    expect((await pg.query('select * from public.hc_orders')).rows).toHaveLength(0);
    await expect(cmd(submit())).rejects.toThrow('연결');
    await expect(pg.query("insert into public.hc_households(name) values('Stolen')")).rejects.toThrow();
  });
  it('rejects missing versions, stale edits and duplicate meal slots', async () => {
    await user(wife);
    const order = (await cmd(submit())).orders[0]!;
    await expect(cmd({ action: 'cancel', id: order.id, comment: '' })).rejects.toThrow('상태');
    await expect(cmd(submit())).rejects.toThrow('해당 시간');
    await user(husband);
    await cmd({ action: 'accept', id: order.id, version: 1, comment: '' });
    await user(wife);
    await expect(cmd({ ...submit(), action: 'edit', id: order.id, version: 1 })).rejects.toThrow('상태');
  });
  it('rolls acceptance back when an existing manual plan occupies the slot', async () => {
    await cmd({ action: 'plan', date: '2099-09-09', slot: 'dinner', items: [], diners: 2, freeText: 'Eat out', clear: false });
    await user(wife);
    const order = (await cmd(submit())).orders[0]!;
    await user(husband);
    await expect(cmd({ action: 'accept', id: order.id, version: 1, comment: '' })).rejects.toThrow('해당 시간');
    const current = await cmd({ action: 'name', name: 'Kitchen' });
    expect(current.orders[0]?.status).toBe('pending');
    expect(current.plans[0]?.free_text).toBe('Eat out');
  });
  it('requires a rejection comment and resolves accepted cancellation atomically', async () => {
    await user(wife);
    const order = (await cmd(submit())).orders[0]!;
    await user(husband);
    await expect(cmd({ action: 'reject', id: order.id, version: 1, comment: ' ' })).rejects.toThrow('의견');
    await cmd({ action: 'accept', id: order.id, version: 1, comment: '' });
    await user(wife);
    await cmd({ action: 'requestCancel', id: order.id, version: 2, comment: '' });
    await user(husband);
    const cancelled = await cmd({ action: 'cancel', id: order.id, version: 3, comment: 'Okay' });
    expect(cancelled.orders[0]?.status).toBe('cancelled');
    expect(cancelled.plans).toHaveLength(0);
  });
  it('consumes invites once and revokes the previous device', async () => {
    const token = (await pg.query<{ token: string }>('select public.hc_invite() as token')).rows[0]!.token;
    await user(outsider);
    const joined = await pg.query<{ value: unknown }>("select public.hc_join($1,'wife') as value", [token]);
    expect(snapshotSchema.parse(joined.rows[0]!.value).role).toBe('wife');
    await user(wife);
    await expect(cmd(submit())).rejects.toThrow('연결');
    await expect(pg.query("select public.hc_join($1,'wife')", [token])).rejects.toThrow('초대');
  });
});

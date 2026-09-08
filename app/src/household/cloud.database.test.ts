// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

let pg: PGlite;
const h = '11111111-1111-4111-8111-111111111111';
const w = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const anonUser = '44444444-4444-4444-8444-444444444444';
const home = '55555555-5555-4555-8555-555555555555';
const otherHome = '66666666-6666-4666-8666-666666666666';
const sid = '77777777-7777-4777-8777-777777777777';
const sid2 = '88888888-8888-4888-8888-888888888888';
const wid = '99999999-9999-4999-8999-999999999999';
const oid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const recipe = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function asUser(user: string, session: string | null = sid) {
  await pg.exec('reset role');
  await pg.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
    [user, JSON.stringify({ sub: user, session_id: session })]);
  await pg.exec('set role authenticated');
}
async function owner() { await pg.exec('reset role'); }
async function household() {
  return (await pg.query<{ id: string | null }>('select public.cloud_household() as id')).rows[0]!.id;
}
async function register(user: string, session: string, version = 1) {
  await owner();
  await pg.query('select public.cloud_register_session($1,$2,$3)', [user,session,version]);
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
    create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users);
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql as $$
      select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,name text,bucket_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
    grant usage on schema public,auth,storage to authenticated,service_role;
    grant select on storage.objects to authenticated;
  `);
  for (const filename of ['202609080001_household.sql','202609080002_push_queue.sql','202609080003_cloud_foundation.sql']) {
    await pg.exec(readFileSync(resolve(process.cwd(),'../supabase/migrations',filename),'utf8'));
  }
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await owner();
  await pg.exec('truncate public.cloud_households,public.hc_households,auth.users,storage.objects cascade');
  await pg.query('insert into auth.users values($1,false),($2,false),($3,false),($4,true)',[h,w,other,anonUser]);
  await pg.query("insert into public.cloud_households(id,name) values($1,'Our kitchen'),($2,'Other kitchen')",[home,otherHome]);
  await pg.query("insert into public.cloud_members(user_id,household_id,role) values($1,$3,'husband'),($2,$3,'wife'),($4,$5,'husband')",[h,w,home,other,otherHome]);
  await pg.query('insert into auth.sessions values($1,$2),($3,$2),($4,$5),($6,$7)',[sid,h,sid2,wid,w,oid,other]);
  await register(h,sid); await register(h,sid2); await register(w,wid); await register(other,oid);
  await pg.query("insert into public.cloud_recipes(household_id,id,title,servings) values($1,$3,'Soup',2),($2,$3,'Other soup',4)",[home,otherHome,recipe]);
});

describe('cloud storage access boundary', () => {
  it('lets both fixed users and multiple sessions read the same household', async () => {
    for (const [user,session] of [[h,sid],[h,sid2],[w,wid]]) {
      await asUser(user!,session!);
      expect(await household()).toBe(home);
      expect((await pg.query('select title from public.cloud_recipes')).rows).toEqual([{ title:'Soup' }]);
      expect((await pg.query('select role from public.cloud_members order by role')).rows).toEqual([{role:'husband'},{role:'wife'}]);
    }
  });
  it('does not let a forged role or household claim select another household', async () => {
    await asUser(other,oid);
    await pg.query("select set_config('request.jwt.claims',$1,false)",[
      JSON.stringify({sub:other,session_id:oid,role:'husband',household_id:home,user_metadata:{role:'husband'}})
    ]);
    expect(await household()).toBe(otherHome);
    expect((await pg.query('select title from public.cloud_recipes')).rows).toEqual([{title:'Other soup'}]);
  });
  it('rejects missing, mismatched, unregistered and deleted auth sessions', async () => {
    await asUser(h,null); expect(await household()).toBeNull();
    await asUser(w,sid); expect(await household()).toBeNull();
    await owner();
    await pg.query('delete from public.cloud_sessions where session_id=$1',[sid2]);
    await asUser(h,sid2); expect(await household()).toBeNull();
    await owner();
    await pg.query('delete from auth.sessions where id=$1',[sid]);
    await asUser(h,sid); expect(await household()).toBeNull();
    expect((await pg.query('select * from public.cloud_recipes')).rows).toHaveLength(0);
  });
  it('blocks anonymous accounts and legacy paired users from cloud storage', async () => {
    const aid = crypto.randomUUID();
    await owner();
    await pg.query("insert into public.hc_households(id) values($1)",[home]);
    await pg.query("insert into public.hc_members values($1,$2,'husband')",[anonUser,home]);
    await pg.query("insert into public.cloud_members(user_id,household_id,role) values($1,$2,'wife')",[anonUser,otherHome]);
    await pg.query('insert into auth.sessions values($1,$2)',[aid,anonUser]);
    await expect(register(anonUser,aid)).rejects.toThrow('permanent-user');
    await asUser(anonUser,aid);
    expect(await household()).toBeNull();
  });
  it('prevents browser writes and session registration even for the administrator', async () => {
    for (const [user,session] of [[h,sid],[w,wid]]) {
      await asUser(user!,session!);
      await expect(pg.query("update public.cloud_recipes set title='Overwrite'")).rejects.toThrow('permission denied');
      await expect(pg.query("insert into public.cloud_households(name) values('Forged')")).rejects.toThrow('permission denied');
      await expect(pg.query('select public.cloud_register_session($1,$2,1)',[user,session])).rejects.toThrow('permission denied');
      await expect(pg.query('select public.cloud_revoke_access($1)',[h])).rejects.toThrow('permission denied');
      await expect(pg.query('select * from public.cloud_sessions')).rejects.toThrow('permission denied');
    }
  });
  it('revokes all existing sessions without revoking the partner and rejects stale login enrollment', async () => {
    await owner();
    await pg.exec('set role service_role');
    await pg.query('select public.cloud_revoke_access($1)',[h]);
    for (const session of [sid,sid2]) {
      await asUser(h,session); expect(await household()).toBeNull();
    }
    await asUser(w,wid); expect(await household()).toBe(home);
    await expect(register(h,sid,1)).rejects.toThrow('Access changed');
    await expect(register(h,sid,2)).rejects.toThrow('Session revoked');
    const newSession = crypto.randomUUID();
    await owner();
    await pg.query('insert into auth.sessions values($1,$2)',[newSession,h]);
    await register(h,newSession,2);
    await asUser(h,newSession); expect(await household()).toBe(home);
  });
  it('denies anonymous HTTP roles every new table and helper', async () => {
    await owner();
    const tables = await pg.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'cloud_%'");
    await pg.exec('set role anon');
    for (const {tablename} of tables.rows) {
      await expect(pg.query('select * from public.' + tablename)).rejects.toThrow('permission denied');
    }
    await expect(pg.query('select public.cloud_household()')).rejects.toThrow('permission denied');
  });
  it('restricts photos by current session, household, metadata and upload completion', async () => {
    const photo = crypto.randomUUID();
    await owner();
    await pg.query("insert into public.cloud_photos(household_id,id,object_path,sha256,mime_type,byte_size) values($1,$2,$3,$4,'image/jpeg',10)",
      [home,photo,home+'/'+photo,'a'.repeat(64)]);
    await pg.query("insert into storage.objects values($1,$2,'cloud-photos')",[photo,home+'/'+photo]);
    await asUser(h); expect((await pg.query('select * from storage.objects')).rows).toHaveLength(0);
    await owner(); await pg.query("update public.cloud_photos set state='ready' where id=$1",[photo]);
    await asUser(w,wid); expect((await pg.query('select * from storage.objects')).rows).toHaveLength(1);
    await asUser(other,oid); expect((await pg.query('select * from storage.objects')).rows).toHaveLength(0);
    await owner(); await pg.query('select public.cloud_revoke_access($1)',[w]);
    await asUser(w,wid); expect((await pg.query('select * from storage.objects')).rows).toHaveLength(0);
  });
});
describe('cloud persistence invariants', () => {
  it('preserves legacy tables while adding cloud storage', async () => {
    await owner();
    await pg.query("insert into public.hc_households(id,name) values($1,'Legacy')",[home]);
    expect((await pg.query('select name from public.hc_households')).rows).toEqual([{name:'Legacy'}]);
    expect((await pg.query('select * from public.cloud_recipes')).rows).toHaveLength(2);
  });
  it('prevents cross-household ingredient references and duplicate fixed roles', async () => {
    const ingredient = crypto.randomUUID();
    await owner();
    await pg.query("insert into public.cloud_ingredients(household_id,id,name,category,default_unit) values($1,$2,'Salt','other','g')",[otherHome,ingredient]);
    await expect(pg.query('insert into public.cloud_recipe_ingredients(household_id,recipe_id,position,ingredient_id,unit) values($1,$2,0,$3,\'g\')',[home,recipe,ingredient])).rejects.toThrow('foreign key');
    await expect(pg.query("insert into public.cloud_members(user_id,household_id,role) values($1,$2,'husband')",[anonUser,home])).rejects.toThrow('unique');
  });
  it('versions edits and soft deletes using server values, advancing household revisions', async () => {
    await owner();
    await pg.query("update public.cloud_recipes set title='Stew',version=999 where household_id=$1",[home]);
    const changed = await pg.query<{version:number}>('select version from public.cloud_recipes where household_id=$1',[home]);
    expect(changed.rows[0]!.version).toBe(2);
    await pg.query('update public.cloud_recipes set deleted_at=now() where household_id=$1',[home]);
    expect((await pg.query('select version,deleted_at is not null as deleted from public.cloud_recipes where household_id=$1',[home])).rows).toEqual([{version:3,deleted:true}]);
    expect((await pg.query('select revision from public.cloud_revisions where household_id=$1',[home])).rows).toEqual([{revision:3}]);
  });
  it('prevents invalid quantities and duplicate active calendar slots', async () => {
    await owner();
    await expect(pg.query("insert into public.cloud_recipes(household_id,title,servings) values($1,'Bad',0)",[home])).rejects.toThrow('check constraint');
    await pg.query("insert into public.cloud_meal_plans(household_id,date,slot) values($1,'2099-09-09','dinner')",[home]);
    await expect(pg.query("insert into public.cloud_meal_plans(household_id,date,slot) values($1,'2099-09-09','dinner')",[home])).rejects.toThrow('unique');
    await pg.query('update public.cloud_meal_plans set deleted_at=now() where household_id=$1',[home]);
    await pg.query("insert into public.cloud_meal_plans(household_id,date,slot) values($1,'2099-09-09','dinner')",[home]);
  });
});


describe('cloud reference and transaction regressions', () => {
  it('cannot enroll another user session or revive a disabled member', async () => {
    await expect(register(h,wid)).rejects.toThrow('Invalid permanent-user session');
    await owner();
    await pg.query('update public.cloud_members set enabled=false where user_id=$1',[h]);
    await asUser(h); expect(await household()).toBeNull();
    await expect(register(h,sid)).rejects.toThrow('Access changed');
  });
  it('scopes the cooking controller to the same household and releases deleted sessions', async () => {
    await owner();
    await expect(pg.query('insert into public.cloud_cook_sessions(household_id,recipe_id,controller_session_id) values($1,$2,$3)',[home,recipe,oid])).rejects.toThrow('foreign key');
    await pg.query('insert into public.cloud_cook_sessions(household_id,recipe_id,controller_session_id) values($1,$2,$3)',[home,recipe,sid]);
    await pg.query('delete from auth.sessions where id=$1',[sid]);
    expect((await pg.query('select controller_session_id,household_id from public.cloud_cook_sessions')).rows).toEqual([{controller_session_id:null,household_id:home}]);
  });
  it('rolls back revision and content together and forbids moving a row between households', async () => {
    await owner();
    const before = (await pg.query('select revision from public.cloud_revisions where household_id=$1',[home])).rows;
    await pg.exec('begin');
    await pg.query("update public.cloud_recipes set title='Uncommitted' where household_id=$1",[home]);
    await pg.exec('rollback');
    expect((await pg.query('select revision from public.cloud_revisions where household_id=$1',[home])).rows).toEqual(before);
    expect((await pg.query('select title from public.cloud_recipes where household_id=$1',[home])).rows).toEqual([{title:'Soup'}]);
    const fresh = crypto.randomUUID();
    await pg.query("insert into public.cloud_ingredients(household_id,id,name,category,default_unit) values($1,$2,'Salt','other','g')",[home,fresh]);
    await expect(pg.query('update public.cloud_ingredients set household_id=$1 where id=$2',[otherHome,fresh])).rejects.toThrow('Household cannot change');
  });
});

-- Run ONCE in the Supabase SQL editor as the deployment owner.
-- The returned token is a private, single-use setup credential, not an API key.
-- Do not save the output in source control or logs.
with household as (
  insert into public.hc_households(name) values('우리집 식당') returning id
), token as (
  select id,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') as value from household
), invitation as (
  insert into public.hc_invites(token_hash,household_id,role,expires_at)
  select encode(sha256(convert_to(value,'UTF8')),'hex'),id,'husband',now()+interval '30 minutes' from token
)
select value as husband_setup_token from token;

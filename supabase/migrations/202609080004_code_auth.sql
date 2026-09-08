-- Permanent role-and-code authentication gateway support.
-- Raw codes and derived Auth passwords never enter application tables.

create table public.cloud_auth_setup (
  singleton boolean primary key default true check (singleton),
  household_id uuid not null unique references public.cloud_households(id),
  husband_user_id uuid not null unique references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.cloud_auth_limits (
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  action text not null check (action in ('bootstrap','login:husband','login:wife')),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  primary key (fingerprint, action)
);

alter table public.cloud_auth_setup enable row level security;
alter table public.cloud_auth_limits enable row level security;
revoke all on public.cloud_auth_setup, public.cloud_auth_limits from public, anon, authenticated;
grant all on public.cloud_auth_setup, public.cloud_auth_limits to service_role;

create function public.cloud_auth_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'initialized', exists(select 1 from public.cloud_auth_setup),
    'wifeConfigured', exists(
      select 1 from public.cloud_auth_setup s
      join public.cloud_members m on m.household_id = s.household_id and m.role = 'wife'
      where m.enabled
    )
  )
$$;

create function public.cloud_initialize_household(target_user uuid, household_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare existing public.cloud_auth_setup; new_household uuid;
begin
  if length(trim(household_name)) not between 1 and 80 then raise exception 'Invalid household name'; end if;
  perform pg_advisory_xact_lock(hashtext('homecook.cloud.bootstrap'));
  select * into existing from public.cloud_auth_setup where singleton;
  if found then
    if existing.husband_user_id <> target_user then raise exception 'Already initialized'; end if;
    return existing.household_id;
  end if;
  if not exists(select 1 from auth.users where id = target_user and not coalesce(is_anonymous, true)) then
    raise exception 'Invalid permanent user';
  end if;
  insert into public.cloud_households(name) values(trim(household_name)) returning id into new_household;
  insert into public.cloud_members(user_id,household_id,role) values(target_user,new_household,'husband');
  insert into public.cloud_auth_setup(household_id,husband_user_id) values(new_household,target_user);
  return new_household;
end $$;

create function public.cloud_provision_wife(actor_user uuid, target_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare setup public.cloud_auth_setup; existing public.cloud_members;
begin
  select * into setup from public.cloud_auth_setup where singleton for update;
  if not found or setup.husband_user_id <> actor_user then raise exception 'Administrator required'; end if;
  if not exists(select 1 from auth.users where id = target_user and not coalesce(is_anonymous, true)) then
    raise exception 'Invalid permanent user';
  end if;
  select * into existing from public.cloud_members where household_id = setup.household_id and role = 'wife';
  if found and existing.user_id <> target_user then raise exception 'Wife identity already exists'; end if;
  insert into public.cloud_members(user_id,household_id,role)
    values(target_user,setup.household_id,'wife') on conflict (user_id) do nothing;
  if not exists(
    select 1 from public.cloud_members
    where user_id=target_user and household_id=setup.household_id and role='wife'
  ) then raise exception 'Wife identity belongs elsewhere'; end if;
end $$;

create function public.cloud_auth_attempt(
  request_fingerprint text, request_action text, allowed_attempts integer default 5
) returns boolean language plpgsql security definer set search_path = '' as $$
declare item public.cloud_auth_limits; request_time timestamptz := clock_timestamp();
begin
  if request_fingerprint !~ '^[a-f0-9]{64}$'
    or request_action not in ('bootstrap','login:husband','login:wife')
    or allowed_attempts not between 1 and 20 then raise exception 'Invalid rate limit input'; end if;
  insert into public.cloud_auth_limits(fingerprint,action,attempts)
    values(request_fingerprint,request_action,0) on conflict do nothing;
  select * into item from public.cloud_auth_limits
    where fingerprint=request_fingerprint and action=request_action for update;
  if item.blocked_until is not null and item.blocked_until > request_time then return false; end if;
  if item.window_started_at <= request_time - interval '15 minutes' then
    update public.cloud_auth_limits set window_started_at=request_time,attempts=1,blocked_until=null
      where fingerprint=request_fingerprint and action=request_action;
    return true;
  end if;
  if item.attempts >= allowed_attempts then
    update public.cloud_auth_limits set blocked_until=request_time + interval '15 minutes'
      where fingerprint=request_fingerprint and action=request_action;
    return false;
  end if;
  update public.cloud_auth_limits set attempts=attempts+1
    where fingerprint=request_fingerprint and action=request_action;
  return true;
end $$;

create function public.cloud_auth_reset_limit(request_fingerprint text, request_action text) returns void
language sql security definer set search_path = '' as $$
  delete from public.cloud_auth_limits where fingerprint=request_fingerprint and action=request_action
$$;

create function public.cloud_auth_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'householdId',m.household_id,
    'role',m.role,
    'name',h.name,
    'accessVersion',m.access_version
  )
  from public.cloud_members m join public.cloud_households h on h.id=m.household_id
  where m.user_id=auth.uid() and m.household_id=public.cloud_household()
$$;

revoke all on function public.cloud_auth_status(),
  public.cloud_initialize_household(uuid,text), public.cloud_provision_wife(uuid,uuid),
  public.cloud_auth_attempt(text,text,integer), public.cloud_auth_reset_limit(text,text) from public, anon, authenticated;
grant execute on function public.cloud_auth_status(),
  public.cloud_initialize_household(uuid,text), public.cloud_provision_wife(uuid,uuid),
  public.cloud_auth_attempt(text,text,integer), public.cloud_auth_reset_limit(text,text) to service_role;
revoke all on function public.cloud_auth_context() from public, anon;
grant execute on function public.cloud_auth_context() to authenticated, service_role;

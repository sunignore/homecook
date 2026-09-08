-- Cloud foundation. Additive: legacy household mode remains unchanged.
-- Browser writes stay closed until validated command RPCs are introduced.
create table public.cloud_households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  timezone text not null default 'Asia/Seoul' check (timezone = 'Asia/Seoul'),
  created_at timestamptz not null default now()
);
create table public.cloud_members (
  user_id uuid primary key references auth.users(id),
  household_id uuid not null references public.cloud_households(id),
  role text not null check (role in ('husband','wife')),
  access_version bigint not null default 1 check (access_version > 0),
  enabled boolean not null default true,
  unique (household_id, role),
  unique (household_id, user_id)
);
create table public.cloud_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references public.cloud_members(user_id),
  household_id uuid not null,
  unique(household_id,session_id),
  foreign key(household_id,user_id) references public.cloud_members(household_id,user_id),
  access_version bigint not null check (access_version > 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Never trust a role or household supplied by the caller or user metadata.
create function public.cloud_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.household_id from public.cloud_members m
  join public.cloud_sessions s on s.user_id = m.user_id
  join auth.sessions a on a.id = s.session_id and a.user_id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.user_id = auth.uid() and m.enabled and not coalesce(u.is_anonymous, true)
    and s.session_id = nullif(auth.jwt()->>'session_id','')::uuid
    and s.access_version = m.access_version and s.revoked_at is null
$$;
revoke all on function public.cloud_household() from public, anon;
grant execute on function public.cloud_household() to authenticated, service_role;

-- The login gateway captures expected_version BEFORE verifying the code.
-- A concurrent revoke/rotation cannot enroll a stale in-flight login afterward.
create function public.cloud_register_session(
  target_user uuid, target_session uuid, expected_version bigint
) returns void language plpgsql security definer set search_path = '' as $$
declare member public.cloud_members;
begin
  select * into member from public.cloud_members where user_id = target_user for update;
  if not found or not member.enabled or member.access_version <> expected_version then
    raise exception 'Access changed; sign in again';
  end if;
  if not exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = target_session and s.user_id = target_user and not coalesce(u.is_anonymous, true)
  ) then raise exception 'Invalid permanent-user session'; end if;
  insert into public.cloud_sessions(session_id,user_id,household_id,access_version)
    values(target_session,target_user,member.household_id,expected_version) on conflict do nothing;
  if not exists (
    select 1 from public.cloud_sessions where session_id = target_session
      and user_id = target_user and access_version = expected_version and revoked_at is null
  ) then raise exception 'Session revoked'; end if;
end $$;
create function public.cloud_revoke_access(target_user uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare next_version bigint;
begin
  update public.cloud_members set access_version = access_version + 1
    where user_id = target_user returning access_version into next_version;
  if not found then raise exception 'Member not found'; end if;
  update public.cloud_sessions set revoked_at = now()
    where user_id = target_user and revoked_at is null;
  return next_version;
end $$;
revoke all on function public.cloud_register_session(uuid,uuid,bigint),
  public.cloud_revoke_access(uuid) from public, anon, authenticated;
grant execute on function public.cloud_register_session(uuid,uuid,bigint),
  public.cloud_revoke_access(uuid) to service_role;

create table public.cloud_ingredients (
  household_id uuid not null references public.cloud_households,
  id uuid not null default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  aliases text[] not null default '{}',
  category text not null check (category in ('vegetable','meat','seafood','dairy','grain','sauce','other')),
  default_unit text not null check (length(default_unit) <= 80),
  is_staple boolean not null default false,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(household_id,id)
);
create table public.cloud_photos (
  household_id uuid not null references public.cloud_households,
  id uuid not null default gen_random_uuid(),
  object_path text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  state text not null default 'pending' check (state in ('pending','ready')),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(household_id,id),
  check (object_path = household_id::text || '/' || id::text)
);
create table public.cloud_recipes (
  household_id uuid not null references public.cloud_households,
  id uuid not null default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  servings numeric not null check (servings > 0 and servings <= 1000),
  source_url text check (length(source_url) <= 4000),
  source_text text check (length(source_text) <= 100000),
  notes text not null default '' check (length(notes) <= 10000),
  tags text[] not null default '{}',
  steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 200),
  photo_id uuid,
  orderable boolean not null default false,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(household_id,id),
  foreign key(household_id,photo_id) references public.cloud_photos(household_id,id)
);
create table public.cloud_recipe_ingredients (
  household_id uuid not null,
  recipe_id uuid not null,
  position integer not null check (position between 0 and 199),
  ingredient_id uuid not null,
  qty numeric check (qty >= 0 and qty <= 1000000),
  unit text not null check (length(unit) <= 80),
  note text not null default '' check (length(note) <= 1000),
  optional boolean not null default false,
  primary key(household_id,recipe_id,position),
  foreign key(household_id,recipe_id) references public.cloud_recipes(household_id,id),
  foreign key(household_id,ingredient_id) references public.cloud_ingredients(household_id,id)
);
create table public.cloud_pantry_items (
  household_id uuid not null references public.cloud_households,
  id uuid not null default gen_random_uuid(),
  ingredient_id uuid not null,
  qty numeric not null check (qty >= 0 and qty <= 1000000),
  unit text not null check (length(unit) <= 80),
  location text not null check (location in ('fridge','freezer','pantry')),
  bought_at timestamptz,
  expires_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(household_id,id),
  foreign key(household_id,ingredient_id) references public.cloud_ingredients(household_id,id)
);
create table public.cloud_orders (
  household_id uuid not null references public.cloud_households,
  id uuid not null default gen_random_uuid(),
  requested_by uuid not null,
  date date not null,
  slot text not null check (slot in ('breakfast','lunch','dinner')),
  diners integer not null default 2 check (diners between 1 and 20),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  note text not null default '' check (length(note) <= 1000),
  status text not null check (status in ('pending','accepted','cooking','ready','rejected','cancelled')),
  cancellation boolean not null default false,
  thanks boolean not null default false,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(household_id,id),
  foreign key(household_id,requested_by) references public.cloud_members(household_id,user_id)
);
create unique index cloud_active_order_slot on public.cloud_orders(household_id,date,slot)
  where deleted_at is null and status not in ('rejected','cancelled');
create table public.cloud_order_events (
  household_id uuid not null,
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  actor_id uuid not null,
  action text not null check (action in ('submit','edit','accept','reject','cancel','requestCancel','declineCancel','cook','ready','thanks')),
  comment text not null default '' check (length(comment) <= 1000),
  created_at timestamptz not null default now(),
  primary key(household_id,id),
  foreign key(household_id,order_id) references public.cloud_orders(household_id,id),
  foreign key(household_id,actor_id) references public.cloud_members(household_id,user_id)
);
create table public.cloud_meal_plans (
  household_id uuid not null references public.cloud_households,
  id uuid not null default gen_random_uuid(),
  date date not null,
  slot text not null check (slot in ('breakfast','lunch','dinner')),
  order_id uuid,
  diners integer not null default 2 check (diners between 1 and 20),
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 20),
  free_text text not null default '' check (length(free_text) <= 1000),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(household_id,id),
  foreign key(household_id,order_id) references public.cloud_orders(household_id,id)
);
create unique index cloud_plan_slot on public.cloud_meal_plans(household_id,date,slot) where deleted_at is null;
create table public.cloud_shopping_items (
  household_id uuid not null references public.cloud_households,
  id uuid not null default gen_random_uuid(),
  ingredient_id uuid not null,
  source_meal_plan_id uuid,
  qty numeric not null check (qty >= 0 and qty <= 1000000),
  unit text not null check (length(unit) <= 80),
  checked boolean not null default false,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(household_id,id),
  foreign key(household_id,ingredient_id) references public.cloud_ingredients(household_id,id),
  foreign key(household_id,source_meal_plan_id) references public.cloud_meal_plans(household_id,id)
);
create table public.cloud_cook_logs (
  household_id uuid not null,
  id uuid not null default gen_random_uuid(),
  recipe_id uuid not null,
  actor_id uuid not null,
  cooked_at timestamptz not null,
  rating integer not null check (rating between 1 and 5),
  memo text not null default '' check (length(memo) <= 10000),
  tweaks text not null default '' check (length(tweaks) <= 10000),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(household_id,id),
  foreign key(household_id,recipe_id) references public.cloud_recipes(household_id,id),
  foreign key(household_id,actor_id) references public.cloud_members(household_id,user_id)
);
create table public.cloud_cook_sessions (
  household_id uuid not null,
  id uuid not null default gen_random_uuid(),
  recipe_id uuid not null,
  controller_session_id uuid,
  step_index integer not null default 0 check (step_index between 0 and 199),
  timers jsonb not null default '[]' check (jsonb_typeof(timers) = 'array' and jsonb_array_length(timers) <= 200),
  started_at timestamptz not null default now(),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(household_id,id),
  foreign key(household_id,recipe_id) references public.cloud_recipes(household_id,id),
  foreign key(household_id,controller_session_id) references public.cloud_sessions(household_id,session_id) on delete set null (controller_session_id)
);
create unique index cloud_active_cook_session on public.cloud_cook_sessions(household_id,recipe_id) where deleted_at is null;
create table public.cloud_preferences (
  household_id uuid not null,
  user_id uuid not null,
  theme text not null default 'system' check (theme in ('system','light','dark')),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(household_id,user_id),
  foreign key(household_id,user_id) references public.cloud_members(household_id,user_id)
);

-- Changes advance a household revision in commit order. Reconnect queries use
-- this revision or a fresh snapshot, never client wall clocks as cursors.
create table public.cloud_revisions (
  household_id uuid primary key references public.cloud_households,
  revision bigint not null default 0 check (revision >= 0)
);
create function public.cloud_touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    new.version := 1; new.created_at := now();
  else
    new.version := old.version + 1; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create function public.cloud_advance_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if TG_OP = 'DELETE' then target := old.household_id; else target := new.household_id; end if;
  if TG_OP = 'UPDATE' and old.household_id <> new.household_id then
    raise exception 'Household cannot change';
  end if;
  insert into public.cloud_revisions values(target,1)
    on conflict(household_id) do update set revision = public.cloud_revisions.revision + 1;
  return null;
end $$;
revoke all on function public.cloud_touch_row(),public.cloud_advance_revision() from public,anon,authenticated;

do $$
declare tab text;
begin
  foreach tab in array array[
    'cloud_ingredients','cloud_photos','cloud_recipes','cloud_recipe_ingredients',
    'cloud_pantry_items','cloud_orders','cloud_order_events','cloud_meal_plans',
    'cloud_shopping_items','cloud_cook_logs','cloud_cook_sessions','cloud_preferences','cloud_revisions'
  ] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
    execute format('create policy cloud_read on public.%I for select to authenticated using (household_id = (select public.cloud_household()))',tab);
    if tab <> 'cloud_revisions' then
      execute format('create trigger cloud_revision after insert or update or delete on public.%I for each row execute function public.cloud_advance_revision()',tab);
    end if;
    if tab not in ('cloud_recipe_ingredients','cloud_order_events','cloud_revisions') then
      execute format('create trigger cloud_version before insert or update on public.%I for each row execute function public.cloud_touch_row()',tab);
    end if;
  end loop;
end $$;
alter table public.cloud_households enable row level security;
alter table public.cloud_members enable row level security;
alter table public.cloud_sessions enable row level security;
revoke all on public.cloud_households,public.cloud_members,public.cloud_sessions from public,anon,authenticated;
grant select on public.cloud_households,public.cloud_members to authenticated;
grant all on public.cloud_households,public.cloud_members,public.cloud_sessions to service_role;
create policy cloud_read on public.cloud_households for select to authenticated using(id = (select public.cloud_household()));
create policy cloud_read on public.cloud_members for select to authenticated using(household_id = (select public.cloud_household()));

-- Existing Storage policies also reference legacy membership. Explicitly grant
-- its RLS-protected self-read instead of relying on project default grants.
grant select on public.hc_members to authenticated;

-- No signed public URLs or direct browser uploads in the initial foundation.
-- Authenticated downloads recheck cloud membership/session on every request.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cloud-photos','cloud-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy cloud_photo_read on storage.objects for select to authenticated using(
  bucket_id = 'cloud-photos' and exists(
    select 1 from public.cloud_photos p where p.object_path = name
      and p.household_id = (select public.cloud_household()) and p.state = 'ready'
      and p.deleted_at is null
  )
);

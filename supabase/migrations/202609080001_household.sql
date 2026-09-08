-- Shared writes are restricted to transaction functions. No public role claims.
create table public.hc_households (id uuid primary key default gen_random_uuid(), name text not null default '우리집 식당' check(length(name) between 1 and 80), calendar_ready boolean not null default false);
create table public.hc_members (user_id uuid primary key references auth.users(id), household_id uuid not null references public.hc_households, role text not null check(role in ('husband','wife')), unique(household_id,role));
create table public.hc_invites (token_hash text primary key, household_id uuid not null references public.hc_households, role text not null check(role in ('husband','wife')), expires_at timestamptz not null, used_at timestamptz);
create table public.hc_menu (household_id uuid not null references public.hc_households, id uuid not null, recipe jsonb not null, available boolean not null default true, version integer not null default 1, primary key(household_id,id));
create table public.hc_orders (id uuid primary key default gen_random_uuid(), household_id uuid not null references public.hc_households, date date not null, slot text not null check(slot in ('breakfast','lunch','dinner')), diners integer not null check(diners between 1 and 20), items jsonb not null, note text not null default '' check(length(note)<=1000), status text not null check(status in ('pending','accepted','cooking','ready','rejected','cancelled')), version integer not null default 1, cancellation boolean not null default false, thanks boolean not null default false, events jsonb not null default '[]', created_at timestamptz not null default now());
create unique index hc_one_active_order on public.hc_orders(household_id,date,slot) where status not in ('rejected','cancelled');
create table public.hc_plans (household_id uuid not null references public.hc_households, date date not null, slot text not null check(slot in ('breakfast','lunch','dinner')), order_id uuid references public.hc_orders, items jsonb not null default '[]', diners integer not null default 2 check(diners between 1 and 20), free_text text not null default '', primary key(household_id,date,slot));
create table public.hc_commands (user_id uuid not null, id uuid not null, request jsonb not null, primary key(user_id,id));
create table public.hc_subscriptions (user_id uuid primary key references public.hc_members(user_id) on delete cascade, subscription jsonb not null);
create table public.hc_outbox (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.hc_members(user_id) on delete cascade, payload jsonb not null, attempts integer not null default 0, next_at timestamptz not null default now(), sent_at timestamptz);

alter table public.hc_households enable row level security;
alter table public.hc_members enable row level security;
alter table public.hc_invites enable row level security;
alter table public.hc_menu enable row level security;
alter table public.hc_orders enable row level security;
alter table public.hc_plans enable row level security;
alter table public.hc_commands enable row level security;
alter table public.hc_subscriptions enable row level security;
alter table public.hc_outbox enable row level security;

create function public.hc_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.hc_members; result jsonb;
begin
 select * into m from public.hc_members where user_id=auth.uid();
 if not found then return null; end if;
 select jsonb_build_object('householdId',m.household_id,'role',m.role,'name',h.name,'calendarReady',h.calendar_ready,
 'menu',coalesce((select jsonb_agg(jsonb_build_object('id',id,'recipe',recipe,'available',available,'version',version) order by recipe->>'title') from public.hc_menu where household_id=h.id),'[]'),
 'orders',coalesce((select jsonb_agg(to_jsonb(o)-'household_id' order by o.created_at desc) from public.hc_orders o where household_id=h.id),'[]'),
 'plans',coalesce((select jsonb_agg(to_jsonb(p)-'household_id') from public.hc_plans p where household_id=h.id),'[]')) into result from public.hc_households h where h.id=m.household_id;
 return result;
end $$;

create function public.hc_valid_dish(d jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare i jsonb; n numeric;
begin
 if jsonb_typeof(d) is distinct from 'object' or not d ?& array['id','title','servings','ingredients','steps','tags'] then return false; end if;
 if exists(select 1 from jsonb_object_keys(d) k where k not in ('id','title','servings','ingredients','steps','tags','photoPath')) then return false; end if;
 perform (d->>'id')::uuid;
 if jsonb_typeof(d->'id') is distinct from 'string' or jsonb_typeof(d->'title') is distinct from 'string' or length(d->>'title') not between 1 and 200 then return false; end if;
 if jsonb_typeof(d->'servings') is distinct from 'number' then return false; end if;
 n:=(d->>'servings')::numeric; if n<=0 or n>1000 then return false; end if;
 if jsonb_typeof(d->'ingredients') is distinct from 'array' or jsonb_array_length(d->'ingredients')>200 then return false; end if;
 for i in select value from jsonb_array_elements(d->'ingredients') loop
   if not i ?& array['ingredientId','name','qty','unit','optional'] or jsonb_typeof(i) is distinct from 'object' then return false; end if;
   if exists(select 1 from jsonb_object_keys(i) k where k not in ('ingredientId','name','qty','unit','note','optional')) then return false; end if;
   perform (i->>'ingredientId')::uuid;
   if jsonb_typeof(i->'ingredientId') is distinct from 'string' or jsonb_typeof(i->'name') is distinct from 'string' or length(i->>'name') not between 1 and 200 then return false; end if;
   if jsonb_typeof(i->'unit') is distinct from 'string' or length(i->>'unit')>80 or jsonb_typeof(i->'optional') is distinct from 'boolean' then return false; end if;
   if jsonb_typeof(i->'qty') not in ('number','null') then return false; end if;
   if jsonb_typeof(i->'qty')='number' and ((i->>'qty')::numeric<0 or (i->>'qty')::numeric>1000000) then return false; end if;
   if i ? 'note' and (jsonb_typeof(i->'note')<>'string' or length(i->>'note')>1000) then return false; end if;
 end loop;
 if jsonb_typeof(d->'steps') is distinct from 'array' or jsonb_array_length(d->'steps')>200 then return false; end if;
 for i in select value from jsonb_array_elements(d->'steps') loop
   if jsonb_typeof(i->'text') is distinct from 'string' or length(i->>'text') not between 1 and 10000 then return false; end if;
   if exists(select 1 from jsonb_object_keys(i) k where k not in ('text','durationSec')) then return false; end if;
   if i ? 'durationSec' then
     if jsonb_typeof(i->'durationSec')<>'number' then return false; end if;
     n:=(i->>'durationSec')::numeric; if n<>trunc(n) or n not between 1 and 604800 then return false; end if;
   end if;
 end loop;
 if jsonb_typeof(d->'tags') is distinct from 'array' or jsonb_array_length(d->'tags')>100 then return false; end if;
 for i in select value from jsonb_array_elements(d->'tags') loop
   if jsonb_typeof(i)<>'string' or length(i#>>'{}')>100 then return false; end if;
 end loop;
 if d ? 'photoPath' and (jsonb_typeof(d->'photoPath')<>'string' or length(d->>'photoPath')>300) then return false; end if;
 return true;
exception when others then return false;
end $$;

create function public.hc_join(token text, chosen_role text) returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.hc_invites;
begin
 if auth.uid() is null or length(token)<>64 then raise exception '초대 코드를 확인해주세요.'; end if;
 select * into invitation from public.hc_invites where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') for update;
 if not found or invitation.used_at is not null or invitation.expires_at<now() or invitation.role<>chosen_role then raise exception '초대가 만료되었거나 역할이 다릅니다.'; end if;
 perform 1 from public.hc_households where id=invitation.household_id for update;
 if exists(select 1 from public.hc_members where user_id=auth.uid()) then raise exception '이미 연결된 기기입니다.'; end if;
 delete from public.hc_members where household_id=invitation.household_id and role=chosen_role;
 insert into public.hc_members values(auth.uid(),invitation.household_id,chosen_role);
 update public.hc_invites set used_at=now() where household_id=invitation.household_id and role=chosen_role and used_at is null;
 return public.hc_snapshot();
end $$;

create function public.hc_invite() returns text language plpgsql security definer set search_path='' as $$
declare m public.hc_members; token text; target text;
begin
 select * into m from public.hc_members where user_id=auth.uid();
 if not found then raise exception '기기를 먼저 연결해주세요.'; end if;
 perform 1 from public.hc_households where id=m.household_id for update;
 select * into m from public.hc_members where user_id=auth.uid();
 if not found then raise exception '연결이 해제된 기기입니다.'; end if;
 target := case m.role when 'husband' then 'wife' else 'husband' end;
 update public.hc_invites set used_at=now() where household_id=m.household_id and role=target and used_at is null;
 token := replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.hc_invites values(encode(sha256(convert_to(token,'UTF8')),'hex'),m.household_id,target,now()+interval '30 minutes',null);
 return token;
end $$;

create function public.hc_command(command_id uuid, body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.hc_members; o public.hc_orders; action text:=body->>'action'; selected_items jsonb; entry jsonb; menu_row public.hc_menu; oid uuid; new_status text; comment text:=coalesce(body->>'comment',''); recipient uuid; prior jsonb;
begin
 select * into m from public.hc_members where user_id=auth.uid();
 if not found then raise exception '기기를 먼저 연결해주세요.'; end if;
 -- Serializes slot mutations and migration, including manual plan changes.
 perform 1 from public.hc_households where id=m.household_id for update;
 select * into m from public.hc_members where user_id=auth.uid();
 if not found then raise exception '연결이 해제된 기기입니다.'; end if;
 if command_id is null or body is null or action is null or jsonb_typeof(body)<>'object' then raise exception '잘못된 요청입니다.'; end if;
 if body ? 'comment' and jsonb_typeof(body->'comment')<>'string' then raise exception '의견을 확인해주세요.'; end if;
 if action in ('edit','accept','reject','cancel','requestCancel','declineCancel','cook','ready','thanks') then
   if jsonb_typeof(body->'version') is distinct from 'number' or (body->>'version')::numeric<>trunc((body->>'version')::numeric) then raise exception '주문 상태 버전을 확인해주세요.'; end if;
 end if;
 if action in ('submit','edit','plan','importPlan') then
   if jsonb_typeof(body->'date') is distinct from 'string' or (body->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or body->>'slot' not in ('breakfast','lunch','dinner') or body->>'slot' is null then raise exception '날짜와 식사를 확인해주세요.'; end if;
   if jsonb_typeof(body->'diners') is distinct from 'number' or (body->>'diners')::numeric<>trunc((body->>'diners')::numeric) or (body->>'diners')::numeric not between 1 and 20 then raise exception '인원을 확인해주세요.'; end if;
 end if;
 select request into prior from public.hc_commands where user_id=auth.uid() and id=command_id;
 if found then
   if prior<>body then raise exception '중복 요청의 내용이 다릅니다.'; end if;
   return public.hc_snapshot();
 end if;
 if length(body::text)>2000000 or length(comment)>1000 then raise exception '요청이 너무 큽니다.'; end if;
 if action='activate' then
   if m.role<>'husband' then raise exception '셰프만 변경할 수 있습니다.'; end if;
   update public.hc_households set calendar_ready=true where id=m.household_id;
 elsif action='name' then
   if m.role<>'husband' then raise exception '셰프만 변경할 수 있습니다.'; end if;
   update public.hc_households set name=body->>'name' where id=m.household_id;
 elsif action='publish' then
   if m.role<>'husband' then raise exception '셰프만 메뉴를 변경할 수 있습니다.'; end if;
   entry:=body->'recipe';
   if not public.hc_valid_dish(entry) then raise exception '레시피를 확인해주세요.'; end if;
   if entry ? 'photoPath' and split_part(entry->>'photoPath','/',1)<>m.household_id::text then raise exception '사진 경로를 확인해주세요.'; end if;
   if jsonb_typeof(body->'available') is distinct from 'boolean' then raise exception '메뉴 상태를 확인해주세요.'; end if;
   insert into public.hc_menu values(m.household_id,(entry->>'id')::uuid,entry,coalesce((body->>'available')::boolean,true),1)
   on conflict(household_id,id) do update set recipe=excluded.recipe,available=excluded.available,version=public.hc_menu.version+1;
 elsif action in ('plan','importPlan') then
   if m.role<>'husband' then raise exception '셰프만 식단을 변경할 수 있습니다.'; end if;
   if jsonb_typeof(body->'items') is distinct from 'array' or jsonb_array_length(body->'items')>20 or exists(select 1 from jsonb_array_elements(body->'items') d where not public.hc_valid_dish(d)) then raise exception '식단 메뉴를 확인해주세요.'; end if;
   if jsonb_typeof(body->'freeText') is distinct from 'string' or length(body->>'freeText')>1000 or jsonb_typeof(body->'clear') is distinct from 'boolean' then raise exception '식단 내용을 확인해주세요.'; end if;
   if exists(select 1 from public.hc_plans where household_id=m.household_id and date=(body->>'date')::date and slot=body->>'slot' and order_id is not null) then raise exception '주문서에서 취소해주세요.'; end if;
   if action='plan' then delete from public.hc_plans where household_id=m.household_id and date=(body->>'date')::date and slot=body->>'slot'; end if;
   if not coalesce((body->>'clear')::boolean,false) then
     insert into public.hc_plans(household_id,date,slot,items,diners,free_text) values(m.household_id,(body->>'date')::date,body->>'slot',coalesce(body->'items','[]'),coalesce((body->>'diners')::integer,2),coalesce(body->>'freeText',''));
   end if;
 elsif action in ('submit','edit') then
   if m.role<>'wife' then raise exception '아내 역할에서 주문해주세요.'; end if;
   if jsonb_typeof(body->'note') is distinct from 'string' then raise exception '요청 사항을 확인해주세요.'; end if;
   if (body->>'date')::date < (now() at time zone 'Asia/Seoul')::date then raise exception '지난 날짜에는 주문할 수 없습니다.'; end if;
   if jsonb_typeof(body->'selection') is distinct from 'array' or jsonb_array_length(body->'selection') not between 1 and 20 then raise exception '메뉴를 1~20개 선택해주세요.'; end if;
   selected_items:='[]';
   for entry in select value from jsonb_array_elements(body->'selection') loop
     select * into menu_row from public.hc_menu where household_id=m.household_id and id=(entry->>'id')::uuid;
     if not found or not menu_row.available or menu_row.version is distinct from (entry->>'version')::integer then raise exception '메뉴가 변경되었습니다. 메뉴판을 새로 확인해주세요.'; end if;
     if exists(select 1 from jsonb_array_elements(selected_items) i where i->>'id'=menu_row.id::text) then raise exception '같은 메뉴는 한 번만 선택해주세요.'; end if;
     selected_items:=selected_items||jsonb_build_array(menu_row.recipe);
   end loop;
   if action='submit' then
     insert into public.hc_orders(household_id,date,slot,diners,items,note,status) values(m.household_id,(body->>'date')::date,body->>'slot',(body->>'diners')::integer,selected_items,coalesce(body->>'note',''),'pending') returning id into oid;
   else
     select * into o from public.hc_orders where id=(body->>'id')::uuid and household_id=m.household_id for update;
     if not found or o.status<>'pending' or o.version is distinct from (body->>'version')::integer then raise exception '주문 상태가 바뀌었습니다. 새로고침 후 확인해주세요.'; end if;
     oid:=o.id;
     update public.hc_orders set date=(body->>'date')::date,slot=body->>'slot',diners=(body->>'diners')::integer,items=selected_items,note=coalesce(body->>'note',''),version=version+1 where id=oid;
   end if;
 else
   if action not in ('accept','reject','cancel','requestCancel','declineCancel','cook','ready','thanks') then raise exception '지원하지 않는 요청입니다.'; end if;
   select * into o from public.hc_orders where id=(body->>'id')::uuid and household_id=m.household_id for update;
   if not found or o.version is distinct from (body->>'version')::integer then raise exception '주문 상태가 바뀌었습니다. 새로고침 후 확인해주세요.'; end if;
   oid:=o.id; new_status:=o.status;
   if action in ('accept','reject','cook','ready','declineCancel') and m.role<>'husband' then raise exception '셰프만 처리할 수 있습니다.'; end if;
   if action='accept' and o.status='pending' then
     if not (select calendar_ready from public.hc_households where id=m.household_id) then raise exception '기존 식단 연결을 먼저 완료해주세요.'; end if;
     insert into public.hc_plans values(m.household_id,o.date,o.slot,o.id,o.items,o.diners,'');
     new_status:='accepted';
   elsif action='reject' and o.status='pending' and length(trim(comment))>0 then new_status:='rejected';
   elsif action='cook' and o.status='accepted' then new_status:='cooking';
   elsif action='ready' and o.status='cooking' and not o.cancellation then new_status:='ready';
   elsif action='cancel' and (o.status='pending' and m.role='wife' or o.status in ('accepted','cooking') and m.role='husband' and length(trim(comment))>0) then
     new_status:='cancelled'; delete from public.hc_plans where order_id=o.id;
   elsif action='requestCancel' and m.role='wife' and o.status in ('accepted','cooking') and not o.cancellation then
     update public.hc_orders set cancellation=true where id=oid;
   elsif action='declineCancel' and o.cancellation and length(trim(comment))>0 then
     update public.hc_orders set cancellation=false where id=oid;
   elsif action='thanks' and m.role='wife' and o.status='ready' then
     update public.hc_orders set thanks=true where id=oid;
   else raise exception '이 상태에서는 처리할 수 없습니다. 거절·취소에는 의견이 필요합니다.';
   end if;
   update public.hc_orders set status=new_status,version=version+1,cancellation=case when new_status='cancelled' then false else cancellation end where id=oid;
 end if;
 if oid is not null then
   update public.hc_orders set events=events||jsonb_build_array(jsonb_build_object('action',action,'role',m.role,'comment',comment,'at',now())) where id=oid;
   select user_id into recipient from public.hc_members where household_id=m.household_id and role<>m.role;
   if recipient is not null and action not in ('cook','thanks') then
     insert into public.hc_outbox(user_id,payload) values(recipient,jsonb_build_object('title','우리집 식당','body',case action when 'submit' then '새 주문이 도착했어요' when 'accept' then '주문을 접수했어요' when 'ready' then '식사 준비가 끝났어요' when 'reject' then '주문에 의견을 남겼어요' else '주문이 변경되었어요' end,'url','/restaurant#order-'||oid::text,'tag',command_id::text));
   end if;
 end if;
 insert into public.hc_commands values(auth.uid(),command_id,body);
 return public.hc_snapshot();
exception when unique_violation then raise exception '해당 시간에 주문이나 식단이 있습니다. 기존 내용을 확인해주세요.';
end $$;

create function public.hc_subscribe(payload jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if payload is null or jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(payload->'endpoint') is distinct from 'string' or jsonb_typeof(payload->'keys'->'p256dh') is distinct from 'string' or jsonb_typeof(payload->'keys'->'auth') is distinct from 'string' then raise exception '알림 등록 정보를 확인해주세요.'; end if;
 if not exists(select 1 from public.hc_members where user_id=auth.uid()) then raise exception '기기를 먼저 연결해주세요.'; end if;
 if length(payload::text)>5000 or (payload->>'endpoint') !~ '^https://([a-zA-Z0-9-]+\.)*push\.apple\.com/[^[:space:]]+$' and (payload->>'endpoint') !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com)/[^[:space:]]+$' then raise exception '지원하지 않는 알림 주소입니다.'; end if;
 if length(payload->'keys'->>'p256dh') not between 80 and 100 or length(payload->'keys'->>'auth') not between 20 and 30 then raise exception '알림 키를 확인해주세요.'; end if;
 insert into public.hc_subscriptions values(auth.uid(),payload) on conflict(user_id) do update set subscription=excluded.subscription;
 insert into public.hc_outbox(user_id,payload) values(auth.uid(),jsonb_build_object('title','우리집 식당','body','알림 연결을 확인했어요','url','/restaurant','tag',gen_random_uuid()::text));
end $$;

revoke all on function public.hc_snapshot(),public.hc_join(text,text),public.hc_invite(),public.hc_command(uuid,jsonb),public.hc_subscribe(jsonb) from public,anon;
grant execute on function public.hc_snapshot(),public.hc_join(text,text),public.hc_invite(),public.hc_command(uuid,jsonb),public.hc_subscribe(jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('household-photos','household-photos',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy hc_photo_read on storage.objects for select to authenticated using(bucket_id='household-photos' and exists(select 1 from public.hc_members where user_id=auth.uid() and household_id::text=(storage.foldername(name))[1]));
create policy hc_member_self on public.hc_members for select to authenticated using(user_id=auth.uid());
create policy hc_photo_insert on storage.objects for insert to authenticated with check(bucket_id='household-photos' and exists(select 1 from public.hc_members where user_id=auth.uid() and role='husband' and household_id::text=(storage.foldername(name))[1]));

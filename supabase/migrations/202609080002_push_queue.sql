create index hc_outbox_pending on public.hc_outbox(next_at) where sent_at is null;
alter table public.hc_outbox add column expires_at timestamptz not null default now()+interval '24 hours';
alter table public.hc_outbox add column discarded_at timestamptz;

create function public.hc_claim_push() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 with selected as (
   select o.id from public.hc_outbox o
   where o.sent_at is null and o.discarded_at is null and o.expires_at>now() and o.next_at<=now() and o.attempts<8
     and exists(select 1 from public.hc_subscriptions s where s.user_id=o.user_id)
   order by o.next_at for update skip locked limit 20
 ), leased as (
   update public.hc_outbox o set attempts=o.attempts+1,
     next_at=now()+make_interval(secs=>greatest(300,least(3600,power(2,o.attempts)::integer*60)))
   where o.id in (select id from selected)
   returning o.id,o.user_id,o.payload,o.attempts
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'user_id',l.user_id,'payload',l.payload,'attempts',l.attempts,'subscription',s.subscription)),'[]') into result
 from leased l join public.hc_subscriptions s on s.user_id=l.user_id;
 return result;
end $$;
revoke all on function public.hc_claim_push() from public,anon,authenticated;
grant execute on function public.hc_claim_push() to service_role;

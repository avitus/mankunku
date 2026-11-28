-- One row per workout, including all progressions in a Daily Practice session.
create table public.lick_session_reports (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  timestamp bigint not null,
  attempts integer not null check (attempts > 0),
  minutes integer not null check (minutes >= 0),
  licks jsonb not null check (jsonb_typeof(licks) = 'array'),
  primary key (user_id, id)
);
create index lick_session_reports_recent on public.lick_session_reports(user_id, timestamp desc, id desc);
alter table public.lick_session_reports enable row level security;
revoke all on public.lick_session_reports from public, anon, authenticated;
grant select, insert, update, delete on public.lick_session_reports to authenticated, service_role;
create policy "Own practice reports" on public.lick_session_reports for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Tabs can flush snapshots of an in-progress session out of order.
create function private.keep_complete_lick_report() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.attempts, new.minutes) < (old.attempts, old.minutes) then return null; end if;
  return new;
end;
$$;
create trigger keep_complete_lick_report before update on public.lick_session_reports
for each row execute function private.keep_complete_lick_report();

create index session_results_recent_ear on public.session_results(user_id, timestamp desc, id desc)
where source is null or source = 'ear-training';

-- Only the admin server needs this aggregate. Never return note details to the roster.
create function public.admin_ear_scores(p_users uuid[])
returns table(user_id uuid, recent double precision, prior double precision, samples integer)
language sql stable security invoker set search_path = '' as $$
  select uid, avg(score) filter (where n <= 5),
         case when count(*) = 10 then avg(score) filter (where n > 5) end,
         least(count(*), 5)::integer
  from unnest(p_users) uid cross join lateral (
    select overall as score, row_number() over (order by timestamp desc, id desc) as n
    from public.session_results
    where user_id = uid and (source is null or source = 'ear-training')
    order by timestamp desc, id desc limit 10
  ) s group by uid
$$;
revoke all on function public.admin_ear_scores(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_ear_scores(uuid[]) to service_role;

-- The review only needs five whole workouts per player, across all of their devices.
create function private.trim_lick_session_reports() returns trigger
language plpgsql set search_path = '' as $$
declare owner_id uuid;
begin
  for owner_id in select distinct user_id from inserted_reports order by user_id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
    delete from public.lick_session_reports
      where user_id = owner_id and id in (
        select id from public.lick_session_reports where user_id = owner_id
        order by timestamp desc, id desc offset 5
      );
  end loop;
  return null;
end;
$$;
create trigger trim_lick_session_reports after insert on public.lick_session_reports
referencing new table as inserted_reports for each statement execute function private.trim_lick_session_reports();

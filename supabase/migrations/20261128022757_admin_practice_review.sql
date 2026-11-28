-- Profile ownership grants access to presentation fields. Only trusted operators
-- may assign the role the admin session and recording routes rely on.
revoke insert, update on public.user_profiles from public, anon, authenticated;
revoke insert (is_admin), update (is_admin) on public.user_profiles from public, anon, authenticated;
grant insert (id, display_name, avatar_url, created_at, updated_at),
      update (id, display_name, avatar_url, created_at, updated_at)
  on public.user_profiles to authenticated;

-- One row per workout, including all progressions in a Daily Practice session.
create table public.lick_session_reports (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  timestamp bigint not null,
  attempts integer not null check (attempts > 0),
  minutes integer not null check (minutes >= 0),
  licks jsonb not null check (jsonb_typeof(licks) = 'array'),
  generation uuid,
  primary key (user_id, id)
);
create index lick_session_reports_recent on public.lick_session_reports(user_id, timestamp desc, id desc);
alter table public.lick_session_reports enable row level security;
revoke all on public.lick_session_reports from public, anon, authenticated;
grant select, insert, update, delete on public.lick_session_reports to authenticated, service_role;
create policy "Own practice reports" on public.lick_session_reports for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Each workout carries the last reset generation observed when practice began.
-- Device timestamps rank the five retained workouts. They never decide reset ordering.
create table public.lick_report_resets (
  user_id uuid not null references auth.users(id) on delete cascade,
  generation uuid not null,
  applied_order bigint not null default 0,
  primary key (user_id, generation),
  unique (user_id, applied_order)
);
alter table public.lick_report_resets enable row level security;
revoke all on public.lick_report_resets from public, anon, authenticated;
grant select, insert (user_id, generation) on public.lick_report_resets to authenticated;
grant all on public.lick_report_resets to service_role;
create policy "Own report resets" on public.lick_report_resets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Allocate the order under the same lock used by uploads. A lost response can
-- safely replay the UUID with ON CONFLICT DO NOTHING. Only an inserted request
-- runs the AFTER trigger, so retries never clear workouts from a later reset.
create function private.order_lick_report_reset() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  select coalesce(max(applied_order), 0) + 1 into new.applied_order
  from public.lick_report_resets where user_id = new.user_id;
  return new;
end;
$$;
create trigger order_lick_report_reset before insert on public.lick_report_resets
for each row execute function private.order_lick_report_reset();

create function private.apply_lick_report_reset() returns trigger
language plpgsql set search_path = '' as $$
begin
  delete from public.lick_session_reports where user_id = new.user_id;
  return null;
end;
$$;
create trigger apply_lick_report_reset after insert on public.lick_report_resets
for each row execute function private.apply_lick_report_reset();

create function private.check_lick_report_generation() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if new.generation is distinct from (select generation from public.lick_report_resets
      where user_id = new.user_id order by applied_order desc limit 1) then
    raise exception 'Practice report generation changed' using errcode = '40001';
  end if;
  return new;
end;
$$;
create trigger check_lick_report_generation before insert or update on public.lick_session_reports
for each row execute function private.check_lick_report_generation();

-- Keep unusually large workouts as summaries. The local practice log remains
-- complete. Limit uncompressed JSON and the number of rows the admin UI renders.
create function private.limit_lick_report_details() returns trigger
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(new.licks) = 'array' then
    if jsonb_array_length(new.licks) > 256 or octet_length(new.licks::text) > 1048576
       or jsonb_array_length(jsonb_path_query_array(new.licks, '$[*].keys[*]')) > 1024 then
      new.licks := '[]'::jsonb;
    end if;
  end if;
  return new;
end;
$$;
-- PostgreSQL runs same-kind triggers alphabetically. Bound the input before
-- merging stored references and the final payload after references are restored.
create trigger bound_incoming_lick_report before insert or update on public.lick_session_reports
for each row execute function private.limit_lick_report_details();
create trigger limit_merged_lick_report before update on public.lick_session_reports
for each row execute function private.limit_lick_report_details();

-- Tabs can flush snapshots of an in-progress session out of order.
create function private.keep_complete_lick_report() returns trigger
language plpgsql set search_path = '' as $$
declare
  prior_refs jsonb;
begin
  if (new.attempts, new.minutes) < (old.attempts, old.minutes) then return null; end if;
  if new.licks = '[]'::jsonb or new.licks = old.licks then return new; end if;

  -- The originating device may have evicted a recording; other devices may
  -- never have had it. Preserve its reference from the locked row on upsert.
  select jsonb_object_agg(k->>'sessionId', k->'reference') into prior_refs
  from jsonb_path_query(old.licks, '$[*].keys[*]') k
  where jsonb_typeof(k->'reference') = 'object' and jsonb_typeof(k->'sessionId') = 'string';

  if prior_refs is not null then
    -- A repeated take ID must not expand one reference many times beyond the
    -- budget while the merge is being built. Measure each old reference once.
    if (select sum(missing.copies * octet_length((prior_refs->missing.id)::text)) from (
          select k->>'sessionId' as id, count(*) as copies
          from jsonb_path_query(new.licks, '$[*].keys[*]') k
          where jsonb_typeof(k->'reference') is distinct from 'object'
          group by k->>'sessionId'
        ) missing) > 1048576 then
      new.licks := '[]'::jsonb;
      return new;
    end if;
    select coalesce(jsonb_agg(
      case when jsonb_typeof(lick->'keys') = 'array' then
        jsonb_set(lick, '{keys}', (select coalesce(jsonb_agg(
          case when prior_refs ? (k->>'sessionId') and jsonb_typeof(k->'reference') is distinct from 'object'
               then k || jsonb_build_object('reference', prior_refs->(k->>'sessionId'))
               else k end order by key_pos), '[]'::jsonb)
          from jsonb_array_elements(lick->'keys') with ordinality as keys(k, key_pos)))
      else lick end order by lick_pos), '[]'::jsonb)
    into new.licks
    from jsonb_array_elements(new.licks) with ordinality as licks(lick, lick_pos);
  end if;
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

-- Match the five ear sessions and five workouts displayed by the admin review.
create function public.admin_review_recording_allowed(p_user_id uuid, p_take text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from (
      select id from public.session_results
      where user_id = p_user_id and (source is null or source = 'ear-training')
      order by timestamp desc, id desc limit 5
    ) ear where ear.id = p_take
  ) or exists (
    select 1 from (
      select licks from public.lick_session_reports where user_id = p_user_id
      order by timestamp desc, id desc limit 5
    ) workout
    where jsonb_path_exists(workout.licks, '$[*].keys[*] ? (@.sessionId == $take)',
                            jsonb_build_object('take', p_take))
  )
$$;
revoke all on function public.admin_review_recording_allowed(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_review_recording_allowed(uuid, text) to service_role;

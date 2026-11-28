begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
select ok(not has_column_privilege('authenticated','public.user_profiles','is_admin','INSERT')
      and not has_column_privilege('authenticated','public.user_profiles','is_admin','UPDATE')
      and not has_column_privilege('anon','public.user_profiles','is_admin','INSERT')
      and not has_column_privilege('anon','public.user_profiles','is_admin','UPDATE'),
  'client roles cannot assign admin membership');
select ok(has_column_privilege('authenticated','public.user_profiles','display_name','UPDATE')
      and has_column_privilege('authenticated','public.user_profiles','updated_at','UPDATE')
      and has_column_privilege('service_role','public.user_profiles','is_admin','UPDATE'),
  'profile editing and trusted role administration remain available');
create temp table player as select gen_random_uuid() as id;
insert into auth.users(id) select id from player;
insert into public.session_results (id,user_id,timestamp,phrase_id,phrase_name,category,key,tempo,difficulty_level,
 pitch_accuracy,rhythm_accuracy,overall,grade,notes_hit,notes_total,source)
select gen_random_uuid()::text, player.id,i,'lick','Example','blues','C',100,12,1,1,
 case when i between 6 and 10 then 1 else 0 end,'good',1,1,
 case when i=11 then 'lick-practice' when i%2=0 then 'ear-training' end
from player,generate_series(1,11)i;
select is((select recent from public.admin_ear_scores(array[(select id from player)])),1::float8,'latest five include legacy ear rows and exclude lick practice');
select is((select prior from public.admin_ear_scores(array[(select id from player)])),0::float8,'previous five are disjoint');
select ok(not has_function_privilege('authenticated','public.admin_ear_scores(uuid[])','EXECUTE'),'admin aggregation is service-only');
insert into public.lick_session_reports select player.id,'w'||i,i,2,1,'[]'::jsonb from player,generate_series(1,7)i;
select is((select count(*) from public.lick_session_reports where user_id=(select id from player)),5::bigint,'retains the five latest workouts');
select is((select min(timestamp) from public.lick_session_reports where user_id=(select id from player)),3::bigint,'prunes oldest workouts first');
update public.lick_session_reports set attempts=1 where user_id=(select id from player) and id='w7';
select is((select attempts from public.lick_session_reports where user_id=(select id from player) and id='w7'),2,'late partial write preserves the fuller report');
update public.lick_session_reports set licks =
  '[{"keys":[{"sessionId":"one","reference":{"tempo":90}},{"sessionId":"two","reference":{"tempo":80}}]}]'
  where user_id=(select id from player) and id='w7';
update public.lick_session_reports set attempts=3, licks =
  '[{"keys":[{"sessionId":"two","reference":{"tempo":100}},{"sessionId":"three"}]},{"keys":[{"sessionId":"one"}]}]'
  where user_id=(select id from player) and id='w7';
select is((select licks from public.lick_session_reports where user_id=(select id from player) and id='w7'),
  '[{"keys":[{"sessionId":"two","reference":{"tempo":100}},{"sessionId":"three"}]},{"keys":[{"sessionId":"one","reference":{"tempo":90}}]}]'::jsonb,
  'changed workouts retain an evicted reference by take ID and accept new attempts and references');
set local role authenticated;
select is((select count(*) from public.lick_session_reports),0::bigint,'a different user cannot read the player reports');
reset role;
grant select on player to authenticated;
select set_config('request.jwt.claim.sub',(select id::text from player),true);
set local role authenticated;
insert into public.lick_report_resets select id,6 from player
  on conflict (user_id) do update set reset_at=excluded.reset_at;
select is((select count(*) from public.lick_session_reports),1::bigint,'reset removes only workouts at or before the cutoff');
insert into public.lick_session_reports select id,'late',6,1,1,'[]'::jsonb from player;
select is((select count(*) from public.lick_session_reports where id='late'),0::bigint,'late sync cannot restore a reset workout');
insert into public.lick_report_resets select id,4 from player
  on conflict (user_id) do update set reset_at=excluded.reset_at;
select is((select reset_at from public.lick_report_resets),6::bigint,'an older reset cannot move the cutoff back');
insert into public.lick_session_reports select id,'newer',8,1,1,'[]'::jsonb from player;
select is((select count(*) from public.lick_session_reports where timestamp>6),2::bigint,'new workouts sync after a reset');
select ok(not has_table_privilege('authenticated','public.lick_report_resets','DELETE'),
  'clients cannot remove the durable cutoff');
reset role;
select * from finish();
rollback;

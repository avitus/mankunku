begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
select ok(not has_column_privilege('authenticated','public.user_profiles','is_admin','INSERT')
      and not has_column_privilege('authenticated','public.user_profiles','is_admin','UPDATE')
      and not has_column_privilege('anon','public.user_profiles','is_admin','INSERT')
      and not has_column_privilege('anon','public.user_profiles','is_admin','UPDATE'),
  'client roles cannot assign admin membership');
select ok(has_column_privilege('authenticated','public.user_profiles','display_name','UPDATE')
      and has_column_privilege('authenticated','public.user_profiles','updated_at','UPDATE')
      and has_column_privilege('service_role','public.user_profiles','is_admin','UPDATE'),
  'profile editing and trusted role administration remain available');
create temp table player as select gen_random_uuid() as id, gen_random_uuid() as first_reset, gen_random_uuid() as second_reset;
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
select ok(public.admin_review_recording_allowed((select id from player), 'one'), 'retained workout can sign its take');
select ok(public.admin_review_recording_allowed((select id from player),
  (select id from public.session_results where timestamp=6 and user_id=(select id from player))), 'fifth ear-training take is eligible');
select ok(not public.admin_review_recording_allowed((select id from player),
  (select id from public.session_results where timestamp=5 and user_id=(select id from player))), 'older ear-training take is ineligible');
select ok(not public.admin_review_recording_allowed(gen_random_uuid(), 'one')
  and not has_function_privilege('authenticated','public.admin_review_recording_allowed(uuid,text)','EXECUTE'),
  'eligibility is account-scoped and service-only');
update public.lick_session_reports set licks=jsonb_build_array(jsonb_build_object('keys',
  (select jsonb_agg(i) from generate_series(1,1025) i))) where id='w6';
select is((select licks from public.lick_session_reports where id='w6'),'[]'::jsonb,'too many key rows retain only the workout summary');
insert into public.lick_session_reports select id,'large',99,12,4,jsonb_build_array(repeat('x',1048576)) from player;
select is((select (licks,attempts,minutes)::text from public.lick_session_reports where id='large'),
  ('[]'::jsonb,12,4)::text,'large compressible details keep the real attempts and minutes');
update public.lick_session_reports set licks=(select jsonb_agg(i) from generate_series(1,257)i) where id='w6';
select is((select licks from public.lick_session_reports where id='w6'),
  '[]'::jsonb,'limits the number of lick headings in a workout');
-- A valid incoming row can still exceed the budget after missing references
-- are restored. Exercise both a single large merge and a duplicated take ID.
update public.lick_session_reports set licks=jsonb_build_array(jsonb_build_object('keys',
  jsonb_build_array(jsonb_build_object('sessionId','long','reference',jsonb_build_object('text',repeat('x',600000))))))
where id='w6';
update public.lick_session_reports set licks=jsonb_build_array(jsonb_build_object('keys',
  jsonb_build_array(jsonb_build_object('sessionId','long')),'name',repeat('y',600000))) where id='w6';
select is((select licks from public.lick_session_reports where id='w6'),'[]'::jsonb,'restored references count toward the final byte limit');
update public.lick_session_reports set licks=jsonb_build_array(jsonb_build_object('keys',
  jsonb_build_array(jsonb_build_object('sessionId','long','reference',jsonb_build_object('text',repeat('x',600000))))))
where id='w6';
update public.lick_session_reports set licks='[{"keys":[{"sessionId":"long"},{"sessionId":"long"}]}]'::jsonb where id='w6';
select is((select licks from public.lick_session_reports where id='w6'),'[]'::jsonb,'duplicate take IDs cannot multiply a reference beyond the limit');
set local role authenticated;
select is((select count(*) from public.lick_session_reports),0::bigint,'a different user cannot read the player reports');
reset role;
grant select on player to authenticated;
select set_config('request.jwt.claim.sub',(select id::text from player),true);
set local role authenticated;
insert into public.lick_report_resets(user_id,generation) select id,first_reset from player
  on conflict (user_id,generation) do nothing;
select is((select count(*) from public.lick_session_reports),0::bigint,'reset removes every report from the previous generation');
select throws_ok($$insert into public.lick_session_reports
  select id,'late',9999999999999,1,1,'[]'::jsonb,null from player$$,
  '40001','Practice report generation changed','a fast clock cannot restore an old-generation workout');
insert into public.lick_session_reports select id,'newer',1,1,1,'[]'::jsonb,first_reset from player;
insert into public.lick_report_resets(user_id,generation) select id,first_reset from player
  on conflict (user_id,generation) do nothing;
select is((select max(applied_order) from public.lick_report_resets),1::bigint,'retry leaves the generation unchanged');
select is((select count(*) from public.lick_session_reports where id='newer'),1::bigint,'new workout survives retry even with a slow clock');
select ok(not has_table_privilege('authenticated','public.lick_report_resets','DELETE'),
  'clients cannot remove the reset generation');
insert into public.lick_report_resets(user_id,generation) select id,second_reset from player
  on conflict (user_id,generation) do nothing;
select is((select count(*) from public.lick_session_reports),0::bigint,'a second reset discards the previous generation');
insert into public.lick_report_resets(user_id,generation) select id,first_reset from player
  on conflict (user_id,generation) do nothing;
select is((select generation from public.lick_report_resets order by applied_order desc limit 1),(select second_reset from player),'out-of-order retry cannot undo a subsequent reset');
select ok(not has_column_privilege('authenticated','public.lick_report_resets','applied_order','INSERT')
  and not has_table_privilege('authenticated','public.lick_report_resets','UPDATE'),
  'only the server assigns and orders reset generations');
insert into public.daily_summaries(user_id,date) select id,'2026-11-25' from player;
insert into public.daily_summaries(user_id,date) select id,'2026-11-26' from player;
select set_config('request.method','DELETE',true);
delete from public.daily_summaries where date='2026-11-25';
select is((select max(applied_order) from public.lick_report_resets),2::bigint,'partial daily-summary deletion preserves reports');
select set_config('request.method','POST',true);
select public.clear_daily_practice_summaries((select id from player));
select ok(not exists(select from public.daily_summaries)
  and (select max(applied_order) from public.lick_report_resets)=2,'modern summary cleanup does not repeat the queued reset');
insert into public.lick_session_reports select id,'post-reset',7,1,1,'[]'::jsonb,second_reset from player;
select set_config('request.method','DELETE',true);
delete from public.daily_summaries where user_id=(select id from player);
select ok(not exists(select from public.lick_session_reports)
  and (select max(applied_order) from public.lick_report_resets)=3,'legacy reset clears reports even with no remaining daily rows');
select throws_ok($$insert into public.lick_session_reports select id,'stale',8,1,1,'[]'::jsonb,second_reset from player$$,
  '40001','Practice report generation changed','a modern device cannot reupload a workout cleared by a legacy reset');
select ok(not has_function_privilege('anon','public.clear_daily_practice_summaries(uuid)','EXECUTE'),
  'summary cleanup is available only to signed-in owners');
reset role;
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
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
set local role authenticated;
select is((select count(*) from public.lick_session_reports),0::bigint,'a different user cannot read the player reports');
reset role;
select * from finish();
rollback;

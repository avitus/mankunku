BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(21);
CREATE TEMP TABLE practice_time_test_user AS SELECT gen_random_uuid() AS id;
INSERT INTO auth.users(id) SELECT id FROM practice_time_test_user;
INSERT INTO public.daily_summaries(user_id, date, practice_time)
SELECT id, '2026-09-11', '{"minutes":40,"earTrainingSessions":0,"lickPracticeSessions":180}'::jsonb
FROM practice_time_test_user;
SELECT is((SELECT practice_minutes FROM public.daily_summaries WHERE user_id = (SELECT id FROM practice_time_test_user)), 40, 'snapshot owns the scalar');

-- Simulate a writer that read the older 25-minute version before the 40-minute
-- writer committed, then flushes its stale snapshot afterwards.
INSERT INTO public.daily_summaries(user_id,date,session_count,ear_training_sessions,lick_practice_sessions,practice_minutes,practice_time)
SELECT id,'2026-09-11',120,0,120,25,'{"minutes":25,"earTrainingSessions":0,"lickPracticeSessions":120}'::jsonb FROM practice_time_test_user
ON CONFLICT (user_id,date) DO UPDATE SET
 session_count=excluded.session_count, ear_training_sessions=excluded.ear_training_sessions,
 lick_practice_sessions=excluded.lick_practice_sessions, practice_minutes=excluded.practice_minutes, practice_time=excluded.practice_time;
SELECT is((SELECT practice_minutes FROM public.daily_summaries WHERE user_id = (SELECT id FROM practice_time_test_user)), 40, 'stale explicit correction cannot overwrite more complete provenance');
UPDATE public.daily_summaries SET practice_minutes=240 WHERE user_id=(SELECT id FROM practice_time_test_user);
SELECT is((SELECT practice_minutes FROM public.daily_summaries WHERE user_id = (SELECT id FROM practice_time_test_user)), 40, 'legacy scalar-only write cannot inflate time');
UPDATE public.daily_summaries SET practice_time=NULL WHERE user_id=(SELECT id FROM practice_time_test_user);
SELECT isnt((SELECT practice_time FROM public.daily_summaries WHERE user_id = (SELECT id FROM practice_time_test_user)), NULL::jsonb, 'legacy null cannot erase provenance');
UPDATE public.daily_summaries SET practice_time='{"minutes":45,"earTrainingSessions":0,"lickPracticeSessions":200}' WHERE user_id=(SELECT id FROM practice_time_test_user);
SELECT is((SELECT practice_minutes FROM public.daily_summaries WHERE user_id = (SELECT id FROM practice_time_test_user)), 45, 'newer complete correction advances the total');
SELECT is((SELECT session_count FROM public.daily_summaries WHERE user_id = (SELECT id FROM practice_time_test_user)), 200, 'summary counters cover the accepted snapshot');
SELECT throws_ok($$UPDATE public.daily_summaries SET practice_time='{"minutes":"bad"}' WHERE user_id=(SELECT id FROM practice_time_test_user)$$, '23514', 'Invalid practice-time provenance', 'malformed provenance is rejected');
SELECT throws_ok($$UPDATE public.daily_summaries SET practice_time='{"minutes":-1,"earTrainingSessions":0,"lickPracticeSessions":200}' WHERE user_id=(SELECT id FROM practice_time_test_user)$$, '23514', 'Invalid practice-time provenance', 'negative time is rejected');
SELECT throws_ok($$UPDATE public.daily_summaries SET practice_time='{"minutes":45,"earTrainingSessions":0,"lickPracticeSessions":0}' WHERE user_id=(SELECT id FROM practice_time_test_user)$$, '23514', 'Invalid practice-time provenance', 'a correction requires source coverage');
UPDATE public.daily_summaries SET ear_training_sessions=1 WHERE user_id=(SELECT id FROM practice_time_test_user);
SELECT is((SELECT practice_minutes FROM public.daily_summaries WHERE user_id = (SELECT id FROM practice_time_test_user)), 46, 'uncovered ear activity is added to corrected lick time');
UPDATE public.daily_summaries SET practice_time='{"minutes":3,"earTrainingSessions":6,"lickPracticeSessions":0,"earMinutes":3,"lickMinutes":0}' WHERE user_id=(SELECT id FROM practice_time_test_user);
SELECT is((SELECT practice_minutes FROM public.daily_summaries WHERE user_id = (SELECT id FROM practice_time_test_user)), 48, 'incomparable source corrections combine');
UPDATE public.daily_summaries SET practice_time='{"minutes":45,"earTrainingSessions":0,"lickPracticeSessions":200,"earMinutes":0,"lickMinutes":45}', ear_training_sessions=0 WHERE user_id=(SELECT id FROM practice_time_test_user);
SELECT is((SELECT ear_training_sessions FROM public.daily_summaries WHERE user_id = (SELECT id FROM practice_time_test_user)), 6, 'stale writer preserves the other source count');
SELECT is((SELECT practice_minutes FROM public.daily_summaries WHERE user_id = (SELECT id FROM practice_time_test_user)), 48, 'stale writer preserves both source durations');

INSERT INTO public.daily_summaries(user_id,date,session_count,ear_training_sessions,practice_minutes)
SELECT id,'2026-09-10',120,120,240 FROM practice_time_test_user;
SELECT ok((SELECT practice_time_unavailable FROM public.daily_summaries WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-10'), 'legacy formula is marked unavailable');
UPDATE public.daily_summaries SET practice_time_unavailable=false,session_count=121,ear_training_sessions=121,practice_minutes=241
WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-10';
SELECT ok((SELECT practice_time_unavailable FROM public.daily_summaries WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-10'), 'stale writes and changed counts cannot erase missing-duration evidence');
SELECT is((SELECT practice_minutes FROM public.daily_summaries WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-10'),241,'raw historical scalar is retained for audit');
UPDATE public.daily_summaries SET practice_time='{"minutes":61,"earTrainingSessions":121,"lickPracticeSessions":0,"earMinutes":60.5,"lickMinutes":0}'
WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-10';
SELECT ok(NOT (SELECT practice_time_unavailable FROM public.daily_summaries WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-10'), 'source recovery clears unavailable marker');
UPDATE public.daily_summaries SET practice_time=NULL,practice_time_unavailable=true,practice_minutes=242
WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-10';
SELECT ok(NOT (SELECT practice_time_unavailable FROM public.daily_summaries WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-10'), 'stale unavailable marker cannot hide recovered source time');
INSERT INTO public.daily_summaries(user_id,date,session_count,ear_training_sessions,practice_minutes)
SELECT id,'2026-09-09',120,120,25 FROM practice_time_test_user;
SELECT ok(NOT (SELECT practice_time_unavailable FROM public.daily_summaries WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-09'), 'non-formula historic durations remain usable');

UPDATE public.daily_summaries SET session_count=2,ear_training_sessions=2,practice_minutes=4,practice_time_unavailable=true
WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-09';
SELECT ok(NOT (SELECT practice_time_unavailable FROM public.daily_summaries WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-09'), 'partial formula match cannot hide a usable cached duration');
SELECT is((SELECT practice_minutes FROM public.daily_summaries WHERE user_id=(SELECT id FROM practice_time_test_user) AND date='2026-09-09'),25,'partial formula match preserves cached minutes');
SELECT * FROM finish();
ROLLBACK;

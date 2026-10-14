-- Run against an isolated local database after applying migrations. Rolls back
-- every fixture. Never run this script against a hosted project.
BEGIN;
INSERT INTO auth.users(id, email) VALUES
 ('10000000-0000-4000-8000-000000000001', 'admin@example.test'),
 ('10000000-0000-4000-8000-000000000002', 'author@example.test'),
 ('10000000-0000-4000-8000-000000000003', 'adopter@example.test'),
 ('10000000-0000-4000-8000-000000000004', 'unused@example.test');
UPDATE public.user_profiles SET is_admin = true WHERE id = '10000000-0000-4000-8000-000000000001';
INSERT INTO public.user_licks(id,user_id,name,time_signature,key) VALUES
 ('admin-test-lick','10000000-0000-4000-8000-000000000002','Test lick',ARRAY[4,4],'C'),
 ('admin-test-unused','10000000-0000-4000-8000-000000000004','Unused lick',ARRAY[4,4],'C');
INSERT INTO public.lick_adoptions(user_id,lick_id) VALUES ('10000000-0000-4000-8000-000000000003','admin-test-lick');

-- Check real role permissions, not merely mocked route guards.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.admin_remove_lick('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','admin-test-lick','Test lick');
    RAISE EXCEPTION 'Expected permission denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.user_visit_days VALUES ('10000000-0000-4000-8000-000000000002','2000-01-01');
    RAISE EXCEPTION 'Expected permission denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM public.admin_begin_user_deletion('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','author@example.test');
    RAISE EXCEPTION 'Expected adopted account rejection';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    PERFORM public.admin_remove_lick('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','admin-test-lick','Test lick');
    RAISE EXCEPTION 'Expected adopted lick rejection';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  IF (SELECT count(*) FROM public.admin_actions) <> 0 THEN RAISE EXCEPTION 'Blocked actions must not start deletion'; END IF;
  BEGIN
    PERFORM public.admin_remove_lick('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','admin-test-lick','Test lick');
    RAISE EXCEPTION 'Expected non-admin rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Blank titles must require the ID, never an empty confirmation.
INSERT INTO public.user_licks(id,user_id,name,time_signature,key) VALUES ('admin-test-blank','10000000-0000-4000-8000-000000000004','',ARRAY[4,4],'C');
DO $$ BEGIN
  BEGIN
    PERFORM public.admin_remove_lick('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','admin-test-blank','');
    RAISE EXCEPTION 'Empty confirmation accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Confirmation text does not match' THEN RAISE; END IF;
  END;
END $$;
SELECT public.admin_remove_lick('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','admin-test-blank','admin-test-blank');
-- Remove an unadopted lick, leaving the account and a sync tombstone.
SELECT public.admin_remove_lick('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','admin-test-unused','Unused lick');
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.user_licks WHERE id='admin-test-unused' AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Missing tombstone'; END IF;
  BEGIN
    UPDATE public.user_licks SET deleted_at = NULL, client_mtime = 9999999999999 WHERE id='admin-test-unused';
    RAISE EXCEPTION 'Unexpected resurrection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'This lick was removed by an administrator' THEN RAISE; END IF;
  END;
END $$;

-- A tune adoption also protects its author, even with no adopted licks.
DELETE FROM public.lick_adoptions WHERE lick_id='admin-test-lick';
INSERT INTO public.tunes(id,user_id,title,key,time_signature) VALUES ('admin-test-tune','10000000-0000-4000-8000-000000000002','Test tune','C',ARRAY[4,4]);
INSERT INTO public.tune_adoptions(user_id,tune_id) VALUES ('10000000-0000-4000-8000-000000000003','admin-test-tune');
DO $$ BEGIN
  BEGIN
    PERFORM public.admin_begin_user_deletion('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','author@example.test');
    RAISE EXCEPTION 'Expected adopted tune rejection';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
DELETE FROM public.tune_adoptions WHERE tune_id='admin-test-tune';
-- Begin account removal and verify a late adoption/content write is refused.
SELECT public.admin_begin_user_deletion('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','author@example.test');
SELECT public.admin_begin_user_deletion('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','author@example.test');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.admin_actions WHERE action='delete_user') <> 1 THEN RAISE EXCEPTION 'Retry duplicated operation'; END IF;
  BEGIN
    INSERT INTO public.lick_adoptions(user_id,lick_id) VALUES ('10000000-0000-4000-8000-000000000003','admin-test-lick');
    RAISE EXCEPTION 'Unexpected late adoption';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Account removal is in progress' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.tune_adoptions(user_id,tune_id) VALUES ('10000000-0000-4000-8000-000000000003','admin-test-tune');
    RAISE EXCEPTION 'Unexpected late tune adoption';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Account removal is in progress' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.user_licks SET name='Edited' WHERE id='admin-test-lick';
    RAISE EXCEPTION 'Unexpected late edit';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Account removal is in progress' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
-- Simulate the Auth API's successful database delete.
DELETE FROM auth.users WHERE id='10000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT public.admin_finish_user_deletion('10000000-0000-4000-8000-000000000001', id) FROM public.admin_actions WHERE action='delete_user';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.user_licks WHERE id='admin-test-lick') THEN RAISE EXCEPTION 'Lick did not cascade'; END IF;
  IF EXISTS(SELECT 1 FROM public.admin_actions WHERE status='pending') THEN RAISE EXCEPTION 'Audit not completed'; END IF;
END $$;
RESET ROLE;

-- Multiple devices/requests on the same day count once. Clients cannot supply
-- a date or another user's identity to the observing RPC.
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT public.record_user_device('20000000-0000-4000-8000-000000000001','Safari','18','macOS','desktop');
SELECT public.record_user_device('20000000-0000-4000-8000-000000000002','Chrome','130','macOS','desktop');
DO $$ BEGIN
  FOR n IN 1..35 LOOP
    PERFORM public.record_user_device(('40000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'Safari','18','macOS','desktop');
  END LOOP;
  IF (SELECT count(*) FROM public.user_devices) <> 32 THEN RAISE EXCEPTION 'Device cap regressed'; END IF;
  IF (SELECT count(*) FROM public.user_visit_days) <> 1 THEN RAISE EXCEPTION 'Visits not deduplicated'; END IF;
END $$;
RESET ROLE;
ROLLBACK;

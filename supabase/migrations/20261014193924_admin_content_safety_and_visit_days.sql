BEGIN;

-- Visits are observations of authenticated use, not attempts or login sessions.
-- Keep only a UTC date, deduplicated across devices. Historical data is a lower
-- bound: first/last device sightings and the last successful sign-in are known.
CREATE TABLE public.user_visit_days (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  PRIMARY KEY (user_id, date)
);
ALTER TABLE public.user_visit_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_visit_days FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_visit_days TO authenticated;
GRANT ALL ON public.user_visit_days TO service_role;
CREATE POLICY "Users can read own visit days" ON public.user_visit_days
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
INSERT INTO public.user_visit_days (user_id, date)
SELECT id, (last_sign_in_at AT TIME ZONE 'UTC')::date FROM auth.users WHERE last_sign_in_at IS NOT NULL
UNION SELECT user_id, (first_seen_at AT TIME ZONE 'UTC')::date FROM public.user_devices
UNION SELECT user_id, (last_seen_at AT TIME ZONE 'UTC')::date FROM public.user_devices
ON CONFLICT DO NOTHING;

-- Record before the device's hourly throttle, including visits across midnight.
CREATE OR REPLACE FUNCTION public.record_user_device(
  p_device_id UUID, p_browser_name TEXT, p_browser_version TEXT,
  p_os_name TEXT, p_device_type TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.user_visit_days VALUES (caller, (now() AT TIME ZONE 'UTC')::date)
    ON CONFLICT DO NOTHING;
  -- Serialize this account's admissions so concurrent fresh IDs cannot bypass the cap.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text, 260));
  IF NOT EXISTS (
    SELECT 1 FROM public.user_devices WHERE user_id = caller AND device_id = p_device_id
  ) THEN
    -- Keep the 31 most recent installations and admit this one as the 32nd.
    DELETE FROM public.user_devices WHERE user_id = caller AND device_id IN (
      SELECT device_id FROM public.user_devices WHERE user_id = caller
      ORDER BY last_seen_at DESC, first_seen_at DESC, device_id
      OFFSET 31
    );
  END IF;
  INSERT INTO public.user_devices AS existing
    (user_id, device_id, browser_name, browser_version, os_name, device_type)
  VALUES (caller, p_device_id, p_browser_name, p_browser_version, p_os_name, p_device_type)
  ON CONFLICT (user_id, device_id) DO UPDATE SET
    browser_name = EXCLUDED.browser_name,
    browser_version = EXCLUDED.browser_version,
    os_name = EXCLUDED.os_name,
    device_type = EXCLUDED.device_type,
    last_seen_at = now()
  WHERE existing.last_seen_at <= now() - interval '1 hour'
     OR (existing.browser_name, existing.browser_version, existing.os_name, existing.device_type)
        IS DISTINCT FROM
        (EXCLUDED.browser_name, EXCLUDED.browser_version, EXCLUDED.os_name, EXCLUDED.device_type);
END;
$$;

-- Audit survives target deletion; do not retain email, names, content or files.
-- A pending account removal also fences new content/adoptions during the
-- non-transactional Storage + Auth API steps. Retries reuse that same operation.
CREATE TABLE public.admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  target_user_id UUID NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('delete_user', 'remove_lick')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX admin_pending_user_deletion ON public.admin_actions(target_user_id)
  WHERE action = 'delete_user' AND status = 'pending';
CREATE INDEX admin_removed_lick ON public.admin_actions(target_id)
  WHERE action = 'remove_lick' AND status = 'completed';
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_actions TO service_role;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- All admin removals and content/adoption writes serialize per author. This
-- closes the check-then-delete race without holding a transaction over HTTP.
CREATE FUNCTION private.lock_content_owner(owner_id UUID) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 731042));
$$;
REVOKE ALL ON FUNCTION private.lock_content_owner(UUID) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.lock_content_owner(UUID) TO service_role;

CREATE FUNCTION private.guard_admin_content() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner_id UUID; content_id TEXT;
BEGIN
  IF TG_TABLE_NAME IN ('lick_adoptions', 'tune_adoptions') THEN
    IF TG_TABLE_NAME = 'lick_adoptions' THEN
      content_id := NEW.lick_id;
      SELECT user_id INTO owner_id FROM public.user_licks WHERE id = content_id;
    ELSE
      content_id := NEW.tune_id;
      SELECT user_id INTO owner_id FROM public.tunes WHERE id = content_id;
    END IF;
    IF owner_id IS NULL THEN RAISE EXCEPTION 'Content unavailable'; END IF;
    PERFORM private.lock_content_owner(owner_id);
    IF TG_TABLE_NAME = 'lick_adoptions' THEN
      IF NOT EXISTS (SELECT 1 FROM public.user_licks WHERE id = content_id AND deleted_at IS NULL AND user_id = owner_id) THEN
        RAISE EXCEPTION 'Content unavailable';
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.tunes WHERE id = content_id AND deleted_at IS NULL AND user_id = owner_id) THEN
        RAISE EXCEPTION 'Content unavailable';
      END IF;
    END IF;
  ELSE
    owner_id := NEW.user_id;
    IF TG_OP = 'UPDATE' AND OLD.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'Content ownership cannot be reassigned';
    END IF;
    -- Only nested favorite-trigger maintenance may pass the deletion fence.
    -- Direct author writes, including counter-only writes, remain fenced.
    IF TG_OP = 'UPDATE' AND pg_catalog.pg_trigger_depth() > 1
      AND (to_jsonb(NEW) - 'favorite_count' - 'updated_at')
        = (to_jsonb(OLD) - 'favorite_count' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    PERFORM private.lock_content_owner(owner_id);
    IF TG_TABLE_NAME = 'user_licks' AND NEW.deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM public.admin_actions WHERE action = 'remove_lick' AND status = 'completed' AND target_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'This lick was removed by an administrator';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_actions WHERE target_user_id = owner_id AND action = 'delete_user' AND status = 'pending') THEN
    RAISE EXCEPTION 'Account removal is in progress';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_admin_content() FROM PUBLIC;
CREATE TRIGGER admin_content_guard BEFORE INSERT OR UPDATE ON public.user_licks
  FOR EACH ROW EXECUTE FUNCTION private.guard_admin_content();
CREATE TRIGGER admin_content_guard BEFORE INSERT OR UPDATE ON public.tunes
  FOR EACH ROW EXECUTE FUNCTION private.guard_admin_content();
CREATE TRIGGER admin_adoption_guard BEFORE INSERT OR UPDATE ON public.lick_adoptions
  FOR EACH ROW EXECUTE FUNCTION private.guard_admin_content();
CREATE TRIGGER admin_adoption_guard BEFORE INSERT OR UPDATE ON public.tune_adoptions
  FOR EACH ROW EXECUTE FUNCTION private.guard_admin_content();

-- These RPCs are service-role only. The route obtains actor_id from verified
-- auth, never from the form. Check the administrator again inside the database.
CREATE FUNCTION public.admin_begin_user_deletion(p_actor_id UUID, p_user_id UUID, p_confirm TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE operation_id UUID; expected TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_actor_id AND is_admin) OR p_actor_id = p_user_id THEN
    RAISE EXCEPTION 'Administrator required; self-deletion is not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM private.lock_content_owner(p_user_id);
  SELECT coalesce(nullif(email, ''), id::text) INTO expected FROM auth.users WHERE id = p_user_id;
  IF expected IS NULL OR p_confirm IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'User or confirmation changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lick_adoptions a JOIN public.user_licks l ON l.id = a.lick_id WHERE l.user_id = p_user_id AND a.user_id <> p_user_id)
    OR EXISTS (SELECT 1 FROM public.tune_adoptions a JOIN public.tunes t ON t.id = a.tune_id WHERE t.user_id = p_user_id AND a.user_id <> p_user_id) THEN
    RAISE EXCEPTION 'Deletion blocked: other users have adopted this content' USING ERRCODE = '23503';
  END IF;
  SELECT id INTO operation_id FROM public.admin_actions WHERE target_user_id = p_user_id AND action = 'delete_user' AND status = 'pending';
  IF operation_id IS NULL THEN
    INSERT INTO public.admin_actions(actor_id, target_user_id, target_id, action, status)
      VALUES (p_actor_id, p_user_id, p_user_id::text, 'delete_user', 'pending') RETURNING id INTO operation_id;
  END IF;
  RETURN operation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_begin_user_deletion(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_begin_user_deletion(UUID, UUID, TEXT) TO service_role;

CREATE FUNCTION public.admin_finish_user_deletion(p_actor_id UUID, p_operation_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_actor_id AND is_admin) THEN
    RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501';
  END IF;
  SELECT target_user_id INTO target FROM public.admin_actions WHERE id = p_operation_id AND action = 'delete_user';
  IF target IS NULL OR EXISTS (SELECT 1 FROM auth.users WHERE id = target) THEN
    RAISE EXCEPTION 'Account deletion has not completed';
  END IF;
  UPDATE public.admin_actions SET status = 'completed', completed_at = coalesce(completed_at, now()) WHERE id = p_operation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_finish_user_deletion(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finish_user_deletion(UUID, UUID) TO service_role;

CREATE FUNCTION public.admin_remove_lick(p_actor_id UUID, p_user_id UUID, p_lick_id TEXT, p_confirm TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lick public.user_licks%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_actor_id AND is_admin) THEN
    RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501';
  END IF;
  PERFORM private.lock_content_owner(p_user_id);
  SELECT * INTO lick FROM public.user_licks WHERE id = p_lick_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR lick.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Lick no longer available'; END IF;
  IF p_confirm IS DISTINCT FROM (CASE WHEN btrim(lick.name) = '' THEN lick.id ELSE lick.name END) THEN RAISE EXCEPTION 'Confirmation text does not match'; END IF;
  IF EXISTS (SELECT 1 FROM public.lick_adoptions WHERE lick_id = p_lick_id AND user_id <> p_user_id) THEN
    RAISE EXCEPTION 'Removal blocked: other users have adopted this lick' USING ERRCODE = '23503';
  END IF;
  UPDATE public.user_licks SET deleted_at = now(), client_mtime = greatest(client_mtime + 1, (extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    WHERE id = p_lick_id;
  INSERT INTO public.admin_actions(actor_id, target_user_id, target_id, action, status, completed_at)
    VALUES (p_actor_id, p_user_id, p_lick_id, 'remove_lick', 'completed', now());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_remove_lick(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_lick(UUID, UUID, TEXT, TEXT) TO service_role;

COMMENT ON TABLE public.user_visit_days IS 'Distinct UTC dates observed signed in. Backfilled only from known auth/device timestamps; earlier history is incomplete.';
COMMENT ON TABLE public.admin_actions IS 'Server-only moderation audit and durable account-removal fence. Pending removals are retried, never automatically released while Auth or Storage may still be in flight.';
COMMIT;

BEGIN;

-- Bound existing diagnostic history as well as future authenticated RPC calls.
WITH ranked AS (
  SELECT user_id, device_id,
    row_number() OVER (PARTITION BY user_id ORDER BY last_seen_at DESC, first_seen_at DESC, device_id) AS position
  FROM public.user_devices
)
DELETE FROM public.user_devices AS devices USING ranked
WHERE devices.user_id = ranked.user_id AND devices.device_id = ranked.device_id AND ranked.position > 32;

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
COMMENT ON TABLE public.user_devices IS
  'Best-effort browser diagnostics: up to 32 recent installations per account, server-enforced admission and hourly last-seen sampling. No IP, raw user agent, fingerprint or exact hardware model.';
COMMIT;

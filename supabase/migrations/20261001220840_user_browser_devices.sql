BEGIN;

-- A browser installation is identified by an anonymous cookie, not a fingerprint.
CREATE TABLE public.user_devices (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  browser_name TEXT NOT NULL CHECK (char_length(browser_name) BETWEEN 1 AND 64),
  browser_version TEXT CHECK (char_length(browser_version) BETWEEN 1 AND 32),
  os_name TEXT NOT NULL CHECK (char_length(os_name) BETWEEN 1 AND 64),
  device_type TEXT NOT NULL CHECK (device_type IN ('phone', 'tablet', 'desktop', 'unknown')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_devices FROM anon, authenticated;
GRANT SELECT ON public.user_devices TO authenticated;
CREATE POLICY "Users can read their own browser devices" ON public.user_devices
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- No caller-supplied user ID or clock. Direct client mutations are disallowed.
CREATE FUNCTION public.record_user_device(
  p_device_id UUID, p_browser_name TEXT, p_browser_version TEXT,
  p_os_name TEXT, p_device_type TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.record_user_device(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_user_device(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON TABLE public.user_devices IS
  'Best-effort browser installation diagnostics. Authenticated page loads only; hourly last-seen sampling. No IP, raw user agent, fingerprint or exact hardware model. Cookie reset creates a new installation.';
COMMIT;

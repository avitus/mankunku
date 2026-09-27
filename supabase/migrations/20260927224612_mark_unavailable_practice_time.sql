-- Retain the original scalar for audit/recovery, but stop presenting the retired
-- two-minutes-per-attempt formula as elapsed time. Source snapshots supersede it.
ALTER TABLE public.daily_summaries
  ADD COLUMN practice_time_unavailable boolean NOT NULL DEFAULT false;

UPDATE public.daily_summaries
SET practice_time_unavailable = true, updated_at = now()
WHERE practice_time IS NULL AND session_count > 0
  AND practice_minutes::bigint = session_count::bigint * 2;

CREATE OR REPLACE FUNCTION public.mark_unknown_daily_practice_time() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Runs before preserve_daily_practice_time, which validates and merges sources.
  IF NEW.practice_time IS NOT NULL OR (TG_OP = 'UPDATE' AND OLD.practice_time IS NOT NULL) THEN
    NEW.practice_time_unavailable := false;
  ELSE
    NEW.practice_time_unavailable := NEW.practice_time_unavailable
      OR (NEW.session_count > 0 AND NEW.practice_minutes::bigint = NEW.session_count::bigint * 2);
    IF TG_OP = 'UPDATE' THEN
      -- A partial/stale writer cannot invalidate a usable cached duration just
      -- because its smaller report coincidentally matches the retired formula.
      IF NOT OLD.practice_time_unavailable
        AND NOT (OLD.session_count > 0 AND OLD.practice_minutes::bigint = OLD.session_count::bigint * 2)
        AND NEW.practice_time_unavailable
        AND NEW.ear_training_sessions <= OLD.ear_training_sessions
        AND NEW.lick_practice_sessions <= OLD.lick_practice_sessions THEN
        NEW.practice_time_unavailable := false;
        NEW.practice_minutes := OLD.practice_minutes;
      END IF;
      NEW.practice_time_unavailable := NEW.practice_time_unavailable OR OLD.practice_time_unavailable
        OR (OLD.session_count > 0 AND OLD.practice_minutes::bigint = OLD.session_count::bigint * 2);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mark_unknown_daily_practice_time
BEFORE INSERT OR UPDATE ON public.daily_summaries
FOR EACH ROW EXECUTE FUNCTION public.mark_unknown_daily_practice_time();

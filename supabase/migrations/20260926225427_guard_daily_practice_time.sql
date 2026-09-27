-- Serialize provenance selection at the row write, not just on clients which
-- may have read the same older row before either writer flushes.
CREATE FUNCTION public.preserve_daily_practice_time() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  old_covers_new boolean;
  new_covers_old boolean;
BEGIN
  IF NEW.practice_time IS NOT NULL AND NOT (CASE
    WHEN jsonb_typeof(NEW.practice_time) = 'object'
      AND jsonb_typeof(NEW.practice_time->'minutes') = 'number'
      AND jsonb_typeof(NEW.practice_time->'earTrainingSessions') = 'number'
      AND jsonb_typeof(NEW.practice_time->'lickPracticeSessions') = 'number'
    THEN
      (NEW.practice_time->>'minutes')::numeric BETWEEN 0 AND 2147483647
      AND (NEW.practice_time->>'minutes')::numeric = trunc((NEW.practice_time->>'minutes')::numeric)
      AND (NEW.practice_time->>'earTrainingSessions')::numeric >= 0
      AND (NEW.practice_time->>'earTrainingSessions')::numeric = trunc((NEW.practice_time->>'earTrainingSessions')::numeric)
      AND (NEW.practice_time->>'lickPracticeSessions')::numeric >= 0
      AND (NEW.practice_time->>'lickPracticeSessions')::numeric = trunc((NEW.practice_time->>'lickPracticeSessions')::numeric)
      AND (NEW.practice_time->>'earTrainingSessions')::numeric + (NEW.practice_time->>'lickPracticeSessions')::numeric BETWEEN 1 AND 2147483647
    ELSE false END
  ) THEN
    RAISE EXCEPTION 'Invalid practice-time provenance' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.practice_time IS NOT NULL THEN
    IF NEW.practice_time IS NULL THEN
      NEW.practice_time := OLD.practice_time;
    ELSE
      old_covers_new := (OLD.practice_time->>'earTrainingSessions')::integer >= (NEW.practice_time->>'earTrainingSessions')::integer
        AND (OLD.practice_time->>'lickPracticeSessions')::integer >= (NEW.practice_time->>'lickPracticeSessions')::integer;
      new_covers_old := (NEW.practice_time->>'earTrainingSessions')::integer >= (OLD.practice_time->>'earTrainingSessions')::integer
        AND (NEW.practice_time->>'lickPracticeSessions')::integer >= (OLD.practice_time->>'lickPracticeSessions')::integer;
      IF (old_covers_new AND NOT new_covers_old)
        OR (old_covers_new = new_covers_old AND (OLD.practice_time->>'minutes')::integer >= (NEW.practice_time->>'minutes')::integer) THEN
        NEW.practice_time := OLD.practice_time;
      END IF;
    END IF;
  END IF;

  IF NEW.practice_time IS NOT NULL THEN
    NEW.practice_minutes := (NEW.practice_time->>'minutes')::integer;
    NEW.ear_training_sessions := greatest(NEW.ear_training_sessions, (NEW.practice_time->>'earTrainingSessions')::integer);
    NEW.lick_practice_sessions := greatest(NEW.lick_practice_sessions, (NEW.practice_time->>'lickPracticeSessions')::integer);
    NEW.session_count := NEW.ear_training_sessions + NEW.lick_practice_sessions;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_daily_practice_time
BEFORE INSERT OR UPDATE ON public.daily_summaries
FOR EACH ROW EXECUTE FUNCTION public.preserve_daily_practice_time();

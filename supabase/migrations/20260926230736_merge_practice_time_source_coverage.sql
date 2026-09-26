-- Source-level correction coverage converges even when one device retained only
-- ear history and another retained only lick history. Uncovered attempts remain
-- estimates outside the snapshot, never a stale cached scalar baseline.
CREATE OR REPLACE FUNCTION public.preserve_daily_practice_time() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  incoming jsonb;
  previous jsonb;
  candidate jsonb;
  idx integer;
  ear_minutes numeric;
  lick_minutes numeric;
BEGIN
  FOR idx IN 1..2 LOOP
    candidate := CASE WHEN idx = 1 THEN NEW.practice_time WHEN TG_OP = 'UPDATE' THEN OLD.practice_time ELSE NULL END;
    IF candidate IS NULL THEN CONTINUE; END IF;
    IF NOT (CASE
      WHEN jsonb_typeof(candidate) = 'object'
        AND jsonb_typeof(candidate->'minutes') = 'number'
        AND jsonb_typeof(candidate->'earTrainingSessions') = 'number'
        AND jsonb_typeof(candidate->'lickPracticeSessions') = 'number'
      THEN (candidate->>'minutes')::numeric BETWEEN 0 AND 2147483647
        AND (candidate->>'minutes')::numeric = trunc((candidate->>'minutes')::numeric)
        AND (candidate->>'earTrainingSessions')::numeric >= 0
        AND (candidate->>'earTrainingSessions')::numeric = trunc((candidate->>'earTrainingSessions')::numeric)
        AND (candidate->>'lickPracticeSessions')::numeric >= 0
        AND (candidate->>'lickPracticeSessions')::numeric = trunc((candidate->>'lickPracticeSessions')::numeric)
        AND (candidate->>'earTrainingSessions')::numeric + (candidate->>'lickPracticeSessions')::numeric BETWEEN 1 AND 2147483647
      ELSE false END
    ) THEN
      RAISE EXCEPTION 'Invalid practice-time provenance' USING ERRCODE = '23514';
    END IF;
    IF NOT (candidate ? 'earMinutes') AND NOT (candidate ? 'lickMinutes') THEN
      ear_minutes := CASE WHEN (candidate->>'lickPracticeSessions')::integer = 0 THEN (candidate->>'minutes')::numeric
        ELSE least((candidate->>'minutes')::numeric, (candidate->>'earTrainingSessions')::numeric * 0.5) END;
      lick_minutes := (candidate->>'minutes')::numeric - ear_minutes;
    ELSE
      IF jsonb_typeof(candidate->'earMinutes') IS DISTINCT FROM 'number'
        OR jsonb_typeof(candidate->'lickMinutes') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Invalid practice-time provenance' USING ERRCODE = '23514';
      END IF;
      ear_minutes := (candidate->>'earMinutes')::numeric;
      lick_minutes := (candidate->>'lickMinutes')::numeric;
    END IF;
    IF ear_minutes < 0 OR lick_minutes < 0 OR round(ear_minutes + lick_minutes) <> (candidate->>'minutes')::numeric
      OR ((candidate->>'earTrainingSessions')::integer = 0 AND ear_minutes <> 0)
      OR ((candidate->>'lickPracticeSessions')::integer = 0 AND lick_minutes <> 0) THEN
      RAISE EXCEPTION 'Invalid practice-time provenance' USING ERRCODE = '23514';
    END IF;
    candidate := candidate || jsonb_build_object('earMinutes', ear_minutes, 'lickMinutes', lick_minutes);
    IF idx = 1 THEN incoming := candidate; ELSE previous := candidate; END IF;
  END LOOP;

  IF TG_OP = 'UPDATE' THEN
    NEW.ear_training_sessions := greatest(OLD.ear_training_sessions, NEW.ear_training_sessions);
    NEW.lick_practice_sessions := greatest(OLD.lick_practice_sessions, NEW.lick_practice_sessions);
    NEW.session_count := NEW.ear_training_sessions + NEW.lick_practice_sessions;
  END IF;
  IF incoming IS NULL THEN incoming := previous;
  ELSIF previous IS NOT NULL THEN
    IF (previous->>'earTrainingSessions')::integer > (incoming->>'earTrainingSessions')::integer
      OR ((previous->>'earTrainingSessions')::integer = (incoming->>'earTrainingSessions')::integer
        AND (previous->>'earMinutes')::numeric >= (incoming->>'earMinutes')::numeric) THEN
      incoming := incoming || jsonb_build_object('earTrainingSessions', previous->'earTrainingSessions', 'earMinutes', previous->'earMinutes');
    END IF;
    IF (previous->>'lickPracticeSessions')::integer > (incoming->>'lickPracticeSessions')::integer
      OR ((previous->>'lickPracticeSessions')::integer = (incoming->>'lickPracticeSessions')::integer
        AND (previous->>'lickMinutes')::numeric >= (incoming->>'lickMinutes')::numeric) THEN
      incoming := incoming || jsonb_build_object('lickPracticeSessions', previous->'lickPracticeSessions', 'lickMinutes', previous->'lickMinutes');
    END IF;
  END IF;
  IF incoming IS NOT NULL THEN
    incoming := incoming || jsonb_build_object('minutes', round((incoming->>'earMinutes')::numeric + (incoming->>'lickMinutes')::numeric));
    NEW.practice_time := incoming;
    NEW.ear_training_sessions := greatest(NEW.ear_training_sessions, (incoming->>'earTrainingSessions')::integer);
    NEW.lick_practice_sessions := greatest(NEW.lick_practice_sessions, (incoming->>'lickPracticeSessions')::integer);
    NEW.session_count := NEW.ear_training_sessions + NEW.lick_practice_sessions;
    NEW.practice_minutes := round((incoming->>'earMinutes')::numeric + (incoming->>'lickMinutes')::numeric
      + (NEW.ear_training_sessions - (incoming->>'earTrainingSessions')::integer
      + NEW.lick_practice_sessions - (incoming->>'lickPracticeSessions')::integer) * 0.5)::integer;
  END IF;
  RETURN NEW;
END;
$$;

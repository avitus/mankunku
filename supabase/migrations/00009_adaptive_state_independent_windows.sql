-- Add per-dimension score windows and cooldowns to adaptive_state default.
-- Remove xp field from adaptive_state default.

ALTER TABLE public.user_progress
  ALTER COLUMN adaptive_state SET DEFAULT '{
    "currentLevel": 1,
    "pitchComplexity": 1,
    "rhythmComplexity": 1,
    "recentScores": [],
    "recentPitchScores": [],
    "recentRhythmScores": [],
    "attemptsAtLevel": 0,
    "attemptsSinceChange": 0,
    "pitchAttemptsSinceChange": 0,
    "rhythmAttemptsSinceChange": 0
  }'::jsonb;

COMMENT ON COLUMN public.user_progress.adaptive_state IS
  'Adaptive difficulty state with independent pitch/rhythm score windows and cooldowns';

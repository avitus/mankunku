-- Keep corrected minutes with their source coverage. A legacy client can still
-- overwrite practice_minutes; it must not turn that scalar into verified time.
ALTER TABLE public.daily_summaries ADD COLUMN practice_time JSONB;
COMMENT ON COLUMN public.daily_summaries.practice_time IS
  'Source-derived {minutes, earTrainingSessions, lickPracticeSessions}; NULL for unverified historical estimates. Omitted on legacy writes.';

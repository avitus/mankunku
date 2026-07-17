-- =============================================================================
-- Migration: 00018_add_tonal_mastery
-- Purpose:   Add public.daily_summaries.tonal_mastery so the Tonal Mastery
--            snapshot (avg proficiency across all 12 scales + 12 keys, 0-100)
--            survives across devices as the primary trend-chart line.
--
-- Mirrors the optional DailySummary.tonalMastery field in
-- src/lib/types/progress.ts. Nullable — pre-feature days and lick-practice-only
-- days have no snapshot; the trend chart forward-fills / starts the line at the
-- first day a value exists. REAL (not INTEGER like pitch/rhythm complexity)
-- because mastery is a fine-grained average that moves in sub-integer steps.
-- =============================================================================

ALTER TABLE public.daily_summaries
  ADD COLUMN tonal_mastery REAL;

COMMENT ON COLUMN public.daily_summaries.tonal_mastery IS
  'Snapshot of Tonal Mastery (avg proficiency across all scales + keys, 0-100) at end of day. Nullable — pre-feature and lick-practice-only days have no snapshot.';

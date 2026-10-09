-- =============================================================================
-- Migration: add_session_results_audio_check
-- Purpose:   Persist the audio check shown beside a score (2026-10-07):
--            `scoring/frame-coverage.ts` reads the pitch detector's own
--            frames against the written line with no note pairing and
--            reports precision (how much of what sounded was the line) and
--            recall (how much of the line sounded). The note score averages
--            over the written notes only, so the two disagree exactly where
--            one of them is wrong; keeping the check with the row is what
--            lets that agreement be measured in production before the check
--            can gate a grade.
--
-- Shape:     { precision: number, recall: number, soundedFrames: number,
--              expectedNotes: number } — the `AudioCheck` interface; NULL on
--            rows scored before the column existed or by a path that did not
--            hand the pipeline its readings.
--
-- Safe:      nullable, no default, no backfill; old clients ignore it and
--            new clients tolerate NULL (`SessionResult.audioCheck` is optional).
-- =============================================================================

ALTER TABLE public.session_results
  ADD COLUMN IF NOT EXISTS audio_check JSONB;

COMMENT ON COLUMN public.session_results.audio_check IS
  'Audio check beside the score: frame-level precision/recall of the pitch readings against the written line (scoring/frame-coverage.ts). NULL before 2026-10-07.';

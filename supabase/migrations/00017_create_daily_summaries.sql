-- =============================================================================
-- Migration: 00017_create_daily_summaries
-- Purpose:   Add public.daily_summaries so the per-day practice aggregates
--            (calendar heatmap, trend chart, period comparison) survive across
--            devices and across the MAX_SESSIONS pruning window.
--
-- Mirrors the DailySummary TypeScript interface from src/lib/types/progress.ts.
-- Composite PK on (user_id, date) — one row per user per local day.
--
-- Design notes:
--   - `date` is stored as TEXT in 'YYYY-MM-DD' (local) format, matching
--     localDateStr() in src/lib/state/history.svelte.ts. We deliberately
--     avoid DATE because the client computes day boundaries in the user's
--     own timezone; storing as the same string the client wrote eliminates
--     any timezone-conversion ambiguity on read-back.
--   - ear_training_sessions + lick_practice_sessions are tracked separately
--     so the calendar can render a split fill. session_count remains the
--     total for backward compatibility with existing read-paths.
--   - pitch_complexity / rhythm_complexity are nullable: lick-practice-only
--     days have no adaptive snapshot. Trend chart forward-fills from the
--     most recent prior day with a snapshot.
-- =============================================================================

CREATE TABLE public.daily_summaries (
  user_id                UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date                   TEXT        NOT NULL,
  session_count          INTEGER     NOT NULL DEFAULT 0,
  ear_training_sessions  INTEGER     NOT NULL DEFAULT 0,
  lick_practice_sessions INTEGER     NOT NULL DEFAULT 0,
  practice_minutes       INTEGER     NOT NULL DEFAULT 0,
  avg_overall            REAL        NOT NULL DEFAULT 0,
  avg_pitch              REAL        NOT NULL DEFAULT 0,
  avg_rhythm             REAL        NOT NULL DEFAULT 0,
  best_score             REAL        NOT NULL DEFAULT 0,
  notes_total            INTEGER     NOT NULL DEFAULT 0,
  notes_hit              INTEGER     NOT NULL DEFAULT 0,
  grades                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  categories             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  pitch_complexity       INTEGER,
  rhythm_complexity      INTEGER,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

CREATE INDEX idx_daily_summaries_user_date
  ON public.daily_summaries(user_id, date DESC);

COMMENT ON TABLE public.daily_summaries IS
  'Per-day practice aggregates (many:1 with auth.users). Mirrors DailySummary TS interface. Survives session-log pruning so calendar/trend history is preserved across devices.';
COMMENT ON COLUMN public.daily_summaries.date IS
  'Local date string in YYYY-MM-DD format. Computed client-side via localDateStr() in the user''s own timezone.';
COMMENT ON COLUMN public.daily_summaries.session_count IS
  'Total scored attempts on this date (ear-training + lick-practice).';
COMMENT ON COLUMN public.daily_summaries.ear_training_sessions IS
  'Scored ear-training attempts on this date.';
COMMENT ON COLUMN public.daily_summaries.lick_practice_sessions IS
  'Scored lick-practice key attempts on this date.';
COMMENT ON COLUMN public.daily_summaries.pitch_complexity IS
  'Adaptive pitchComplexity snapshot at end of day. Nullable — lick-practice-only days have no snapshot.';
COMMENT ON COLUMN public.daily_summaries.rhythm_complexity IS
  'Adaptive rhythmComplexity snapshot at end of day. Nullable — lick-practice-only days have no snapshot.';


-- ── Row Level Security ────────────────────────────────────────────────

ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily summaries"
  ON public.daily_summaries
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own daily summaries"
  ON public.daily_summaries
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own daily summaries"
  ON public.daily_summaries
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own daily summaries"
  ON public.daily_summaries
  FOR DELETE
  USING (user_id = auth.uid());


-- ── updated_at auto-update trigger ────────────────────────────────────
-- Reuses public.update_updated_at_column() defined in migration 00001.

CREATE TRIGGER update_daily_summaries_updated_at
  BEFORE UPDATE ON public.daily_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

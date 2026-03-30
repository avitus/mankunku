-- =============================================================================
-- Migration: 00002_create_user_progress
-- Purpose:   Create FOUR interrelated progress-tracking tables that mirror the
--            TypeScript interfaces from src/lib/types/progress.ts. These tables
--            replace the localStorage-based persistence managed by
--            src/lib/state/progress.svelte.ts and enable cross-device progress
--            synchronisation for authenticated users.
--
-- Tables created:
--   1. public.user_progress       — aggregate progress (1:1 with auth.users)
--   2. public.session_results     — individual practice session outcomes (many:1)
--   3. public.scale_proficiency   — per-scale proficiency tracking (many:1)
--   4. public.key_proficiency     — per-key proficiency tracking (many:1)
--
-- Depends on:
--   - auth.users (Supabase built-in)
--   - public.update_updated_at_column() — created in migration 00001
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Phase 1: Create public.user_progress table
-- ---------------------------------------------------------------------------
-- One row per user. Stores aggregate progress data mirroring the UserProgress
-- interface (src/lib/types/progress.ts lines 70-83).
--
-- Design decisions:
--   - PK is user_id (UUID) establishing a strict 1:1 with auth.users
--   - adaptive_state is JSONB rather than individual columns because it mirrors
--     the AdaptiveState interface which changes as a unit
--   - category_progress and key_progress are JSONB maps matching the TypeScript
--     Record<> types for flexible key-value storage
--   - updated_at is used for sync conflict resolution (last-write-wins strategy)
--   - ON DELETE CASCADE ensures clean user deletion
--   - JSONB default for adaptive_state matches createInitialAdaptiveState()
--     from src/lib/difficulty/adaptive.ts
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_progress (
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  adaptive_state     JSONB       NOT NULL DEFAULT '{
    "currentLevel": 1,
    "pitchComplexity": 1,
    "rhythmComplexity": 1,
    "recentScores": [],
    "attemptsAtLevel": 0,
    "attemptsSinceChange": 0,
    "xp": 0
  }'::jsonb,
  total_practice_time INTEGER    NOT NULL DEFAULT 0,
  streak_days         INTEGER    NOT NULL DEFAULT 0,
  last_practice_date  TEXT       NOT NULL DEFAULT '',
  category_progress   JSONB      NOT NULL DEFAULT '{}'::jsonb,
  key_progress        JSONB      NOT NULL DEFAULT '{}'::jsonb,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

-- Descriptive comments for documentation and database introspection
COMMENT ON TABLE public.user_progress IS
  'Aggregate user progress data (1:1 with auth.users). Mirrors the UserProgress TypeScript interface.';
COMMENT ON COLUMN public.user_progress.user_id IS
  'Primary key — same UUID as auth.users.id (1:1 relationship).';
COMMENT ON COLUMN public.user_progress.adaptive_state IS
  'JSONB blob mirroring AdaptiveState interface: currentLevel, pitchComplexity, rhythmComplexity, recentScores[], attemptsAtLevel, attemptsSinceChange, xp.';
COMMENT ON COLUMN public.user_progress.total_practice_time IS
  'Cumulative practice time in seconds.';
COMMENT ON COLUMN public.user_progress.streak_days IS
  'Consecutive practice days streak counter.';
COMMENT ON COLUMN public.user_progress.last_practice_date IS
  'ISO date string (YYYY-MM-DD) of the last practice session.';
COMMENT ON COLUMN public.user_progress.category_progress IS
  'JSONB map of PhraseCategory → CategoryProgress {category, attemptsTotal, averageScore, bestScore, lastAttempt}.';
COMMENT ON COLUMN public.user_progress.key_progress IS
  'JSONB map of PitchClass → {attempts: number, averageScore: number}.';
COMMENT ON COLUMN public.user_progress.updated_at IS
  'Last modification timestamp. Used for sync conflict resolution (last-write-wins).';


-- ---------------------------------------------------------------------------
-- Phase 2: Create public.session_results table
-- ---------------------------------------------------------------------------
-- Many rows per user (capped at 200 application-side, matching MAX_SESSIONS
-- constant from src/lib/state/progress.svelte.ts line 16). Mirrors the
-- SessionResult interface (src/lib/types/progress.ts lines 26-47).
--
-- Design decisions:
--   - PK is id (TEXT) — session identifier generated client-side as
--     `${Date.now()}-${random}` (see progress.svelte.ts line 105)
--   - user_id FK enables multi-user isolation and cascading deletion
--   - timestamp is BIGINT (milliseconds since epoch) matching JS Date.now()
--   - note_results is JSONB NOT NULL for the NoteResult[] array containing
--     complex nested scoring data (expected note, detected note, per-note scores)
--   - timing is nullable JSONB for optional TimingDiagnostics object
--   - scale_type is nullable TEXT for backward compatibility with sessions
--     recorded before scale tracking was added
--   - Numeric scores (pitch_accuracy, rhythm_accuracy, overall) use REAL
--     for 0-100 floating point accuracy values
--   - Two indexes optimise common query patterns: by user_id alone, and
--     by user_id + timestamp DESC for ordered session history retrieval
-- ---------------------------------------------------------------------------

CREATE TABLE public.session_results (
  id               TEXT    NOT NULL,
  user_id          UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamp        BIGINT  NOT NULL,
  phrase_id        TEXT    NOT NULL,
  phrase_name      TEXT    NOT NULL,
  category         TEXT    NOT NULL,
  key              TEXT    NOT NULL,
  scale_type       TEXT,
  tempo            INTEGER NOT NULL,
  difficulty_level INTEGER NOT NULL,
  pitch_accuracy   REAL    NOT NULL,
  rhythm_accuracy  REAL    NOT NULL,
  overall          REAL    NOT NULL,
  grade            TEXT    NOT NULL,
  notes_hit        INTEGER NOT NULL,
  notes_total      INTEGER NOT NULL,
  note_results     JSONB   NOT NULL DEFAULT '[]'::jsonb,
  timing           JSONB,
  PRIMARY KEY (id)
);

-- Index: efficient lookup of all sessions for a given user
CREATE INDEX idx_session_results_user_id
  ON public.session_results(user_id);

-- Index: ordered session history (newest first) per user — used by
-- getRecentSessions() and the progress dashboard
CREATE INDEX idx_session_results_user_timestamp
  ON public.session_results(user_id, timestamp DESC);

-- Descriptive comments for documentation
COMMENT ON TABLE public.session_results IS
  'Individual practice session outcomes (many:1 with auth.users). Mirrors the SessionResult TypeScript interface. Application-side cap of 200 per user.';
COMMENT ON COLUMN public.session_results.id IS
  'Session identifier generated client-side as ${Date.now()}-${random}.';
COMMENT ON COLUMN public.session_results.user_id IS
  'Foreign key to auth.users.id — multi-user isolation.';
COMMENT ON COLUMN public.session_results.timestamp IS
  'Unix timestamp in milliseconds (from Date.now()).';
COMMENT ON COLUMN public.session_results.phrase_id IS
  'Identifier of the phrase practised.';
COMMENT ON COLUMN public.session_results.phrase_name IS
  'Human-readable display name of the phrase.';
COMMENT ON COLUMN public.session_results.category IS
  'PhraseCategory union value (e.g. ii-V-I-major, blues, bebop-lines).';
COMMENT ON COLUMN public.session_results.key IS
  'PitchClass value for the session key (C, Db, D, ... B).';
COMMENT ON COLUMN public.session_results.scale_type IS
  'ScaleType identifier (e.g. dorian, major). Nullable for backward compatibility.';
COMMENT ON COLUMN public.session_results.tempo IS
  'Session tempo in BPM.';
COMMENT ON COLUMN public.session_results.difficulty_level IS
  'Difficulty level at time of session.';
COMMENT ON COLUMN public.session_results.pitch_accuracy IS
  'Pitch accuracy score (0-100).';
COMMENT ON COLUMN public.session_results.rhythm_accuracy IS
  'Rhythm accuracy score (0-100).';
COMMENT ON COLUMN public.session_results.overall IS
  'Combined overall score (0-100).';
COMMENT ON COLUMN public.session_results.grade IS
  'Grade string: perfect, great, good, fair, or try-again.';
COMMENT ON COLUMN public.session_results.notes_hit IS
  'Count of correctly matched notes.';
COMMENT ON COLUMN public.session_results.notes_total IS
  'Total expected notes in the phrase.';
COMMENT ON COLUMN public.session_results.note_results IS
  'JSONB array of NoteResult objects with per-note scoring breakdown.';
COMMENT ON COLUMN public.session_results.timing IS
  'Optional JSONB TimingDiagnostics: meanOffsetMs, medianOffsetMs, stdDevMs, latencyCorrectionMs, perNoteOffsetMs.';


-- ---------------------------------------------------------------------------
-- Phase 3: Create public.scale_proficiency table
-- ---------------------------------------------------------------------------
-- Per-scale proficiency tracking. Mirrors ScaleProficiency interface
-- (src/lib/types/progress.ts lines 5-11). Composite PK on (user_id, scale_id).
--
-- Design decisions:
--   - Composite PK (user_id, scale_id) — one row per user per scale type
--   - recent_scores uses PostgreSQL INTEGER[] array matching the TypeScript
--     number[] circular buffer (last 10 scores at current level)
--   - level defaults to 1 matching createInitialScaleProficiency()
--   - Counter columns (attempts_at_level, attempts_since_change, total_attempts)
--     all default to 0 matching initial state
-- ---------------------------------------------------------------------------

CREATE TABLE public.scale_proficiency (
  user_id              UUID      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scale_id             TEXT      NOT NULL,
  level                INTEGER   NOT NULL DEFAULT 1,
  recent_scores        INTEGER[] NOT NULL DEFAULT '{}',
  attempts_at_level    INTEGER   NOT NULL DEFAULT 0,
  attempts_since_change INTEGER  NOT NULL DEFAULT 0,
  total_attempts       INTEGER   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, scale_id)
);

-- Descriptive comments for documentation
COMMENT ON TABLE public.scale_proficiency IS
  'Per-scale proficiency tracking (many:1 with auth.users). Mirrors the ScaleProficiency TypeScript interface. Composite PK on (user_id, scale_id).';
COMMENT ON COLUMN public.scale_proficiency.user_id IS
  'Foreign key to auth.users.id — part of composite PK.';
COMMENT ON COLUMN public.scale_proficiency.scale_id IS
  'ScaleType identifier (e.g. dorian, major, mixolydian) — part of composite PK.';
COMMENT ON COLUMN public.scale_proficiency.level IS
  'Proficiency level 1-100. Defaults to 1 (beginner).';
COMMENT ON COLUMN public.scale_proficiency.recent_scores IS
  'Circular buffer of last 10 scores at current level (INTEGER array).';
COMMENT ON COLUMN public.scale_proficiency.attempts_at_level IS
  'Number of attempts at the current proficiency level.';
COMMENT ON COLUMN public.scale_proficiency.attempts_since_change IS
  'Attempts since last level change.';
COMMENT ON COLUMN public.scale_proficiency.total_attempts IS
  'Lifetime total attempts for this scale.';


-- ---------------------------------------------------------------------------
-- Phase 4: Create public.key_proficiency table
-- ---------------------------------------------------------------------------
-- Per-key proficiency tracking. Mirrors KeyProficiency interface
-- (src/lib/types/progress.ts lines 13-19). Composite PK on (user_id, key).
--
-- Design decisions:
--   - Composite PK (user_id, key) — one row per user per PitchClass
--   - Structure mirrors scale_proficiency for consistency
--   - PitchClass values: C, Db, D, Eb, E, F, Gb, G, Ab, A, Bb, B
--     (12 possible rows per user)
--   - Column "key" is quoted in indexes if needed since it is a SQL reserved
--     word — however PostgreSQL allows it as a column name without quoting
--     in CREATE TABLE and most contexts
-- ---------------------------------------------------------------------------

CREATE TABLE public.key_proficiency (
  user_id              UUID      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key                  TEXT      NOT NULL,
  level                INTEGER   NOT NULL DEFAULT 1,
  recent_scores        INTEGER[] NOT NULL DEFAULT '{}',
  attempts_at_level    INTEGER   NOT NULL DEFAULT 0,
  attempts_since_change INTEGER  NOT NULL DEFAULT 0,
  total_attempts       INTEGER   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key)
);

-- Descriptive comments for documentation
COMMENT ON TABLE public.key_proficiency IS
  'Per-key proficiency tracking (many:1 with auth.users). Mirrors the KeyProficiency TypeScript interface. Composite PK on (user_id, key).';
COMMENT ON COLUMN public.key_proficiency.user_id IS
  'Foreign key to auth.users.id — part of composite PK.';
COMMENT ON COLUMN public.key_proficiency.key IS
  'PitchClass value (C, Db, D, Eb, E, F, Gb, G, Ab, A, Bb, B) — part of composite PK.';
COMMENT ON COLUMN public.key_proficiency.level IS
  'Proficiency level 1-100. Defaults to 1 (beginner).';
COMMENT ON COLUMN public.key_proficiency.recent_scores IS
  'Circular buffer of last 10 scores at current level (INTEGER array).';
COMMENT ON COLUMN public.key_proficiency.attempts_at_level IS
  'Number of attempts at the current proficiency level.';
COMMENT ON COLUMN public.key_proficiency.attempts_since_change IS
  'Attempts since last level change.';
COMMENT ON COLUMN public.key_proficiency.total_attempts IS
  'Lifetime total attempts for this key.';


-- ---------------------------------------------------------------------------
-- Phase 5: Attach updated_at auto-update trigger to user_progress
-- ---------------------------------------------------------------------------
-- Reuses the public.update_updated_at_column() function created in
-- migration 00001_create_users_profile. That function is a shared utility
-- defined with CREATE OR REPLACE for safe reuse across migrations.
--
-- BEFORE UPDATE ensures the timestamp is set before the row is written,
-- enabling reliable last-write-wins conflict resolution in the sync layer.
-- ---------------------------------------------------------------------------

CREATE TRIGGER update_user_progress_updated_at
  BEFORE UPDATE ON public.user_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

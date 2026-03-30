-- =============================================================================
-- Migration: 00004_create_user_licks
-- Purpose:   Create the public.user_licks table for storing user-recorded
--            musical phrases. This table mirrors the TypeScript Phrase interface
--            from src/lib/types/music.ts and replaces the localStorage-based
--            persistence in src/lib/persistence/user-licks.ts.
--
--            Each user can record, name, and tag custom licks during practice.
--            Recorded licks are stored with full musical metadata (notes,
--            harmony, difficulty) plus an optional audio_url pointing to the
--            associated audio blob in Supabase Storage.
--
-- Depends on:
--   - auth.users (Supabase built-in)
--   - public.update_updated_at_column() — created in migration 00001
--
-- TypeScript source interfaces:
--   - Phrase          (src/lib/types/music.ts lines 59-71)
--   - Note            (src/lib/types/music.ts lines 24-35)
--   - HarmonicSegment (src/lib/types/music.ts lines 37-47)
--   - DifficultyMetadata (src/lib/types/music.ts lines 49-57)
--   - PhraseCategory  (src/lib/types/music.ts lines 13-17)
--   - PitchClass      (src/lib/types/music.ts line 2)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Phase 1: Create public.user_licks table
-- ---------------------------------------------------------------------------
-- Stores user-recorded musical phrases. Many rows per user (one per lick).
-- The Phrase interface maps to SQL columns as follows:
--
--   TypeScript Field          → SQL Column        SQL Type
--   ──────────────────────────────────────────────────────────
--   id: string                → id                TEXT PK
--   (auth context)            → user_id           UUID FK
--   name: string              → name              TEXT NOT NULL
--   timeSignature: [n, n]     → time_signature    INTEGER[2] NOT NULL
--   key: PitchClass           → key               TEXT NOT NULL
--   notes: Note[]             → notes             JSONB NOT NULL
--   harmony: HarmonicSegment[]→ harmony           JSONB NOT NULL
--   difficulty: DifficultyMeta→ difficulty         JSONB NOT NULL
--   category: PhraseCategory  → category          TEXT NOT NULL
--   tags: string[]            → tags              TEXT[] NOT NULL
--   source: string            → source            TEXT NOT NULL
--   (new for cloud)           → audio_url         TEXT (nullable)
--   (new for cloud)           → created_at        TIMESTAMPTZ NOT NULL
--   (new for cloud)           → updated_at        TIMESTAMPTZ NOT NULL
--
-- Design decisions:
--   - id is TEXT (not UUID) because user-licks.ts generates IDs client-side
--     using the pattern `user-{Date.now()}-{4-char-random}` (see generateId()
--     in src/lib/persistence/user-licks.ts line 11-18)
--   - user_id FK with ON DELETE CASCADE ensures automatic cleanup on account
--     deletion
--   - time_signature uses PostgreSQL INTEGER[] (2-element array) rather than
--     JSONB to match the TypeScript [number, number] tuple semantics while
--     keeping it queryable with array operators
--   - notes, harmony, and difficulty use JSONB because they contain complex
--     nested structures (Note[], HarmonicSegment[], DifficultyMetadata) that
--     are always read/written as complete units
--   - category defaults to 'user' and source defaults to 'user-recorded'
--     matching the normalisation in saveUserLick() (user-licks.ts lines 28-33)
--   - tags uses PostgreSQL TEXT[] array for efficient contains/overlap queries
--   - audio_url is nullable because recordings are optional — a user may
--     save note/harmony metadata without an audio blob
--   - created_at and updated_at are cloud-specific timestamps not present in
--     the original Phrase interface; updated_at enables last-write-wins sync
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_licks (
  id              TEXT          NOT NULL,
  user_id         UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT          NOT NULL,
  time_signature  INTEGER[2]    NOT NULL,
  key             TEXT          NOT NULL,
  notes           JSONB         NOT NULL DEFAULT '[]'::jsonb,
  harmony         JSONB         NOT NULL DEFAULT '[]'::jsonb,
  difficulty      JSONB         NOT NULL DEFAULT '{}'::jsonb,
  category        TEXT          NOT NULL DEFAULT 'user',
  tags            TEXT[]        NOT NULL DEFAULT '{}',
  source          TEXT          NOT NULL DEFAULT 'user-recorded',
  audio_url       TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- Descriptive comments for documentation and database introspection
COMMENT ON TABLE public.user_licks IS
  'User-recorded musical phrases (many:1 with auth.users). Mirrors the Phrase TypeScript interface from src/lib/types/music.ts. Replaces localStorage persistence from src/lib/persistence/user-licks.ts.';

COMMENT ON COLUMN public.user_licks.id IS
  'Primary key — generated client-side as user-{timestamp}-{random} (e.g. user-1716000000000-a3f2).';

COMMENT ON COLUMN public.user_licks.user_id IS
  'Foreign key to auth.users.id — multi-user isolation. ON DELETE CASCADE for automatic cleanup.';

COMMENT ON COLUMN public.user_licks.name IS
  'User-given display name for the recorded lick.';

COMMENT ON COLUMN public.user_licks.time_signature IS
  'Time signature as a 2-element INTEGER array, e.g. {4,4} for 4/4 time. Maps to TypeScript [number, number].';

COMMENT ON COLUMN public.user_licks.key IS
  'Musical key as a PitchClass value: C, Db, D, Eb, E, F, Gb, G, Ab, A, Bb, or B.';

COMMENT ON COLUMN public.user_licks.notes IS
  'JSONB array of Note objects. Each Note has: pitch (MIDI number or null for rest), duration ([num, den] fraction), offset ([num, den] fraction), velocity?, articulation?, scaleDegree?.';

COMMENT ON COLUMN public.user_licks.harmony IS
  'JSONB array of HarmonicSegment objects. Each has: chord {root, quality, bass?}, scaleId, startOffset, duration.';

COMMENT ON COLUMN public.user_licks.difficulty IS
  'JSONB DifficultyMetadata object with: level (1-100), pitchComplexity (1-100), rhythmComplexity (1-100), lengthBars.';

COMMENT ON COLUMN public.user_licks.category IS
  'PhraseCategory value. User-recorded licks always use ''user''. Default enforced in both DB and application layer.';

COMMENT ON COLUMN public.user_licks.tags IS
  'PostgreSQL TEXT array of user-assigned tags for filtering and organisation.';

COMMENT ON COLUMN public.user_licks.source IS
  'Origin of the lick. User recordings always use ''user-recorded''. Default enforced in both DB and application layer.';

COMMENT ON COLUMN public.user_licks.audio_url IS
  'Supabase Storage URL for the associated audio recording blob (e.g. recordings/{userId}/{id}.webm). Nullable — audio is optional.';

COMMENT ON COLUMN public.user_licks.created_at IS
  'Record creation timestamp. Defaults to now() on INSERT.';

COMMENT ON COLUMN public.user_licks.updated_at IS
  'Last modification timestamp. Auto-updated via trigger. Used for sync conflict resolution (last-write-wins).';


-- ---------------------------------------------------------------------------
-- Phase 2: Create index for user lookup
-- ---------------------------------------------------------------------------
-- Index on user_id enables efficient retrieval of all licks belonging to a
-- specific user — the primary query pattern for the library page and sync
-- operations. Without this index, every getUserLicks() call would require
-- a full table scan.
-- ---------------------------------------------------------------------------

CREATE INDEX idx_user_licks_user_id ON public.user_licks(user_id);


-- ---------------------------------------------------------------------------
-- Phase 3: Create updated_at auto-update trigger
-- ---------------------------------------------------------------------------
-- Reuses the shared public.update_updated_at_column() function created in
-- migration 00001_create_users_profile. The function is re-declared here
-- with CREATE OR REPLACE for idempotency — if migration 00001 already
-- defined it, this is a safe no-op replacement with identical logic.
--
-- The trigger fires BEFORE UPDATE to ensure updated_at is set before the
-- row is written, enabling reliable last-write-wins conflict resolution
-- in the sync layer (src/lib/persistence/sync.ts).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_licks_updated_at
  BEFORE UPDATE ON public.user_licks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

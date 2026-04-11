-- =============================================================================
-- Migration: 00010_create_lick_metadata.sql
-- Purpose:   Create the public.user_lick_metadata table for cross-device
--            synchronization of lick practice metadata that was previously
--            stored only in localStorage.
--
-- Stores four JSONB blobs per user:
--   1. lick_tags          — practice tags and progression tags
--                           (Record<phraseId, string[]>)
--   2. practice_progress  — per-lick per-key tempo/pass history
--                           (Record<phraseId, Record<PitchClass, KeyProgress>>)
--   3. tag_overrides      — tag modifications for curated licks
--                           (Record<lickId, string[]>)
--   4. category_overrides — category modifications for curated licks
--                           (Record<lickId, PhraseCategory>)
--
-- Depends on:
--   - auth.users (Supabase built-in)
--   - update_updated_at_column() trigger function (migration 00001)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Phase 1: Create public.user_lick_metadata table
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_lick_metadata (
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lick_tags           JSONB       NOT NULL DEFAULT '{}',
  practice_progress   JSONB       NOT NULL DEFAULT '{}',
  tag_overrides       JSONB       NOT NULL DEFAULT '{}',
  category_overrides  JSONB       NOT NULL DEFAULT '{}',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

COMMENT ON TABLE public.user_lick_metadata IS
  'Per-user lick practice metadata. One row per user. JSONB columns store data '
  'that was previously localStorage-only, enabling cross-device sync.';

COMMENT ON COLUMN public.user_lick_metadata.lick_tags IS
  'Practice tags and progression tags. Shape: Record<phraseId, string[]>. '
  'Tags include "practice" and "prog:<type>" entries.';

COMMENT ON COLUMN public.user_lick_metadata.practice_progress IS
  'Per-lick per-key practice progress. Shape: Record<phraseId, Record<PitchClass, '
  '{currentTempo, lastPracticedAt, passCount}>>.';

COMMENT ON COLUMN public.user_lick_metadata.tag_overrides IS
  'Tag overrides for curated licks. Shape: Record<lickId, string[]>.';

COMMENT ON COLUMN public.user_lick_metadata.category_overrides IS
  'Category overrides for curated licks. Shape: Record<lickId, PhraseCategory>.';

-- ---------------------------------------------------------------------------
-- Phase 2: Enable RLS and create access policies
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_lick_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own lick metadata"
  ON public.user_lick_metadata FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own lick metadata"
  ON public.user_lick_metadata FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lick metadata"
  ON public.user_lick_metadata FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own lick metadata"
  ON public.user_lick_metadata FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Phase 3: Create updated_at auto-update trigger
-- ---------------------------------------------------------------------------

CREATE TRIGGER update_user_lick_metadata_updated_at
  BEFORE UPDATE ON public.user_lick_metadata
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

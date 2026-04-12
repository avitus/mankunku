-- =============================================================================
-- Migration: 00011_add_new_lick_starting_tempo.sql
-- Purpose:   Add new_lick_starting_tempo column to public.user_settings.
--            Mirrors the TypeScript defaultSettings.newLickStartingTempo (60).
-- =============================================================================

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS new_lick_starting_tempo INTEGER NOT NULL DEFAULT 60;

ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_new_lick_starting_tempo_chk
    CHECK (new_lick_starting_tempo BETWEEN 40 AND 200);

COMMENT ON COLUMN public.user_settings.new_lick_starting_tempo IS
  'Starting BPM for licks with no prior practice history. Range 40–200, default 60.';

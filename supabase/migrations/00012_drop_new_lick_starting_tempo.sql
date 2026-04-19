-- =============================================================================
-- Migration: 00012_drop_new_lick_starting_tempo.sql
-- Purpose:   Remove the new_lick_starting_tempo column from public.user_settings.
--            The app no longer exposes a user-configurable starting tempo; all
--            new licks now start at the module constant NEW_LICK_DEFAULT_TEMPO
--            (60 BPM, see src/lib/persistence/lick-practice-store.ts).
-- =============================================================================

ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_new_lick_starting_tempo_chk;

ALTER TABLE public.user_settings
  DROP COLUMN IF EXISTS new_lick_starting_tempo;

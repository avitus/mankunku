-- =============================================================================
-- Migration: 00003_create_user_settings.sql
-- Purpose:   Create the public.user_settings table mirroring the TypeScript
--            Settings interface from src/lib/state/settings.svelte.ts.
--            Each user has exactly one settings row (1:1 with auth.users).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Phase 1: Create public.user_settings table
-- ---------------------------------------------------------------------------
-- Column defaults match the TypeScript defaultSettings object exactly:
--   instrumentId:       'tenor-sax'
--   defaultTempo:       100
--   masterVolume:       0.8
--   metronomeEnabled:   true
--   metronomeVolume:    0.7
--   swing:              0.5  (range 0.5 straight → 0.8 heavy swing)
--   theme:              'dark'
--   onboardingComplete: false
--   tonalityOverride:   null
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_settings (
  user_id             UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instrument_id       TEXT          NOT NULL DEFAULT 'tenor-sax',
  default_tempo       INTEGER       NOT NULL DEFAULT 100,
  master_volume       REAL          NOT NULL DEFAULT 0.8,
  metronome_enabled   BOOLEAN       NOT NULL DEFAULT true,
  metronome_volume    REAL          NOT NULL DEFAULT 0.7,
  swing               REAL          NOT NULL DEFAULT 0.5,
  theme               TEXT          NOT NULL DEFAULT 'dark',
  onboarding_complete BOOLEAN       NOT NULL DEFAULT false,
  tonality_override   JSONB,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_default_tempo_chk CHECK (default_tempo > 0),
  CONSTRAINT user_settings_master_volume_chk CHECK (master_volume BETWEEN 0 AND 1),
  CONSTRAINT user_settings_metronome_volume_chk CHECK (metronome_volume BETWEEN 0 AND 1),
  CONSTRAINT user_settings_swing_chk CHECK (swing BETWEEN 0.5 AND 0.8),
  CONSTRAINT user_settings_theme_chk CHECK (theme IN ('dark', 'light')),
  PRIMARY KEY (user_id)
);
);

-- Add a comment on the table for documentation
COMMENT ON TABLE public.user_settings IS
  'Per-user application settings. One row per user, mirrors the TypeScript Settings interface.';

COMMENT ON COLUMN public.user_settings.user_id IS
  'Primary key and foreign key to auth.users(id). Establishes 1:1 relationship.';

COMMENT ON COLUMN public.user_settings.instrument_id IS
  'Instrument identifier matching INSTRUMENTS record keys (e.g. tenor-sax, alto-sax, trumpet).';

COMMENT ON COLUMN public.user_settings.default_tempo IS
  'Default practice tempo in BPM.';

COMMENT ON COLUMN public.user_settings.master_volume IS
  'Master volume level, range 0.0 to 1.0.';

COMMENT ON COLUMN public.user_settings.metronome_enabled IS
  'Whether the metronome is enabled during practice.';

COMMENT ON COLUMN public.user_settings.metronome_volume IS
  'Metronome volume level, range 0.0 to 1.0.';

COMMENT ON COLUMN public.user_settings.swing IS
  'Swing amount: 0.5 = straight, up to 0.8 = heavy swing.';

COMMENT ON COLUMN public.user_settings.theme IS
  'UI theme: dark or light.';

COMMENT ON COLUMN public.user_settings.onboarding_complete IS
  'Whether the user has completed the first-run onboarding wizard.';

COMMENT ON COLUMN public.user_settings.tonality_override IS
  'Optional JSON override for the daily tonality. NULL means use auto-selected daily tonality.';

COMMENT ON COLUMN public.user_settings.updated_at IS
  'Timestamp of last update, used for cross-device sync conflict resolution.';

-- ---------------------------------------------------------------------------
-- Phase 2: Create updated_at auto-update trigger
-- ---------------------------------------------------------------------------
-- The update_updated_at_column() function is created with CREATE OR REPLACE
-- so it is idempotent — if migration 00001 already defined it, this is a no-op.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

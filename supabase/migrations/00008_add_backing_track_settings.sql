-- =============================================================================
-- Migration: 00008_add_backing_track_settings.sql
-- Purpose:   Add backing track settings columns to public.user_settings.
--            Mirrors the TypeScript defaultSettings: backingTrackEnabled (true),
--            backingInstrument ('piano'), backingTrackVolume (0.6).
-- =============================================================================

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS backing_track_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS backing_instrument    TEXT    NOT NULL DEFAULT 'piano',
  ADD COLUMN IF NOT EXISTS backing_track_volume  REAL    NOT NULL DEFAULT 0.6;

ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_backing_instrument_chk
    CHECK (backing_instrument IN ('piano', 'organ')),
  ADD CONSTRAINT user_settings_backing_track_volume_chk
    CHECK (backing_track_volume BETWEEN 0 AND 1);

COMMENT ON COLUMN public.user_settings.backing_track_enabled IS
  'Whether the jazz backing track (bass, drums, comping) is enabled during practice.';

COMMENT ON COLUMN public.user_settings.backing_instrument IS
  'Comping instrument for the backing track: piano or organ.';

COMMENT ON COLUMN public.user_settings.backing_track_volume IS
  'Backing track volume level, range 0.0 to 1.0.';

-- =============================================================================
-- Migration: 00016_add_tour_state.sql
-- Purpose:   Add tour_state JSONB column to public.user_settings to persist
--            guided tour completion across devices.
--
--            Shape of tour_state:
--              {
--                "completed": [tourId, ...],
--                "dismissed": [tourId, ...]
--              }
--            Both arrays are deduplicated string lists. The default empty
--            object means "no tours seen", so existing rows behave identically
--            to a fresh user without any code change.
-- =============================================================================

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS tour_state JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_settings.tour_state IS
  'JSONB record of guided tour completion: { completed: string[], dismissed: string[] }. Empty object = no tours seen.';

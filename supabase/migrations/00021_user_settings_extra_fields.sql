-- =============================================================================
-- Migration: 00021_user_settings_extra_fields
-- Purpose:   Add the two Settings fields that existed only in local state and
--            were therefore reset to their defaults on every authenticated
--            hydration (cloud-wins with no column to write them to):
--              - backing_style       (BackingStyle: swing|bossa-nova|ballad|straight)
--              - bleed_filter_enabled (A/B toggle for bleed-filtered scoring)
--
-- Nullable, no default: the client coalesces NULL to its own defaults
-- ('swing' / false), so old clients and pre-migration rows are unaffected.
--
-- Depends on:
--   - public.user_settings (migration 00003)
-- =============================================================================

ALTER TABLE public.user_settings
  ADD COLUMN backing_style        TEXT,
  ADD COLUMN bleed_filter_enabled BOOLEAN;

COMMENT ON COLUMN public.user_settings.backing_style IS
  'Backing-track rhythmic feel: swing | bossa-nova | ballad | straight. '
  'Nullable — client coalesces NULL to ''swing''.';

COMMENT ON COLUMN public.user_settings.bleed_filter_enabled IS
  'When true, use bleed-filtered notes as the primary score (A/B testing '
  'toggle). Nullable — client coalesces NULL to false.';

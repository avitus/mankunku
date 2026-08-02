-- =============================================================================
-- Migration: 20260802203809_add_trick_state.sql
-- Purpose:   Add trick_state JSONB column to public.user_settings to persist
--            trick (melodic-device) practice state across devices.
--
--            Shape of trick_state:
--              {
--                "selectedVariants": [variantKey, ...],
--                "selectedUpdatedAt": epochMillis,
--                "migrations": [markerName, ...],
--                "progress": { variantKey: { pitchClass: { currentTempo,
--                              lastPracticedAt, passCount } } },
--                "unlockCounts": { variantKey: number },
--                "history": { variantKey: [{ t, bpm, keys }, ...] }
--              }
--            Variant keys are the composite `${trickId}:${paramSignature}`
--            progress keys from src/lib/types/tricks.ts. The default empty
--            object means "no trick practice yet", so existing rows behave
--            identically to a fresh user without any code change.
-- =============================================================================

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS trick_state JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_settings.trick_state IS
  'JSONB record of trick practice state: { selectedVariants: string[], selectedUpdatedAt: number, migrations: string[], progress: {}, unlockCounts: {}, history: {} }. Empty object = no trick practice yet.';

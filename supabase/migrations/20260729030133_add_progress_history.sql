-- =============================================================================
-- Migration: add_progress_history
-- Purpose:   Add the `progress_history` JSONB column to user_lick_metadata so the
--            per-lick BPM / keys-unlocked time series (which powers the library
--            detail-page progress graph) syncs across devices alongside the
--            other lick-practice metadata blobs.
--
-- Shape: Record<lickId, LickProgressPoint[]> where
--        LickProgressPoint = { t: number; bpm: number; keys: number }.
--        Append-only; merged by a pure per-timestamp union (no LWW), so it is
--        commutative and idempotent and cannot lose points on a cross-device
--        merge. See lick-metadata-merge.ts (unionHistory).
--
-- Depends on:
--   - public.user_lick_metadata (migration 00010)
-- =============================================================================

ALTER TABLE public.user_lick_metadata
  ADD COLUMN progress_history JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.user_lick_metadata.progress_history IS
  'Per-lick append-only BPM/keys-unlocked time series for the detail-page '
  'progress graph. Shape: Record<lickId, {t,bpm,keys}[]>. Merged by per-'
  'timestamp union (append-only, no LWW); missing/null resolves to {}.';

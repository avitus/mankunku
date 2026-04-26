-- =============================================================================
-- Migration: 00015_add_unlock_counts.sql
-- Purpose:   Add the `unlock_counts` JSONB column to user_lick_metadata so the
--            per-lick gradual key-unlock state syncs across devices alongside
--            the other lick practice metadata blobs.
--
-- Shape: Record<lickId, number> (each value clamped at runtime to [1, 12]).
--
-- Depends on:
--   - public.user_lick_metadata (migration 00010)
-- =============================================================================

ALTER TABLE public.user_lick_metadata
  ADD COLUMN unlock_counts JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.user_lick_metadata.unlock_counts IS
  'Per-lick unlocked-key count for the gradual 1→12 key progression in '
  'lick practice. Shape: Record<lickId, number>. Values are clamped at '
  'runtime to [1, 12]; missing entries are resolved by getUnlockedKeyCount '
  '(grandfather fallback if practice_progress has all 12 keys, else 1).';

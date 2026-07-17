-- =============================================================================
-- Migration: 00020_lick_metadata_merge_meta
-- Purpose:   Carry per-entry recency + reset-tombstone maps for the lick
--            metadata JSONB blobs so cross-device sync can merge per lick id
--            instead of replacing an entire column (whole-column last-writer-wins
--            was silently dropping other devices' tags / progress / unlocks).
--
-- Shape (all sub-maps keyed by lick id → client mtime in ms):
--   {
--     "tags":          { "<lickId>": <mtime> },   -- lick_tags per-id LWW
--     "overrides":     { "<lickId>": <mtime> },   -- tag_overrides per-id LWW
--     "catOverrides":  { "<lickId>": <mtime> },   -- category_overrides per-id LWW
--     "progressResets":{ "<lickId>": <mtime> },   -- practice_progress reset tombstones
--     "unlockResets":  { "<lickId>": <mtime> }    -- unlock_counts reset tombstones
--   }
--
-- The client reads the cloud row, merges each keyed-by-id map against local
-- using these mtimes (and monotonic domain signals where they exist —
-- lastPracticedAt / passCount / unlock count), then writes the merged result
-- back. The reserved "__migrations" tag key is ALWAYS unioned (never LWW,
-- never dropped) so the prog-backfill-v1 marker cannot be erased.
--
-- Backward compatibility: NOT NULL DEFAULT '{}'. Old clients never read or write
-- this column; their whole-column writes remain the pre-existing (unchanged)
-- behaviour until every client is upgraded.
--
-- Depends on:
--   - public.user_lick_metadata (migration 00010, 00015)
-- =============================================================================

ALTER TABLE public.user_lick_metadata
  ADD COLUMN merge_meta JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.user_lick_metadata.merge_meta IS
  'Per-entry merge metadata for cross-device reconciliation of the keyed-by-id '
  'metadata blobs. Sub-maps (tags/overrides/catOverrides/progressResets/'
  'unlockResets) map lick id → client mtime (ms). Enables per-lick merge instead '
  'of whole-column last-writer-wins. Written only by clients that support the '
  'per-entry merge; defaults to {}.';

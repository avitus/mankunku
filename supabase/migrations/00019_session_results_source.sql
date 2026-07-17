-- =============================================================================
-- Migration: 00019_session_results_source
-- Purpose:   Persist SessionResult.source ('ear-training' | 'lick-practice') on
--            session_results so a device that hydrates its history from the
--            cloud can rebuild per-scale / per-key proficiency correctly.
--
-- Background: SessionResult.source is written locally (progress.svelte.ts) and
--            drives migrateScaleProficiency / migrateKeyProficiency, which SKIP
--            lick-practice sessions. Before this column the field was dropped on
--            every cloud round-trip, so after a device migration those replays
--            counted lick-practice sessions as ear-training and polluted the
--            key/scale unlock model.
--
-- Nullable + no default: pre-migration rows and old clients that omit the column
-- read back as NULL, which the mappers coalesce to 'ear-training' (the historical
-- default for sessions written before lick-practice existed). Fully backward
-- compatible during the CI auto-deploy window.
--
-- Depends on:
--   - public.session_results (migration 00002)
-- =============================================================================

ALTER TABLE public.session_results
  ADD COLUMN source TEXT;

COMMENT ON COLUMN public.session_results.source IS
  'Origin of the session: ''ear-training'' or ''lick-practice''. Nullable — '
  'rows written before this column (or by old clients) read back as NULL and '
  'are treated as ''ear-training'' by the client mappers, matching the '
  'pre-lick-practice default.';

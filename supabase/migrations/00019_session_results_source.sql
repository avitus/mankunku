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

-- Enforce the documented allowed values while staying nullable for old-client
-- compatibility (old clients omit the column → NULL). Rejects arbitrary strings
-- so the ear-training/lick-practice exclusion logic can't be bypassed.
--
-- NOT VALID: skips the full-table validation scan that would otherwise take a
-- lock and block writes on a live session_results. It's safe to skip here —
-- every existing row has source = NULL (the column was just added above), so
-- there is nothing to validate; the constraint is still enforced on all future
-- writes. (A later `VALIDATE CONSTRAINT` in a maintenance window is therefore
-- unnecessary, but harmless if desired.)
ALTER TABLE public.session_results
  ADD CONSTRAINT session_results_source_check
  CHECK (source IS NULL OR source IN ('ear-training', 'lick-practice')) NOT VALID;

COMMENT ON COLUMN public.session_results.source IS
  'Origin of the session: ''ear-training'' or ''lick-practice''. Nullable — '
  'rows written before this column (or by old clients) read back as NULL and '
  'are treated as ''ear-training'' by the client mappers, matching the '
  'pre-lick-practice default.';

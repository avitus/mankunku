-- ============================================================================
-- Migration: rename_lead_sheets_to_tunes
-- Purpose:  Product-wide nomenclature change: "lead sheets" are now "tunes".
--           Renames every schema object of the lead-sheet family created in
--           20260722202042/20260722202043 — tables, the sheet_id columns,
--           constraints, indexes, triggers, functions, policies, view — and
--           creates the new `tunes` storage bucket.
--
-- Rename semantics relied on here:
--   - ALTER TABLE ... RENAME keeps indexes/constraints/triggers/policies
--     attached under their OLD names; each gets its own rename below.
--   - View definitions, policy predicates, and partial-index predicates are
--     stored as parse trees keyed by OID/attnum — they track table and
--     column renames automatically (e.g. the adoptions INSERT policy's
--     NOT EXISTS self-heals). Only their NAMES need changing.
--   - plpgsql function BODIES are raw text and do NOT track renames, so the
--     three trigger functions are renamed (preserving their OID, which keeps
--     the already-attached triggers pointing at them) and then REPLACED with
--     corrected bodies, restating SECURITY DEFINER + pinned search_path.
--   - RENAME CONSTRAINT on a PK also renames its backing index.
--
-- Storage: the bucket is NOT renamed via SQL — updating storage.buckets/
--   storage.objects orphans the physical objects (the backend key embeds the
--   bucket id; see github.com/supabase/supabase/discussions/3446). Instead
--   the new `tunes` bucket + policies are created here; existing objects are
--   copied once post-deploy via the Storage API, after which the empty
--   `lead-sheets` bucket and its four policies get a small cleanup migration.
--
-- Client counterpart: localStorage schema v3 (namespace.ts) renames the
--   persisted keys and rewrites the queued outbox intent in the same deploy.
--
-- Rollback notes (manual): reverse every RENAME below; the function bodies
--   must then be re-pointed at the lead_sheet names by hand.
-- ============================================================================

-- ── (a) Tables ──────────────────────────────────────────────────────────────

ALTER TABLE public.lead_sheets           RENAME TO tunes;
ALTER TABLE public.lead_sheet_favorites  RENAME TO tune_favorites;
ALTER TABLE public.lead_sheet_adoptions  RENAME TO tune_adoptions;

-- ── (b) Columns ─────────────────────────────────────────────────────────────

ALTER TABLE public.tune_favorites RENAME COLUMN sheet_id TO tune_id;
ALTER TABLE public.tune_adoptions RENAME COLUMN sheet_id TO tune_id;

-- ── (c) Constraints (PK renames carry their backing indexes) ────────────────

ALTER TABLE public.tunes          RENAME CONSTRAINT lead_sheets_pkey                   TO tunes_pkey;
ALTER TABLE public.tunes          RENAME CONSTRAINT lead_sheets_user_id_fkey           TO tunes_user_id_fkey;
ALTER TABLE public.tune_favorites RENAME CONSTRAINT lead_sheet_favorites_pkey          TO tune_favorites_pkey;
ALTER TABLE public.tune_favorites RENAME CONSTRAINT lead_sheet_favorites_user_id_fkey  TO tune_favorites_user_id_fkey;
ALTER TABLE public.tune_favorites RENAME CONSTRAINT lead_sheet_favorites_sheet_id_fkey TO tune_favorites_tune_id_fkey;
ALTER TABLE public.tune_adoptions RENAME CONSTRAINT lead_sheet_adoptions_pkey          TO tune_adoptions_pkey;
ALTER TABLE public.tune_adoptions RENAME CONSTRAINT lead_sheet_adoptions_user_id_fkey  TO tune_adoptions_user_id_fkey;
ALTER TABLE public.tune_adoptions RENAME CONSTRAINT lead_sheet_adoptions_sheet_id_fkey TO tune_adoptions_tune_id_fkey;

-- ── (d) Indexes ─────────────────────────────────────────────────────────────

ALTER INDEX public.idx_lead_sheets_user_id           RENAME TO idx_tunes_user_id;
ALTER INDEX public.idx_lead_sheets_live              RENAME TO idx_tunes_live;
ALTER INDEX public.idx_lead_sheets_popularity        RENAME TO idx_tunes_popularity;
ALTER INDEX public.idx_lead_sheet_favorites_sheet_id RENAME TO idx_tune_favorites_tune_id;
ALTER INDEX public.idx_lead_sheet_adoptions_user_id  RENAME TO idx_tune_adoptions_user_id;

-- ── (e) Triggers ────────────────────────────────────────────────────────────
-- update_updated_at_column() is SHARED with the lick tables — not renamed.

ALTER TRIGGER update_lead_sheets_updated_at     ON public.tunes          RENAME TO update_tunes_updated_at;
ALTER TRIGGER lead_sheets_after_soft_delete     ON public.tunes          RENAME TO tunes_after_soft_delete;
ALTER TRIGGER lead_sheet_favorites_after_insert ON public.tune_favorites RENAME TO tune_favorites_after_insert;
ALTER TRIGGER lead_sheet_favorites_after_delete ON public.tune_favorites RENAME TO tune_favorites_after_delete;

-- ── (f) Trigger functions: rename (OID preserved), then replace stale bodies ─

ALTER FUNCTION public.increment_lead_sheet_favorite_count() RENAME TO increment_tune_favorite_count;
ALTER FUNCTION public.decrement_lead_sheet_favorite_count() RENAME TO decrement_tune_favorite_count;
ALTER FUNCTION public.cascade_lead_sheet_soft_delete()      RENAME TO cascade_tune_soft_delete;

-- SECURITY DEFINER with pinned search_path restated on every CREATE OR
-- REPLACE — unstated attributes would reset (and invoker-rights count
-- triggers silently no-op under RLS for the cross-user case).
CREATE OR REPLACE FUNCTION public.increment_tune_favorite_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.tunes
    SET favorite_count = favorite_count + 1
    WHERE id = NEW.tune_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_tune_favorite_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.tunes
    SET favorite_count = GREATEST(favorite_count - 1, 0)
    WHERE id = OLD.tune_id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.cascade_tune_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.tune_favorites WHERE tune_id = NEW.id;
  DELETE FROM public.tune_adoptions WHERE tune_id = NEW.id;
  RETURN NEW;
END;
$$;

-- ── (g) Authors view (definition auto-tracks the table rename) ──────────────

ALTER VIEW public.public_lead_sheet_authors RENAME TO public_tune_authors;

-- ── (h) RLS policies (predicates auto-track; names change) ──────────────────

ALTER POLICY "Authenticated users can view any lead sheet"          ON public.tunes          RENAME TO "Authenticated users can view any tune";
ALTER POLICY "Users can insert own lead sheets"                     ON public.tunes          RENAME TO "Users can insert own tunes";
ALTER POLICY "Users can update own lead sheets"                     ON public.tunes          RENAME TO "Users can update own tunes";
ALTER POLICY "Users can delete own lead sheets"                     ON public.tunes          RENAME TO "Users can delete own tunes";
ALTER POLICY "Authenticated users can view lead sheet favorites"    ON public.tune_favorites RENAME TO "Authenticated users can view tune favorites";
ALTER POLICY "Users can insert own lead sheet favorites"            ON public.tune_favorites RENAME TO "Users can insert own tune favorites";
ALTER POLICY "Users can delete own lead sheet favorites"            ON public.tune_favorites RENAME TO "Users can delete own tune favorites";
ALTER POLICY "Users can view own lead sheet adoptions"              ON public.tune_adoptions RENAME TO "Users can view own tune adoptions";
ALTER POLICY "Users can insert own lead sheet adoptions (non-self)" ON public.tune_adoptions RENAME TO "Users can insert own tune adoptions (non-self)";
ALTER POLICY "Users can delete own lead sheet adoptions"            ON public.tune_adoptions RENAME TO "Users can delete own tune adoptions";

-- ── (i) Comments (textual only — refreshed to the new vocabulary) ───────────

COMMENT ON TABLE public.tunes IS
  'User-owned tunes (melody + harmony song forms). Local-first: ids are client-generated TEXT so offline-created rows keep their id on first sync.';
COMMENT ON COLUMN public.tunes.sections IS
  'Full TuneSection[] payload (section labels, bar counts, repeat/ending markers, notes, harmony) — read/written whole, so JSONB.';
COMMENT ON COLUMN public.tunes.pdf_url IS
  'Storage path of the original imported PDF in the tunes bucket ({uid}/{id}.pdf), when this tune came from a PDF import. NULL otherwise.';
COMMENT ON COLUMN public.tunes.favorite_count IS
  'Defaults to 0 in database; maintained by triggers on tune_favorites. Do not set manually.';
COMMENT ON TABLE public.tune_favorites IS
  'Thumbs-up relation between users and tunes (community feature). Composite PK enforces idempotent favoriting. No UPDATE policy on purpose — favorites are immutable, which is also why no UPDATE count-trigger handler exists.';
COMMENT ON TABLE public.tune_adoptions IS
  'Add-to-my-book relation. Adoption is a live reference, not a copy — the payload stays in tunes, so an author delete cascades to adopters.';
COMMENT ON VIEW public.public_tune_authors IS
  'Column-restricted projection of user_profiles for tune community attribution. Readable by any authenticated user; exposes only display_name and avatar_url, and only for users with at least one live shared tune.';

-- ── (j) Storage: new `tunes` bucket + policies ──────────────────────────────
-- The old `lead-sheets` bucket stays until its objects are copied via the
-- Storage API post-deploy (see header); a follow-up migration drops its
-- four policies once it is deleted in the dashboard.

INSERT INTO storage.buckets (id, name, public)
VALUES ('tunes', 'tunes', false)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public;

DROP POLICY IF EXISTS "Users can upload own tune PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own tune PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own tune PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own tune PDFs" ON storage.objects;

CREATE POLICY "Users can upload own tune PDFs"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tunes'
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.pdf$')
  );

CREATE POLICY "Users can view own tune PDFs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'tunes'
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.pdf$')
  );

CREATE POLICY "Users can update own tune PDFs"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'tunes'
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.pdf$')
  )
  WITH CHECK (
    bucket_id = 'tunes'
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.pdf$')
  );

CREATE POLICY "Users can delete own tune PDFs"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'tunes'
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.pdf$')
  );

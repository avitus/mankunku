-- ============================================================================
-- Migration: lead_sheets
-- Purpose:  Durable, cloud-synced storage for lead sheets (melody +
--           full-harmony song forms) with community sharing, mirroring the
--           user_licks infrastructure (00004/00005/00013) with the later
--           fixes baked in from day one:
--             - client_mtime + deleted_at sync columns (00020) — updated_at
--               is trigger-stamped server write order, useless for offline
--               last-write-wins; deletes are tombstones so they propagate
--               and a stale device cannot resurrect a newer delete;
--             - SECURITY DEFINER count/cascade triggers with pinned
--               search_path (00020/00023a) — invoker-rights triggers
--               silently no-op under RLS for the cross-user case;
--             - authors view filtered to live-sheet authors (00023b) — the
--               unfiltered form leaked profiles of users who never shared.
--
-- Tables:   lead_sheets            — owner-scoped content rows (TEXT PK,
--                                    client-generated ids, JSONB sections)
--           lead_sheet_favorites   — thumbs-up relation (community)
--           lead_sheet_adoptions   — "add to my library" relation (community)
-- View:     public_lead_sheet_authors — column-restricted attribution
--
-- Depends on: 00003 (user_profiles), 00004 (update_updated_at_column),
--             auth.users (Supabase built-in)
--
-- Rollback notes (manual):
--   DROP VIEW public.public_lead_sheet_authors;
--   DROP TABLE public.lead_sheet_adoptions, public.lead_sheet_favorites,
--              public.lead_sheets CASCADE;
--   DROP FUNCTION public.increment_lead_sheet_favorite_count(),
--                 public.decrement_lead_sheet_favorite_count(),
--                 public.cascade_lead_sheet_soft_delete();
-- ============================================================================

-- ── (a) Content table ───────────────────────────────────────────────────────

CREATE TABLE public.lead_sheets (
  id              TEXT          NOT NULL,
  user_id         UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           TEXT          NOT NULL,
  composer        TEXT,
  key             TEXT          NOT NULL,
  time_signature  INTEGER[2]    NOT NULL,
  style           TEXT,
  tags            TEXT[]        NOT NULL DEFAULT '{}',
  sections        JSONB         NOT NULL DEFAULT '[]'::jsonb,
  difficulty      JSONB,
  source          TEXT          NOT NULL DEFAULT 'user',
  pdf_url         TEXT,
  favorite_count  INTEGER       NOT NULL DEFAULT 0,
  deleted_at      TIMESTAMPTZ,
  client_mtime    BIGINT        NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

COMMENT ON TABLE public.lead_sheets IS
  'User-owned lead sheets (melody + harmony song forms). Local-first: ids are client-generated TEXT (sheet-{timestamp}-{random}) so offline-created rows keep their id on first sync.';
COMMENT ON COLUMN public.lead_sheets.sections IS
  'Full LeadSheetSection[] payload (section labels, bar counts, repeat/ending markers, notes, harmony) — read/written whole, so JSONB.';
COMMENT ON COLUMN public.lead_sheets.key IS
  'Concert-pitch key (PitchClass string). Display transposition happens client-side.';
COMMENT ON COLUMN public.lead_sheets.pdf_url IS
  'Storage path of the original imported PDF in the lead-sheets bucket ({uid}/{id}.pdf), when this sheet came from a PDF import. NULL otherwise.';
COMMENT ON COLUMN public.lead_sheets.favorite_count IS
  'Defaults to 0 in database; maintained by triggers on lead_sheet_favorites. Do not set manually.';
COMMENT ON COLUMN public.lead_sheets.deleted_at IS
  'Soft-delete tombstone. NULL = live. Deletes are tombstone UPDATEs so they propagate across devices; never hard-DELETE from clients.';
COMMENT ON COLUMN public.lead_sheets.client_mtime IS
  'Client-owned edit clock (Date.now() ms). NOT touched by the updated_at trigger — this is the field cross-device merge compares.';

-- Query pattern: all sheets for a user (sync pull, includes tombstones)
CREATE INDEX idx_lead_sheets_user_id ON public.lead_sheets(user_id);

-- Query pattern: live sheets for a user (library views)
CREATE INDEX idx_lead_sheets_live
  ON public.lead_sheets(user_id)
  WHERE deleted_at IS NULL;

-- Query pattern: community browse ordered by popularity then recency
CREATE INDEX idx_lead_sheets_popularity
  ON public.lead_sheets (favorite_count DESC, created_at DESC);

CREATE TRIGGER update_lead_sheets_updated_at
  BEFORE UPDATE ON public.lead_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.lead_sheets ENABLE ROW LEVEL SECURITY;

-- Community browse sees only live rows; the OWNER also sees their own
-- tombstones so pull-first sync learns about deletes made on other devices.
CREATE POLICY "Authenticated users can view any lead sheet"
  ON public.lead_sheets
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (deleted_at IS NULL OR user_id = auth.uid())
  );

CREATE POLICY "Users can insert own lead sheets"
  ON public.lead_sheets
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own lead sheets"
  ON public.lead_sheets
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own lead sheets"
  ON public.lead_sheets
  FOR DELETE
  USING (user_id = auth.uid());

-- ── (b) Favorites join table ────────────────────────────────────────────────

CREATE TABLE public.lead_sheet_favorites (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sheet_id   TEXT        NOT NULL REFERENCES public.lead_sheets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sheet_id)
);

COMMENT ON TABLE public.lead_sheet_favorites IS
  'Thumbs-up relation between users and lead sheets (community feature). Composite PK enforces idempotent favoriting. No UPDATE policy on purpose — favorites are immutable, which is also why no UPDATE count-trigger handler exists.';

-- Query pattern: count/aggregate favorites per sheet
CREATE INDEX idx_lead_sheet_favorites_sheet_id ON public.lead_sheet_favorites(sheet_id);

ALTER TABLE public.lead_sheet_favorites ENABLE ROW LEVEL SECURITY;

-- Public like-graph, deliberate: any authenticated user can see who favorited
-- what (mirrors lick_favorites).
CREATE POLICY "Authenticated users can view lead sheet favorites"
  ON public.lead_sheet_favorites
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert own lead sheet favorites"
  ON public.lead_sheet_favorites
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own lead sheet favorites"
  ON public.lead_sheet_favorites
  FOR DELETE
  USING (user_id = auth.uid());

-- Denormalized favorite_count maintenance. SECURITY DEFINER with pinned
-- search_path is mandatory: the trigger updates the AUTHOR's lead_sheets row
-- as the FAVORITER, whose own-rows-only UPDATE policy would match 0 rows
-- under invoker rights and silently freeze the count (the 00023a bug class).
CREATE OR REPLACE FUNCTION public.increment_lead_sheet_favorite_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.lead_sheets
    SET favorite_count = favorite_count + 1
    WHERE id = NEW.sheet_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_lead_sheet_favorite_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.lead_sheets
    SET favorite_count = GREATEST(favorite_count - 1, 0)
    WHERE id = OLD.sheet_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER lead_sheet_favorites_after_insert
  AFTER INSERT ON public.lead_sheet_favorites
  FOR EACH ROW EXECUTE FUNCTION public.increment_lead_sheet_favorite_count();

CREATE TRIGGER lead_sheet_favorites_after_delete
  AFTER DELETE ON public.lead_sheet_favorites
  FOR EACH ROW EXECUTE FUNCTION public.decrement_lead_sheet_favorite_count();

-- ── (c) Adoptions join table ────────────────────────────────────────────────

CREATE TABLE public.lead_sheet_adoptions (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sheet_id   TEXT        NOT NULL REFERENCES public.lead_sheets(id) ON DELETE CASCADE,
  adopted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sheet_id)
);

COMMENT ON TABLE public.lead_sheet_adoptions IS
  'Add-to-my-library relation. Adoption is a live reference, not a copy — the payload stays in lead_sheets, so an author delete cascades to adopters.';

-- Query pattern: which lead sheets has user X adopted?
CREATE INDEX idx_lead_sheet_adoptions_user_id ON public.lead_sheet_adoptions(user_id);

ALTER TABLE public.lead_sheet_adoptions ENABLE ROW LEVEL SECURITY;

-- Fully owner-scoped, including SELECT — nobody can observe others' adoptions.
CREATE POLICY "Users can view own lead sheet adoptions"
  ON public.lead_sheet_adoptions
  FOR SELECT
  USING (user_id = auth.uid());

-- Self-adoption block lives in the INSERT policy's WITH CHECK, not a trigger
-- (same effect, one fewer object to maintain — the 00013 design note).
CREATE POLICY "Users can insert own lead sheet adoptions (non-self)"
  ON public.lead_sheet_adoptions
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_sheets
      WHERE id = sheet_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own lead sheet adoptions"
  ON public.lead_sheet_adoptions
  FOR DELETE
  USING (user_id = auth.uid());

-- ── (d) Soft-delete cascade ─────────────────────────────────────────────────

-- FK ON DELETE CASCADE only fires on hard DELETE; a tombstone UPDATE must
-- replicate the cascade manually. It deletes OTHER users' favorite/adoption
-- rows, so it must run SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.cascade_lead_sheet_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.lead_sheet_favorites WHERE sheet_id = NEW.id;
  DELETE FROM public.lead_sheet_adoptions WHERE sheet_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lead_sheets_after_soft_delete
  AFTER UPDATE ON public.lead_sheets
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.cascade_lead_sheet_soft_delete();

-- ── (e) Authors view ────────────────────────────────────────────────────────

-- Definer-rights view (bypasses user_profiles RLS) restricted to authors of
-- at least one LIVE lead sheet — never the unfiltered 00013 form, which
-- exposed profiles of users who never shared anything.
CREATE OR REPLACE VIEW public.public_lead_sheet_authors
  WITH (security_invoker = false) AS
  SELECT p.id, p.display_name, p.avatar_url
  FROM public.user_profiles p
  WHERE p.id IN (
    SELECT DISTINCT user_id
    FROM public.lead_sheets
    WHERE deleted_at IS NULL
  );

COMMENT ON VIEW public.public_lead_sheet_authors IS
  'Column-restricted projection of user_profiles for lead-sheet community attribution. Readable by any authenticated user; exposes only display_name and avatar_url, and only for users with at least one live shared lead sheet.';

GRANT SELECT ON public.public_lead_sheet_authors TO authenticated;

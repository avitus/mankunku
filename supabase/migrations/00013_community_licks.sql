-- =============================================================================
-- Migration: 00013_community_licks
-- Purpose:   Open user-entered licks for community discovery. Any authenticated
--            user can SELECT any row in user_licks; INSERT/UPDATE/DELETE stay
--            owner-scoped. Adds two new tables (lick_favorites, lick_adoptions)
--            and a restricted author view (public_lick_authors) so clients can
--            render attribution without exposing email or profile timestamps.
--
-- Scope:
--   - Widens the SELECT policy on public.user_licks (drops the owner-only
--     policy; replaces with an authenticated-only policy).
--   - Creates public.lick_favorites (user_id, lick_id) for thumbs-up counts.
--   - Creates public.lick_adoptions (user_id, lick_id) for live-reference
--     adoptions (author edits propagate; author deletion cascades).
--   - Creates public.public_lick_authors — a SECURITY DEFINER view that
--     surfaces only (id, display_name, avatar_url) from user_profiles to
--     authenticated users, without widening RLS on user_profiles itself.
--
-- Self-adoption is blocked inside the INSERT policy's WITH CHECK clause rather
-- than via a trigger — same effect, one fewer object to maintain.
--
-- ON DELETE CASCADE on both new tables' lick_id FK implements the live-delete
-- semantic from the PRD: when an author deletes a user_licks row, every
-- favorite and every adoption referencing it disappears automatically.
--
-- Depends on:
--   - public.user_licks     (migration 00004)
--   - public.user_profiles  (migration 00001)
--   - auth.users            (Supabase built-in)
--
-- Rollback notes (manual):
--   - DROP VIEW public.public_lick_authors;
--   - DROP TABLE public.lick_adoptions;
--   - DROP TABLE public.lick_favorites;
--   - DROP POLICY "Authenticated users can view any lick" ON public.user_licks;
--   - CREATE POLICY "Users can view own licks" ON public.user_licks
--       FOR SELECT USING (user_id = auth.uid());
--   Any favorites/adoptions created post-migration are destroyed by rollback.
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PHASE 1: Widen public.user_licks SELECT visibility                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Existing policy (from migration 00005) restricts SELECT to the owner:
--   USING (user_id = auth.uid())
-- Replace with an authenticated-only predicate so any signed-in user can
-- browse any user lick for the Community feature.
--
-- INSERT, UPDATE, and DELETE policies remain unchanged — authors retain
-- exclusive write access to their own rows.

DROP POLICY IF EXISTS "Users can view own licks" ON public.user_licks;

CREATE POLICY "Authenticated users can view any lick"
  ON public.user_licks
  FOR SELECT
  USING (auth.role() = 'authenticated');


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PHASE 2: public.lick_favorites                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Many-to-many join between users and licks, recording a thumbs-up.
-- Composite PK enforces idempotent favoriting (each user can favorite a lick
-- at most once). lick_id FK ON DELETE CASCADE removes favorites when the
-- author deletes the underlying lick.

CREATE TABLE public.lick_favorites (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lick_id    TEXT        NOT NULL REFERENCES public.user_licks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lick_id)
);

COMMENT ON TABLE public.lick_favorites IS
  'Thumbs-up relation: one row per (user, lick) pair. Count aggregations feed the Community page.';

COMMENT ON COLUMN public.lick_favorites.user_id IS
  'Favoriter. FK to auth.users; ON DELETE CASCADE removes favorites when the account is deleted.';

COMMENT ON COLUMN public.lick_favorites.lick_id IS
  'Favorited lick. FK to user_licks; ON DELETE CASCADE removes favorites when the author deletes the lick.';

-- Query pattern: "how many favorites does lick X have?" — scan by lick_id.
CREATE INDEX idx_lick_favorites_lick_id ON public.lick_favorites(lick_id);


-- ---------------------------------------------------------------------------
-- RLS for lick_favorites
-- ---------------------------------------------------------------------------
-- SELECT is open to all authenticated users so the community page can
-- compute favorite counts. The rows contain no sensitive data beyond
-- "user X favorited lick Y" — this is equivalent to a public like graph,
-- which is fine for the product surface (we don't render who favorited
-- what in v1, but exposing it is acceptable for future features).
--
-- INSERT / DELETE are owner-scoped; UPDATE is disallowed (favorites are
-- immutable — no fields to change).

ALTER TABLE public.lick_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all favorites"
  ON public.lick_favorites
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert own favorites"
  ON public.lick_favorites
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own favorites"
  ON public.lick_favorites
  FOR DELETE
  USING (user_id = auth.uid());


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PHASE 3: public.lick_adoptions                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Records that a user has adopted a lick into their personal library.
-- "Adoption" is a live reference, not a copy — the lick payload lives in
-- user_licks. ON DELETE CASCADE on lick_id implements the spec: when the
-- author deletes, every adopter loses access.

CREATE TABLE public.lick_adoptions (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lick_id    TEXT        NOT NULL REFERENCES public.user_licks(id) ON DELETE CASCADE,
  adopted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lick_id)
);

COMMENT ON TABLE public.lick_adoptions IS
  'Live-reference adoption relation: one row per (adopter, lick). Deleting the underlying lick cascades and removes the adoption.';

COMMENT ON COLUMN public.lick_adoptions.user_id IS
  'Adopter. FK to auth.users; ON DELETE CASCADE.';

COMMENT ON COLUMN public.lick_adoptions.lick_id IS
  'Adopted lick. FK to user_licks; ON DELETE CASCADE (live-delete semantics).';

-- Query pattern: "which licks has user X adopted?" — scan by user_id.
CREATE INDEX idx_lick_adoptions_user_id ON public.lick_adoptions(user_id);


-- ---------------------------------------------------------------------------
-- RLS for lick_adoptions
-- ---------------------------------------------------------------------------
-- SELECT / INSERT / DELETE are all owner-scoped. A user can see and manage
-- only their own adoptions; no one else can observe who has adopted what.
--
-- The INSERT policy also blocks self-adoption inline via a subquery on
-- user_licks. This replaces what would otherwise be a BEFORE INSERT trigger.
-- RLS WITH CHECK is the natural place for this predicate: it composes with
-- the ownership check and fails fast.

ALTER TABLE public.lick_adoptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own adoptions"
  ON public.lick_adoptions
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own adoptions (non-self)"
  ON public.lick_adoptions
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.user_licks
      WHERE id = lick_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own adoptions"
  ON public.lick_adoptions
  FOR DELETE
  USING (user_id = auth.uid());


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PHASE 4: Denormalized favorite_count on user_licks                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Popularity sort on the community browse page needs an ORDER BY that the
-- DB can index. An aggregate JOIN on every query works for low volumes but
-- doesn't scale. Denormalize the count onto user_licks and maintain it with
-- AFTER INSERT / AFTER DELETE triggers on lick_favorites.
--
-- Correctness model:
--   - Column default is 0; new user_licks rows start with no favorites, correct.
--   - INSERT on lick_favorites → increment user_licks.favorite_count.
--   - DELETE on lick_favorites → decrement user_licks.favorite_count.
--   - UPDATE on lick_favorites is disallowed by RLS (no policy), so no handler.
--   - On user_licks delete, lick_favorites cascades; no favorites trigger fires
--     (because ON DELETE CASCADE doesn't trigger AFTER DELETE on the cascaded
--     rows by default). Since the parent row is gone, stale counts are moot.
--
-- Existing rows (none pre-launch) start at 0 via the DEFAULT on the new
-- column; no backfill needed.

ALTER TABLE public.user_licks
  ADD COLUMN favorite_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.user_licks.favorite_count IS
  'Denormalized count of lick_favorites rows for this lick. Maintained by triggers on lick_favorites. Used for ORDER BY favorite_count DESC on the community page.';

CREATE OR REPLACE FUNCTION public.increment_lick_favorite_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.user_licks
    SET favorite_count = favorite_count + 1
    WHERE id = NEW.lick_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.decrement_lick_favorite_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.user_licks
    SET favorite_count = GREATEST(favorite_count - 1, 0)
    WHERE id = OLD.lick_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lick_favorites_after_insert
  AFTER INSERT ON public.lick_favorites
  FOR EACH ROW EXECUTE FUNCTION public.increment_lick_favorite_count();

CREATE TRIGGER lick_favorites_after_delete
  AFTER DELETE ON public.lick_favorites
  FOR EACH ROW EXECUTE FUNCTION public.decrement_lick_favorite_count();

-- Index for ORDER BY favorite_count DESC, created_at DESC (popularity sort).
CREATE INDEX idx_user_licks_popularity
  ON public.user_licks (favorite_count DESC, created_at DESC);


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PHASE 5: public.public_lick_authors view                               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- A column-restricted window into user_profiles. The Community page needs
-- to render (author display name, avatar) alongside each lick, but we don't
-- want to widen RLS on user_profiles — doing so would expose created_at,
-- updated_at, and any future sensitive columns.
--
-- security_invoker = false (the default in current Postgres, but set
-- explicitly for clarity) means the view runs with the privileges of its
-- definer (the role that executed this migration). That bypasses the RLS
-- policies on user_profiles, which is the intended behavior here — we've
-- explicitly chosen which columns to surface.
--
-- We grant SELECT to the `authenticated` role only; `anon` has no access.

CREATE VIEW public.public_lick_authors
  WITH (security_invoker = false) AS
  SELECT id, display_name, avatar_url
  FROM public.user_profiles;

COMMENT ON VIEW public.public_lick_authors IS
  'Public-safe projection of user_profiles for community attribution. Surfaces only (id, display_name, avatar_url). Readable by any authenticated user.';

GRANT SELECT ON public.public_lick_authors TO authenticated;

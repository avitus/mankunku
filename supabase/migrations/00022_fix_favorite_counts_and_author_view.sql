-- =============================================================================
-- Migration: 00022_fix_favorite_counts_and_author_view
-- Purpose:   Fix two community-layer defects surfaced by the data-layer audit:
--            (a) favorite_count never updates for cross-user favorites, and
--            (b) public_lick_authors leaks every registered user's profile.
--
-- (a) favorite_count triggers ran SECURITY INVOKER. The trigger UPDATEs
--     user_licks (the AUTHOR's row) as the FAVORITER, whose own-rows-only
--     UPDATE RLS matches 0 rows → the count silently never moves for the
--     entire community use case (favoriting someone else's lick). Rebinding
--     the functions as SECURITY DEFINER (with a pinned search_path) runs the
--     UPDATE as the function owner, bypassing the favoriter's RLS. Triggers
--     are unchanged (CREATE OR REPLACE FUNCTION rebinds them). A one-shot
--     idempotent backfill repairs counts that already drifted.
--
-- (b) public_lick_authors projected ALL user_profiles (no join to user_licks),
--     GRANTed to every authenticated user — exposing names/avatars of users who
--     never shared anything. Restrict it to users who actually authored a
--     (live) lick.
--
-- All CREATE OR REPLACE — non-breaking, no client change required. The backfill
-- is idempotent (safe to re-run).
--
-- Depends on:
--   - public.lick_favorites + favorite_count triggers (migration 00013)
--   - public.public_lick_authors view (migration 00013)
--   - public.user_licks.deleted_at (migration 00019)
-- =============================================================================

-- ── (a) favorite_count triggers → SECURITY DEFINER ──────────────────────────

CREATE OR REPLACE FUNCTION public.increment_lick_favorite_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.user_licks
    SET favorite_count = favorite_count + 1
    WHERE id = NEW.lick_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_lick_favorite_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.user_licks
    SET favorite_count = GREATEST(favorite_count - 1, 0)
    WHERE id = OLD.lick_id;
  RETURN OLD;
END;
$$;

-- One-shot idempotent backfill: recompute every count directly from the
-- favorites table so counts drifted by the INVOKER bug are repaired.
UPDATE public.user_licks ul
  SET favorite_count = COALESCE(f.cnt, 0)
  FROM (
    SELECT lick_id, COUNT(*) AS cnt
    FROM public.lick_favorites
    GROUP BY lick_id
  ) f
  WHERE ul.id = f.lick_id
    AND ul.favorite_count <> COALESCE(f.cnt, 0);

UPDATE public.user_licks ul
  SET favorite_count = 0
  WHERE ul.favorite_count <> 0
    AND NOT EXISTS (
      SELECT 1 FROM public.lick_favorites lf WHERE lf.lick_id = ul.id
    );

-- ── (b) restrict public_lick_authors to actual authors ──────────────────────

CREATE OR REPLACE VIEW public.public_lick_authors
  WITH (security_invoker = false) AS
  SELECT p.id, p.display_name, p.avatar_url
  FROM public.user_profiles p
  WHERE p.id IN (
    SELECT DISTINCT user_id
    FROM public.user_licks
    WHERE deleted_at IS NULL
  );

COMMENT ON VIEW public.public_lick_authors IS
  'Public-safe projection of user_profiles for community attribution, '
  'restricted to users who have authored at least one live (non-tombstoned) '
  'lick. Surfaces only (id, display_name, avatar_url). Readable by any '
  'authenticated user.';

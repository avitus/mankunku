-- =============================================================================
-- Migration: 00019_user_licks_tombstones
-- Purpose:   Make user_licks sync non-destructive and delete-safe across devices
--            by adding (a) a client-owned edit clock the updated_at trigger does
--            NOT touch, and (b) soft-delete tombstones so a delete on one device
--            propagates instead of being resurrected by another device's push.
--
-- Why client_mtime (not updated_at): the shared update_updated_at_column()
-- BEFORE UPDATE trigger (migration 00001/00004) overwrites updated_at with
-- now() on every upsert-UPDATE, so updated_at records SERVER write order, not
-- EDIT-intent order — useless for offline last-write-wins. client_mtime is
-- stamped by the client (Date.now()) and never touched by any trigger, so it is
-- the field the merge actually compares.
--
-- Soft delete: deleteUserLick writes deleted_at = now() (a tombstone UPDATE)
-- instead of a hard DELETE. The merge resolves tombstone-vs-edit purely by
-- client_mtime, so a stale device can never un-delete a newer delete, and a
-- genuinely newer re-creation still wins.
--
-- Backward compatibility (CI auto-deploy window):
--   - Both columns are nullable/defaulted; old clients omit them (client_mtime
--     defaults to 0 → treated as oldest, so a new client's real edit wins).
--   - Old clients still issue hard DELETEs, which also converge and still fire
--     the ON DELETE CASCADE from migration 00013.
--   - The SELECT policy keeps every live lick visible to community browse and
--     additionally lets an OWNER read their own tombstones (needed so the
--     pull-first merge can learn about deletes made on other devices).
--
-- Depends on:
--   - public.user_licks (migration 00004)
--   - public.lick_favorites / public.lick_adoptions + community SELECT policy
--     (migration 00013)
-- =============================================================================

ALTER TABLE public.user_licks
  ADD COLUMN deleted_at   TIMESTAMPTZ,
  ADD COLUMN client_mtime BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.user_licks.deleted_at IS
  'Soft-delete tombstone. NULL = live. Set by deleteUserLick instead of a hard '
  'DELETE so the deletion propagates across devices; tombstone-vs-edit is '
  'resolved by client_mtime.';

COMMENT ON COLUMN public.user_licks.client_mtime IS
  'Client-owned edit clock (Date.now() ms). NOT touched by the updated_at '
  'trigger, so unlike updated_at it reflects edit-intent order and is the field '
  'the cross-device merge compares. Legacy rows default to 0 (oldest).';

-- Partial index for the common "live licks for this user" scan.
CREATE INDEX idx_user_licks_live
  ON public.user_licks(user_id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- SELECT visibility: hide tombstones from community browse, but let the owner
-- still read their own tombstones so the sync layer can propagate deletes.
-- Replaces the community-browse policy from migration 00013.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view any lick" ON public.user_licks;

CREATE POLICY "Authenticated users can view any lick"
  ON public.user_licks
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (deleted_at IS NULL OR user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Soft-delete cascade: a hard DELETE cascaded to lick_favorites / lick_adoptions
-- (migration 00013 FKs). A soft delete does not, so replicate that here. The
-- favorites/adoptions being removed belong to OTHER users, whose own-rows-only
-- DELETE RLS would block an invoker-rights delete — so the function runs
-- SECURITY DEFINER (with a pinned search_path) to mirror the cascade.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cascade_user_lick_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.lick_favorites WHERE lick_id = NEW.id;
  DELETE FROM public.lick_adoptions  WHERE lick_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_licks_after_soft_delete
  AFTER UPDATE ON public.user_licks
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.cascade_user_lick_soft_delete();

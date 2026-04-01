-- =============================================================================
-- Migration: 00007_add_is_admin
-- Purpose:   Add an is_admin flag to user_profiles and update the user_licks
--            DELETE RLS policy so admins can delete any user's licks.
--
-- Depends on:
--   - public.user_profiles (migration 00001)
--   - public.user_licks RLS policies (migration 00005)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Phase 1: Add is_admin column to user_profiles
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_profiles
  ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.is_admin IS
  'Admin flag. Admins can delete any user lick. Set manually via SQL or service role.';

-- ---------------------------------------------------------------------------
-- Phase 2: Replace user_licks DELETE policy to allow admin deletes
-- ---------------------------------------------------------------------------

DROP POLICY "Users can delete own licks" ON public.user_licks;

CREATE POLICY "Users can delete own licks or admin can delete any"
  ON public.user_licks
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

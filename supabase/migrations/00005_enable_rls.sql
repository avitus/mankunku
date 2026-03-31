-- =============================================================================
-- Migration: 00005_enable_rls
-- Purpose:   Enable Row Level Security (RLS) on ALL user-scoped tables and
--            create per-table access policies. This migration is intentionally
--            separate from the table creation migrations (00001-00004) so it
--            can be audited independently for security review.
--
-- Security model:
--   - Every user-scoped table has RLS enabled (no exceptions)
--   - Each table gets 4 policies: SELECT, INSERT, UPDATE, DELETE
--   - All policies restrict access to the authenticated user's own rows
--   - user_profiles uses "id = auth.uid()" (PK IS the auth user ID)
--   - All other tables use "user_id = auth.uid()" (FK to auth.users)
--   - UPDATE policies include both USING and WITH CHECK clauses
--   - INSERT policies include WITH CHECK clause
--
-- Tables covered (7):
--   1. public.user_profiles      (migration 00001)
--   2. public.user_progress      (migration 00002)
--   3. public.session_results    (migration 00002)
--   4. public.scale_proficiency  (migration 00002)
--   5. public.key_proficiency    (migration 00002)
--   6. public.user_settings      (migration 00003)
--   7. public.user_licks         (migration 00004)
--
-- Total policies: 28 (7 tables × 4 operations)
--
-- Depends on:
--   - Supabase auth.uid() function (built-in)
--   - All tables created in migrations 00001-00004
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PHASE 1: Enable Row Level Security on all user-scoped tables           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- RLS must be enabled on each table before any policies can take effect.
-- Once enabled, all queries (even from service_role) must satisfy a policy
-- unless the caller explicitly bypasses RLS. The Supabase anon and
-- authenticated roles always respect RLS.

ALTER TABLE public.user_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progress     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scale_proficiency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_proficiency   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_licks        ENABLE ROW LEVEL SECURITY;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PHASE 2: Create per-table RLS policies                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Each table receives four policies (SELECT, INSERT, UPDATE, DELETE) that
-- restrict access to rows belonging to the currently authenticated user.
--
-- Policy clause semantics:
--   USING (condition)      → applied to existing rows (SELECT, UPDATE, DELETE)
--   WITH CHECK (condition) → applied to new/modified rows (INSERT, UPDATE)
--
-- For SELECT and DELETE: only USING is needed.
-- For INSERT: only WITH CHECK is needed.
-- For UPDATE: both USING (filter existing rows) and WITH CHECK (validate
--   the updated row) are required to prevent a user from changing their
--   user_id/id to another user's ID.


-- ---------------------------------------------------------------------------
-- 2.1  user_profiles
-- ---------------------------------------------------------------------------
-- Special case: the user identity column is "id" (not "user_id") because
-- the user_profiles PK IS the auth.users.id directly (1:1 relationship
-- established in migration 00001).
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own profile"
  ON public.user_profiles
  FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON public.user_profiles
  FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON public.user_profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users can delete own profile"
  ON public.user_profiles
  FOR DELETE
  USING (id = auth.uid());


-- ---------------------------------------------------------------------------
-- 2.2  user_progress
-- ---------------------------------------------------------------------------
-- One row per user (PK = user_id). Stores aggregate progress data.
-- Created in migration 00002.
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own progress"
  ON public.user_progress
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own progress"
  ON public.user_progress
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own progress"
  ON public.user_progress
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own progress"
  ON public.user_progress
  FOR DELETE
  USING (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 2.3  session_results
-- ---------------------------------------------------------------------------
-- Many rows per user (practice session outcomes). PK = id (TEXT),
-- FK = user_id. Created in migration 00002.
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own session results"
  ON public.session_results
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own session results"
  ON public.session_results
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own session results"
  ON public.session_results
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own session results"
  ON public.session_results
  FOR DELETE
  USING (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 2.4  scale_proficiency
-- ---------------------------------------------------------------------------
-- Per-scale proficiency tracking. Composite PK = (user_id, scale_id).
-- Created in migration 00002.
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own scale proficiency"
  ON public.scale_proficiency
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own scale proficiency"
  ON public.scale_proficiency
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own scale proficiency"
  ON public.scale_proficiency
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own scale proficiency"
  ON public.scale_proficiency
  FOR DELETE
  USING (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 2.5  key_proficiency
-- ---------------------------------------------------------------------------
-- Per-key proficiency tracking. Composite PK = (user_id, key).
-- Created in migration 00002.
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own key proficiency"
  ON public.key_proficiency
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own key proficiency"
  ON public.key_proficiency
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own key proficiency"
  ON public.key_proficiency
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own key proficiency"
  ON public.key_proficiency
  FOR DELETE
  USING (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 2.6  user_settings
-- ---------------------------------------------------------------------------
-- One row per user (PK = user_id). Stores application preferences.
-- Created in migration 00003.
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own settings"
  ON public.user_settings
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own settings"
  ON public.user_settings
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own settings"
  ON public.user_settings
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own settings"
  ON public.user_settings
  FOR DELETE
  USING (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 2.7  user_licks
-- ---------------------------------------------------------------------------
-- User-recorded musical phrases. PK = id (TEXT), FK = user_id.
-- Created in migration 00004.
-- ---------------------------------------------------------------------------

CREATE POLICY "Users can view own licks"
  ON public.user_licks
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own licks"
  ON public.user_licks
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own licks"
  ON public.user_licks
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own licks"
  ON public.user_licks
  FOR DELETE
  USING (user_id = auth.uid());

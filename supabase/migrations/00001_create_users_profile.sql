-- =============================================================================
-- Migration: 00001_create_users_profile
-- Purpose:   Create the public.user_profiles table that extends Supabase's
--            built-in auth.users with application-specific profile fields.
--            This is the foundational table that all other migrations depend on.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Phase 1: Create public.user_profiles table
-- ---------------------------------------------------------------------------
-- Establishes a strict 1:1 relationship with auth.users via shared PK/FK.
-- ON DELETE CASCADE ensures automatic profile cleanup on account deletion.
-- display_name and avatar_url are nullable to support email/password signups
-- where OAuth metadata is not available.
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_profiles (
  id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- Add a descriptive comment to the table for documentation
COMMENT ON TABLE public.user_profiles IS
  'Application-specific user profile data extending Supabase auth.users. One row per user.';
COMMENT ON COLUMN public.user_profiles.id IS
  'Primary key — same UUID as auth.users.id (1:1 relationship)';
COMMENT ON COLUMN public.user_profiles.display_name IS
  'User-chosen display name. Nullable — auto-populated from OAuth metadata if available.';
COMMENT ON COLUMN public.user_profiles.avatar_url IS
  'URL to user avatar image. May come from OAuth provider (e.g. Google) or user upload.';
COMMENT ON COLUMN public.user_profiles.created_at IS
  'Profile creation timestamp.';
COMMENT ON COLUMN public.user_profiles.updated_at IS
  'Last modification timestamp. Used for sync conflict resolution (last-write-wins).';

-- ---------------------------------------------------------------------------
-- Phase 2: Create handle_new_user() trigger function
-- ---------------------------------------------------------------------------
-- Automatically inserts a user_profiles row when a new user signs up via
-- Supabase Auth (inserted into auth.users). Extracts display name and
-- avatar URL from the user's raw_user_meta_data JSON column.
--
-- SECURITY DEFINER is required because:
--   - The trigger fires from the auth schema context
--   - The function needs INSERT privileges on public.user_profiles
--   - Without SECURITY DEFINER, RLS policies (added in migration 00005)
--     would block the insert since there is no authenticated session context
--
-- COALESCE handles different OAuth providers:
--   - Google OAuth provides 'full_name' in raw_user_meta_data
--   - Other providers may use 'name'
--   - Email/password signups will have NULL for both, which is acceptable
--     since display_name is nullable
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name'
    ),
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- Phase 3: Create the trigger on auth.users
-- ---------------------------------------------------------------------------
-- Fires AFTER INSERT so the auth.users row is fully committed before we
-- reference it via the FK constraint on user_profiles.id.
-- FOR EACH ROW ensures every individual signup creates a profile.
-- ---------------------------------------------------------------------------

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Phase 4: Create shared update_updated_at_column() function and
--          user_profiles-specific trigger
-- ---------------------------------------------------------------------------
-- The update_updated_at_column() function is a reusable utility that
-- automatically sets the updated_at column to now() on every UPDATE.
-- It is defined here in the first migration with CREATE OR REPLACE so
-- subsequent migrations (00002, 00003, 00004) can safely reference it
-- without recreating it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the updated_at auto-update trigger to user_profiles.
-- BEFORE UPDATE ensures the timestamp is set before the row is written.
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- Migration: 00014_recordings_bucket
-- Purpose:   Provision the `recordings` Storage bucket and its per-user RLS
--            policies. The app uploads a practice recording blob to
--            `recordings/{userId}/{sessionId}.webm` after every scored
--            session. Upload call sites:
--              - src/lib/persistence/audio-store.ts::saveRecording (primary,
--                invoked from the practice page after scoring)
--              - src/lib/persistence/sync.ts::uploadRecording (shared helper)
--            Without these policies every upload returns a 400 with
--            "new row violates row-level security policy" from
--            storage.objects.
--
-- Bucket:
--   - name:   recordings
--   - public: false (all access mediated by RLS — signed URLs or authed reads)
--
-- Object path convention:
--   `{auth.uid()}/{sessionId}.webm`
--   `storage.foldername(name)[1]` returns the first path segment, which MUST
--   equal the caller's auth.uid() for every policy below.
--
-- Policy matrix (4 per bucket — matches the table-level pattern in 00005):
--   - INSERT: uploads
--   - SELECT: downloads (getRecording)
--   - UPDATE: upserts via { upsert: true } (re-uploads to the same path)
--   - DELETE: recording deletion
--
-- All four share the same authed-and-owns-folder predicate. Policies are
-- idempotent: guarded with DROP IF EXISTS so the migration is safe to
-- re-apply if the bucket was provisioned out-of-band in the dashboard.
--
-- Depends on:
--   - Supabase Storage (storage.buckets, storage.objects)
--   - auth.uid() function (built-in)
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PHASE 1: Create the bucket (idempotent)                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Converge on the intended private configuration. If the bucket was
-- previously created out-of-band with public = true, DO NOTHING would
-- silently retain that insecure state; DO UPDATE forces it private.
INSERT INTO storage.buckets (id, name, public)
VALUES ('recordings', 'recordings', false)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PHASE 2: RLS policies on storage.objects scoped to the recordings bucket ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- RLS is already enabled on storage.objects by Supabase defaults. We only
-- add policies; we do not ALTER TABLE here.

DROP POLICY IF EXISTS "Users can upload own recordings"   ON storage.objects;
DROP POLICY IF EXISTS "Users can read own recordings"     ON storage.objects;
DROP POLICY IF EXISTS "Users can update own recordings"   ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own recordings"   ON storage.objects;

CREATE POLICY "Users can upload own recordings"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'recordings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can read own recordings"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'recordings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update own recordings"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'recordings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'recordings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own recordings"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'recordings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================================
-- Migration: lead_sheets_bucket
-- Purpose:  Private Storage bucket for original lead-sheet PDF assets
--           (uploads from the PDF import flow), mirroring the recordings
--           bucket (00014).
--
-- Object path convention: {auth.uid()}/{sheetId}.pdf — exactly one folder
-- segment (the owner's uid) and a filename restricted to [A-Za-z0-9_-],
-- all enforced by a single regex predicate per policy.
--
-- Policy matrix: 4 per bucket (INSERT = uploads, SELECT = downloads,
-- UPDATE = { upsert: true } re-uploads, DELETE = deletion), matching 00014.
-- storage.objects is shared across buckets, so policy names must be unique —
-- these are distinct from the recordings-bucket policy names.
--
-- Depends on: Supabase storage schema (built-in; RLS already enabled on
--             storage.objects — policies only, no ALTER TABLE).
-- ============================================================================

-- DO UPDATE, not DO NOTHING: if the bucket was previously created out-of-band
-- with public = true, DO NOTHING would silently retain that insecure state.
INSERT INTO storage.buckets (id, name, public)
VALUES ('lead-sheets', 'lead-sheets', false)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public;

DROP POLICY IF EXISTS "Users can upload own lead sheet PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own lead sheet PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own lead sheet PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own lead sheet PDFs" ON storage.objects;

CREATE POLICY "Users can upload own lead sheet PDFs"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'lead-sheets'
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.pdf$')
  );

CREATE POLICY "Users can view own lead sheet PDFs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'lead-sheets'
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.pdf$')
  );

CREATE POLICY "Users can update own lead sheet PDFs"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'lead-sheets'
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.pdf$')
  )
  WITH CHECK (
    bucket_id = 'lead-sheets'
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.pdf$')
  );

CREATE POLICY "Users can delete own lead sheet PDFs"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'lead-sheets'
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]+\.pdf$')
  );

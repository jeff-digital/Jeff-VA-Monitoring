-- Run AFTER R2 migration completes and the updated web/Android apps are checked.
-- Keep originals readable for recovery. These restrictive policies only stop
-- authenticated clients writing the old client-documents bucket.
BEGIN;
DROP POLICY IF EXISTS jeff_va_retired_file_insert ON storage.objects;
DROP POLICY IF EXISTS jeff_va_retired_file_update ON storage.objects;
DROP POLICY IF EXISTS jeff_va_retired_file_delete ON storage.objects;
CREATE POLICY jeff_va_retired_file_insert ON storage.objects AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (bucket_id <> 'client-documents');
CREATE POLICY jeff_va_retired_file_update ON storage.objects AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (bucket_id <> 'client-documents')
  WITH CHECK (bucket_id <> 'client-documents');
CREATE POLICY jeff_va_retired_file_delete ON storage.objects AS RESTRICTIVE
  FOR DELETE TO authenticated USING (bucket_id <> 'client-documents');
COMMIT;

-- To restore legacy write permissions, drop these three policies.
-- This does not copy new R2 files back to Supabase.

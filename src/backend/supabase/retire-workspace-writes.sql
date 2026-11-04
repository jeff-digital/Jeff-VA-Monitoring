-- Run only AFTER D1 has been deployed and records have been checked.
-- Retain SELECT so users can recover their old workspace once on first D1 login.
-- Old web tabs and Android builds must reload/update before saving again.
-- This does not delete records, affect authentication, or change file storage.
BEGIN;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.app_state FROM authenticated;
COMMIT;

-- Rollback permission only (does not copy new D1 records back to Supabase):
-- GRANT INSERT, UPDATE, DELETE ON TABLE public.app_state TO authenticated;

# D1 workspace migration

File storage has since moved to R2; see [private file storage](private-file-storage.md). The Supabase file references below describe the original D1 cutover and retained source backups.

The Worker uses `WORKSPACE_BACKEND=d1` and the `WORKSPACE_DB` binding for workspace records. The database is `jeff-va-workspace` (`671cb15b-0a62-4368-a516-fcf7dc7d66d5`). Its schema is `src/backend/d1/0001-workspace.sql`.

Applications, emails, daily tasks, client tasks, invoices, subscriptions, wallet entries and the other collections have separate account-scoped tables. Saves update changed records with conflict checks. The website checks a small revision while visible every 60 seconds and on focus; Android checks the revision before downloading changed data. Supabase Auth still verifies users. Existing attached files remain in Supabase Storage. These services can still generate Supabase usage; this is not a complete removal of Supabase.

## Backup and imported data

The supplied November 5 JSON backup was copied unchanged to the ignored local directory `migration-data/73a960112f83/`. `source-backup.json`, `import.sql`, `report.json` and the remote verification snapshot remain private and must not be committed or published. Source SHA-256: `73a960112f831877c9bb831c1b8e7a9aa822861471c8e9d3274253ab762d25fb`.

The remote import was verified against every original JSON value. It includes 59 applications, 464 emails, 12 daily tasks, and the other exported collections and settings. This is the backup's snapshot; changes made in an older app after that export are not included. The backup does not contain attached file bytes, authentication sessions or onboarding invitation hashes. Keep the original Supabase records and the Excel/JSON backups.

Other existing users migrate once on their first authenticated workspace load, through their own Supabase read permissions. Migration is atomic and cannot overwrite an already imported D1 account. If the source is restricted or a record is too large, migration fails without substituting an empty workspace. New users receive an empty account after a successful source check.

## After deployment

1. Refresh the published website and verify the restored records. Update every Android device to version 1.3.5 or newer. Older builds or browser tabs may still use Supabase directly.
2. After checking D1, run `src/backend/supabase/retire-workspace-writes.sql` in the Supabase SQL editor. This prevents older clients from silently saving into a second database. It preserves reads needed by users who have not migrated yet.
3. Reissue existing onboarding invitation links. Old invitation hashes are absent from the backup. Earlier submitted responses are recovered once per account from Supabase when their owner opens onboarding responses; this needs Supabase to remain accessible.
4. Review restored follow-up schedules and Gmail Sent before resuming automatic email. `BACKGROUND_FOLLOW_UPS_PAUSED=true` pauses both browser automatic reservations and background alarms during migration. Manual sends still use delivery protection. After review, set this variable to `false` in `wrangler.jsonc` and deploy; maintain the same value in Cloudflare runtime settings. Existing encrypted Gmail connections and the delivery ledger remain in Durable Objects.

D1 still has daily reads, writes, storage and Worker limits. Reduced transfer does not mean unlimited free usage. Do not repeatedly export/reimport the full workspace or frequently refresh entire collections.

## Maintenance and rollback

`scripts/prepare-d1-import.mjs <backup-path>` prepares a private, guarded SQL import and count report. An import never replaces a ready account. D1 schema changes use Wrangler migrations. Local checks: `scripts/test-d1-workspace.mjs` and `scripts/test-d1-integration.mjs`.

Do not switch back to Supabase after new D1 edits without exporting and reconciling those edits first. Setting the backend flag alone does not copy D1 changes back. The permission rollback in the retirement SQL restores legacy writes only.

# Private Cloudflare file storage

The website and Android 1.3.6+ use the authenticated `/api/files` Worker API for documents, attachments and client profile photos. Files are stored in the private Standard-class R2 bucket `jeff-va-files`, bound as `WORKSPACE_FILES`. No public bucket URL or public signed download link is needed. Supabase Auth still validates each session; D1 retains workspace file references.

The Worker derives account ownership from the verified user, validates the path, blocks traversal and overwrites, and limits each upload to 25 MiB. PDF, Word documents, JPEG, PNG, WebP and generic binary files are accepted; active HTML/SVG uploads are rejected. Downloads are private, uncached attachment responses. Deletion tombstones in D1 prevent a removed file from reappearing through the legacy read fallback, including while migration is running.

## Existing files

The existing `FollowUpDelivery` Durable Object class also hosts an isolated, resumable file-migration instance. It uses the existing server-only Supabase service key to list account-prefixed objects, copy them one at a time, and stop its alarm after completion. It preserves the original path so D1 references continue working. Copy operations supply a SHA-256 checksum to R2 and verify the returned object size. Originals are never deleted by migration. Existing R2 objects are never overwritten. Failed transfers retry up to five times and remain recorded for recovery.

The private R2 object `_system/migration-v1.json` contains progress and any failed paths; it is accessible to the Cloudflare operator, never through the user file API. Do not publish that report. Paths outside account UUID prefixes are skipped. Existing files above the 25 MiB app limit require a separate reviewed transfer; their originals remain intact.

An authenticated read of an uncopied legacy file can also copy it through the caller's own Supabase permissions. Once R2 contains it, further downloads use R2. The fallback never serves tombstoned files. A completed migration does not mean later uploads from obsolete clients are transferred automatically.

## Final checks

1. Confirm the private migration report says `done: true` with no failures. Open documents and client photos using the published website.
2. Install Android 1.3.6 or newer on all devices. Old Android versions still use Supabase file endpoints.
3. Run `src/backend/supabase/retire-file-writes.sql` in Supabase SQL Editor. It stops obsolete authenticated clients writing the old file bucket while preserving reads and other buckets.
4. Retain Supabase originals until a separate cleanup is authorized. They are migration backups; deletion in the new app hides/removes the R2 copy and records a tombstone, while retained legacy backups remain in Supabase.

Settings displays the signed-in user's R2 file total, not the organization's billing quota. R2 storage and request usage still have provider limits and charges; this implementation does not guarantee free usage at every scale. Original Gmail attachments stay at Google until explicitly saved in this app. Device backup files remain on the device.

Checks: `node scripts/test-private-files.mjs` exercises authenticated ownership, traversal, size/type limits, checksums, non-overwrite behavior, deletion recovery, usage isolation and background copying. `android/build-apk.ps1` builds and signs the updated native app with the existing private signing identity.

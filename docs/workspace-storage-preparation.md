# Page-first storage migration preparation

This document describes the completed preparation phase. The current D1 backend,
import checks and remaining device/permission steps are in [D1 migration](d1-migration.md).

This is the first phase of the Cloudflare D1 migration. It changes page storage
access **before** splitting the database tables. No existing Supabase records or
files are moved or deleted. Supabase Auth, file storage and realtime remain active.

## Page coverage

Every website page goes through `workspaceStore` and `/api/workspace` for record
storage. Existing page renderers keep their current in-memory data shape. Their
`persist()` calls save only changed records or changed small settings collections.
The storage contract registers these page dependencies for the later table split:

| Page | Main records |
| --- | --- |
| Application and client dashboards | Applications, emails, tasks, reminders, invoices, wallet, goals |
| Applications | Application records, email evidence, alerts |
| To apply | To-apply entries, applications, alerts |
| Daily tasks | Daily/client tasks, related applications and to-apply entries |
| Active clients | Client application records, client tasks, email evidence, invoices, onboarding IDs |
| Email inbox | Messages, templates, deleted IDs, matching clients, AI task state |
| Career tools | Document metadata, invoices, scripts, links, email templates |
| Wallet | Transactions, rates from client records, invoices |
| Subscriptions | Subscription records |
| Social trends | Saved trend records |
| News | Its existing authenticated news API; no workspace storage needed |
| Settings and account | Sign-in records, counts and full-record backup |
| Public client onboarding | Token-scoped invitation lookup and submission through `/api/onboarding` |

Client-photo verification now reads just the affected application through the
same API. File uploads/downloads still use the existing private Supabase bucket.
Client invitation creation, response viewing and onboarding alerts use a fixed
authenticated onboarding API; the public form uses a separate token-scoped API.
Only the existing allowed operations are forwarded, preserving invitation and
account ownership checks. The form no longer calls Supabase directly.
Android's shared repository also uses the API, so all its screens follow the same
storage contract. Android edits reuse the loaded workspace and refresh only on
conflict; they no longer download and return the entire workspace on every save.

## Storage behavior

- The authenticated Worker determines the account ID; clients cannot submit a
  different account ID. The legacy database adapter uses the user's token and RLS.
- The database function locks the user's existing row and applies only changed
  records. Different records edited on two devices merge. Editing a stale version
  of the same record returns a conflict instead of overwriting the newer change.
- Saves return only a small acknowledgement. A repeated request after a lost
  response is idempotent. A failed batch rolls back in full. Large imports use
  multiple bounded batches; an interrupted import may have partially saved batches
  and can be retried without creating duplicate record IDs.
- Only changed records are uploaded. Initial loading remains a full legacy
  snapshot **in this phase**. Page pagination and lazy email-body loading belong
  to the following D1/table phase; this preparation does not claim to eliminate
  Supabase egress.
- Whole-array updates are retained for small ID-less settings/history. Record
  reordering sends IDs, not email bodies or complete records. Other devices' new
  records are retained. Legacy top-level fields are not discarded by saves.
- There is no silent fallback to the old whole-workspace save if the API or
  database function is missing. Deploy server and clients together after setup.

## Backups

The existing downloaded Excel backup remains useful. It does not include email
history or document binaries, and some newer record types/fields are not exported
by the existing workbook format. Do not treat Excel as a complete migration image.

Settings → **Download full records (.json)** exports all loaded records, including
email bodies, wallet entries, subscription data and legacy fields. It includes
the originating account ID and format version for later import validation. It
does not export Supabase login sessions or OAuth credentials. Downloaded backups
are private files and are never committed to the repository.

Attached files are separate objects in Supabase Storage. This phase preserves
their paths and leaves the bucket intact; a later R2 migration must copy file
contents separately if desired. No documents should be deleted just because an
Excel or JSON export was downloaded.

## Deploying this preparation

1. Run `src/backend/supabase/workspace-page-storage-migration.sql` in the Supabase
   SQL Editor. It adds authenticated record-read and save RPC functions and creates no new tables.
   It is safe to run again. Keep the earlier background-follow-up functions.
2. Build and deploy the updated Worker and website together. Publish an updated
   Android build before depending on the new storage path on Android devices.
3. Refresh open browser tabs. Verify adding, editing and deleting an unimportant
   record in each page you use, plus cross-device edits, before the D1 cutover.
4. Download the full-record JSON backup. The Excel backup is an additional recovery
   option, not a reason to discard the current database.

The optional ignored localhost server forwards `/api/workspace` GET/PATCH/DELETE
to the deployed Worker. It needs restarting after its local proxy update.

## Next phase: separate tables and switch to D1

Create the D1 tables only after this page layer is verified. Replace the Worker
adapter and route backend AI checks, follow-ups and onboarding reads/writes to
the new storage as well. Move records using their existing IDs and account IDs.
Keep the shared delivery ledger to prevent background resend during cutover.
Replace Supabase row subscriptions with small D1-backed revision notifications.
Finally perform a controlled final import and switch clients, blocking old clients
from writing to the retired Supabase workspace. Retain a recovery copy until the
import counts, user isolation and linked records have been verified.

## Verification

```text
node scripts/test-workspace-store.mjs
node scripts/test-workspace-api.mjs
node scripts/test-workspace-egress.mjs
node scripts/test-native-android.cjs
```

Optional real SQL validation uses PGlite via `PGLITE_MODULE`, as with the background
follow-up SQL tests: `node scripts/test-workspace-storage-sql.mjs`.

# Background follow-ups

Scheduled automatic follow-ups can run while the user is logged out, the browser
is closed, or the computer is off. The deployed Cloudflare Worker and Supabase
must remain available. No browser session or local server participates in sending.

This is shared infrastructure for multiple users. The app operator configures the
server secrets once; users do not run PowerShell or install anything. Each user
enables their own Gmail connection, with a separate account-scoped encrypted token,
alarm, status history and delivery ledger. Follow-ups use that user's verified
email and profile name captured when they enable background sending. The Gmail
OAuth client and server encryption key belong to the deployment, not to an
individual end user's device. Creating the encryption key in PowerShell is only
one optional setup method; any cryptographically secure 32-byte Base64 generator
can be used. Never use an online key generator that receives or retains the key.

## One-time deployment

1. Run [background-follow-ups-migration.sql](../src/backend/supabase/background-follow-ups-migration.sql)
   in the Supabase SQL Editor. This adds a service-role-only receipt function that
   locks and merges the affected application, email and alert, preserving other
   workspace fields and newer follow-up dates.
   It also adds a server-only snapshot function that returns just the small set
   of scheduled application fields. Re-run this migration if you installed an
   earlier version: it is safe to run again.
2. In Cloudflare → this Worker → Settings → Variables and Secrets, configure these
   **secrets**, never frontend variables or committed configuration:
   - `SUPABASE_SERVICE_ROLE_KEY`: the project's server-only legacy service-role key.
     It is used to read the specific enabled user's saved schedule and call the
     receipt function; it is never returned to a browser.
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: the same Google web OAuth client
     used for Supabase Google sign-in and the existing Gmail renewal endpoint.
   - `FOLLOW_UP_TOKEN_KEY`: a cryptographically random 32-byte key, encoded as
     standard Base64. Keep it stable; replacing it requires reconnecting enabled
     Gmail accounts. Generate it locally and enter it directly into Cloudflare's
     secret field; do not paste it into chat or source files.
3. Build with `pwsh -File scripts/build-cloudflare.ps1` and deploy the Worker and
   assets together using the existing `wrangler.jsonc`. The existing
   `FOLLOW_UP_DELIVERIES` binding and migration are reused. **No Cron Trigger is
   required**: each enabled account uses a Cloudflare Durable Object alarm.
4. Open Settings & account → **Background follow-ups** → **Enable background
   sending**. If prompted, reconnect Gmail first and grant read and send access.
   This uses the saved offline Google authorization from Google sign-in, not a
   temporary Gmail-only popup token. The mailbox must match the verified account
   email. Google OAuth consent and redirect URLs must already allow the deployed
   app. An OAuth app still in Google's external Testing mode may require frequent
   reconnection; review Google's production/verification requirements.
5. Enable automatic follow-up on the desired applications and save them. Existing
   overdue automatic schedules become eligible as soon as background sending is
   enabled, subject to the client's sending window. The first check runs within
   roughly one minute; subsequent checks run about every five minutes.

The scheduler uses alarms rather than a global cron scan so that each enabled
account owns its encrypted connection and schedule. No email is sent just by
deploying: server setup and account opt-in are both required. **Turn off** deletes
the encrypted Gmail connection and cancels its next alarm. It does not disable
existing browser-based automatic sending while the page is open. An email already
submitted to Gmail cannot be cancelled by turning background sending off.

## Sending and recovery

- Uses the current follow-up composer template and reads only saved schedule fields on
  each run. Only applications marked `automaticFollowUp` are eligible; active
  clients, rejected applications, invalid email addresses and unknown timezones
  are excluded.
  Email bodies, tasks, documents and unrelated workspace fields are not downloaded
  by the scheduler. The final cancellation check reads only the affected application.
- Sends Monday–Friday, 8 AM–5 PM in the client timezone, including DST. Overdue
  schedules wait for the next permitted window. Up to ten eligible applications
  are processed per check.
- Reads Gmail Sent for evidence of an earlier follow-up, then claims the same
  durable account/application/date reservation used by browser sending. Repeated
  alarms, open tabs, restarts and stale workspace snapshots cannot claim a second
  send for that date.
- Rechecks the saved record and the enabled connection immediately before sending.
  Cancellation, editing and turning off prevent a send that has not started.
- Explicit Gmail rejections can retry. A timeout or uncertain acceptance keeps the
  shared reservation locked. Later runs check Sent to recover the result; they
  never blindly resend. Settings lists these as **Needs review**.
- Successful delivery receipts are retained independently of workspace snapshots.
  Database failures leave an unsynced receipt for a later alarm to save. The
  database merge clears only the matching old schedule, and adds sent mail and a
  follow-up alert. Normal workspace reload/realtime refresh displays the result on
  the website and Android. Gmail sync can also import the original sent message.
- Revoked Google authorization pauses the connection and shows **Reconnect Gmail**.
  A Google password is never stored. Refresh tokens are AES-256-GCM encrypted with
  the account ID as authenticated data. No token is included in status responses.

Cloudflare alarms can be delivered more than once, so correctness depends on the
shared delivery ledger, not on a timer firing exactly once. Durable Objects and
Gmail operations count toward their respective service usage. Provider outages can
delay checks; the cadence is not a guaranteed delivery deadline.

Local preview: the optional ignored `scripts/local_server.py` can forward
`/api/follow-up/background` GET/POST/DELETE to the deployed Worker. Wrangler with
local bindings is separate from production and needs local secrets and its own
test setup. Do not enable a real mailbox in a test deployment accidentally.

## Verification

```text
node scripts/test-background-follow-ups.mjs
node scripts/test-background-follow-ups-ui.mjs
node scripts/test-follow-up-delivery.mjs
node scripts/test-follow-up-browser.mjs
node scripts/test-worker-session.mjs
```

The background tests use mocked Gmail and Supabase: they never send real mail.
The optional PostgreSQL test uses `@electric-sql/pglite`; set `PGLITE_MODULE` to its
installed `dist/index.js` path and run `node scripts/test-background-follow-ups-sql.mjs`.

References: [Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[Google offline authorization](https://developers.google.com/identity/protocols/oauth2/web-server),
[Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending).

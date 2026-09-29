# Jeff VA — private local frontend + Supabase

This version keeps the existing UI and application behavior, but moves app data from browser localStorage/IndexedDB into your private Supabase project.

## What is stored where

- **Supabase Postgres:** applications, daily tasks and completion history, readable Gmail messages, alerts, and saved email templates.
- **Supabase Storage (private bucket):** attached PDF/Word files.
- **Browser storage:** the Supabase login session is kept only in the current browser tab session; closing the tab requires signing in again. The Gmail OAuth token is kept for the current browser tab session and reused for automatic sync after signing back in. Google may require a new sign-in if that token expires.
- **Not stored automatically in the browser:** application data and document files.
- **Excel export:** creates a local `.xlsx` backup with application, client, reminder, tool, and daily task sheets. Email history and document binaries are not placed in the Excel file.

## Important security rule

The frontend uses the Supabase **anon/publishable key** only. Never put a Supabase `service_role`/secret key in this project. The database and Storage are protected by Row Level Security (RLS) so an authenticated user can access only their own row/files.

## Setup

1. Create a project at Supabase.
2. In Supabase, open **SQL Editor** and run the complete contents of `sql/supabase-schema.sql`.
   This enables Supabase Realtime, configures the private document bucket to accept only PDF/Word files up to 25 MiB, and adds a secured aggregate-only function for this project's storage totals. Re-run the script when the schema changes; the storage function returns byte/file totals but no object names.
3. In Supabase, open **Authentication -> Users** and create your private user account. Use the email/password you want to use on the Jeff VA login screen.
4. In Supabase, open **Project Settings -> API** and copy:
   - **Project URL**
   - **Publishable/anon key** (use the browser-safe key shown for client applications)
5. Edit `js/supabase-config.js`:

```js
window.SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
window.SUPABASE_ANON_KEY = 'YOUR-PUBLISHABLE-OR-ANON-KEY';
window.SUPABASE_LOGIN_EMAIL = 'your-supabase-login-email@example.com';
```

6. `js/supabase-config.js` contains the project URL and publishable/anon key, which are visible to browsers by design. Never put a service-role/secret key or Google OAuth client secret in frontend files. Supabase RLS is what protects user data.
7. Keep the GitHub repository private if you do not want people browsing the source. A deployed website still exposes the files you choose to publish, so deploy only the runtime assets.
8. For the most reliable local-browser behavior, run the folder from a small local HTTP server instead of opening `index.html` directly:

```powershell
python local_server.py
```

Then open `http://127.0.0.1:8080` on the same computer. The local server listens only on this computer and is not available to phones or other computers on the network. Keep the server window open while using the app.

For Windows, you can double-click `start-jeff-va.bat` in the project folder. It starts the local server and opens Jeff VA in your browser, so you do not need to open VS Code or type the commands manually. Keep the small server window open while using the app.

## Cloudflare Pages deployment

Connect the private GitHub repository to Cloudflare Pages with production branch `main`, build command `bash ./build-cloudflare.sh`, and output directory `dist`. The build copies only `index.html`, CSS, the favicon, browser JavaScript/config, and Cloudflare response headers. Do not set `appwork` itself as the output directory; that would also publish the local server, SQL schema, README, and source modules. The Pages output includes a Content Security Policy and standard security headers.

The local Python server and its automatic Documents backup are not included in the Pages output. Supabase records and private document storage continue to work online.

## Automatic Documents backup

When Jeff VA is started with `start-jeff-va.bat`, it automatically keeps `Jeff VA Backup.xlsx` current in your Windows **Documents** folder. It updates immediately after every saved change, once a minute while the app is open, and again when the browser is hidden or closed. The Settings panel shows the time of the latest successful Documents backup. This is one rolling backup file, not a new download each time. It contains the same application, active-client, invoice, reminder, link, and script data as the normal Excel export; attached document binaries and email history are not included.

The existing **Automatic Excel backup** setting still controls optional daily/weekly browser downloads. The Documents-folder backup runs independently and needs the local server started by `start-jeff-va.bat`.

## JavaScript source files

The browser loads the generated `js/app.js` bundle. Edit the ordered source modules in `js/modules/` instead:

- `01-core.js` — shared state, Supabase loading/saving, authentication, and utilities.
- `02-email-matching.js` — email matching and dashboard/application rendering.
- `03-documents.js` — client and personal document handling.
- `04-gmail.js` — Gmail authorization, syncing, and sending.
- `05-backup.js` — Excel export and restore.
- `pages/06-shell-events.js` — navigation, dashboard controls, notifications, and shared layout behavior.
- `pages/07-applications-page.js` — application form, filters, and the Active Client document/email workflow.
- `pages/08-to-apply-page.js` — application-reminder controls.
- `pages/09-daily-task-page.js` — daily planning, task completion, and task history.
- `pages/09-active-clients-page.js` — active-client details, contracts, documents, and invoices.
- `pages/10-inbox-page.js` — inbox and email-composer controls.
- `pages/11-tools-page.js` — personal documents, scripts, and work links.
- `pages/12-auth-startup.js` — unchanged login/logout behavior and application startup.

`start-jeff-va.bat` rebuilds `js/app.js` from these modules before starting the server. The build preserves one shared JavaScript closure, so splitting the source does not change runtime behavior or data access. The application activation flow is isolated in the Applications page module: Next remains disabled until its selected contract has uploaded, and cancelling the document or email step restores the original application and removes the staged upload. The app also refuses to save until Supabase has successfully loaded the current user's state, preventing a failed startup from overwriting cloud data with an empty application list.

## Google login

The app derives its OAuth return URL from the page currently open, so the deployed site does not redirect to localhost. For the production Worker URL `https://jeff-va-monitoring.jeffdigi.workers.dev`:

1. In Supabase **Authentication -> URL Configuration**, set **Site URL** to `https://jeff-va-monitoring.jeffdigi.workers.dev` and add `https://jeff-va-monitoring.jeffdigi.workers.dev/**` under **Redirect URLs**. Keep `http://127.0.0.1:8080/**` and `http://localhost:3000/**` only if you still use those local development URLs.
2. Under Supabase **Authentication -> Providers -> Google**, use the Google OAuth **Web application** client ID and secret.
3. In Google Cloud Console for that same OAuth client, add `https://jeff-va-monitoring.jeffdigi.workers.dev` under **Authorized JavaScript origins**. Origins contain only scheme and hostname, with no path or trailing slash. Keep `http://127.0.0.1:8080` and optionally `http://localhost:3000` there only for local development.
4. In Google Cloud Console, keep the **Authorized redirect URI** equal to the Supabase callback URL shown in Supabase's Google provider settings (normally `https://oeooedwobhmpwwdohrcy.supabase.co/auth/v1/callback`). Do not replace this callback with the Worker URL.
5. Keep the client ID in `js/gmail-config.js` the same as the client ID configured in Supabase. For personal use while Google's consent screen is in Testing, add your Google account as a test user.

The Google login button creates the Supabase session directly, so a separate Supabase email/password login is not required. After changing the settings, sign out, open the Worker URL, and reconnect Google there. Never share an OAuth callback URL containing values after `#` or `?`; those may contain active tokens.

## Supabase password recovery

For an email/password Supabase account, use the recovery option under the signed-in **Password** page. The reset link returns to the app origin that requested it. In Supabase **Authentication -> URL Configuration -> Redirect URLs**, allow `https://jeff-va-monitoring.jeffdigi.workers.dev/**` and keep `http://127.0.0.1:8080/**` only for local development. Open the recovery link in the same browser where the app is running and set/confirm the new password in the recovery dialog. Google-only accounts must change their Google password through Google Account security instead.

## Using the same private dashboard on another laptop

Copy the same project folder to the laptop and open it through the local HTTP server. Enter the same Supabase email/password. The records and documents will load from Supabase, so they are not tied to the first browser/device.

## Existing local data

This version does not automatically upload the old browser's localStorage/IndexedDB data. If you have important data in the old version, open the old version, export its Excel backup, then use **Restore from Excel** in this version after logging in. That restore writes the imported records to Supabase.

## Gmail

Gmail continues to use Google's browser OAuth flow directly. When Google login is configured with Gmail scopes, the inbox sync starts automatically after login. Your Gmail access token is kept only for the current browser session; it is not uploaded to Supabase by Jeff VA.

Gmail sync and sending require the Gmail API and the OAuth client to allow `https://jeff-va-monitoring.jeffdigi.workers.dev` as an authorized JavaScript origin. Add `http://127.0.0.1:8080` (and optionally `http://localhost:3000`) only for local development. The OAuth consent screen must include your Google account as a test user while the app is in testing mode. After changing origins or enabling email sending, sign in with Google so the app receives the requested permissions.

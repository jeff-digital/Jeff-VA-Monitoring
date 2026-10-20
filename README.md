# Jeff VA Monitoring

Jeff VA Monitoring is a web app for organizing job applications and virtual-assistant client work in one place. It brings together application and client tracking, tasks and reminders, documents, invoices, email, and client onboarding.

## Features

- Track job applications, platforms, status, and follow-up dates.
- Automatically mark pending applications as rejected after one calendar month and show a sign-in notice listing the applications that changed.
- Manage active clients, contracts, documents, invoices, and reminders.
- Send token-based, one-time client onboarding forms for working preferences and first-week priorities.
- Organize tasks, reusable scripts, and helpful links.
- Connect Gmail to view and manage work-related email.
- Automatically mark a pending application Rejected when its latest uniquely matched incoming email clearly says the role is filled/closed or the applicant will not proceed. Each saved change creates an unread Applications notification with the reason and a link to the email. Ambiguous wording, quoted messages, sent mail, older emails, offers, and active clients do not trigger this rule. Changes require a successful Gmail sync while the app is open; this is conservative phrase matching, not an AI service. Manually reopening an application preserves its processed-email marker so the same message cannot reject it again.
- Send and review client onboarding forms.
- Sync application and client data with Supabase.
- Export and restore selected records using Excel workbooks.

## Technology

- HTML, CSS, and JavaScript
- Supabase for hosted data and file storage
- Google Identity and Gmail API integrations
- Python standard library for the optional local development server
- Cloudflare Workers static-asset deployment

## Project structure

```text
src/
  frontend/       Web app, styles, assets, and onboarding pages
  backend/        Supabase setup files
templates/        Reusable document and email templates
scripts/          Build tools and local development server
dist/             Generated site output; do not edit manually
wrangler.jsonc    Cloudflare Workers deployment configuration
start-jeff-va.bat Windows startup shortcut
```

## Getting started

### 1. Clone the repository

```bash
git clone <repository-url>
cd Jeff-VA-Monitoring
```

### 2. Configure external services

Set up a Supabase project and apply the schema in `src/backend/supabase/supabase-schema.sql`. Configure the frontend with your own Supabase project URL and **publishable** key in `src/frontend/js/supabase-config.js`.

To enable client profile photo uploads on an existing Supabase project, run `src/backend/supabase/profile-photo-storage-migration.sql` in the Supabase Dashboard SQL Editor. It allows JPEG, PNG, and WebP images in the existing private client documents bucket while preserving the bucket's other allowed file types.

### Workspace recovery history

The app's design and static-code deployments do not delete Supabase data. To protect against an accidental overwrite, restore action, or a future application change that saves an incomplete workspace, run `src/backend/supabase/app-state-history-migration.sql` once in the Supabase SQL Editor. It preserves the version immediately before every workspace update or deletion, retaining the most recent 60 recovery points per user. It does not modify existing data when installed.

Excel exports remain a separate, recommended offline backup. The automatic Documents backup works only when the app is launched locally with `start-jeff-va.bat`; browser downloads depend on the device and browser settings.

### Client onboarding

- The real, invitation-only form is served at `/onboarding/`. It requires the Supabase setup above and an active client's invitation.
- `/onboarding/change-test.html` is a design preview with sample invitation details. It never submits data; draft answers are saved only in this browser's local storage and can be removed with Clear draft.
- Run `src/backend/supabase/client-onboarding-details-migration.sql` in the Supabase Dashboard SQL Editor when deploying the expanded live onboarding form. It updates the RPC signature and reloads the PostgREST schema cache required by the live page.
- For a fresh Supabase project, apply `src/backend/supabase/supabase-schema.sql` first.
- The page does not accept passwords or other account credentials. Screenshots can be added here after capturing the finished page at desktop and mobile widths.

Gmail integration is optional. To use it, configure a Google OAuth client for your app and set its client ID in `src/frontend/js/gmail-config.js`.

For Gmail updates to continue after returning to the app, add runtime secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to the Cloudflare Worker. These must match the Google OAuth client configured in Supabase Auth. Google sign-in requests offline access; users who connected before this change must connect once again to grant it. The authenticated `POST /api/gmail/refresh` route exchanges the Google refresh token without opening a popup. Google credentials are retained per dashboard user in the browser's persistent storage and removed by Log out. Dashboard login is tab-scoped: Supabase uses sessionStorage with automatic token renewal while the tab is active. Permanent dashboard auto-login is disabled, and a new browser session requires explicit sign-in. Refreshing the current tab preserves login. Some browsers restore tab sessionStorage with their restore-tabs feature; closing a tab is not a guaranteed server-side logout. Use Log out to explicitly end the session. Revoked or expired Google permission pauses email updates while keeping saved emails and the dashboard session available. Restart the local Python server after updating: it forwards Gmail renewal to the authenticated production Worker, keeping the OAuth secret out of localhost and the browser. Production must be deployed and configured for local renewal to work. Temporary upstream failures are retried without discarding the connection.

The frontend configuration is delivered to browsers. Use only values intended to be public there; never put private keys, service-role keys, or OAuth client secrets in frontend files or commit them to Git.

### 3. Build and run locally

On Windows, run `start-jeff-va.bat` from the repository root. It builds the frontend bundle, starts the local server, and opens the app.

Alternatively, run the steps separately:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-app.ps1
python .\scripts\local_server.py
```

Then open <http://localhost:8080>. The local server requires Python and uses the standard library.

## Configuration

- **Supabase:** project URL, publishable browser key, and database setup.
- **Google/Gmail (optional):** OAuth client configuration for sign-in and Gmail features.
- **Cloudflare Workers:** hosting configuration is defined in `wrangler.jsonc`; Workers Builds runs the static-site build before deploying.

Use your own service accounts and credentials. Keep private values outside the repository, for example in local environment configuration, and ensure they are excluded from version control.

## Build

Build the Cloudflare Workers static assets from Git Bash or another Bash environment:

```bash
bash ./scripts/build-cloudflare.sh
```

On Windows PowerShell, use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-cloudflare.ps1
```

The generated site is written to `dist/`. This directory is build output, is ignored by Git, and should not be edited directly.

## Deployment

For the Cloudflare Workers Git integration, set the root directory to `/`, the build command to `bash ./scripts/build-cloudflare.sh`, and the deploy command to `npx wrangler deploy`. The Wrangler configuration publishes the generated `dist/` directory; a root-level `index.html` is not needed. Keep hosting-provider credentials and project settings outside the repository.

## Security

### News feed on Cloudflare Workers

The Worker entry point `src/backend/worker.mjs` serves `/api/news` and `/api/tools`, verifies the dashboard's Supabase bearer session, and delegates other requests to the static assets binding. Cloudflare Access protections, if configured, should stay enabled. Provider keys are runtime secrets, never build variables or frontend values.

Add `GNEWS_API_KEY` in the Worker's Settings > Variables and Secrets. Optional providers use `YOUTUBE_API_KEY` and `PRODUCT_HUNT_TOKEN`. No service-role key is needed for the news endpoints. The public Supabase URL and publishable key are configured in `wrangler.jsonc`.

Build with `bash scripts/build-cloudflare.sh`, then deploy with `npx wrangler deploy` (or the existing Git integration). Adding a secret alone does not deploy the new Worker code. For local live news, use `npx wrangler dev` after building; the Python static server does not execute the Worker API. Put local credentials in an ignored `.dev.vars` file.

The News page loads only after sign-in, on opening News, and refreshes hourly while visible. Server responses are cached for one hour; Refresh respects that cache. GNews requests are capped at ten articles per page for the free plan. The provider's request limits, publication delay, and license still apply. Failed sources display a message or allow the other source to continue. Optional unconfigured providers are skipped.

The News toolbar shows an app-tracked GNews request count for the current UTC day. It increments only when the Worker contacts GNews, not when an article response is served from cache, and resets at 00:00 UTC. GNews does not expose its authoritative account counter through the news API, so use the GNews dashboard if the app count and provider account count differ.

The News topic selector includes Business for the UK, Australia, US, and Canada, plus VA Philippines and Remote Work. These filters use the existing GNews connection, so they do not require additional API credentials.

Social media trends focuses on marketing, brand campaigns, and products across social platforms, including TikTok, Instagram, Facebook, YouTube, Twitter/X, Reddit, LinkedIn, Snapchat, Pinterest, Threads, and Bluesky. The general social-media term also covers other platforms. Business targets UK, US, Canadian, and Australian business challenges in staffing, hiring, workload, productivity, customer service, growth, and costs, to help identify areas where a VA could support an owner. These are publisher reports, not generated diagnoses or claims that a specific company needs a VA. All news includes viral stories. This uses the existing GNews key, cache, deduplication and request counter; article links open the publisher, and are not guaranteed to link directly to a video. It does not provide live video view counts or sound-use statistics.

Run `node scripts/test-news.mjs` for mocked endpoint tests covering authentication, static routing, provider failure, caching, article images, and secret handling. Live production verification requires deployment and the runtime secret.

- Do not commit passwords, tokens, private keys, service-role keys, or other private credentials.
- Never place administrative or server-only credentials in browser code.
- Keep local credential files out of Git and rotate any credential that may have been exposed.
- Report security concerns privately to the repository maintainer rather than posting sensitive details publicly.

## Development

Edit frontend source in `src/frontend/`; do not edit the generated `dist/` output. The Windows startup shortcut is `start-jeff-va.bat`. To rebuild the Cloudflare Workers output, run `bash ./scripts/build-cloudflare.sh`.

## License

This repository currently has no explicit open-source license.

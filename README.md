# Jeff VA Monitoring

Jeff VA Monitoring is a web app for organizing job applications and virtual-assistant client work in one place. It brings together application and client tracking, tasks and reminders, documents, invoices, email, and client onboarding.

## Features

- Track job applications, platforms, status, and follow-up dates.
- Manage active clients, contracts, documents, invoices, and reminders.
- Organize tasks, reusable scripts, and helpful links.
- Connect Gmail to view and manage work-related email.
- Send and review client onboarding forms.
- Sync application and client data with Supabase.
- Export and restore selected records using Excel workbooks.

## Technology

- HTML, CSS, and JavaScript
- Supabase for hosted data and file storage
- Google Identity and Gmail API integrations
- Python standard library for the optional local development server
- Cloudflare Pages-compatible static build

## Project structure

```text
src/
  frontend/       Web app, styles, assets, and onboarding pages
  backend/        Supabase setup files
templates/        Reusable document and email templates
functions/        Cloudflare Pages Functions location
scripts/          Build tools and local development server
dist/             Generated site output; do not edit manually
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

Gmail integration is optional. To use it, configure a Google OAuth client for your app and set its client ID in `src/frontend/js/gmail-config.js`.

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
- **Cloudflare Pages (optional):** hosting configuration for deploying the generated site.

Use your own service accounts and credentials. Keep private values outside the repository, for example in local environment configuration, and ensure they are excluded from version control.

## Build

Build the Cloudflare Pages-compatible static site from Git Bash or another Bash environment:

```bash
bash ./scripts/build-cloudflare.sh
```

The generated site is written to `dist/`. This directory is build output, is ignored by Git, and should not be edited directly.

## Deployment

Build the site, then deploy the contents of `dist/` using your configured static hosting provider. For Cloudflare Pages, use `dist/` as the build output directory. Hosting-provider credentials and project settings should be managed outside this repository.

## Security

- Do not commit passwords, tokens, private keys, service-role keys, or other private credentials.
- Never place administrative or server-only credentials in browser code.
- Keep local credential files out of Git and rotate any credential that may have been exposed.
- Report security concerns privately to the repository maintainer rather than posting sensitive details publicly.

## Development

Edit frontend source in `src/frontend/`; do not edit the generated `dist/` output. The Windows startup shortcut is `start-jeff-va.bat`. To rebuild the Cloudflare Pages output, run `bash ./scripts/build-cloudflare.sh`.

## License

This repository currently has no explicit open-source license.

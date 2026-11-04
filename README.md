# Jeff VA Monitoring

Jeff VA Monitoring is a multi-user workspace for organizing job applications and virtual-assistant client work, with account-specific records across the website and Android app.

## Features

- Job application tracking and follow-up reminders.
- Client and subscription management.
- Daily tasks, calendars, and weekly reports.
- Work-related email organization.
- Documents, invoices, and reusable templates.
- Data export and backup tools.
- Responsive layouts for desktop and mobile.
- Native Android interface connected to the same account data (see [Android build instructions](android/README.md)).

## Native Android companion

Jeff VA also has a **native Android application built with Java and Android Views**, connected to the management system's Supabase data and Cloudflare APIs. It includes dashboards, client/application tracking, tasks, email organization and mobile account settings.

See the [Android source, sample screenshots and setup](android/README.md). The separate [interactive design preview](android/design-preview/README.md) uses synthetic records and has no connected account. Private sessions, signing keys, live mobile configuration and generated APKs are excluded from this repository.

## Access

The application is intended for authorized users. Access to this repository does not grant permission to use private accounts, connected services, or stored information.

## Development

Frontend source is maintained in `src/frontend/`, with JavaScript organized into shared and page-specific files. Build tools are maintained in `scripts/`. Generated output should not be edited directly.

The [page-first storage preparation guide](docs/workspace-storage-preparation.md) describes the shared website/Android storage API, complete-record JSON backups, and the next D1 migration phase. Existing data remains in Supabase during this preparation.

### Folder guide

| Location | Contents |
| --- | --- |
| `src/frontend/` | Website pages, styles, and JavaScript. |
| `src/frontend/images/` | Logos, article images, and other images used by the website. |
| `src/backend/` | Cloudflare Worker entry point. |
| `functions/api/` | Server API handlers used by the Worker. |
| `android/` | Native Android app, build tools, and mobile design preview. |
| `scripts/` | Website build, local server, and verification tools. |
| `docs/` | Project and feature documentation. |
| `docs/previews/homepage/` | Local homepage and login design screenshots; excluded from Git and deployment. |
| `templates/` | Reusable document and email templates. |
| `dist/` | Generated website build; excluded from Git. |

Keep design screenshots in `docs/previews/`, and put images required by the website in `src/frontend/images/`. The root contains repository configuration, `wrangler.jsonc`, and this guide.

Personal local tooling (`start-jeff-va.bat`, `scripts/local_server.py`, and `scripts/test_local_gmail.py`) is excluded from Git, along with machine-specific editor settings, local tool state, credentials, and generated output. Build scripts, shared tests, and the Android Gradle wrapper remain versioned so the project can be built and maintained from the repository.

Environment setup, service configuration, deployment procedures, and operational details should be maintained in private documentation available to authorized maintainers.

## Security and privacy

Workspace records now use Cloudflare D1; Supabase continues to provide authentication and existing file storage. See [D1 migration](docs/d1-migration.md) for backup verification, device updates and the final legacy-write permission step.

Keep passwords, tokens, private keys, and other credentials outside the repository. Use sample information when sharing screenshots or reporting issues.

Report suspected security issues privately to the repository maintainer. Do not include credentials, personal information, or exploit details in public issues.

## License

This repository currently has no explicit open-source license.

# Jeff VA Monitoring

Jeff VA Monitoring is a personal workspace for organizing job applications and virtual-assistant client work.

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

Environment setup, service configuration, deployment procedures, and operational details should be maintained in private documentation available to authorized maintainers.

## Security and privacy

Keep passwords, tokens, private keys, and other credentials outside the repository. Use sample information when sharing screenshots or reporting issues.

Report suspected security issues privately to the repository maintainer. Do not include credentials, personal information, or exploit details in public issues.

## License

This repository currently has no explicit open-source license.

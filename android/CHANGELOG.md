# Android changes

## 1.4.1 — November 7, 2026

- Added persistent native connection status, Retry and automatic recovery attempts without rebuilding open forms.
- Added short page reveals and sheet transitions that respect Android animation settings.
- Guarded initial loading against duplicate retry requests.
- Reviewed all 21 preview pages and corrected upload routing, client edits/tasks, calendars, financial forms, category filtering and validation.
- Improved preview typography, form spacing, copy feedback and keyboard-aware navigation.

## 1.4.0 — November 7, 2026

- Refreshed shared native screens with large titles, white backgrounds, soft neutral cards and blue accents.
- Simplified bottom navigation and grouped More links into sections.
- Coordinated search, filters, segmented tabs, forms, action sheets and settings switches.
- Retained separate To do/Completed tasks, client photos, dashboard charts, contextual Add actions and pull-to-refresh.
- Updated the synthetic browser preview and its sample screenshots to match the new direction.
- Explicitly use UTF-8 when compiling Java, preserving symbols across Windows and Linux builds.

This release changes presentation, not backend behavior. Closed-app push and automatic Gmail ingestion still require server setup. Browser previews do not verify physical-phone layout, performance, accessibility services or account integration.

# Reload recovery

A remembered sign-in keeps the current page on reload instead of forcing the dashboard. Once account data loads, the website restores the selected client/tab and unfinished form, including invoice fields, service lines, branding, weekly calculations, and email text.

Main workspace forms are covered: invoice generation/upload/payment, email composition, applications/client details, daily/client tasks, reminders, scripts, links, wallet entries, subscriptions and social trends. A small status message confirms unfinished work is saved in the browser tab. Successful invoice saves and sent emails clear their unfinished state; closing or cancelling a form discards that open draft. Recovery never submits a form or sends an email.

Draft text is stored in **sessionStorage**, scoped by account and tab. It survives refresh in the same tab. Closing the tab or clearing site data can remove it. Use the application's Save/Send actions to commit records to the account. Passwords, authentication tokens, login and destructive/security forms are excluded. Signing out hides and resets the visible forms; another account does not restore the previous account's work.

Attachments up to 25 MB are kept locally in IndexedDB with owner/tab checks. Generated invoice PDFs can also be recreated from an unchanged saved invoice when necessary. If the browser cannot recover a file, the email/upload screen asks for it again; invoice sending requires an attachment. File-change handlers that upload content are not replayed automatically.

Restoration waits for authenticated workspace loading. Startup mutations cannot overwrite an existing draft before it is recovered. Edited invoice drafts retain their original revision snapshot so the existing stale-invoice check still protects changes made on another device. Password recovery retains its dedicated flow.

Verification: `node scripts/test-tab-auth.cjs`, `node scripts/test-browser-drafts.cjs`, and the invoice checks. The DOM recovery test uses `linkedom`; set `JEFF_VA_DOM_MODULE` to its installed module path when it is not in the local invoice-review tools folder. No database migration is required.

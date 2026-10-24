# Page-based JavaScript split report

Branch: `refactor/page-split` (based on `main` at `67379f7`).

This is a code-organization change only. The two original source files reconstruct
exactly after line-ending normalization. The ordered sequence of all 13,458
nonblank code lines is identical in the committed frontend bundle and `dist`.
No application symbol, statement, listener, data key or runtime behavior changed.
HTML/CSS Phase 3 is disabled and was skipped. Nothing was merged or pushed.

## 1. Files created/changed

All module paths below are relative to `src/frontend/js/modules/`. Cuts use the
listed top-level symbol anchors, not line numbers. No page banners were added.

| File | Original file | First -> last symbol/content |
| --- | --- | --- |
| `02-email-matching.js` (retained head) | Same | Existing comment, `PLATFORM_SENDER_EMAILS` -> `applicationMatchIndexSignature` |
| `pages/09a-client-social-links.js` | `02-email-matching.js` | `activeClientDetailsModalEdit`, `CLIENT_SOCIAL_PLATFORM_LABELS` -> `#addClientSocialLink` / `#clientSocialLinksList` listeners |
| `02b-application-email-match-engine.js` | `02-email-matching.js` | `applicationMatchSignature` -> `matchBadge` |
| `pages/07a-dashboard-page.js` | `02-email-matching.js` | `renderDashboard` -> `renderRecentApplications`; includes both dashboards, calendar and charts |
| `pages/07b-applications-render.js` | `02-email-matching.js` | `applicationWeekOptions` -> `renderApplications` -> `emailWeekOptions`; includes existing follow-up rendering helpers |
| `pages/08a-to-apply-render.js` | `02-email-matching.js` | `renderToApplyList` -> `updatePlatformFilter` |
| `pages/10b-inbox-render.js` | `02-email-matching.js` | Complete `renderEmails` function |
| `pages/09b-active-clients-render.js` | `02-email-matching.js` | `hiredClients` -> `closeHiredDetail` |
| `pages/06a-view-router.js` | `02-email-matching.js` | `updateWeekNavigationCounts` -> `showView`; router, render functions and inbox attention state remain contiguous |
| `pages/07c-application-form.js` | `02-email-matching.js` | `saveNewClientApplicationDraft` -> `deleteClient` |
| `03-documents.js` (retained prefix) | Same | Existing prefix through `saveClientEmailNotifications`; scripts, links, invoices and client-email alerts remain here |
| `03b-notifications-and-reminders.js` | `03-documents.js` | `generatedNotificationTypes` -> `clearAlerts`; includes notifications and due-reminder/follow-up processing |

Other files:

- `scripts/js-modules.txt`: added the ten slice paths consecutively at the original
  `02`/`03` positions. Original 24 entries retain their relative order; total 34.
- `src/frontend/js/app.js`: rebuilt committed shared-IIFE bundle. Its only
  normalized diff is ten extra blank separator lines from concatenation.
- `scripts/build-app.cjs`: dependency-free Node equivalent of the PowerShell
  committed-bundle build; verified against unchanged modules before cutting.
- `scripts/verify-split-parity.cjs`: dependency-free baseline comparison for both
  bundles; ignores only EOL differences, trailing whitespace, blanks and permitted
  `// Page:` banners (none were used).
- `scripts/lib/read-modules.cjs`: reads named slices in manifest order and exports
  the two original-file groups for source-slicing tests.
- Nine tests: module read expressions/helper imports only, listed in section 3.
- This report.

Each file move has its own commit, including its manifest entry and rebuilt
bundle. The cuts were made tail-first so every intermediate commit preserves the
original order. All 26 Node tests, Python tests, syntax, bundle parity and exact
source reconstruction passed after every move.

| Move | Commit |
| --- | --- |
| Application form | `d6097b4` |
| View router | `0eba7f4` |
| Active Clients renderer | `d831f79` |
| Inbox renderer | `988e8b9` |
| To Apply renderer/CRUD | `5db9399` |
| Applications renderer | `2b3016c` |
| Dashboard renderer | `61f75ef` |
| Email matching engine | `b462672` |
| Client social links | `524350f` |
| Notifications/reminders | `73349b7` |

Setup/read-adapter commit: `80644f8`. A final documentation commit records this
report separately from the file moves.

## 2. G1-G7 commands and results

On Windows, the requested `/tmp` baselines were stored in their system-temp
equivalents: `$env:TEMP/baseline-app.js` and `$env:TEMP/baseline-ids.txt`.
Original module contents, original manifest, the baseline dist bundle, per-move
test logs and the final audit script/logs are in
`$env:TEMP/jeff-va-page-split-baseline/`, outside the repository.

### G1: full tests — PASS

The same test selection was run before changes, after the read adapter, after
each cut, and for final verification. The final execution used PowerShell:

```powershell
$tests = Get-ChildItem -LiteralPath scripts -File |
  Where-Object { $_.Name -match '^test-.*\.(cjs|mjs)$' } | Sort-Object Name
foreach ($test in $tests) {
  node $test.FullName
  if ($LASTEXITCODE -ne 0) { throw "Test failed: $($test.Name)" }
}
& 'C:/Users/Jeffrey/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' scripts/test_local_gmail.py
```

```text
G1 PASS: 26/26 Node tests
Local Gmail forwarding checks passed: origin, authentication, fixed upstream, renewal, and temporary failures.
Local AI forwarding checks passed: fixed route, authorization forwarding, timeout and unavailable deployment response.
```

Expected error-path fixtures log simulated quota/malformed-output diagnostics;
these tests still exit successfully, identically to the baseline.

### G2: bundle parity and builds — PASS

```powershell
node scripts/build-app.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-app.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-cloudflare.ps1
& 'C:/Program Files/Git/bin/bash.exe' scripts/build-cloudflare.sh
node scripts/verify-split-parity.cjs
```

```text
PASS src/frontend/js/app.js: 13458 identical ordered nonblank code lines.
PASS dist/js/app.js: 13458 identical ordered nonblank code lines.
```

The Bash Cloudflare build ran before and after the cuts. The Node builder matched
the original committed bundle on unchanged modules after EOL normalization.
PowerShell and Bash builds also preserve the same final ordered code.

### G3: syntax — PASS

```powershell
node --check src/frontend/js/app.js
```

Result: exit 0; no syntax diagnostics.

### G4: order — PASS

Final G4-G7, test-diff and exact source-reconstruction audits were executed with:

```powershell
node "$env:TEMP/jeff-va-page-split-baseline/verify-final.cjs"
```

```text
G4 PASS: 24 original modules retain relative order; all 10 new modules precede startup; 34 manifest entries; manifest EOL style unchanged; new sources CRLF.
```

### G5: forbidden paths untouched — PASS

```powershell
git diff --stat main..HEAD
node "$env:TEMP/jeff-va-page-split-baseline/verify-final.cjs"
```

```text
G5 PASS: forbidden paths unchanged in git diff main..HEAD.
```

No changes to `functions/`, `src/backend/`, `wrangler.jsonc`, `_headers`, onboarding,
templates, `01-core.js`, `index.html`, `styles.css`, or `local_server.py`. Original
build scripts, `.gitignore`, and all other existing modules are unchanged.

### G6: HTML IDs — PASS

```text
G6 PASS: 806 HTML IDs identical, zero duplicates.
```

The audit compares the full ordered ID list to the saved baseline, stronger than
comparing only the set.

### G7: no new globals — PASS

```text
G7 PASS: original single top-level IIFE and exact ordered code retained; no imports/exports or new window names.
```

The audit verifies the original wrapper, compiles the bundle with `vm.Script`,
compares all ordered nonblank code lines, rejects import/export statements, and
compares the complete set of `window.*` names with the baseline. Existing listener
registration order is preserved by exact ordered-code parity.

## 3. Test diff summary

Only these tests changed:

```text
test-application-duplicates.cjs
test-application-quick-filters.cjs
test-email-direction.cjs
test-email-subject-follow-up.cjs
test-inbox-attention.cjs
test-onlinejobs-matching.mjs
test-automatic-email-tasks.cjs
test-gmail-sync-ui.cjs
test-subscriptions.cjs
```

Their changed lines are exclusively the module-read expression and helper
imports. The ESM test uses `createRequire(import.meta.url)`. Existing reads of
other files use their original expressions; no anchor string, fixture, assertion
or behavior check changed. The audit checks every added/deleted test-diff line
against the permitted read/import expression types.

```text
TEST DIFF PASS: 9 tests changed only module-read expressions/helper imports; no anchors or assertions changed.
SOURCE PASS: original 02 and 03 reconstructed exactly, including whitespace, after EOL normalization.
```

## 4. Mis-homed code deliberately left in place

- `emailWeekOptions` stays at the end of `pages/07b-applications-render.js`.
- `updatePlatformFilter` stays at the end of `pages/08a-to-apply-render.js`.
- Both Dashboard and Client Dashboard stay together in `pages/07a-dashboard-page.js`.
- `alertNewMatches` and its save helper stay in the retained `03-documents.js`
  prefix; only the specified notification tail was cut.
- `toast` remains in `05-backup.js`; AI service logic remains under `pages/10a`;
  original non-sequential file numbering remains unchanged.

## 5. Unexpected findings, out-of-scope issues and manual smoke checks

The brief describes existing module sources as CRLF, but the actual baseline
checkout contains LF in both files being split. Existing retained prefixes were
not reformatted. Newly created slice files use CRLF as explicitly required;
the original manifest's LF style was preserved. Full reconstructed source text
is identical after EOL normalization. No gate failed.

The screenshot attachment directory was untracked before work and remains
untracked. Stale nested folders, ignored caches and attachments were not used as
application sources. There are no dependency additions or new package files.

The task-provided audit findings remain unchanged and were not repaired:

1. Local `/social-trends` is absent from `APP_ROUTES`; the optional route fix was
   deliberately skipped to keep forbidden paths untouched.
2. Existing HTML cache-buster strings are stale; no-cache behavior is unchanged.
3. `emptyData()` lacks the `emailTaskAiUsage` key returned by the load allowlist.
4. Optional/dynamic HTML-ID references remain as provided in the audit.
5. Shared helpers, service file placement and numbering inconsistencies remain.
6. `/api/tools` remains unused by the frontend; the two classification endpoint
   modules retain their existing circular imports.
7. Workspace storage remains one last-write-wins JSON snapshot. Concurrent edits
   from different devices can still overwrite each other; this is architectural
   and outside the refactor.

Authenticated production behavior was not exercised offline. The owner should
run `start-jeff-va.bat`, sign in, and smoke-check both dashboards, daily tasks,
Applications, To Apply, News, Social Trends, Active Clients and detail tabs,
Inbox, Tools/Documents, Subscriptions, Wallet and Account. Reload each route;
check add/edit/delete with disposable records, the Saved indicator and persistence
after hard refresh. Check Gmail sync, one owner-controlled test email, Escape on
each drawer and the notification bell. The known local Social Trends route issue
above is expected to remain.

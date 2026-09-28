$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$jsRoot = Join-Path $projectRoot 'appwork\js'
$moduleRoot = Join-Path $jsRoot 'modules'
$moduleNames = @(
  '01-core.js'
  '02-email-matching.js'
  '03-documents.js'
  '04-gmail.js'
  '05-backup.js'
  'pages/06-shell-events.js'
  'pages/07-applications-page.js'
  'pages/08-to-apply-page.js'
  'pages/09-daily-task-page.js'
  'pages/09-active-clients-page.js'
  'pages/10-inbox-page.js'
  'pages/11-tools-page.js'
  'pages/12-weekly-report.js'
  'pages/12-auth-startup.js'
)
$wrapperStart = "(() => {`r`n  'use strict';`r`n`r`n"
$body = ($moduleNames | ForEach-Object { Get-Content -Raw -Encoding UTF8 (Join-Path $moduleRoot $_) }) -join "`r`n"
$wrapperEnd = "`r`n})();`r`n"
[System.IO.File]::WriteAllText((Join-Path $jsRoot 'app.js'), $wrapperStart + $body + $wrapperEnd, [System.Text.UTF8Encoding]::new($false))
Write-Host "Built appwork/js/app.js from $($moduleNames.Count) source modules."

$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDirectory
$sourceDirectory = Join-Path $repoRoot 'src\frontend'
$outputDirectory = Join-Path $repoRoot 'dist'
$resolvedRepoRoot = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\')
$resolvedOutput = [System.IO.Path]::GetFullPath($outputDirectory).TrimEnd('\')

if ($resolvedOutput -ne (Join-Path $resolvedRepoRoot 'dist')) {
  throw "Refusing to replace an unexpected output directory: $resolvedOutput"
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceDirectory 'index.html'))) {
  throw 'Frontend source is missing.'
}

if (Test-Path -LiteralPath $resolvedOutput) {
  Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}

@('css', 'images', 'js', 'onboarding') | ForEach-Object {
  New-Item -ItemType Directory -Path (Join-Path $resolvedOutput $_) -Force | Out-Null
}

$copies = @{
  'index.html' = 'index.html'
  '_headers' = '_headers'
  'css\styles.css' = 'css\styles.css'
  'images\tab.png' = 'images\tab.png'
  'js\gmail-config.js' = 'js\gmail-config.js'
  'js\supabase-config.js' = 'js\supabase-config.js'
  'onboarding\index.html' = 'onboarding\index.html'
  'onboarding\change-test.html' = 'onboarding\change-test.html'
  'onboarding\onboarding.css' = 'onboarding\onboarding.css'
  'onboarding\onboarding.js' = 'onboarding\onboarding.js'
  'onboarding\country-flags.svg' = 'onboarding\country-flags.svg'
  'onboarding\country-flags-LICENSE.txt' = 'onboarding\country-flags-LICENSE.txt'
}

foreach ($entry in $copies.GetEnumerator()) {
  Copy-Item -LiteralPath (Join-Path $sourceDirectory $entry.Key) -Destination (Join-Path $resolvedOutput $entry.Value)
}

$moduleNames = Get-Content -Encoding UTF8 (Join-Path $scriptDirectory 'js-modules.txt') | Where-Object { $_.Trim() }
$moduleContents = $moduleNames | ForEach-Object {
  (Get-Content -Raw -Encoding UTF8 (Join-Path $sourceDirectory "js\modules\$($_.Trim())")).TrimEnd("`r", "`n")
}
$bundle = "(() => {`n  'use strict';`n`n" + ($moduleContents -join "`n`n") + "`n})();`n"
[System.IO.File]::WriteAllText((Join-Path $resolvedOutput 'js\app.js'), $bundle, [System.Text.UTF8Encoding]::new($false))

Write-Host "Built Cloudflare assets in $resolvedOutput from $($moduleNames.Count) JavaScript modules."

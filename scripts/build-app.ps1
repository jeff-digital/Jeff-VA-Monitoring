$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDirectory
$jsRoot = Join-Path $projectRoot 'src\frontend\js'
$moduleRoot = Join-Path $jsRoot 'modules'
$moduleNames = Get-Content -Encoding UTF8 (Join-Path $scriptDirectory 'js-modules.txt')
$wrapperStart = "(() => {`r`n  'use strict';`r`n`r`n"
$body = ($moduleNames | ForEach-Object { Get-Content -Raw -Encoding UTF8 (Join-Path $moduleRoot $_) }) -join "`r`n"
$wrapperEnd = "`r`n})();`r`n"
[System.IO.File]::WriteAllText((Join-Path $jsRoot 'app.js'), $wrapperStart + $body + $wrapperEnd, [System.Text.UTF8Encoding]::new($false))
Write-Host "Built src/frontend/js/app.js from $($moduleNames.Count) source modules."

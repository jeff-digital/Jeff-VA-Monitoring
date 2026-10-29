$ErrorActionPreference = 'Stop'
$androidRoot = $PSScriptRoot
$projectRoot = Join-Path $androidRoot 'project'
$toolsRoot = Join-Path $androidRoot '.android-tools'
$savedJavaHome = $env:JAVA_HOME
$savedAndroidHome = $env:ANDROID_HOME
$savedGradleHome = $env:GRADLE_USER_HOME

function Assert-Succeeded([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed (exit $LASTEXITCODE)." }
}

try {
  if (-not $env:JAVA_HOME) {
    $env:JAVA_HOME = Get-ChildItem (Join-Path $toolsRoot 'jdk') -Directory | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $toolsRoot 'sdk' }
  if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle-cache' }
  $javaBin = Join-Path $env:JAVA_HOME 'bin'
  $buildTools = Join-Path $env:ANDROID_HOME 'build-tools\36.0.0'
  foreach ($file in @((Join-Path $javaBin 'java.exe'), (Join-Path $buildTools 'apksigner.bat'))) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Missing Android build dependency: $file. See android/README.md." }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'gradlew.bat'))) {
    throw 'Generate the Android project first: node android/generate.cjs'
  }
  $sdkProperty = 'sdk.dir=' + $env:ANDROID_HOME.Replace('\', '/').Replace(':', '\:')
  [System.IO.File]::WriteAllText((Join-Path $projectRoot 'local.properties'), "$sdkProperty`n")
  & (Join-Path $projectRoot 'gradlew.bat') -p $projectRoot --no-daemon --max-workers=2 testDebugUnitTest lintRelease assembleRelease
  Assert-Succeeded 'Build Android release'

  # DPAPI encrypts the signing password for the current Windows user.
  # Keep this excluded directory when making private backups for future APK updates.
  $signingRoot = Join-Path $androidRoot '.signing'
  New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null
  $currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $signingRoot /inheritance:r /grant:r "${currentIdentity}:(OI)(CI)F" /Q | Out-Null
  Assert-Succeeded 'Protect signing directory'
  $passwordFile = Join-Path $signingRoot 'password.dpapi'
  $keyFile = Join-Path $signingRoot 'jeff-va.keystore'
  if (-not (Test-Path -LiteralPath $passwordFile)) {
    if (Test-Path -LiteralPath $keyFile) { throw 'Signing key exists but its encrypted password is missing. Restore the password backup.' }
    $randomPassword = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $securePassword = ConvertTo-SecureString $randomPassword -AsPlainText -Force
    ConvertFrom-SecureString $securePassword | Set-Content -LiteralPath $passwordFile
    $randomPassword = $null
  }
  $securePassword = (Get-Content -LiteralPath $passwordFile -Raw).Trim() | ConvertTo-SecureString
  $credential = [System.Management.Automation.PSCredential]::new('apk-signing', $securePassword)
  $env:JEFF_VA_KEYSTORE_PASSWORD = $credential.GetNetworkCredential().Password
  if (-not (Test-Path -LiteralPath $keyFile)) {
    & (Join-Path $javaBin 'keytool.exe') -genkeypair -keystore $keyFile -alias 'jeff-va' -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Jeff VA, OU=Personal Applications' -storepass:env JEFF_VA_KEYSTORE_PASSWORD -keypass:env JEFF_VA_KEYSTORE_PASSWORD -noprompt
    Assert-Succeeded 'Create APK signing key'
  }
  $manifest = Get-Content (Join-Path $androidRoot 'app-config.json') -Raw | ConvertFrom-Json
  $outputRoot = Join-Path $androidRoot 'output'
  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  $apkFile = Join-Path $outputRoot "Jeff-VA-$($manifest.versionName).apk"
  $unsignedApk = Join-Path $projectRoot 'app\build\outputs\apk\release\app-release-unsigned.apk'
  & (Join-Path $buildTools 'apksigner.bat') sign --ks $keyFile --ks-key-alias 'jeff-va' --ks-pass env:JEFF_VA_KEYSTORE_PASSWORD --key-pass env:JEFF_VA_KEYSTORE_PASSWORD --out $apkFile $unsignedApk
  Assert-Succeeded 'Sign APK'
  & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $apkFile
  Assert-Succeeded 'Verify APK signature'
  & (Join-Path $buildTools 'zipalign.exe') -c 4 $apkFile
  Assert-Succeeded 'Verify APK alignment'

  $certificate = Join-Path $signingRoot 'certificate.der'
  & (Join-Path $javaBin 'keytool.exe') -exportcert -keystore $keyFile -alias 'jeff-va' -storepass:env JEFF_VA_KEYSTORE_PASSWORD -file $certificate
  Assert-Succeeded 'Export public signing certificate'
  $fingerprint = ((Get-FileHash -LiteralPath $certificate -Algorithm SHA256).Hash -split '(.{2})' | Where-Object { $_ }) -join ':'
  $metadata = @{ packageId = $manifest.packageId; versionName = $manifest.versionName; versionCode = $manifest.versionCode; certificateSha256 = $fingerprint; interface = 'Android Views' }
  [System.IO.File]::WriteAllText((Join-Path $outputRoot 'build-info.json'), (ConvertTo-Json $metadata))
  $apkHash = (Get-FileHash -LiteralPath $apkFile -Algorithm SHA256).Hash.ToLowerInvariant()
  [System.IO.File]::WriteAllText("$apkFile.sha256", "$apkHash  $([System.IO.Path]::GetFileName($apkFile))`n")
  Write-Host "APK ready: $apkFile"
  Write-Host 'Native Android workspace: no Chrome activity or WebView is used for the application interface.'
} finally {
  Remove-Item Env:JEFF_VA_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  $env:JAVA_HOME = $savedJavaHome
  $env:ANDROID_HOME = $savedAndroidHome
  $env:GRADLE_USER_HOME = $savedGradleHome
}

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const localConfig = path.join(root, 'android/app-config.json');
const hasLocalConfig = fs.existsSync(localConfig);
const config = JSON.parse(fs.readFileSync(hasLocalConfig ? localConfig : path.join(root, 'android/app-config.example.json'), 'utf8'));
const sourceRoot = path.join(root, 'android/project/app/src/main');
const manifest = fs.readFileSync(path.join(sourceRoot, 'AndroidManifest.xml'), 'utf8');
const activity = fs.readFileSync(path.join(sourceRoot, 'java/com/jeffdigital/jeffva/MainActivity.java'), 'utf8');
const repository = fs.readFileSync(path.join(sourceRoot, 'java/com/jeffdigital/jeffva/WorkspaceRepository.java'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'android/project/app/build.gradle'), 'utf8');
assert.match(activity, /class MainActivity extends Activity/);
// All app-owned details, editors, confirmations and menus must share the native
// sheet; a polished browser preview must not mask default platform alert lists.
assert.doesNotMatch(activity, /new AlertDialog\.Builder/);
assert.match(activity, /new WorkspaceDialog\.Builder\(this, dark\)/);
assert.doesNotMatch(activity, /ReminderNotifications\.(?:update|notifyNow)\(this,/,
  'Encrypted reminder IO must not run directly on the UI/navigation thread');
assert.doesNotMatch(activity + manifest + gradle, /WebView|androidbrowserhelper|trusted\.LauncherActivity/);
assert.match(manifest, /android:allowBackup="false"/);
assert.match(manifest, /android:usesCleartextTraffic="false"/);
const callback = new URL(config.authRedirect);
assert.ok(manifest.includes(`android:scheme="${callback.protocol.slice(0, -1)}"`));
assert.ok(manifest.includes(`android:host="${callback.hostname}"`));
assert.ok(manifest.includes(`android:path="${callback.pathname}"`));
assert.match(repository, /code_challenge_method=s256/);
assert.match(repository, /code_verifier/);
assert.match(repository, /updated_at=/);
assert.ok(config.versionCode > 1, 'Native APK must update the original browser APK');
const webConfig = fs.readFileSync(path.join(root, 'src/frontend/js/supabase-config.js'), 'utf8');
if (hasLocalConfig) {
  assert.ok(webConfig.includes(config.supabaseUrl), 'Native and web apps must use the same account backend');
  assert.ok(webConfig.includes(config.publishableKey));
}
console.log('PASS native Android: native Activity, no browser wrapper, callback alignment, PKCE, conditional saves, shared backend and upgrade version.');

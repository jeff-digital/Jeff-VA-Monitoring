const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/frontend/js/theme.js'), 'utf8');
const key = 'jeff-va-theme-v1';
function fixture(saved, blocked = false) {
  const handlers = {}, changes = {}, values = new Map([[key, saved]]);
  const control = { addEventListener: (name, callback) => { changes[name] = callback; } };
  const meta = {};
  const document = {
    documentElement: { dataset: {} },
    querySelector: () => meta,
    getElementById: () => handlers.DOMContentLoaded ? control : null,
    addEventListener: (name, callback) => { handlers[name] = callback; }
  };
  vm.runInNewContext(source, { document,
    localStorage: {
      getItem: name => { if (blocked) throw Error('Unavailable'); return values.get(name); },
      setItem: (name, value) => { if (blocked) throw Error('Unavailable'); values.set(name, value); }
    },
    window: { addEventListener: (name, callback) => { handlers[name] = callback; } }
  });
  return { document, meta, control, handlers, changes, values };
}
const dark = fixture('dark');
assert.equal(dark.document.documentElement.dataset.theme, 'dark', 'Saved theme applies before DOM ready');
assert.equal(dark.meta.content, '#080808');
dark.handlers.DOMContentLoaded();
assert.equal(dark.control.value, 'dark');
dark.control.value = 'light';
dark.changes.change();
assert.equal(dark.values.get(key), 'light');
assert.equal(dark.document.documentElement.dataset.theme, 'light');
dark.handlers.storage({ key, newValue: 'dark' });
assert.equal(dark.control.value, 'dark', 'Other tabs synchronize the selection');
dark.handlers.storage({ key: 'unrelated', newValue: 'light' });
assert.equal(dark.control.value, 'dark');
dark.handlers.storage({ key: null, newValue: null });
assert.equal(dark.control.value, 'light', 'Cleared storage restores light mode');
for (const saved of [null, 'invalid', 'light']) assert.equal(fixture(saved).document.documentElement.dataset.theme, 'light');
const blocked = fixture('dark', true);
blocked.handlers.DOMContentLoaded();
blocked.control.value = 'dark';
blocked.changes.change();
assert.equal(blocked.document.documentElement.dataset.theme, 'dark', 'Storage failure does not prevent switching');
const html = fs.readFileSync(path.join(root, 'src/frontend/index.html'), 'utf8');
assert.ok(html.indexOf('js/theme.js') < html.indexOf('css/styles.css'), 'Theme loads before styles under the existing CSP');
assert.match(html, /<option value="dark">Dark mode<\/option>/);
assert.doesNotMatch(html, /Black mode|black workspace/);
for (const file of ['build-cloudflare.ps1', 'build-cloudflare.sh']) {
  assert.match(fs.readFileSync(path.join(__dirname, file), 'utf8'), /js[\\/]theme\.js/);
}
console.log('PASS theme: startup, switching, persistence, cross-tab sync, unavailable storage, and build inclusion.');

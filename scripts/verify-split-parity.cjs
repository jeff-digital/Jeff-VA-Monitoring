const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const baseline = process.argv[2] || path.join(os.tmpdir(), 'baseline-app.js');
const normalize = text => text.replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd())
  .filter(line => line.trim() && !line.trimStart().startsWith('// Page:'));
const expected = normalize(fs.readFileSync(baseline, 'utf8'));
for (const name of ['src/frontend/js/app.js', 'dist/js/app.js']) {
  const actual = normalize(fs.readFileSync(path.join(root, name), 'utf8'));
  assert.deepEqual(actual, expected, `${name} must preserve every ordered code line`);
  console.log(`PASS ${name}: ${actual.length} identical ordered nonblank code lines.`);
}

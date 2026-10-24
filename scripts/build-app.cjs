const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const names = fs.readFileSync(path.join(__dirname, 'js-modules.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const body = names.map(name => fs.readFileSync(path.join(root, 'src/frontend/js/modules', name), 'utf8')).join('\r\n');
fs.writeFileSync(path.join(root, 'src/frontend/js/app.js'), "(() => {\r\n  'use strict';\r\n\r\n" + body + '\r\n})();\r\n', 'utf8');
console.log(`Built src/frontend/js/app.js from ${names.length} source modules.`);

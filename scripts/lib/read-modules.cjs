const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const moduleGroups = {
  '02-email-matching.js': [
    '02-email-matching.js', 'pages/09a-client-social-links.js',
    '02b-application-email-match-engine.js', 'pages/07a-dashboard-page.js',
    'pages/07b-applications-render.js', 'pages/08a-to-apply-render.js',
    'pages/10b-inbox-render.js', 'pages/09b-active-clients-render.js',
    'pages/06a-view-router.js', 'pages/07c-application-form.js'
  ],
  '03-documents.js': ['03-documents.js', '03b-notifications-and-reminders.js']
};
function readModules(names) {
  const wanted = new Set(names);
  const order = fs.readFileSync(path.join(root, 'scripts/js-modules.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  return order.filter(name => wanted.has(name))
    .map(name => fs.readFileSync(path.join(root, 'src/frontend/js/modules', name), 'utf8')).join('');
}
module.exports = { readModules, moduleGroups };

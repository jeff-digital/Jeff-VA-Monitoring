import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
  children = []; hidden = false; disabled = false; textContent = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this[name] = callback; }
}
const elements = new Map();
const $ = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
let enabled = false, token = 'offline-token', configured = true, calls = [], renewals = 0;
const context = vm.createContext({ Map, Date, AbortSignal, currentUser: { id: 'owner' }, $, data: { applications: [{ id: 'app', clientName: '<script>company</script>' }] },
  document: { createElement: () => new Element() }, formatAccountTimestamp: date => date || '', readGmailCredentials: () => ({ refreshToken: token }), reconnectGmailWithGoogle: () => {},
  requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'session' } } }), refreshSession: async () => { renewals++; return { data: { session: { access_token: 'renewed' } } }; } } }),
  fetch: async (_url, options) => {
    calls.push(options);
    if (options.method === 'POST') { assert.equal(JSON.parse(options.body).refreshToken, 'offline-token'); enabled = true; }
    if (options.method === 'DELETE') { enabled = false; assert.equal(options.body, undefined); }
    return Response.json({ configured, enabled, status: 'ready', email: 'owner@example.com', recent: [{ applicationId: 'app', status: 'sent', sentAt: '2026-11-05' }] });
  }
});
const source = fs.readFileSync(new URL('../src/frontend/js/modules/04b-background-follow-ups.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../src/frontend/index.html', import.meta.url), 'utf8');
for (const [, id] of source.matchAll(/\$\('#([^']+)'\)/g)) assert.ok(html.includes(`id="${id}"`), `Missing settings control: ${id}`);
vm.runInContext(source, context);
await vm.runInContext('loadBackgroundFollowUpStatus(true)', context);
assert.equal($('#enableBackgroundFollowUps').disabled, false);
assert.equal($('#disableBackgroundFollowUps').hidden, true);
assert.equal($('#backgroundFollowUpHistory').children[0].children[0].textContent, '<script>company</script>', 'Application names are rendered as plain text');
await vm.runInContext('changeBackgroundFollowUps(true)', context);
assert.equal($('#enableBackgroundFollowUps').hidden, true);
assert.equal($('#disableBackgroundFollowUps').hidden, false);
assert.match($('#backgroundFollowUpStatus').textContent, /Enabled/);
await vm.runInContext('changeBackgroundFollowUps(false)', context);
assert.equal($('#enableBackgroundFollowUps').hidden, false);
assert.equal($('#disableBackgroundFollowUps').hidden, true);
token = '';
const previous = calls.length;
await vm.runInContext('changeBackgroundFollowUps(true)', context);
assert.equal(calls.length, previous, 'Missing offline authorization never submits an enable request');
assert.equal($('#reconnectBackgroundGmail').hidden, false);
assert.match($('#backgroundFollowUpStatus').textContent, /Reconnect Gmail/);
configured = false;
await vm.runInContext('loadBackgroundFollowUpStatus(true)', context);
assert.equal($('#enableBackgroundFollowUps').disabled, true);
assert.match($('#backgroundFollowUpStatus').textContent, /Server setup/);
context.fetch = async (_url, options) => options.headers.authorization === 'Bearer session' ? Response.json({}, { status: 401 }) : Response.json({ configured: true, enabled: false });
await vm.runInContext('loadBackgroundFollowUpStatus(true)', context);
assert.equal(renewals, 1, 'An expired dashboard session is renewed once');
let finishOld;
context.fetch = () => new Promise(resolve => { finishOld = resolve; });
const pending = vm.runInContext('loadBackgroundFollowUpStatus(true)', context);
await new Promise(resolve => setImmediate(resolve));
context.currentUser = { id: 'other' };
context.fetch = async () => Response.json({ configured: true, enabled: false, recent: [] });
await vm.runInContext('loadBackgroundFollowUpStatus(true)', context);
finishOld(Response.json({ configured: true, enabled: true, email: 'owner@example.com', recent: [{ applicationId: 'app', status: 'sent' }] }));
await pending;
assert.ok(!$('#backgroundFollowUpStatus').textContent.includes('owner@example.com'), 'Previous account responses never populate a new account');
assert.equal($('#backgroundFollowUpHistory').children.length, 0);
console.log('PASS background settings: enable, turn off, reconnect, missing server setup, expired sessions, safe labels and in-flight account changes.');

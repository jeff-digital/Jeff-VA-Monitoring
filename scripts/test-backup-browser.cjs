const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
const values = new Map([['jeff-va-auto-backup-frequency-v1', 'daily']]);
let downloads = 0, requests = [], fail = false, failComplete = false;
const context = vm.createContext({ window: { XLSX: {}, addEventListener() {} }, document: { addEventListener() {} },
  localStorage: { getItem: key => values.get(key), setItem: (key,value) => values.set(key,value) },
  currentUser: { id: 'user-1' }, dataReady: true, supabaseDataLoaded: true, today: () => '2026-10-25',
  requireSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'session', user: { id: context.currentUser.id }, expires_at: Date.now()/1000+3600 } } }) } }),
  console: { warn() {} }, AbortSignal, setInterval, clearInterval,
  fetch: async (url, options) => { assert.equal(url, '/api/backup/download'); const body=JSON.parse(options.body); requests.push(body);
    if (fail || (failComplete && body.action === 'complete')) throw Error('offline');
    return { ok: true, json: async () => body.action === 'claim' ? { status: 'claimed', claimToken: 'receipt' } : { status: 'downloaded' } };
  },
  recordDownload: () => { downloads++; return true; }
});
vm.runInContext(fs.readFileSync('src/frontend/js/modules/05-backup.js','utf8'),context);
vm.runInContext('exportBackup = recordDownload;', context);
await Promise.all([context.runAutomaticBackup(), context.runAutomaticBackup()]);
assert.equal(downloads, 1, 'Overlapping timers download only once');
assert.deepEqual(requests.map(r=>r.action), ['claim','complete']);
await context.runAutomaticBackup();
assert.equal(downloads, 1, 'Reload marker prevents another scheduled download');
context.currentUser = { id: 'user-2' }; fail = true;
await context.runAutomaticBackup();
assert.equal(downloads, 1, 'Missing shared protection never downloads');
fail = false; failComplete = true;
await context.runAutomaticBackup();
assert.equal(downloads, 2, 'A different account does not inherit another account marker');
await context.runAutomaticBackup();
assert.equal(downloads, 2, 'Lost completion response cannot duplicate download');
values.set('jeff-va-auto-backup-frequency-v1','off');
await context.runAutomaticBackup();
assert.equal(downloads, 2);
console.log('Backup browser checks passed: overlapping timers, local markers, account isolation, offline protection, lost receipts and disabled schedule.');
})().catch(error => { console.error(error); process.exitCode=1; });

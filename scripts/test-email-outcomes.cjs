const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = (extra = {}) => ({ id: 'app-1', clientName: 'Acme', role: 'VA', status: 'Applied',
  appliedDate: new Date(Date.now() - 172800000).toISOString(),
  updatedAt: new Date(Date.now() - 86400000).toISOString(), ...extra });
const email = (body, extra = {}) => ({ id: 'email-1', gmailId: 'gmail-1', from: 'client@acme.example', to: 'me@example.com',
  subject: 'Application update', body, date: new Date(Date.now() - 3600000).toISOString(), ...extra });
let saveSucceeds = true;
let saves = 0;
const context = vm.createContext({
  data: { applications: [], emails: [], alerts: [] },
  isSentEmail: item => item.direction === 'sent' || item.source === 'sent' || item.labelIds?.includes('SENT') || item.from === 'me@example.com',
  matchApplicationsForEmail: item => item.ambiguous ? context.data.applications : [context.data.applications[0]],
  persist: async () => { saves++; return saveSucceeds; },
  emailContentText: value => value
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/frontend/js/modules/04a-email-outcomes.js'), 'utf8'), context);
const detect = body => context.detectApplicationEmailOutcome(email(body));
for (const body of [
  'We have decided not to move forward with your application.',
  'We will not be moving forward with your candidacy.',
  "We won't proceed with your application.",
  'We are no longer proceeding with your application.',
  'Your application has been unsuccessful.',
  'You have not been selected for this role.',
  'We have decided to move forward with other candidates.',
  'We will be moving forward with another candidate.',
  'We have selected a different candidate.',
  'We have filled the position.',
  'The position has been filled.',
  'The role has now been closed.',
  'The vacancy is cancelled.',
  'The position is no longer available.',
  'Your application is now closed.',
  'Your application has expired.'
]) assert.ok(detect(body), `expected a clear outcome: ${body}`);
for (const body of [
  'Please close the browser after the interview.',
  'Your interview is close to our office.',
  'Our office is closed on Friday.',
  'Please complete the required form.',
  'Your password has expired.',
  'Applications are now closed. We are still reviewing your application.',
  'The job posting has expired, but we are reviewing your application.',
  'The role is not yet filled.',
  'If the position has been filled, we will let you know.',
  'The position may have been filled.',
  'It is not true that the role has been closed.',
  'You have not received the interview link yet.',
  'We are pleased to invite you to an interview.',
  'We have not decided whether to proceed with your application.',
  'You have not been selected yet. We will update you.',
  'You have been selected. The position has been filled by you.',
  'A previous role has been filled. We are still reviewing this one.',
  'Thank you for your time.\nOn Monday, Client wrote:\nThe position has been filled.',
  'Thank you.\n> The position has been filled.',
  'Thanks.\n-----Original Message-----\nYour application has been rejected.'
]) assert.equal(detect(body), null, `must not reject: ${body}`);
assert.equal(context.detectApplicationEmailOutcome(email('We will not proceed with your application.', { direction: 'sent' })), null);
assert.equal(context.detectApplicationEmailOutcome(email('The position has been filled.', { from: 'me@example.com' })), null);
assert.equal(context.detectApplicationEmailOutcome(email('We would like to invite you for an interview.', { subject: 'Re: Position filled' })), null);

async function reset(extra = {}) {
  context.data = { applications: [app(extra)], emails: [], alerts: [] };
  saveSucceeds = true;
  return context.data.applications[0];
}
(async () => {
  let record = await reset();
  let changes = await context.applyApplicationEmailOutcomes([email('The position has been filled.')]);
  assert.equal(record.status, 'Not selected');
  assert.equal(changes.length, 1);
  assert.equal(context.data.alerts[0].unread, true);
  assert.equal(context.data.alerts[0].type, 'application-email-closed');
  assert.equal(context.data.alerts[0].emailId, 'email-1');
  assert.equal(record.emailClosure.previousStatus, 'Applied');
  assert.match(context.data.alerts[0].evidence, /filled/);
  record.status = 'Applied';
  changes = await context.applyApplicationEmailOutcomes([email('The position has been filled.')]);
  assert.equal(changes.length, 0, 'manual reopen must not reprocess the same email');
  assert.equal(record.status, 'Applied');
  assert.equal(context.data.alerts.length, 1, 'no duplicate notifications');
  for (const status of ['Active client', 'Offer', 'Not selected', 'Rejected', 'To Apply']) {
    record = await reset({ status });
    assert.equal((await context.applyApplicationEmailOutcomes([email('The role is closed.')])).length, 0);
    assert.equal(record.status, status);
  }
  record = await reset();
  context.data.applications.push(app({ id: 'app-2' }));
  assert.equal((await context.applyApplicationEmailOutcomes([email('The role is closed.', { ambiguous: true })])).length, 0);
  record = await reset();
  const old = email('The role is closed.', { date: new Date(Date.now() - 259200000).toISOString() });
  assert.equal((await context.applyApplicationEmailOutcomes([old])).length, 0, 'historical mail cannot reject a newer application');
  assert.equal((await context.applyApplicationEmailOutcomes([email('The role is closed.'), email('We would like to invite you for an interview.', { id: 'new', gmailId: 'new', date: new Date(Date.now() - 10000).toISOString() })])).length, 0, 'a newer reply supersedes an older closure');
  record = await reset();
  saveSucceeds = false;
  assert.equal((await context.applyApplicationEmailOutcomes([email('The role is closed.')])).length, 0);
  assert.equal(record.status, 'Applied', 'failed cloud save must roll back automatic rejection');
  assert.equal(context.data.alerts.length, 0, 'failed save must not leave a success notification');
  saveSucceeds = true;
  assert.equal((await context.applyApplicationEmailOutcomes([email('The role is closed.')])).length, 1, 'a later sync can retry');
  assert.ok(saves >= 3);
  console.log('Email outcome checks passed: rejection wording, negation, quotations, direction, matching, chronology, notifications, idempotency, and save rollback.');
})().catch(error => { console.error(error); process.exitCode = 1; });

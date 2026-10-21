import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { applicationEmailCandidates } from '../functions/api/application-email-classify.js';
const read = name => fs.readFileSync(new URL(`../src/frontend/js/modules/${name}`, import.meta.url), 'utf8');
const matcher = read('02-email-matching.js');
const context = vm.createContext({ $: () => null, currentUser: { email: 'me@example.com' },
  data: { applications: [], emails: [] }, isActiveContract: () => false });
vm.runInContext(matcher.slice(0, matcher.indexOf('  function renderDashboard(')), context);
vm.runInContext(read('02a-email-match-rules.js'), context);
vm.runInContext(read('02aa-email-disambiguation.js'), context);
const core = read('01-core.js');
vm.runInContext(core.slice(core.indexOf('  function isSentEmail('), core.indexOf('  function manualApplicationStatusTimestamp(')), context);
const app = { id: 'car-wrapping', clientName: 'Car Wrapping Services', contact: 'Kurt', role: 'Social Media Content Creator',
  platform: 'OnlineJobs.ph', email: 'support@onlinejobs.ph', appliedDate: '2026-10-20', status: 'Applied' };
const email = { id: 'reply', from: 'OnlineJobs.ph <support@onlinejobs.ph>', date: '2026-10-22T10:00:00Z',
  subject: 'Application for Social Media Content Creator', body: 'Hi Jeffrey. When can you jump on for an interview?' };
function clientMatches(apps, message) {
  context.data.applications = apps;
  context.invalidateApplicationMatchCaches();
  return Array.from(context.matchApplicationsForEmail({ ...message }), item => item.id);
}
assert.deepEqual(clientMatches([app], email), [app.id], 'Exact unique platform application subject matches without a company/contact in the body');
assert.equal(applicationEmailCandidates([app], email)[0]?.id, app.id, 'Server accepts the same association');
for (const subject of ['Re: Application for Social Media Content Creator', 'Application for the Social Media Content Creator']) {
  assert.deepEqual(clientMatches([app], { ...email, subject }), [app.id]);
  assert.equal(applicationEmailCandidates([app], { ...email, subject })[0]?.id, app.id);
}
for (const message of [
  { ...email, subject: 'Social Media Content Creator jobs you may like' },
  { ...email, subject: 'Application for Video Editor' },
  { ...email, date: '2026-10-19T10:00:00Z' }
]) {
  assert.deepEqual(clientMatches([app], message), []);
  assert.equal(applicationEmailCandidates([app], message).length, 0);
}
assert.deepEqual(clientMatches([app], { ...email, direction: 'sent' }), [], 'Sent email is excluded');
const sameRole = { ...app, id: 'same-role-other-company', clientName: 'Other company' };
assert.notEqual(clientMatches([app, sameRole], email).length, 1, 'A shared role alone cannot pick a single job');
assert.equal(applicationEmailCandidates([app, sameRole], email).length, 0);
const linkedApp = { ...app, website: 'https://www.onlinejobs.ph/jobseekers/job/Social-Media-Content-Creator-1485266' };
const linkedEmail = { ...email, body: `${email.body}\nSent via OnlineJobs.ph contact form.\nhttps://www.onlinejobs.ph/jobseekers/job/1485266` };
assert.deepEqual(clientMatches([linkedApp, sameRole], linkedEmail), [app.id], 'Posting ID works across slug/numeric URL variants');
assert.equal(applicationEmailCandidates([linkedApp, sameRole], linkedEmail)[0]?.id, app.id);
const conflict = { ...linkedEmail, body: linkedEmail.body.replace('1485266', '9999999') };
assert.deepEqual(clientMatches([linkedApp], conflict), [], 'Conflicting saved posting prevents a role-only guess');
assert.equal(applicationEmailCandidates([linkedApp], conflict).length, 0);
assert.equal(context.onlineJobsJobIds('https://evil.example/jobseekers/job/1485266').length, 0);
assert.equal(context.onlineJobsJobIds('https://www.onlinejobs.ph/jobseekers/info/1485266').length, 0, 'A profile ID is not a posting ID');
const direct = { ...app, id: 'direct', platform: 'Direct client', email: 'kurt@example.com' };
assert.deepEqual(clientMatches([direct], { ...email, from: 'Kurt <kurt@example.com>' }), ['direct']);
console.log('OnlineJobs matching passed: exact-role interview replies, posting URL variants, ambiguous roles, conflicting IDs, newsletters, chronology, sent exclusion, and direct-client regression.');

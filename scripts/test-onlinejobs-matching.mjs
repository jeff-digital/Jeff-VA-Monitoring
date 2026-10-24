import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { applicationEmailCandidates } from '../functions/api/application-email-classify.js';
import { createRequire } from 'node:module';
const { readModules, moduleGroups } = createRequire(import.meta.url)('./lib/read-modules.cjs');
const read = name => moduleGroups[name] ? readModules(moduleGroups[name]) : fs.readFileSync(new URL(`../src/frontend/js/modules/${name}`, import.meta.url), 'utf8');
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
const unrelated = { id: 'personal-name', clientName: 'Jeffrey Almocera', contact: 'Jeffrey Almocera', role: 'Editor',
  email: 'jepoyalmocera222@gmail.com', platform: 'Direct client', appliedDate: '2026-10-25', status: 'Applied' };
const receipt = { id: 'workable-receipt', from: 'Workable <noreply@candidates.workablemail.com>',
  subject: 'Thanks for applying to BookWithMe!', date: '2026-10-14T08:00:00Z',
  body: "BookWithMe\nYour application for the Virtual Assistant job was submitted successfully.\nHere's a copy of your application data for safekeeping.\n** PERSONAL INFORMATION **\nName: Jeffrey Almocera\nEmail: almocerajeffreys@gmail.com\n** PROFILE **\nEditor\nhttps://example.com/jobs/personal-profile" };
assert.deepEqual(clientMatches([unrelated], receipt), [], 'An old receipt cannot match a later unrelated application');
assert.equal(applicationEmailCandidates([unrelated], receipt).length, 0);
const earlierUnrelated = { ...unrelated, appliedDate: '2026-10-01' };
const sameNameWrongSender = { ...receipt, from: 'Jeffrey Almocera <someone-else@example.com>', subject: 'Editor application', body: 'Jeffrey Almocera, Editor' };
assert.deepEqual(clientMatches([earlierUnrelated], sameNameWrongSender), [], 'A display-name match cannot override a different direct-client email address');
assert.equal(applicationEmailCandidates([earlierUnrelated], sameNameWrongSender).length, 0);
assert.deepEqual(clientMatches([earlierUnrelated], receipt), [], 'Applicant name and role in a copied profile are not employer evidence');
assert.equal(applicationEmailCandidates([earlierUnrelated], receipt).length, 0);
const bookWithMe = { ...earlierUnrelated, id: 'bookwithme', clientName: 'BookWithMe', contact: 'Recruiting team', role: 'Virtual Assistant' };
assert.deepEqual(clientMatches([earlierUnrelated, bookWithMe], receipt), ['bookwithme'], 'Company in receipt subject still identifies the real application');
assert.deepEqual(applicationEmailCandidates([earlierUnrelated, bookWithMe], receipt).map(item => item.id), ['bookwithme']);
assert.deepEqual(clientMatches([direct], { ...email, from: 'Kurt <kurt@example.com>', date: '2026-10-01' }), [], 'Even a matching sender cannot attach an email from before this application');
console.log('OnlineJobs matching passed: exact-role interview replies, posting URL variants, ambiguous roles, conflicting IDs, newsletters, chronology, sent exclusion, and direct-client regression.');

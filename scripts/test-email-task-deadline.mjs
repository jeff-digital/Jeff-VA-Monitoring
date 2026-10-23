import assert from 'node:assert/strict';
import { resolveEmailTaskDeadline } from '../functions/api/email-task-deadline.js';
import { validateEmailClassification } from '../functions/api/email-classify.js';
const received = '2026-10-22T18:00:00Z'; // October 23 in Philippine time.
const resolve = (quote, date, confidence = .98, text = `Please upload the content ${quote}.`) => resolveEmailTaskDeadline({ dueDate: date, deadlineEvidence: quote, deadlineConfidence: confidence }, text, 'Content request', received).dueDate;
for (const [quote, date] of [
  ['today', '2026-10-23'], ['tomorrow', '2026-10-24'], ['tonight', '2026-10-23'],
  ['by Friday', '2026-10-23'], ['on Monday', '2026-10-26'], ['this Sunday', '2026-10-25'],
  ['in 3 days', '2026-10-26'], ['by October 27', '2026-10-27'], ['by Oct. 27, 2026', '2026-10-27'],
  ['27 October 2026', '2026-10-27'], ['2026-10-27', '2026-10-27'], ['27/10/2026', '2026-10-27'],
  ['10/27/2026', '2026-10-27'], ['February 29, 2028', '2028-02-29'], ['tomorrow October 24', '2026-10-24'],
  ['today upload today', '2026-10-23'], ['for end of duty', '2026-10-23'], ['by end of shift', '2026-10-23'],
  ['before your shift ends', '2026-10-23'], ['by EOD', '2026-10-23'], ['by close of business', '2026-10-23'],
  ['tomorrow by end of duty', '2026-10-24'], ['Monday EOD', '2026-10-26'], ['October 27 by end of duty', '2026-10-27']
]) assert.equal(resolve(quote, date), date, `Resolves ${quote} against the received date`);
for (const [quote, date] of [
  ['soon', '2026-10-27'], ['ASAP', '2026-10-23'], ['at 5 PM', '2026-10-23'], ['next Friday', '2026-10-30'],
  ['10/11/2026', '2026-11-10'], ['October 27 or October 28', '2026-10-27'], ['today or October 27', '2026-10-27'],
  ['tomorrow', '2026-10-25'], ['February 30, 2026', '2026-03-02'], ['February 29, 2027', '2027-03-01'],
  ['not tomorrow', '2026-10-24'], ['last Monday', '2026-10-19']
]) assert.equal(resolve(quote, date), '', `Leaves ${quote} blank instead of guessing`);
assert.equal(resolve('tomorrow', '2026-10-24', .7), '');
assert.equal(resolve('tomorrow', '2026-10-24', .99, 'Please upload the content soon.'), '', 'Date evidence must be an exact source quote');
const text = 'Upload the Instagram content by October 27.';
const result = { purpose: 'work_task', confidence: .97, roleRelated: true, reason: 'Work request.', title: 'Upload content', evidence: text,
  dueDate: '2026-10-27', deadlineEvidence: 'by October 27', deadlineConfidence: .98 };
assert.equal(validateEmailClassification(result, text, 'Content', received).dueDate, '2026-10-27');
assert.equal(validateEmailClassification({ ...result, purpose: 'informational' }, text, 'Content', received).dueDate, '', 'Non-task messages never get a deadline');
assert.equal(validateEmailClassification({ ...result, deadlineEvidence: '' }, text, 'Content', received).createTask, true, 'Missing deadline does not block an otherwise valid task');
assert.equal(validateEmailClassification({ ...result, deadlineEvidence: '' }, text, 'Content', received).dueDate, '');
console.log('Email deadline checks passed: exact dates, weekdays, relative dates, Philippine received-date anchor, grounding, confidence, invalid/ambiguous dates and task eligibility.');

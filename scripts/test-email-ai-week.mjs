import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emailAiWeekBounds, emailIsInCurrentAiWeek } from '../functions/api/email-ai-week.js';
const source = fs.readFileSync(new URL('../src/frontend/js/modules/pages/10a-email-client-tasks.js', import.meta.url), 'utf8');
const browser = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf('  function emailTaskExisting(')), browser);
const originalTz = process.env.TZ;
try {
  for (const timezone of ['America/Los_Angeles', 'Asia/Manila', 'Pacific/Auckland']) {
    process.env.TZ = timezone;
    const now = Date.parse('2026-10-21T04:00:00Z');
    const range = emailAiWeekBounds(now);
    assert.equal(new Date(range.start).toISOString(), '2026-10-18T16:00:00.000Z');
    assert.equal(new Date(range.end).toISOString(), '2026-10-25T16:00:00.000Z');
    assert.equal(browser.emailAiWeekRange(now).start, range.start);
    assert.equal(browser.emailAiWeekRange(now).end, range.end);
    for (const [date, expected] of [
      ['2026-10-18T23:59:59+08:00', false], ['2026-10-19T00:00:00+08:00', true],
      ['2026-10-21T11:59:59+08:00', true], ['2026-10-24T12:00:00+08:00', false],
      ['2026-10-26T00:00:00+08:00', false], ['invalid', false], ['', false]
    ]) {
      assert.equal(emailIsInCurrentAiWeek(date, now), expected, date);
      assert.equal(browser.isEmailInAiWeek({ date }, now), expected, `${timezone}: ${date}`);
    }
    const sunday = Date.parse('2026-10-25T15:59:59Z');
    assert.equal(emailIsInCurrentAiWeek('2026-10-19T00:00:00+08:00', sunday), true);
    const monday = Date.parse('2026-10-25T16:00:00Z');
    assert.equal(emailIsInCurrentAiWeek('2026-10-25T23:59:59+08:00', monday), false);
    assert.equal(emailIsInCurrentAiWeek('2026-10-26T00:00:00+08:00', monday), true);
    assert.equal(browser.isEmailInAiWeek({ date: '2026-10-25T23:59:59+08:00' }, monday), false);
  }
} finally {
  if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
}
console.log('Weekly AI scope passed: identical browser/server Monday–Sunday boundaries in Philippine time, week rollover, invalid/future dates and independence from device timezone.');

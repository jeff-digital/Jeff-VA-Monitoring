const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map();
const $ = selector => {
  if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '', innerHTML: '', open: false, handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; }, showModal() { this.open = true; } });
  return nodes.get(selector);
};
let intervals = 0, cleared = 0;
const document = { hidden: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
const context = vm.createContext({ $, $$: () => [], document, Intl,
  setInterval: () => ++intervals, clearInterval: () => { cleared++; },
  escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  fetch: () => { throw new Error('Clocks must not depend on a network API'); }
});
vm.runInContext(fs.readFileSync('src/frontend/js/modules/pages/09c-client-world-clock.js', 'utf8'), context);
const winter = new Date('2026-01-01T00:30:00Z'), summer = new Date('2026-07-01T00:30:00Z');
assert.equal(context.clientWorldClockTime('Australia/Sydney', winter).offset, 'GMT+11');
assert.equal(context.clientWorldClockTime('Australia/Sydney', summer).offset, 'GMT+10');
assert.equal(context.clientWorldClockTime('Australia/Brisbane', winter).offset, 'GMT+10', 'Australian cities cannot share one assumed offset');
assert.equal(context.clientWorldClockTime('America/Toronto', winter).offset, 'GMT-5');
assert.equal(context.clientWorldClockTime('America/Toronto', summer).offset, 'GMT-4');
assert.equal(context.clientWorldClockTime('America/Phoenix', summer).offset, 'GMT-7');
assert.equal(context.clientWorldClockTime('America/St_Johns', winter).offset, 'GMT-3:30');
assert.equal(context.clientWorldClockTime('Asia/Kolkata', winter).offset, 'GMT+5:30');
assert.match(context.clientWorldClockTime('America/New_York', winter).date, /Dec 31, 2025/, 'Date rolls back correctly across midnight');
assert.match(context.clientWorldClockTime('Australia/Sydney', winter).date, /Jan 1, 2026/);
assert.equal(context.filterClientWorldClocks('sydney').length, 1);
assert.ok(context.filterClientWorldClocks('', 'Canada').length >= 6);
assert.equal(context.filterClientWorldClocks('London', 'Canada').length, 0);
assert.deepEqual(Array.from(context.filterClientWorldClocks(), clock => clock.city), ['New York', 'Toronto', 'Sydney', 'London']);
assert.equal(context.filterClientWorldClocks('', 'United Kingdom')[0].zone, 'Europe/London');
assert.equal(context.filterClientWorldClocks('unmatched city').length, 0);
assert.ok(context.filterClientWorldClocks('china').some(clock => clock.zone === 'Asia/Shanghai'));
assert.ok(context.filterClientWorldClocks('singapore').some(clock => clock.zone === 'Asia/Singapore'));
assert.ok(context.filterClientWorldClocks('', 'India').some(clock => clock.zone === 'Asia/Kolkata'));
assert.equal(context.filterClientWorldClocks('', '').length, 4, 'Clearing search returns only the four featured clocks');
assert.ok(!context.filterClientWorldClocks().some(clock => clock.country === 'China'));
assert.match($('#worldClockCountry').innerHTML, /China/);
assert.match($('#worldClockCountry').innerHTML, /Singapore/);
for (const clock of context.filterClientWorldClocks('asia/')) assert.ok(context.clientWorldClockTime(clock.zone).time);
$('#openClientWorldClock').handlers.click();
assert.equal($('#worldClockModal').open, true);
assert.equal(intervals, 1);
assert.match($('#worldClockGrid').innerHTML, /Sydney/);
$('#worldClockCountry').value = 'Canada';
$('#worldClockCountry').handlers.change();
assert.doesNotMatch($('#worldClockGrid').innerHTML, /Sydney/);
document.hidden = true; document.handlers.visibilitychange();
assert.equal(cleared, 1, 'Hidden tabs stop the ticking interval');
document.hidden = false; document.handlers.visibilitychange();
assert.equal(intervals, 2, 'Returning to the open clock resumes live time');
$('#worldClockModal').open = false; $('#worldClockModal').handlers.close();
assert.equal(cleared, 2, 'Closing the modal stops its timer');
document.handlers.visibilitychange();
assert.equal(intervals, 2, 'Closed clocks never run in the background');
console.log('World clock checks passed: regional zones, DST, half-hour offsets, date boundaries, search, country filters and timer lifecycle without API requests.');

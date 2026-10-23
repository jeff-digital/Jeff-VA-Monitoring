const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
const calendarDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : '';
};

// Independently verify the model's proposed date against its exact source quote.
// Unsupported/ambiguous wording never turns into an invented task deadline.
export function resolveEmailTaskDeadline(result, text, subject, receivedAt) {
  const empty = { dueDate: '', deadlineEvidence: '', deadlineConfidence: 0 };
  const quote = String(result.deadlineEvidence || '').trim().slice(0, 160);
  const confidence = result.deadlineConfidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < .9 || confidence > 1
    || !quote || !normalize(`${subject}\n${text}`).includes(normalize(quote))
    || !/^\d{4}-\d{2}-\d{2}$/.test(result.dueDate || '') || !Number.isFinite(Date.parse(receivedAt))) return empty;
  const base = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(receivedAt));
  const year = Number(base.slice(0, 4));
  const source = normalize(quote);
  if (/\b(?:not|cancelled|canceled|previous|last|maybe|possibly|next)\b/.test(source)) return empty;
  const dates = [];
  let ambiguous = false;
  const add = value => { if (value) dates.push(value); else ambiguous = true; };
  for (const match of source.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(calendarDate(+match[1], +match[2], +match[3]));
  for (const match of source.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const first = +match[1], second = +match[2];
    if (first <= 12 && second <= 12 && first !== second) ambiguous = true;
    else add(calendarDate(+match[3], first > 12 ? second : first, first > 12 ? first : second));
  }
  const monthPattern = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  for (const match of source.matchAll(new RegExp(`\\b${monthPattern}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'g'))) add(calendarDate(+(match[3] || year), months.indexOf(match[1].slice(0, 3)) + 1, +match[2]));
  for (const match of source.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthPattern}(?:\\s+(\\d{4}))?\\b`, 'g'))) add(calendarDate(+(match[3] || year), months.indexOf(match[2].slice(0, 3)) + 1, +match[1]));
  if (!ambiguous) {
    const day = new Date(`${base}T00:00:00Z`);
    const offsets = [];
    if (/\b(?:today|tonight)\b/.test(source)) offsets.push(0);
    if (/\btomorrow\b/.test(source)) offsets.push(1);
    for (const match of source.matchAll(/\bin\s+(\d{1,2})\s+days?\b/g)) offsets.push(+match[1]);
    const weekday = source.match(/\b(?:(?:by|on|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (weekday && !dates.length) offsets.push((weekdays.indexOf(weekday[1]) - day.getUTCDay() + 7) % 7);
    const endOfDuty = /\b(?:end\s+of\s+(?:(?:my|your|the|our|today'?s)\s+)?(?:duty|shift|day)|eod|cob|close\s+of\s+business)\b/.test(source)
      || /\b(?:before|by)\s+(?:(?:my|your|the|our)\s+)?(?:duty|shift)\s+ends\b/.test(source);
    if (endOfDuty && !dates.length && !offsets.length) offsets.push(0);
    for (const offset of offsets) { const target = new Date(day); target.setUTCDate(target.getUTCDate() + offset); add(target.toISOString().slice(0, 10)); }
  }
  const unique = [...new Set(dates)];
  return !ambiguous && unique.length === 1 && unique[0] === result.dueDate
    ? { dueDate: result.dueDate, deadlineEvidence: quote, deadlineConfidence: confidence } : empty;
}

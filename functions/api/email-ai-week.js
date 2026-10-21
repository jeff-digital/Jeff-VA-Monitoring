// Philippine calendar weeks start Monday at 00:00 (UTC+8).
export function emailAiWeekBounds(now = Date.now()) {
  const day = 86400000, offset = 8 * 3600000;
  const local = new Date(now + offset);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
    - ((local.getUTCDay() + 6) % 7) * day - offset;
  return { start, end: start + 7 * day };
}

export function emailIsInCurrentAiWeek(value, now = Date.now()) {
  const received = Date.parse(value || '');
  const { start, end } = emailAiWeekBounds(now);
  return Number.isFinite(received) && received >= start && received < end && received <= now + 300000;
}

export function followUpTimeZone(app) {
  for (const zone of [app.clientTimeZone, app.timeZone, app.timezone]) {
    if (!zone) continue;
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); return zone; } catch {}
  }
  const [country, region = ''] = String(app.location || '').split(',').map(value => value.trim());
  const regions = { Eastern: 'America/New_York', Central: 'America/Chicago', Mountain: 'America/Denver', Pacific: 'America/Los_Angeles',
    Atlantic: 'America/Halifax', Newfoundland: 'America/St_Johns', Alaska: 'America/Anchorage', Hawaii: 'Pacific/Honolulu' };
  if (['United States', 'Canada'].includes(country)) return regions[region] || '';
  if (country === 'Australia') return ({ East: 'Australia/Sydney', Central: 'Australia/Adelaide', West: 'Australia/Perth' })[region] || '';
  return ({ 'United States': 'America/New_York', Canada: 'America/Toronto', 'United Kingdom': 'Europe/London', Philippines: 'Asia/Manila',
    Brazil: 'America/Sao_Paulo', China: 'Asia/Shanghai', Colombia: 'America/Bogota', France: 'Europe/Paris', Germany: 'Europe/Berlin',
    India: 'Asia/Kolkata', Ireland: 'Europe/Dublin', Israel: 'Asia/Jerusalem', Italy: 'Europe/Rome', Japan: 'Asia/Tokyo',
    Mexico: 'America/Mexico_City', Netherlands: 'Europe/Amsterdam', 'New Zealand': 'Pacific/Auckland', Peru: 'America/Lima',
    'Saudi Arabia': 'Asia/Riyadh', 'South Africa': 'Africa/Johannesburg', 'South Korea': 'Asia/Seoul', Taiwan: 'Asia/Taipei',
    'United Arab Emirates': 'Asia/Dubai' })[country] || '';
}

export function isFollowUpWeekday(app, now = new Date()) {
  if (!followUpTimeZone(app)) return false;
  const day = new Intl.DateTimeFormat('en-US', { timeZone: followUpTimeZone(app), weekday: 'short' }).format(now);
  return day !== 'Sat' && day !== 'Sun';
}

export function followUpLocalDate(app, now = new Date()) {
  if (!followUpTimeZone(app)) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: followUpTimeZone(app), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

export function isFollowUpSendTime(app, scheduledDate, now = new Date()) {
  if (!isFollowUpWeekday(app, now) || !scheduledDate || scheduledDate > followUpLocalDate(app, now)) return false;
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: followUpTimeZone(app), hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour >= 8 && hour < 17;
}

export function isFollowUpDateWeekday(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && ![0, 6].includes(date.getUTCDay());
}

export function nextFollowUpWeekday(value) {
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime())) return '';
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

'use strict';

// When outgoing calls may be placed: the platform's hours (default 10 AM to
// 9 PM India time, the hours TRAI's default "do not disturb" bands leave open
// for commercial calls) and, for a campaign, its own days and hours in its
// own time zone. Both must allow the moment.

const DEFAULT_ZONE = 'Asia/Kolkata';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Wall-clock parts of a moment in a time zone.
function zonedParts(date, timeZone = DEFAULT_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'long', hourCycle: 'h23'
  }).formatToParts(date).map(p => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month - 1, d: +parts.day, h: +parts.hour, min: +parts.minute, weekday: parts.weekday };
}

// The moment a wall-clock time in a time zone happens.
function zonedDate(y, m, d, h, min, timeZone = DEFAULT_ZONE) {
  let guess = Date.UTC(y, m, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.y, p.m, p.d, p.h, p.min);
    guess += Date.UTC(y, m, d, h, min) - shown;
  }
  return new Date(guess);
}

const toMinutes = (hhmm, fallback) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  return m ? Math.min(24 * 60, +m[1] * 60 + +m[2]) : fallback;
};

// The windows that apply: platform hours in India time, and the campaign's.
function rules({ schedule = null, platform = {} } = {}) {
  const start = Number.isFinite(+platform.start) ? +platform.start : 10;
  const end = Number.isFinite(+platform.end) ? +platform.end : 21;
  const list = [{ zone: DEFAULT_ZONE, from: start * 60, to: end * 60, days: null }];
  if (schedule && (schedule.callStartTime || schedule.dayOfWeek?.length)) {
    list.push({
      zone: schedule.timeZone || DEFAULT_ZONE,
      from: toMinutes(schedule.callStartTime, 0),
      to: toMinutes(schedule.callEndTime, 24 * 60),
      days: schedule.dayOfWeek?.length ? schedule.dayOfWeek : null
    });
  }
  return list;
}

const allowedBy = (date, rule) => {
  const p = zonedParts(date, rule.zone);
  if (rule.days && !rule.days.includes(p.weekday)) return false;
  const minute = p.h * 60 + p.min;
  return minute >= rule.from && minute < rule.to;
};

function isAllowed(date = new Date(), opts = {}) {
  return rules(opts).every(rule => allowedBy(date, rule));
}

// The first moment at or after `date` that every window allows (checked in
// 15-minute steps over the next two weeks), or null if they never overlap.
function nextAllowed(date = new Date(), opts = {}) {
  const list = rules(opts);
  if (list.every(rule => allowedBy(date, rule))) return date;
  // Start of the next quarter hour, then step forward.
  let t = new Date(Math.ceil(date.getTime() / (15 * 60000)) * 15 * 60000);
  const limit = date.getTime() + 14 * 24 * 3600000;
  while (t.getTime() <= limit) {
    if (list.every(rule => allowedBy(t, rule))) return t;
    t = new Date(t.getTime() + 15 * 60000);
  }
  return null;
}

// "1 hour", "30 minutes", "2 hours", "1 day" -> milliseconds.
function parseInterval(text, fallbackMs = 3600000) {
  const m = /(\d+(?:\.\d+)?)\s*(min|minute|minutes|hour|hours|hr|hrs|day|days)/i.exec(String(text || ''));
  if (!m) return fallbackMs;
  const unit = m[2].toLowerCase();
  const n = parseFloat(m[1]);
  if (unit.startsWith('min')) return n * 60000;
  if (unit.startsWith('d')) return n * 86400000;
  return n * 3600000;
}

module.exports = { isAllowed, nextAllowed, zonedParts, zonedDate, parseInterval, DAY_NAMES };

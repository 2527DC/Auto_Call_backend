'use strict';

// Dashboard date filters, worked out in Indian time (UTC+5:30 all year, no daylight saving),
// so "today" and "this month" match the customer's calendar whatever the server's time zone.
const TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Indian calendar fields of a moment.
const istParts = (date) => {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours() };
};

// The moment an Indian wall-clock time happens (months and days may overflow, like Date.UTC).
const istDate = (y, m, d = 1, h = 0) => new Date(Date.UTC(y, m, d, h) - IST_OFFSET_MS);

const parseDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return match ? istDate(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};

// Start and end of the chosen period, the matching earlier period to compare against, and the
// chart bucket size. The comparison covers the same elapsed time, so "this month so far" is
// compared with the same days of last month.
const buildPeriod = (dateRange, startDate, endDate, now = new Date()) => {
  const t = istParts(now);
  let start;
  let end;
  let prevStart;
  let bucket;
  let compareLabel;

  switch (dateRange) {
    case 'today':
      start = istDate(t.y, t.m, t.d);
      end = new Date(start.getTime() + DAY_MS - 1);
      prevStart = new Date(start.getTime() - DAY_MS);
      bucket = 'hour';
      compareLabel = 'vs yesterday';
      break;
    case 'this_week':
      start = istDate(t.y, t.m, t.d - ((t.wd + 6) % 7));
      end = new Date(start.getTime() + 7 * DAY_MS - 1);
      prevStart = new Date(start.getTime() - 7 * DAY_MS);
      bucket = 'day';
      compareLabel = 'vs last week';
      break;
    case 'this_month':
      start = istDate(t.y, t.m, 1);
      end = new Date(istDate(t.y, t.m + 1, 1).getTime() - 1);
      prevStart = istDate(t.y, t.m - 1, 1);
      bucket = 'day';
      compareLabel = 'vs last month';
      break;
    case 'this_year':
      start = istDate(t.y, 0, 1);
      end = new Date(istDate(t.y + 1, 0, 1).getTime() - 1);
      prevStart = istDate(t.y - 1, 0, 1);
      bucket = 'month';
      compareLabel = 'vs last year';
      break;
    case 'custom': {
      start = parseDay(startDate);
      const last = parseDay(endDate);
      if (!start || !last || last < start) return null;
      end = new Date(last.getTime() + DAY_MS - 1);
      const days = Math.round((end.getTime() + 1 - start.getTime()) / DAY_MS);
      prevStart = new Date(start.getTime() - days * DAY_MS);
      bucket = days <= 2 ? 'hour' : days <= 92 ? 'day' : 'month';
      compareLabel = `vs previous ${days} days`;
      break;
    }
    default:
      return null;
  }

  const elapsed = Math.max(0, Math.min(end.getTime(), now.getTime()) - start.getTime());
  return {
    start,
    end,
    prevStart,
    prevEnd: new Date(prevStart.getTime() + elapsed),
    bucket,
    compareLabel,
  };
};

const BUCKET_FORMATS = { hour: '%Y-%m-%dT%H', day: '%Y-%m-%d', month: '%Y-%m' };

// Mongo expression that turns a date field into its bucket key, in Indian time.
const bucketKey = (field, bucket) => ({
  $dateToString: { format: BUCKET_FORMATS[bucket], date: field, timezone: TIMEZONE },
});

const pad = (n) => String(n).padStart(2, '0');

// Every bucket from the start of the period up to now (or its end, if that is earlier), with
// the same keys bucketKey produces and a short label for the chart axis.
const listBuckets = (period, now = new Date()) => {
  const { start, bucket } = period;
  const last = new Date(Math.min(period.end.getTime(), now.getTime()));
  const s = istParts(start);
  const multiYear = istParts(last).y !== s.y;
  const shortRange = last.getTime() - start.getTime() < 7 * DAY_MS;
  const buckets = [];

  for (let i = 0; buckets.length < 400; i++) {
    const at = bucket === 'hour' ? istDate(s.y, s.m, s.d, s.h + i)
      : bucket === 'day' ? istDate(s.y, s.m, s.d + i)
        : istDate(s.y, s.m + i, 1);
    if (at > last) break;
    const p = istParts(at);
    if (bucket === 'hour') {
      const h12 = p.h % 12 || 12;
      buckets.push({ key: `${p.y}-${pad(p.m + 1)}-${pad(p.d)}T${pad(p.h)}`, label: `${h12} ${p.h < 12 ? 'AM' : 'PM'}` });
    } else if (bucket === 'day') {
      const label = shortRange ? `${WEEKDAYS[p.wd]} ${p.d}` : `${p.d} ${MONTHS[p.m]}`;
      buckets.push({ key: `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`, label });
    } else {
      const label = multiYear ? `${MONTHS[p.m]} '${String(p.y).slice(2)}` : MONTHS[p.m];
      buckets.push({ key: `${p.y}-${pad(p.m + 1)}`, label });
    }
  }
  return buckets;
};

module.exports = { TIMEZONE, buildPeriod, bucketKey, listBuckets, istParts, istDate };

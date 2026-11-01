// Market calendar for the Inter Equity time rules: US bank holidays (no trading),
// FOMC days, NFP days (approximate rule) and live red-folder news from a weekly feed.
// Pure functions; works in the browser and in Node.

const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();   // 0 = Sunday

/** n-th weekday (0=Sun) of a month; n = -1 means the last one. */
function nthWeekday(y, m, wd, n) {
  if (n > 0) {
    const first = dow(y, m, 1);
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - ((dow(y, m, last) - wd + 7) % 7);
}

/** Saturday -> Friday, Sunday -> Monday (how US holidays are observed). */
function observed(y, m, d) {
  const w = dow(y, m, d);
  const t = Date.UTC(y, m - 1, d) + (w === 6 ? -1 : w === 0 ? 1 : 0) * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Easter Sunday (Gregorian, anonymous algorithm). */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const _hol = new Map();
/** US bank holidays + the Christmas / New Year days Marco says not to trade. date -> name */
export function holidays(y) {
  if (_hol.has(y)) return _hol.get(y);
  const h = new Map();
  const add = (date, name) => h.set(date, name);
  add(observed(y, 1, 1), 'New Year');
  add(ymd(y, 1, nthWeekday(y, 1, 1, 3)), 'Martin Luther King Day');
  add(ymd(y, 2, nthWeekday(y, 2, 1, 3)), "Presidents' Day");
  const [em, ed] = easter(y);
  const gf = new Date(Date.UTC(y, em - 1, ed) - 2 * 86400000).toISOString().slice(0, 10);
  add(gf, 'Good Friday');
  add(ymd(y, 5, nthWeekday(y, 5, 1, -1)), 'Memorial Day');
  if (y >= 2022) add(observed(y, 6, 19), 'Juneteenth');
  add(observed(y, 7, 4), 'Independence Day');
  add(ymd(y, 9, nthWeekday(y, 9, 1, 1)), 'Labor Day');
  const tg = nthWeekday(y, 11, 4, 4);
  add(ymd(y, 11, tg), 'Thanksgiving');
  add(ymd(y, 12, 24), 'Christmas Eve');
  add(observed(y, 12, 25), 'Christmas');
  add(ymd(y, 12, 25), 'Christmas');
  add(ymd(y, 12, 26), 'Boxing Day');
  add(ymd(y, 12, 31), "New Year's Eve");
  _hol.set(y, h);
  return h;
}

/** Holiday name for a 'YYYY-MM-DD' New York date, or null. */
export function holidayName(date) {
  const y = +date.slice(0, 4);
  return holidays(y).get(date) || (date.endsWith('-01-01') ? 'New Year' : null);
}

// FOMC statement days (14:00 New York). Source: federalreserve.gov meeting calendars.
const FOMC = [
  '2020-01-29', '2020-03-03', '2020-03-15', '2020-04-29', '2020-06-10', '2020-07-29', '2020-09-16', '2020-11-05', '2020-12-16',
  '2021-01-27', '2021-03-17', '2021-04-28', '2021-06-16', '2021-07-28', '2021-09-22', '2021-11-03', '2021-12-15',
  '2022-01-26', '2022-03-16', '2022-05-04', '2022-06-15', '2022-07-27', '2022-09-21', '2022-11-02', '2022-12-14',
  '2023-02-01', '2023-03-22', '2023-05-03', '2023-06-14', '2023-07-26', '2023-09-20', '2023-11-01', '2023-12-13',
  '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12', '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
];
const FOMC_SET = new Set(FOMC);

const _nfp = new Map();
/**
 * Non-farm payrolls day for a month's report (approximation): the third Friday after the week
 * (Sunday-Saturday) that contains the 12th. Matches most releases; holiday shifts are not modelled.
 */
function nfpForReferenceMonth(y, m) {
  const w12 = dow(y, m, 12);
  const sat = 12 + (6 - w12);                         // Saturday ending the reference week
  const t = Date.UTC(y, m - 1, sat) + (6 + 14) * 86400000;   // Friday after, plus two weeks
  return new Date(t).toISOString().slice(0, 10);
}
// known releases that the rule gets wrong (holiday calendars, shutdowns)
const NFP_FIX = { '2025-01-03': '2025-01-10' };
function nfpDates(y) {
  if (_nfp.has(y)) return _nfp.get(y);
  const s = new Set();
  for (const [ry, rm] of [[y - 1, 12], ...Array.from({ length: 12 }, (_, i) => [y, i + 1])]) {
    let d = nfpForReferenceMonth(ry, rm);
    d = NFP_FIX[d] || d;
    if (holidayName(d)) d = addDays(d, -1);            // e.g. 4 July on a Friday -> Thursday release
    s.add(d);
  }
  _nfp.set(y, s);
  return s;
}

const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * Everything the time rules need for one New York date.
 * live: optional list from liveEvents() (real red-folder events for the current week).
 */
export function dayInfo(date, live = null) {
  const y = +date.slice(0, 4);
  const fomc = FOMC_SET.has(date);
  const nfp = nfpDates(y).has(date);
  const nextBiz = (() => { let d = addDays(date, 1); while ([0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())) d = addDays(d, 1); return d; })();
  const eveOf = FOMC_SET.has(nextBiz) ? 'FOMC' : nfpDates(+nextBiz.slice(0, 4)).has(nextBiz) ? 'NFP' : null;
  const events = [];
  if (fomc) events.push({ hour: 14, title: 'FOMC', impact: 'High' });
  if (nfp) events.push({ hour: 8.5, title: 'NFP', impact: 'High' });
  if (live) for (const e of live) if (e.date === date && !events.some(x => Math.abs(x.hour - e.hour) < 0.01)) events.push(e);
  return { date, holiday: holidayName(date), fomc, nfp, eveOf, events, weekday: new Date(date + 'T00:00:00Z').getUTCDay() };
}

/**
 * Parse a weekly economic-calendar feed (ForexFactory JSON export format:
 * [{ title, country, date: ISO with offset, impact }]) into New York dates/hours.
 * Keeps high-impact events for the given currencies.
 */
export function liveEvents(feed, currencies = ['USD']) {
  if (!Array.isArray(feed)) return [];
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const out = [];
  for (const e of feed) {
    if (!e || e.impact !== 'High' || !currencies.includes(e.country)) continue;
    const t = Date.parse(e.date);
    if (!Number.isFinite(t)) continue;
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
    out.push({ date: `${p.year}-${p.month}-${p.day}`, hour: (+p.hour % 24) + +p.minute / 60, title: `${e.country} ${e.title}`, impact: 'High', t: Math.floor(t / 1000) });
  }
  return out;
}

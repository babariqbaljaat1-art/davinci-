// Inter Equity rulebook: calendar, checklist grading, IE management, daily loss stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holidays, dayInfo, liveEvents } from '../docs/engine/calendar.js';
import { simulateTrade, mulberry32 } from '../docs/engine/core.js';
import { findSetups, tradesFromSetups } from '../docs/engine/davinci.js';
import { gradeSetups } from '../docs/engine/ierules.js';

test('calendar: US bank holidays incl. Good Friday and observed days', () => {
  const h = holidays(2024);
  assert.equal(h.get('2024-03-29'), 'Good Friday');
  assert.equal(h.get('2024-11-28'), 'Thanksgiving');
  assert.equal(h.get('2024-01-15'), 'Martin Luther King Day');
  assert.equal(holidays(2021).get('2021-07-05'), 'Independence Day');      // 4 July on a Sunday
  assert.equal(dayInfo('2024-12-26').holiday, 'Boxing Day');
});

test('calendar: FOMC and NFP days, eve of news', () => {
  assert.equal(dayInfo('2024-12-18').fomc, true);
  assert.equal(dayInfo('2024-12-17').eveOf, 'FOMC');
  for (const d of ['2024-08-02', '2024-09-06', '2024-10-04', '2024-11-01', '2024-12-06', '2025-01-10', '2025-02-07', '2025-07-03']) assert.equal(dayInfo(d).nfp, true, d);
  assert.equal(dayInfo('2025-01-03').nfp, false);
});

test('calendar: live feed keeps high-impact events for the currencies, in New York time', () => {
  const ev = liveEvents([
    { title: 'CPI m/m', country: 'USD', date: '2025-02-12T08:30:00-05:00', impact: 'High' },
    { title: 'Retail Sales', country: 'USD', date: '2025-02-14T08:30:00-05:00', impact: 'Medium' },
    { title: 'GDP', country: 'GBP', date: '2025-02-13T02:00:00-05:00', impact: 'High' },
  ], ['USD']);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].date, '2025-02-12');
  assert.ok(Math.abs(ev[0].hour - 8.5) < 1e-9);
  assert.equal(dayInfo('2025-02-12', ev).events[0].title, 'USD CPI m/m');
});

// short at 100, stop 101, liquidity target 95 (5R)
function bars(path, t0 = Date.UTC(2024, 5, 4, 14, 0) / 1000) {   // Tue 4 Jun 2024 10:00 New York, 5m bars
  return path.map(([o, h, l, c], k) => ({ t: t0 + k * 300, o, h, l, c }));
}

test('IE management: 80% at the first target, break-even, runner to the next liquidity', () => {
  const c = bars([[99, 99.5, 98.8, 99], [99.5, 100.2, 99.4, 100], [99.6, 99.8, 96, 96.5], [96.4, 96.6, 94.9, 95.2], [95.2, 95.4, 93.9, 94]]);
  const r = simulateTrade(c, { dir: 'short', entry: 100, sl: 101, tp: 95, armedAt: 1 }, { costR: 0, manage: 'ie', t1Pct: 0.8, t2: 94 });
  assert.equal(r.status, 'win');
  assert.ok(Math.abs(r.r - (0.8 * 5 + 0.2 * 6)) < 1e-9, `r=${r.r}`);
});

test('IE management: after the first target the rest is stopped at break-even', () => {
  const c = bars([[99, 99.5, 98.8, 99], [99.5, 100.2, 99.4, 100], [99.6, 99.8, 94.9, 95.5], [95.5, 100.3, 95.4, 100.2]]);
  const r = simulateTrade(c, { dir: 'short', entry: 100, sl: 101, tp: 95, armedAt: 1 }, { costR: 0, manage: 'ie', t1Pct: 0.8, t2: 93 });
  assert.ok(Math.abs(r.r - 4) < 1e-9, `r=${r.r}`);
});

test('IE management: next structural low taken -> stop to break-even before the target', () => {
  const c = bars([[99, 99.5, 98.8, 99], [99.5, 100.2, 99.4, 100], [99.6, 99.8, 97.9, 98.2], [98.2, 100.4, 98.1, 100.3]]);
  const r = simulateTrade(c, { dir: 'short', entry: 100, sl: 101, tp: 95, armedAt: 1 }, { costR: 0, manage: 'ie', beAt: 98 });
  assert.equal(r.r, 0);
  assert.equal(r.be, true);
});

test('IE management: first target at 3R, runner to the liquidity', () => {
  const c = bars([[99, 99.5, 98.8, 99], [99.5, 100.2, 99.4, 100], [99.6, 99.8, 96.9, 97.2], [97.2, 97.3, 94.9, 95]]);
  const r = simulateTrade(c, { dir: 'short', entry: 100, sl: 101, tp: 95, armedAt: 1 }, { costR: 0, manage: 'ie', t1R: 3, t1Pct: 0.5 });
  assert.ok(Math.abs(r.r - (0.5 * 3 + 0.5 * 5)) < 1e-9, `r=${r.r}`);
});

test('IE management: closes what is left at the New York close hour', () => {
  const t0 = Date.UTC(2024, 5, 4, 19, 50) / 1000;                     // 15:50 New York
  const c = bars([[99, 99.5, 98.8, 99], [99.5, 100.2, 99.4, 100], [99.8, 99.9, 99.2, 99.5], [99.5, 99.6, 99.1, 99.2]], t0);
  const r = simulateTrade(c, { dir: 'short', entry: 100, sl: 101, tp: 95, armedAt: 1 }, { costR: 0, manage: 'ie', closeHour: 16 });
  assert.equal(r.status, 'timeout');
  assert.ok(Math.abs(r.r - 0.5) < 1e-9, `r=${r.r}`);
});

test('two losses in a day and done', () => {
  const t = Date.UTC(2024, 5, 4, 13, 0) / 1000;
  const c = Array.from({ length: 40 }, (_, k) => ({ t: t + k * 300, o: 1, h: 1, l: 1, c: 1 }));
  const mk = (fillAt, r) => ({ id: String(fillAt), result: { status: r > 0 ? 'win' : 'loss', fillAt, exitAt: fillAt + 1, r } });
  const taken = tradesFromSetups([mk(1, -1), mk(4, -1), mk(8, 3)], { candles: c, maxLossesPerDay: 2 });
  assert.deepEqual(taken.map(s => s.id), ['1', '4']);
});

test('grading: every armed setup gets a grade and a full checklist; skip marks only below the minimum', () => {
  // random walk with enough structure for setups; 5m bars starting on a Monday morning New York
  const rnd = mulberry32(7);
  const t0 = Date.UTC(2024, 2, 4, 5, 0) / 1000;
  let p = 2000;
  const c = Array.from({ length: 6000 }, (_, k) => { const o = p; p += (rnd() - 0.5) * 3; const h = Math.max(o, p) + rnd(); const l = Math.min(o, p) - rnd(); return { t: t0 + k * 300, o, h, l, c: p }; });
  const s = findSetups(c, { ie: true, ieMin: 'B', session: [8, 11], kind: 'metal' });
  const armed = s.filter(x => x.armedAt != null);
  assert.ok(armed.length > 0);
  for (const x of armed) {
    assert.ok(['A', 'B', 'X'].includes(x.ie.grade), x.ie.grade);
    assert.ok(x.ie.checks.length >= 18);
    assert.equal(!!x.skip, x.ie.grade === 'X');
  }
  // re-grading is deterministic
  const before = armed.map(x => x.ie.grade).join('');
  gradeSetups(c, armed, { session: [8, 11], kind: 'metal' });
  assert.equal(armed.map(x => x.ie.grade).join(''), before);
});

test('grading: indices only arm after the 9:30 stock open', () => {
  const rnd = mulberry32(11);
  const t0 = Date.UTC(2024, 2, 4, 5, 0) / 1000;
  let p = 18000;
  const c = Array.from({ length: 6000 }, (_, k) => { const o = p; p += (rnd() - 0.5) * 20; const h = Math.max(o, p) + rnd() * 6; const l = Math.min(o, p) - rnd() * 6; return { t: t0 + k * 300, o, h, l, c: p }; });
  const s = findSetups(c, { ie: true, session: [8, 11], kind: 'index' }).filter(x => x.armedAt != null);
  for (const x of s) {
    const h = new Date(c[x.armedAt].t * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
    assert.ok(h >= '09:30' && h < '11:00', h);
  }
});

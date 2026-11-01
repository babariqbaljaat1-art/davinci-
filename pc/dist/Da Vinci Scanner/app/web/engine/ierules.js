// Inter Equity rulebook checklist (research/study-notes.md -> "RULEBOOK").
// Every setup the Da Vinci detector finds is graded against the rules Marco and the team
// state in the course, webinars and live calls:
//   A = every rule met            -> full planned risk
//   B = core rules met, warnings  -> half risk ("B setup")
//   X = a hard rule broken        -> IE would not take it
// Only information available when the order is armed is used (no look-ahead).

import { atr, pivots, nyClock } from './core.js';
import { dayInfo } from './calendar.js';
import { htfBias } from './davinci.js';

export const IE_DEFAULTS = {
  kind: 'fx',               // 'fx' | 'metal' | 'index' (indices wait for the 9:30 stock open)
  sessionStart: 8,          // New York hours for entries
  sessionEnd: 11,           // no new trades after London close
  indexOpen: 9.5,
  minRR: 3,                 // 1:3 to the first target
  bigMoveX: 2.0,            // yesterday's range / 10-day average: fail at or above
  bigMoveWarnX: 1.6,        //                                      warn at or above
  asiaLondonX: 1.5,         // Asia and London both this many times their usual range -> NY likely dead
  maxStopDayFrac: 0.5,      // stop larger than this share of the average day range -> skip
  warnStopDayFrac: 0.3,
  leftStrength: 24,         // swept high/low must be the highest/lowest of this many bars (true draw from the left)
  beyondRiskX: 2,           // unswept liquidity within this many risks beyond the LB -> caution
  newsBeforeH: 3,           // a red-folder event within this many hours after the entry -> no entry before it
  live: null,               // live red-folder events (calendar.liveEvents)
};

export const IE_LABELS = {
  A1: 'Liquidity block: purani liquidity sweep hui',
  A2: 'LB valid: displacement (imbalance ya previous candle ke paar close)',
  A3: 'Buildup: BOS + lower high / higher low (early traders induce)',
  A4: 'Trap: buildup liya gaya, entry liquidity lene ke baad',
  A5: 'Opposite side par engineered liquidity (target)',
  A6: 'With structure nahi (retail ke stops ke paar se entry)',
  A7: 'Liquidity from the left (asli draw sweep hua)',
  A8: 'Pehle target tak RR 1:3 ya zyada',
  A9: 'LB ke paar abhi liquidity nahi bachi',
  A10: 'Stop size theek (LB ke paar, bohot bara nahi)',
  B1: 'HTF (4h) narrative same direction',
  B2: 'Aaj ki liquidity li gayi (PDL/Asia/London low buys ke liye)',
  B3: 'HTF extreme / all-time-high zone nahi',
  C1: 'New York session (entry 8-11 NY, indices 9:30 ke baad)',
  C2: 'Red news se pehle entry nahi (NFP/FOMC/CPI)',
  C4: 'Trap hour (9-10:30 NY) mein sweep',
  C7: 'Bank holiday nahi',
  D1: 'Kal bara move nahi hua (aaj range day nahi)',
  D2: 'Asia + London dono ne bara move nahi kiya',
  D3: 'Kal FOMC/NFP nahi (pre-news liquidity build)',
};

function check(id, state, note = '') { return { id, label: IE_LABELS[id], state, note }; }

/** Checklist groups for display: setup, direction, time, day type. */
export const IE_GROUPS = [
  ['Setup', ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10']],
  ['Direction', ['B1', 'B2', 'B3']],
  ['Time', ['C1', 'C2', 'C4', 'C7']],
  ['Day', ['D1', 'D2', 'D3']],
];

/**
 * Precompute per-bar clock and per-day statistics once per candle series.
 */
function context(candles) {
  const n = candles.length;
  const clock = new Array(n);
  const days = new Map();            // tradeDay -> stats
  const order = [];
  for (let i = 0; i < n; i++) {
    const k = nyClock(candles[i].t);
    clock[i] = k;
    let d = days.get(k.tradeDay);
    if (!d) {
      d = { key: k.tradeDay, first: i, last: i, hi: -Infinity, lo: Infinity, asiaH: -Infinity, asiaL: Infinity, lonH: -Infinity, lonL: Infinity, lonStart: -1, lonEnd: -1, asiaEnd: -1 };
      days.set(k.tradeDay, d); order.push(d);
    }
    const c = candles[i];
    d.last = i; d.hi = Math.max(d.hi, c.h); d.lo = Math.min(d.lo, c.l);
    if (k.hour >= 19) { d.asiaH = Math.max(d.asiaH, c.h); d.asiaL = Math.min(d.asiaL, c.l); d.asiaEnd = i; }
    else if (k.hour >= 2 && k.hour < 5) { d.lonH = Math.max(d.lonH, c.h); d.lonL = Math.min(d.lonL, c.l); if (d.lonStart < 0) d.lonStart = i; d.lonEnd = i; }
  }
  order.forEach((d, j) => {
    d.idx = j;
    const prev = order.slice(Math.max(0, j - 10), j);
    d.prev = order[j - 1] || null;
    d.avgRange = prev.length ? prev.reduce((a, x) => a + (x.hi - x.lo), 0) / prev.length : NaN;
    d.avgAsia = prev.length ? prev.reduce((a, x) => a + (Number.isFinite(x.asiaH) ? x.asiaH - x.asiaL : 0), 0) / prev.length : NaN;
    d.avgLon = prev.length ? prev.reduce((a, x) => a + (Number.isFinite(x.lonH) ? x.lonH - x.lonL : 0), 0) / prev.length : NaN;
    const p20 = order.slice(Math.max(0, j - 20), j), p60 = order.slice(Math.max(0, j - 60), j);
    d.hi20 = Math.max(...p20.map(x => x.hi)); d.lo20 = Math.min(...p20.map(x => x.lo));
    d.hi60 = Math.max(...p60.map(x => x.hi)); d.lo60 = Math.min(...p60.map(x => x.lo));
  });
  return { clock, days };
}

/** Lowest low / highest high of candles[a..b] (inclusive); small ranges only. */
function minLow(c, a, b) { let m = Infinity; for (let i = Math.max(0, a); i <= b; i++) m = Math.min(m, c[i].l); return m; }
function maxHigh(c, a, b) { let m = -Infinity; for (let i = Math.max(0, a); i <= b; i++) m = Math.max(m, c[i].h); return m; }

/**
 * Grade setups in place: adds s.ie = { grade, checks, risk } to every setup.
 * params: detector params (pivotK, sweepLookback, ...) merged with IE_DEFAULTS overrides.
 */
export function gradeSetups(candles, setups, params = {}) {
  const p = { ...IE_DEFAULTS, ...params };
  if (!setups.length) return setups;
  const { clock, days } = context(candles);
  const A = atr(candles, 14);
  const tf = candles[1].t - candles[0].t;
  const hb = htfBias(candles, Math.max(2, Math.round(14400 / tf)));
  const piv = pivots(candles, p.pivotK || 3);
  const start = p.kind === 'index' ? Math.max(p.sessionStart, p.indexOpen) : p.sessionStart;

  for (const s of setups) {
    const short = s.dir === 'short', sg = short ? 1 : -1;
    const at = s.armedAt ?? candles.length - 1;          // decision bar
    const k = clock[Math.min(at, clock.length - 1)];
    const day = days.get(k.tradeDay);
    const info = dayInfo(k.date, p.live);
    const risk = Math.abs(s.sl - s.entry);
    const checks = [];

    // ---- A: the setup ----
    checks.push(check('A1', 'pass', s.swept?.kind ? `${s.swept.kind} sweep` : 'swing sweep'));
    checks.push(check('A2', s.disp === false ? 'fail' : 'pass'));
    const hasBuild = !!s.bos && s.buildup.length > 0;
    checks.push(check('A3', hasBuild ? 'pass' : (s.armedAt == null ? 'wait' : 'fail')));
    checks.push(check('A4', s.armedAt == null ? 'wait' : 'pass', s.armedAt == null ? '' : 'limit LB par: price buildup le kar aayegi tab fill'));
    checks.push(check('A5', s.respected ? 'pass' : (s.armedAt == null ? 'wait' : 'fail'), s.respected ? '' : 'no engineered liquidity = low probability'));
    checks.push(check('A6', hasBuild ? 'pass' : 'wait'));
    const strong = !!s.swept?.kind || (s.swept?.strength ?? 0) >= p.leftStrength;
    checks.push(check('A7', strong ? 'pass' : 'warn', strong ? '' : 'chhota/nazdeeki high-low sweep hua, asli draw nahi'));
    if (s.rr != null) checks.push(check('A8', s.rr >= p.minRR ? 'pass' : 'fail', `1:${s.rr.toFixed(1)}`));
    else checks.push(check('A8', 'wait'));
    // unswept swing beyond the LB, still intact at the decision bar
    const list = short ? piv.highs : piv.lows;
    const ext = short ? s.lb.top : s.lb.bottom;
    let beyond = null;
    let q0 = 0, q1 = list.length;                         // binary search: first pivot inside the lookback window
    const from = s.lb.i - (p.sweepLookback || 150);
    while (q0 < q1) { const m = (q0 + q1) >> 1; if (list[m].i < from) q0 = m + 1; else q1 = m; }
    for (let q = q0; q < list.length && list[q].i < s.lb.i; q++) {
      const h = list[q];
      if (h.confirmedAt > at) continue;
      if (sg * (h.price - ext) <= 0 || sg * (h.price - ext) > p.beyondRiskX * risk) continue;
      const taken = short ? maxHigh(candles, h.i + 1, at) > h.price : minLow(candles, h.i + 1, at) < h.price;
      if (!taken) { beyond = h; break; }
    }
    checks.push(check('A9', beyond ? 'warn' : 'pass', beyond ? `${short ? 'upar' : 'neeche'} ${String(+beyond.price.toFixed(5))} abhi intact` : ''));
    const dayRange = day?.avgRange;
    const stopFrac = Number.isFinite(dayRange) && dayRange > 0 ? risk / dayRange : 0;
    checks.push(check('A10', stopFrac > p.maxStopDayFrac ? 'fail' : stopFrac > p.warnStopDayFrac ? 'warn' : 'pass', stopFrac ? `stop = ${Math.round(stopFrac * 100)}% of day range` : ''));

    // ---- B: direction ----
    const h = hb[Math.min(at, hb.length - 1)];            // +1 bullish, -1 bearish
    const want = short ? -1 : 1;
    checks.push(check('B1', h === -want ? 'fail' : h === want ? 'pass' : 'warn', h === 0 ? 'HTF clear nahi' : h === -want ? 'HTF ulti direction mein' : ''));
    let tookDay = false;
    if (day) {
      const dayStart = day.first;
      if (short) {
        const pdh = day.prev?.hi;
        tookDay = (pdh != null && maxHigh(candles, dayStart, at) > pdh)
          || (Number.isFinite(day.asiaH) && day.asiaEnd >= 0 && maxHigh(candles, day.asiaEnd + 1, at) > day.asiaH)
          || (Number.isFinite(day.lonH) && day.lonEnd >= 0 && maxHigh(candles, day.lonEnd + 1, at) > day.lonH);
      } else {
        const pdl = day.prev?.lo;
        tookDay = (pdl != null && minLow(candles, dayStart, at) < pdl)
          || (Number.isFinite(day.asiaL) && day.asiaEnd >= 0 && minLow(candles, day.asiaEnd + 1, at) < day.asiaL)
          || (Number.isFinite(day.lonL) && day.lonEnd >= 0 && minLow(candles, day.lonEnd + 1, at) < day.lonL);
      }
    }
    checks.push(check('B2', tookDay ? 'pass' : 'warn', tookDay ? '' : short ? 'PDH/Asia/London high abhi nahi liya' : 'PDL/Asia/London low abhi nahi liya'));
    let extreme = false;
    if (day && Number.isFinite(day.hi20)) {
      if (short) extreme = s.entry < day.lo20 || s.lb.top > day.hi60;
      else extreme = s.entry > day.hi20 || s.lb.bottom < day.lo60;
    }
    checks.push(check('B3', extreme ? 'warn' : 'pass', extreme ? 'HTF extreme: Marco pehle PA banne deta hai' : ''));

    // ---- C: time ----
    const hr = k.hour;
    const inSess = hr >= start && hr < p.sessionEnd;
    checks.push(check('C1', inSess ? 'pass' : (s.armedAt == null ? 'wait' : 'fail'), `${String(Math.floor(hr)).padStart(2, '0')}:${String(Math.round((hr % 1) * 60)).padStart(2, '0')} NY`));
    let news = null;
    if (info.fomc) news = 'FOMC din: subah liquidity build hoti hai';
    for (const e of info.events) if (!news && e.hour + 0.08 > hr && e.hour - hr < p.newsBeforeH) news = `${e.title} ${Math.floor(e.hour)}:${String(Math.round((e.hour % 1) * 60)).padStart(2, '0')} se pehle`;
    checks.push(check('C2', news ? 'fail' : 'pass', news || (p.live ? 'live calendar checked' : 'NFP/FOMC auto; CPI aur baqi news ForexFactory par dekho')));
    const lbHour = clock[Math.min(s.lb.i, clock.length - 1)].hour;
    checks.push(check('C4', lbHour >= 9 && lbHour < 10.5 ? 'pass' : 'info', lbHour >= 9 && lbHour < 10.5 ? '' : 'trap hour ke bahar (zaroori nahi)'));
    checks.push(check('C7', info.holiday ? 'fail' : 'pass', info.holiday || ''));

    // ---- D: day type ----
    const pr = day?.prev ? day.prev.hi - day.prev.lo : NaN;
    const x = Number.isFinite(pr) && day.avgRange > 0 ? pr / day.prev.avgRange : 0;
    checks.push(check('D1', x >= p.bigMoveX ? 'fail' : x >= p.bigMoveWarnX ? 'warn' : 'pass', x ? `kal ka range ${x.toFixed(1)}x average` : ''));
    const asiaX = day && day.avgAsia > 0 && Number.isFinite(day.asiaH) ? (day.asiaH - day.asiaL) / day.avgAsia : 0;
    const lonX = day && day.avgLon > 0 && Number.isFinite(day.lonH) ? (day.lonH - day.lonL) / day.avgLon : 0;
    checks.push(check('D2', asiaX >= p.asiaLondonX && lonX >= p.asiaLondonX ? 'warn' : 'pass'));
    checks.push(check('D3', info.eveOf ? 'warn' : 'pass', info.eveOf ? `kal ${info.eveOf}` : ''));

    const fails = checks.filter(c => c.state === 'fail').length;
    const warns = checks.filter(c => c.state === 'warn').length;
    const waiting = checks.some(c => c.state === 'wait');
    const grade = fails ? 'X' : waiting ? '?' : warns ? 'B' : 'A';
    s.ie = { grade, checks, fails, warns, risk: grade === 'A' ? 1 : grade === 'B' ? 0.5 : 0 };
  }
  return setups;
}

/** Order of grades, for "minimum grade" filters. */
export const GRADE_RANK = { A: 3, B: 2, '?': 1, X: 0 };

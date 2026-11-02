// "Marco model": the entry Marco takes most (research/marco-trades.md, YouTube notes):
//   liquidity on the left is taken -> that high/low is a LIQUIDITY BLOCK (LB) -> price pulls back,
//   prints an inducement high (early sellers' stops above it) -> the moment that high is stabbed
//   while price is still inside the LB, SELL. Stop beyond the LB extreme, target the opposite
//   liquidity (the low the trap started from), at least 1:3 to the first target.
//   "I will always enter as soon as the liquidity is taken."  Bullish = mirror.
//
// Two shapes of the same model:
//   mode 'pivot'   : LB = swing high that ran an intact older swing high (+ displacement);
//                    inducement = a later lower swing high (k = entryK bars each side).
//   mode 'candle4' : the 4-candle sniper model (video "The ONLY Entry Model You Need"):
//                    c2 spikes the high from the left and closes back below (LB with a big wick),
//                    c3 prints a high below it, c4 takes c3's high -> sell at c3 high, stop above c2.
// Output has the same shape as davinci.js setups, so grading, the app and the backtest reuse it.

import { atr, pivots, simulateTrade, nyClock } from './core.js';

export const MARCO_DEFAULTS = {
  mode: 'pivot',          // 'pivot' | 'candle4'
  pivotK: 3,              // swing strength for the LB and for the liquidity it runs
  entryK: 2,              // swing strength for the inducement high/low (pivot mode)
  sweepLookback: 150,
  displacementBars: 3,
  requireDisplacement: true,
  wickFrac: 0.4,          // candle4: the LB candle's rejection wick must be at least this share of its range
  candle4Window: 3,       // candle4: c4 may come up to this many bars after c3
  slBufferATR: 0.1,
  minRiskATR: 0,
  minRR: 3,
  maxRR: 20,
  maxBarsToEntry: 120,
  maxSetupsPerLB: 3,      // re-entries while the LB holds and the target is intact ("another opportunity")
  maxBarsInTrade: 400,
  costR: 0.05,
  spread: 0,
  session: null,
  manage: 'simple',
  t1Pct: 0.8,
  t1R: 0,
  closeHour: 16,
  partialR: 0,
  partialPct: 0.5,
  fixedR: 0,              // research only: >0 = fixed R target (the liquidity must still be at least minRR away)
  insideLB: true,         // pivot mode: the inducement high must sit inside the LB zone (between the swept level and the LB extreme)
};

function mirror(candles) {
  return candles.map(c => ({ t: c.t, o: -c.o, h: -c.l, l: -c.h, c: -c.c }));
}

/** First index in a pivot list with .i > i. */
function firstAfter(list, i) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].i <= i) lo = m + 1; else hi = m; }
  return lo;
}

/** The intact older swing high that the high at bar i (price h) ran, if any (liquidity from the left). */
function sweptHigh(c, highs, i, h, lookback) {
  let best = null, maxSince = -Infinity, x = i - 1, lowIdx = -1;
  for (let q = firstAfter(highs, i - 1) - 1; q >= 0; q--) {
    const p = highs[q];
    if (p.i < i - lookback) break;
    while (x > p.i) {
      if (c[x].h > maxSince) maxSince = c[x].h;
      if (lowIdx < 0 || c[x].l < c[lowIdx].l) lowIdx = x;
      x--;
    }
    if (maxSince > h) break;                                   // something higher since: older highs were not run by this one
    if (p.confirmedAt > i || p.price >= h || lowIdx < 0) continue;
    let taken = false;                                         // must be intact until the leg into the sweep
    for (let y = p.i + 1; y <= lowIdx; y++) if (c[y].h > p.price) { taken = true; break; }
    if (taken) continue;
    if (!best || p.price > best.price) best = p;
  }
  return best;
}

/** Nearest intact swing low below `price`, formed before bar `at`, still untouched at `at` (liquidity target). */
function liquidityBelow(c, lows, at, price, lookback, minDist = 0) {
  let best = null;
  for (let q = firstAfter(lows, at - 1) - 1; q >= 0; q--) {
    const l = lows[q];
    if (l.i < at - lookback) break;
    if (l.confirmedAt > at || l.price >= price - minDist) continue;
    let intact = true;
    for (let y = l.i + 1; y < at; y++) if (c[y].l < l.price) { intact = false; break; }
    if (intact && (!best || l.price > best.price)) best = l;
  }
  return best;
}

/** Bearish detector on (possibly mirrored) candles. */
function detect(c, p, A, piv, hours) {
  const n = c.length, out = [];
  const { highs, lows } = piv;
  const ent = p.mode === 'pivot' ? pivots(c, p.entryK) : null;
  const inSession = t => !hours || (hours[t] >= p.session[0] && hours[t] < p.session[1]);

  const build = (lb, h0, ih, armAt, extreme, disp, tpLevel = null) => {
    const a = A[lb.i];
    const entry = ih.price;
    const sl = Math.max(lb.price + p.slBufferATR * a, entry + p.minRiskATR * a);
    const risk = sl - entry;
    if (!(risk > 0)) return null;
    let tp = tpLevel ?? extreme.price;                          // the low the trap started from (sell-side resting there)
    let rr = (entry - tp) / risk;
    if (rr < p.minRR || rr > p.maxRR) return null;
    if (p.fixedR > 0) { tp = entry - p.fixedR * risk; rr = p.fixedR; }   // research: fixed target, liquidity must lie beyond it
    // management levels: next intact low >= 1R below entry and above T1 -> BE; next intact low below T1 -> runner
    let beAt = null;
    for (let q = firstAfter(lows, lb.i) ; q < lows.length && lows[q].confirmedAt <= armAt; q++) {
      const l = lows[q];
      if (l.price < entry - risk && l.price > tp) {
        let intact = true;
        for (let y = l.i + 1; y < armAt; y++) if (c[y].l < l.price) { intact = false; break; }
        if (intact && (beAt == null || l.price > beAt)) beAt = l.price;
      }
    }
    const t2l = liquidityBelow(c, lows, armAt, tp, p.sweepLookback * 2, 0.05 * a);
    // pending order: fills when price trades up through the inducement high, cancelled at session end
    let expiresAt = Math.min(n - 1, armAt + p.maxBarsToEntry);
    if (hours) { let e = armAt; while (e + 1 < n && inSession(e + 1) && e + 1 - armAt < 400) e++; expiresAt = Math.min(expiresAt, e); }
    const s = {
      lb: { i: lb.i, t: c[lb.i].t, top: lb.price, bottom: Math.min(ih.price, Math.max(c[lb.i].o, c[lb.i].c)), level: h0.price },
      swept: { i: h0.i, t: c[h0.i].t, price: h0.price, kind: h0.kind || null, strength: h0.strength ?? 0 },
      disp,
      bos: { i: extreme.i, price: extreme.price },              // sellers induced: the sell-off away from the LB
      buildup: [{ i: ih.i, t: c[ih.i].t, price: ih.price }],     // the inducement high (early sellers' stops above)
      respected: { i: extreme.i, t: c[extreme.i].t, price: extreme.price },
      extreme: { i: extreme.i, t: c[extreme.i].t, price: extreme.price },
      entry, sl, tp, rr, armedAt: armAt, expiresAt, model: p.mode,
      mgmt: { beAt, t2: t2l ? t2l.price : null },
    };
    s.result = simulateTrade(c, { dir: 'short', entry, sl, tp, armedAt: armAt, expiresAt },
      { costR: p.costR + (p.spread || 0) / risk, maxBarsInTrade: p.maxBarsInTrade, partialR: p.partialR, partialPct: p.partialPct,
        manage: p.manage, t1Pct: p.t1Pct, t1R: p.t1R, beAt, t2: s.mgmt.t2, closeHour: p.closeHour });
    s.status = s.result.status;
    return s;
  };

  const strengthOf = h0 => { let k = 0; for (let x = h0.i - 1; x >= 0 && k < 500 && c[x].h < h0.price; x--) k++; return k; };

  if (p.mode === 'candle4') {
    for (let i = 1; i + 2 < n; i++) {
      const c1 = c[i - 1], c2 = c[i], a = A[i];
      if (!(a > 0) || !(c2.h > c1.h)) continue;
      const range = c2.h - c2.l, wick = c2.h - Math.max(c2.o, c2.c);
      if (!(range > 0) || wick < p.wickFrac * range || !(c2.c < c1.h)) continue;   // spike above and close back below
      const h0 = sweptHigh(c, highs, i, c2.h, p.sweepLookback) || (c1.h < c2.h ? { i: i - 1, price: c1.h, kind: 'prev candle' } : null);
      if (!h0) continue;
      h0.strength = strengthOf(h0);
      const c3 = c[i + 1];
      if (!(c3.h < c2.h) || c3.c > c2.h) continue;                // c3 leaves a high below the LB
      if (!inSession(i + 2)) continue;
      const lb = { i, price: c2.h };
      let extreme = { i: i, price: Math.min(c2.l, c3.l) };
      if (c3.l < c2.l) extreme = { i: i + 1, price: c3.l };
      // target: the nearest liquidity below from the left ("targeting whatever it is to the downside")
      const liq = liquidityBelow(c, lows, i + 2, extreme.price, p.sweepLookback * 2);
      if (!liq) continue;
      const s = build(lb, h0, { i: i + 1, price: c3.h }, i + 2, extreme, true, liq.price);
      if (!s) continue;
      s.expiresAt = Math.min(s.expiresAt, i + 1 + p.candle4Window);
      s.result = simulateTrade(c, { dir: 'short', entry: s.entry, sl: s.sl, tp: s.tp, armedAt: s.armedAt, expiresAt: s.expiresAt },
        { costR: p.costR + (p.spread || 0) / (s.sl - s.entry), maxBarsInTrade: p.maxBarsInTrade, partialR: p.partialR, partialPct: p.partialPct,
          manage: p.manage, t1Pct: p.t1Pct, t1R: p.t1R, beAt: s.mgmt.beAt, t2: s.mgmt.t2, closeHour: p.closeHour });
      s.status = s.result.status;
      out.push(s);
    }
    return out;
  }

  // pivot mode
  for (const H1 of highs) {
    const i = H1.i, a = A[i];
    if (!(a > 0) || i + p.pivotK >= n) continue;
    const h0 = sweptHigh(c, highs, i, H1.price, p.sweepLookback);
    if (!h0) continue;
    h0.strength = strengthOf(h0);
    let disp = false;
    for (let j = i + 1; j <= Math.min(n - 1, i + p.displacementBars); j++) {
      if (c[j].c < c[j - 1].l || (j + 1 < n && c[j + 1].h < c[j - 1].l)) { disp = true; break; }
    }
    if (p.requireDisplacement && !disp) continue;
    const lb = { i, price: H1.price };
    const lbBottom = Math.min(h0.price, Math.max(c[i].o, c[i].c));
    let extreme = { i, price: c[i].l }, made = 0;
    let q = firstAfter(ent.highs, i);
    const end = Math.min(n - 1, i + p.maxBarsToEntry);
    let waitAbove = -Infinity;                                  // after a fill, only a new lower high counts as a new inducement
    let broken = false, last = null, doneAt = Infinity;
    for (let t = i + 1; t <= end && made < p.maxSetupsPerLB; t++) {
      const b = c[t];
      if (b.c > H1.price) { broken = true; break; }             // LB broken
      // "As soon as we take out this low ... sells need to be off your cards": the target liquidity was
      // taken before the entry, so this LB gives no more sells
      if (t >= doneAt) { broken = true; break; }
      if (b.l < extreme.price) extreme = { i: t, price: b.l };
      while (q < ent.highs.length && ent.highs[q].confirmedAt <= t) {
        const ih = ent.highs[q++];
        if (ih.i <= extreme.i || ih.price >= H1.price || ih.i <= i) continue;   // must be a lower high printed after the sell-off
        if (p.insideLB && ih.price < lbBottom) continue;          // "trapped inside the LB": the stabbed high is in the LB zone
        // still untaken when it becomes known
        let taken = false;
        for (let y = ih.i + 1; y <= t; y++) if (c[y].h > ih.price) { taken = true; break; }
        if (taken || ih.price <= waitAbove) continue;
        if (!inSession(t)) continue;
        const ext = { i: extreme.i, price: extreme.price };
        const s = build(lb, h0, ih, t + 1, ext, disp);
        if (!s) continue;
        out.push(s);
        last = s;
        made++;
        if (s.result.status === 'missed') doneAt = Math.min(doneAt, s.result.at);
        waitAbove = -Infinity;
      }
    }
    // LB still holding at the last bar, waiting for (another) inducement high to be stabbed -> 'forming'
    if (!broken && end === n - 1 && made < p.maxSetupsPerLB && !(last && ['pending', 'open'].includes(last.status))) {
      out.push({
        lb: { i, t: c[i].t, top: H1.price, bottom: lbBottom, level: h0.price },
        swept: { i: h0.i, t: c[h0.i].t, price: h0.price, kind: h0.kind || null, strength: h0.strength ?? 0 },
        disp, bos: { i: extreme.i, price: extreme.price }, buildup: [],
        respected: { i: extreme.i, t: c[extreme.i].t, price: extreme.price },
        extreme: { i: extreme.i, t: c[extreme.i].t, price: extreme.price },
        entry: lbBottom, sl: H1.price + p.slBufferATR * a, tp: null, rr: null,
        armedAt: null, expiresAt: null, model: p.mode, mgmt: null, result: null, status: 'forming',
      });
    }
  }
  return out;
}

function unmirror(s) {
  const f = v => (v == null ? v : -v);
  const pt = o => (o ? { ...o, price: f(o.price) } : o);
  return {
    ...s,
    lb: { ...s.lb, top: f(s.lb.top), bottom: f(s.lb.bottom), level: f(s.lb.level) },
    swept: pt(s.swept), bos: pt(s.bos), respected: pt(s.respected), extreme: pt(s.extreme),
    buildup: s.buildup.map(pt),
    entry: f(s.entry), sl: f(s.sl), tp: f(s.tp),
    mgmt: s.mgmt ? { beAt: f(s.mgmt.beAt), t2: f(s.mgmt.t2) } : s.mgmt,
    result: s.result ? { ...s.result, exit: f(s.result.exit), mark: f(s.result.mark) } : s.result,
  };
}

/** All Marco-model setups (both directions), sorted by arming bar. */
export function findMarcoSetups(candles, params = {}) {
  const p = { ...MARCO_DEFAULTS, ...params };
  if (candles.length < 50) return [];
  const A = atr(candles, 14);
  const hours = p.session ? candles.map(x => nyClock(x.t).hour) : null;
  const bear = detect(candles, p, A, pivots(candles, p.pivotK), hours).map(s => ({ ...s, dir: 'short' }));
  const m = mirror(candles);
  const bull = detect(m, p, A, pivots(m, p.pivotK), hours).map(s => ({ ...unmirror(s), dir: 'long' }));
  const all = [...bear, ...bull];
  for (const s of all) s.id = s.armedAt == null ? `${s.dir}-${s.model}-lb${s.lb.t}` : `${s.dir}-${s.model}-${candles[s.armedAt].t}`;
  return all.sort((a, b) => (a.armedAt ?? candles.length) - (b.armedAt ?? candles.length));
}

/**
 * Marco's liquidity marks. A swing high (low) is only liquidity once a later swing high (low) came
 * back to it and respected it (within tolATR, without taking it): "if this high never touched into
 * this high ... you wouldn't be plotting a line on this high". The ray lasts until price trades
 * through it. Returns [{ i, price, high, respAt, endAt (null = still resting), taken }].
 */
export function liquidityLevels(candles, { k = 3, tolATR = 0.3, maxActive = 60 } = {}) {
  const n = candles.length;
  if (n < 20) return [];
  const A = atr(candles, 14), piv = pivots(candles, k), out = [];
  for (const [list, high] of [[piv.highs, true], [piv.lows, false]]) {
    const active = [];
    let q = 0;
    for (let t = 0; t < n; t++) {
      const b = candles[t];
      for (let j = active.length - 1; j >= 0; j--) {
        const L = active[j];
        if (high ? b.h > L.price : b.l < L.price) { if (L.respAt != null) out.push({ ...L, endAt: t, taken: true }); active.splice(j, 1); }
      }
      while (q < list.length && list[q].confirmedAt <= t) {
        const p = list[q++], tol = tolATR * (A[t] || 0);
        for (const L of active) {
          if (L.respAt != null || p.i - L.i < 2) continue;
          if (high ? p.price <= L.price && p.price >= L.price - tol : p.price >= L.price && p.price <= L.price + tol) L.respAt = p.i;
        }
        active.push({ i: p.i, price: p.price, high, respAt: null });
        if (active.length > maxActive) { const o = active.shift(); if (o.respAt != null) out.push({ ...o, endAt: t, taken: false }); }
      }
    }
    for (const L of active) if (L.respAt != null) out.push({ ...L, endAt: null, taken: false });
  }
  return out.sort((a, b) => a.i - b.i);
}

/**
 * Today's session liquidity at the last bar ("who is induced?"): previous day high/low, and the
 * Asia (19-24 NY) and London (2-5 NY) highs/lows once those sessions are over, each with whether
 * price has taken it since. Returns [{ name, price, i, taken }].
 */
export function sessionLevels(candles) {
  const n = candles.length;
  if (n < 2) return [];
  const clock = candles.map(c => nyClock(c.t));
  const today = clock[n - 1].tradeDay;
  let first = n - 1;
  while (first > 0 && clock[first - 1].tradeDay === today) first--;
  let p = first - 1, pH = -Infinity, pL = Infinity;
  while (p >= 0 && clock[p].tradeDay === clock[Math.max(0, first - 1)].tradeDay) { pH = Math.max(pH, candles[p].h); pL = Math.min(pL, candles[p].l); p--; }
  const win = (from, to) => {
    let h = -Infinity, l = Infinity, s = -1, e = -1;
    for (let i = first; i < n; i++) { const hr = clock[i].hour; if (hr >= from && hr < to) { h = Math.max(h, candles[i].h); l = Math.min(l, candles[i].l); if (s < 0) s = i; e = i; } }
    return { h, l, s, e };
  };
  const after = (from, test) => { for (let i = from + 1; i < n; i++) if (test(candles[i])) return true; return false; };
  const out = [];
  if (first > 0 && Number.isFinite(pH)) {
    out.push({ name: 'PDH', price: pH, i: first, taken: after(first - 1, c => c.h > pH) });
    out.push({ name: 'PDL', price: pL, i: first, taken: after(first - 1, c => c.l < pL) });
  }
  const asia = win(19, 24), lon = win(2, 5);
  if (asia.s >= 0 && asia.e < n - 1 && clock[n - 1].hour < 17) {
    out.push({ name: 'Asia H', price: asia.h, i: asia.s, taken: after(asia.e, c => c.h > asia.h) });
    out.push({ name: 'Asia L', price: asia.l, i: asia.s, taken: after(asia.e, c => c.l < asia.l) });
  }
  if (lon.s >= 0 && lon.e < n - 1 && clock[n - 1].hour >= 5 && clock[n - 1].hour < 17) {
    out.push({ name: 'London H', price: lon.h, i: lon.s, taken: after(lon.e, c => c.h > lon.h) });
    out.push({ name: 'London L', price: lon.l, i: lon.s, taken: after(lon.e, c => c.l < lon.l) });
  }
  return out;
}

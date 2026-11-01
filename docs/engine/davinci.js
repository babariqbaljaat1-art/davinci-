// "Da Vinci" setup detector, written from the Inter Equity course rules.
//
// Bearish version (bullish is the exact mirror):
//  Step 1  Liquidity Block (LB): a swing high H1 that runs a prior intact swing
//          high H0 (buy-side liquidity) and is followed by displacement
//          (a close below the previous candle's low, or a bearish imbalance/FVG).
//  Step 2  Buildup below the LB: price takes out the swing low that preceded
//          H1 (BOS, sellers induced), then prints at least one lower high
//          below the LB (internal liquidity / early sellers).
//  Step 3  Price engineers liquidity at the lows: the post-LB low is respected
//          by a later higher (or equal) low, leaving sell-side liquidity to target.
//  Step 4  Buildup taken -> entry: price rallies through the buildup highs into
//          the LB. Sell at the LB, stop above the LB, target the lows.
//
// Invalid when: price closes above the LB before entry, the lows get taken
// before entry ("liquidity already taken, setup done"), RR is below minimum,
// or the setup takes too long.

import { atr, pivots, simulateTrade, resample, nyClock, referenceLevels, periodBias } from './core.js';

export const DEFAULTS = {
  pivotK: 3,              // swing strength (bars each side)
  sweepLookback: 150,     // bars back to look for the swept high/low (H0)
  displacementBars: 3,    // bars after the LB high/low that must show displacement
  requireDisplacement: true,
  minBuildup: 1,          // lower highs (bearish) / higher lows (bullish) after the BOS
  requireRespectedLow: true,
  equalTolATR: 0.15,      // "equal" lows/highs tolerance, in ATR
  entryMode: 'level',     // 'level' = swept level H0, 'body' = LB candle body, 'mid' = 50% of LB
  slBufferATR: 0.10,      // extra room beyond the LB extreme
  minRiskATR: 0,          // stop at least this many ATR from entry (0 = off)
  tpMode: 'liquidity',    // 'liquidity' = opposing lows/highs, 'nearest' = nearer respected low, 'fixedR' = fixed multiple (only if liquidity lies beyond it)
  fixedR: 3,
  minRR: 3,
  maxRR: 20,
  maxBarsToEntry: 200,
  maxBarsInTrade: 400,
  costR: 0.05,            // slippage + commission per trade, in R
  spread: 0,              // bid/ask spread in price units; added to the cost as spread / risk
  bias: 'none',           // 'none' | 'htf' | 'daily' | 'weekly' (direction from the last prev-day/week high-low sweep)
  session: null,          // e.g. [8, 11] = only arm/fill between 08:00 and 11:00 New York time
  refLevels: false,       // true = the LB must sweep a session level (prev day / Asia / London high or low)
  htfFactor: 4,           // HTF = this many base bars (e.g. 1h -> 4h)
};

// --- mirroring: run the bearish logic on flipped prices to get bullish setups ---
function mirror(candles) {
  return candles.map(c => ({ t: c.t, o: -c.o, h: -c.l, l: -c.h, c: -c.c }));
}

/**
 * Higher-timeframe narrative, per base bar: +1 bullish, -1 bearish, 0 unknown.
 * Bearish when the latest HTF event was a sweep of an HTF swing high that
 * closed back below it (buy-side taken -> market goes for sell-side), and
 * vice versa. Only completed HTF bars are used (no look-ahead).
 */
export function htfBias(candles, factor = 4, k = 2) {
  const out = new Array(candles.length).fill(0);
  if (candles.length < 3) return out;
  const tf = candles[1].t - candles[0].t;
  const sec = tf * factor;
  const htf = resample(candles, sec);
  const { highs, lows } = pivots(htf, k);
  const events = []; // { at: htf index, dir }
  for (let j = 1; j < htf.length; j++) {
    const b = htf[j];
    const ph = highs.filter(p => p.confirmedAt <= j - 1 && p.i < j).slice(-3);
    const pl = lows.filter(p => p.confirmedAt <= j - 1 && p.i < j).slice(-3);
    if (ph.some(p => b.h > p.price && b.c < p.price)) events.push({ at: j, dir: -1 });
    else if (pl.some(p => b.l < p.price && b.c > p.price)) events.push({ at: j, dir: 1 });
  }
  let e = 0, cur = 0;
  for (let i = 0; i < candles.length; i++) {
    // HTF bar j is complete once a base bar starts at or after its end
    const t = candles[i].t;
    while (e < events.length && htf[events[e].at].t + sec <= t) { cur = events[e].dir; e++; }
    out[i] = cur;
  }
  return out;
}

/** Index of the first pivot whose bar index is > i (pivots are sorted by i). */
function firstAfter(list, i) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].i <= i) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Core bearish detector on (possibly mirrored) candles. */
function detectBearish(c, p, A, piv, refs, hours) {
  const { highs, lows } = piv;
  const n = c.length;
  const setups = [];
  // sparse table: rangeMax(a, b) = max high in [a, b] in O(1)
  const LOG = new Uint8Array(n + 1); for (let k = 2; k <= n; k++) LOG[k] = LOG[k >> 1] + 1;
  const sp = [Float64Array.from(c, x => x.h)];
  for (let j = 1; (1 << j) <= n; j++) {
    const prev = sp[j - 1], half = 1 << (j - 1), cur = new Float64Array(n - (1 << j) + 1);
    for (let k = 0; k < cur.length; k++) cur[k] = Math.max(prev[k], prev[k + half]);
    sp.push(cur);
  }
  const rangeMax = (a, b) => { if (b < a) return -Infinity; const j = LOG[b - a + 1]; return Math.max(sp[j][a], sp[j][b - (1 << j) + 1]); };

  for (const H1 of highs) {
    const i = H1.i;
    if (i + p.pivotK >= n) continue;
    const atrI = A[i];
    if (!(atrI > 0)) continue;

    // Step 1a: which intact swing high did H1 run?
    let H0 = null;
    if (refs) {
      // session mode: H1 must be the leg that first took a session level (prev day / Asia / London)
      for (const r of refs) {
        if (r.knownAt > i || r.knownAt < i - p.sweepLookback || r.price >= H1.price || r.cross < 0) continue;
        if (r.cross > i || r.cross < i - 2 * p.pivotK - 2) continue;
        let higher = false;
        for (let x = r.cross; x < i; x++) if (c[x].h > H1.price) { higher = true; break; }
        if (higher) continue;
        if (!H0 || r.price > H0.price) H0 = { i: r.knownAt - 1, price: r.price, kind: r.kind };
      }
    }
    if (!refs) {
      // H0 must stay intact until the pullback low that starts the sweep leg,
      // and H1 must be the highest point since H0.
      let x = i - 1, lowIdx = -1, maxSince = -Infinity;
      for (let q = firstAfter(highs, i - 1) - 1; q >= 0; q--) {
        const h = highs[q];
        if (h.i < i - p.sweepLookback) break;
        while (x > h.i) {                                    // extend the suffix (h.i, i)
          if (c[x].h > maxSince) maxSince = c[x].h;
          if (lowIdx < 0 || c[x].l < c[lowIdx].l) lowIdx = x;
          x--;
        }
        if (maxSince > H1.price) break;                      // higher than H1 since here: older highs fail too
        if (h.confirmedAt > i || h.price >= H1.price || lowIdx < 0) continue;
        if (rangeMax(h.i + 1, lowIdx) > h.price) continue;   // taken before the sweep leg started
        if (!H0 || h.price > H0.price) H0 = h;
      }
    }
    if (!H0) continue;

    // Step 1b: displacement after the LB high
    let dispAt = -1;
    for (let j = i + 1; j <= Math.min(n - 1, i + p.displacementBars); j++) {
      const closeBelowPrev = c[j].c < c[j - 1].l;
      const fvg = j + 1 < n && c[j + 1].h < c[j - 1].l;
      if (closeBelowPrev || fvg) { dispAt = fvg && !closeBelowPrev ? j + 1 : j; break; }
    }
    if (p.requireDisplacement && dispAt < 0) continue;

    const top = H1.price;
    const bodyTop = Math.max(c[i].o, c[i].c);
    const level = H0.price;
    let entry = p.entryMode === 'body' ? bodyTop
      : p.entryMode === 'mid' ? (top + Math.min(level, bodyTop)) / 2
      : level;
    if (entry >= top - 0.05 * atrI) continue;
    const sl = Math.max(top + p.slBufferATR * atrI, entry + p.minRiskATR * atrI);

    // Low that led into the sweep (sellers' BOS reference)
    // last swing low strictly between H0 and H1 (binary search instead of scanning every low)
    const li0 = firstAfter(lows, i - 1) - 1;
    let Lp = li0 >= 0 && lows[li0].i > H0.i && lows[li0].i < i ? lows[li0] : null;
    if (!Lp) {
      let li = H0.i + 1;
      for (let x = H0.i + 1; x < i; x++) if (c[x].l < c[li].l) li = x;
      if (li >= i) continue;
      Lp = { i: li, price: c[li].l };
    }

    // Walk forward bar by bar using only information known at each bar
    const start = Math.max(i + p.pivotK, dispAt < 0 ? i + 1 : dispAt);
    const endScan = Math.min(n - 1, i + p.maxBarsToEntry);
    let bos = null, extreme = { i, price: Infinity }, status = 'forming', armed = null;
    let buildup = [], respected = null, invalidAt = -1;
    const tol = p.equalTolATR * atrI;
    // pivots after H1, consumed in confirmation order (pivot index order == confirmation order)
    let hp = firstAfter(highs, i), lp = firstAfter(lows, i);

    for (let t = i + 1; t <= endScan; t++) {
      const b = c[t];
      if (b.c > top) { status = 'invalid'; invalidAt = t; break; }   // LB broken
      if (!bos && b.l < Lp.price) bos = { i: t, price: Lp.price };
      if (b.l < extreme.price) {
        extreme = { i: t, price: b.l };
        respected = null;                                            // need a new respected low
      }
      // Step 2: lower highs below the entry level, formed after the BOS
      while (hp < highs.length && highs[hp].confirmedAt <= t) {
        const h = highs[hp++];
        if (bos && h.i > bos.i && h.price < entry) buildup.push(h);
      }
      // Step 3: a later low that respected (did not break) the extreme low
      while (lp < lows.length && lows[lp].confirmedAt <= t) {
        const l = lows[lp++];
        if (!respected && l.i > extreme.i && l.price >= extreme.price - tol) respected = l;
      }
      if (t < start || !bos) continue;
      const ready = buildup.length >= p.minBuildup && (!p.requireRespectedLow || respected);
      if (hours && !(hours[t] >= p.session[0] && hours[t] < p.session[1])) continue;   // outside the trading session
      if (!armed && ready) {
        let tp = extreme.price;
        if (p.tpMode === 'nearest' && respected) tp = Math.min(respected.price, entry - (sl - entry) * p.minRR);
        if (p.tpMode === 'fixedR') {
          tp = entry - p.fixedR * (sl - entry);
          if (tp < extreme.price) continue;                          // opposing liquidity must lie beyond the target
        }
        const rr = (entry - tp) / (sl - entry);
        if (rr < p.minRR || rr > p.maxRR) continue;                  // wait: RR may improve with a lower low
        // the market must still be below the entry when we arm
        if (b.h >= entry) continue;
        armed = { at: t + 1, tp, rr };
        status = 'armed';
        break;
      }
    }

    const base = {
      lb: { i, t: c[i].t, top, bottom: Math.min(level, bodyTop), level },
      swept: { i: H0.i, t: c[H0.i].t, price: H0.price },
      bos, buildup: buildup.map(h => ({ i: h.i, t: c[h.i].t, price: h.price })),
      respected: respected ? { i: respected.i, t: c[respected.i].t, price: respected.price } : null,
      extreme: Number.isFinite(extreme.price) ? { i: extreme.i, t: c[extreme.i].t, price: extreme.price } : null,
      entry, sl,
    };
    if (!armed) {
      setups.push({ ...base, status: status === 'forming' && endScan >= n - 1 ? 'forming' : (status === 'forming' ? 'expired' : status), invalidAt });
      continue;
    }
    let expiresAt = Math.min(n - 1, i + p.maxBarsToEntry);
    if (hours) {   // an unfilled order is cancelled when the session ends
      let e = armed.at;
      while (e + 1 < n && hours[e + 1] >= p.session[0] && hours[e + 1] < p.session[1] && e + 1 - armed.at < 400) e++;
      expiresAt = Math.min(expiresAt, e);
    }
    const s = { ...base, tp: armed.tp, rr: armed.rr, armedAt: armed.at, expiresAt, status: 'armed' };
    s.result = simulateTrade(c, { dir: 'short', entry: s.entry, sl: s.sl, tp: s.tp, armedAt: s.armedAt, expiresAt: s.expiresAt }, { costR: p.costR + (p.spread || 0) / Math.abs(s.sl - s.entry), maxBarsInTrade: p.maxBarsInTrade });
    s.status = s.result.status;
    setups.push(s);
  }
  return setups;
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
    result: s.result ? { ...s.result, exit: f(s.result.exit), mark: f(s.result.mark) } : s.result,
  };
}

/**
 * Find all Da Vinci setups (both directions) in a candle series.
 * Every setup carries its own simulated outcome, so the same call powers the
 * live scanner (latest setups) and the backtest (all setups).
 */
export function findSetups(candles, params = {}) {
  const p = { ...DEFAULTS, ...params };
  if (candles.length < 50) return [];
  const A = atr(candles, 14);
  const bias = p.bias === 'htf' ? htfBias(candles, p.htfFactor) : (p.bias === 'daily' || p.bias === 'weekly') ? periodBias(candles, p.bias) : null;

  const hours = p.session ? candles.map(c => nyClock(c.t).hour) : null;
  let refsBear = null, refsBull = null;
  if (p.refLevels) {
    const rl = referenceLevels(candles);
    const cross = (list, sign) => list.map(r => {
      let x = r.knownAt;
      while (x < candles.length && x < r.knownAt + p.sweepLookback && !(sign > 0 ? candles[x].h > r.price : candles[x].l < r.price)) x++;
      return { ...r, price: sign * r.price, cross: x < candles.length && x < r.knownAt + p.sweepLookback ? x : -1 };
    });
    refsBear = cross(rl.highs, 1);
    refsBull = cross(rl.lows, -1);
  }
  const bear = detectBearish(candles, p, A, pivots(candles, p.pivotK), refsBear, hours).map(s => ({ ...s, dir: 'short' }));
  const m = mirror(candles);
  const bull = detectBearish(m, p, A, pivots(m, p.pivotK), refsBull, hours).map(s => ({ ...unmirror(s), dir: 'long' }));

  let all = [...bear, ...bull];
  if (bias) {
    all = all.filter(s => {
      const at = s.armedAt ?? s.lb.i;
      const b = bias[Math.min(at, bias.length - 1)];
      return s.dir === 'short' ? b === -1 : b === 1;
    });
  }
  for (const s of all) s.id = `${s.dir}-${s.lb.t}`;
  return all.sort((a, b) => a.lb.i - b.lb.i);
}

/**
 * Backtest = every armed setup, taking only one trade at a time
 * (a setup that fills while another trade is open is skipped).
 */
export function tradesFromSetups(setups) {
  const done = setups
    .filter(s => s.result && ['win', 'loss', 'timeout', 'open'].includes(s.result.status))
    .sort((a, b) => a.result.fillAt - b.result.fillAt);
  const taken = [];
  let busyUntil = -1;
  for (const s of done) {
    if (s.result.fillAt <= busyUntil) continue;
    taken.push(s);
    busyUntil = s.result.exitAt ?? Infinity;
  }
  return taken;
}

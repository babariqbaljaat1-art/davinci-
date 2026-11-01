// Generic market-structure + backtest utilities.
// Pure functions, no dependencies: runs in the browser and in Node.
//
// Candle format used everywhere: { t: unixSeconds, o, h, l, c }

/** Average True Range (Wilder). Returns array aligned with candles (NaN until warm). */
export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tr = i === 0
      ? c.h - c.l
      : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c));
    if (i < period) {
      prev = i === 0 ? tr : prev + tr;
      if (i === period - 1) { prev = prev / period; out[i] = prev; }
    } else {
      prev = (prev * (period - 1) + tr) / period;
      out[i] = prev;
    }
  }
  return out;
}

/**
 * Fractal swing points. A swing high at i needs `k` lower highs on each side.
 * `confirmedAt` = i + k: the first bar at which the pivot is knowable (no look-ahead).
 */
export function pivots(candles, k = 3) {
  const highs = [], lows = [];
  const n = candles.length;
  for (let i = k; i < n - k; i++) {
    let isH = true, isL = true;
    const hi = candles[i].h, lo = candles[i].l;
    for (let j = 1; j <= k && (isH || isL); j++) {
      if (candles[i - j].h >= hi || candles[i + j].h > hi) isH = false;
      if (candles[i - j].l <= lo || candles[i + j].l < lo) isL = false;
    }
    if (isH) highs.push({ i, price: hi, type: 'H', confirmedAt: i + k });
    if (isL) lows.push({ i, price: lo, type: 'L', confirmedAt: i + k });
  }
  return { highs, lows };
}

/**
 * Simulate one limit-order trade bar by bar.
 * setup: { dir: 'short'|'long', entry, sl, tp, armedAt, expiresAt }
 * The order can fill from bar `armedAt` until `expiresAt` (inclusive).
 * If SL and TP are both inside one bar, SL is assumed first (conservative).
 * costR: round-trip cost (spread + commission + slippage) expressed in R.
 */
export function simulateTrade(candles, setup, { costR = 0.05, maxBarsInTrade = 500, partialR = 0, partialPct = 0.5 } = {}) {
  if (partialR > 0) return simulateManaged(candles, setup, { costR, maxBarsInTrade, partialR, partialPct });
  const { dir, entry, sl, tp } = setup;
  const short = dir === 'short';
  const risk = Math.abs(sl - entry);
  if (!(risk > 0)) return { status: 'invalid' };
  let fillAt = -1;
  const last = Math.min(setup.expiresAt ?? candles.length - 1, candles.length - 1);
  for (let i = setup.armedAt; i <= last; i++) {
    const b = candles[i];
    if (short ? b.h >= entry : b.l <= entry) { fillAt = i; break; }
    // the setup dies if price reaches the target without filling first
    if (short ? b.l <= tp : b.h >= tp) return { status: 'missed', at: i };
  }
  if (fillAt < 0) return { status: last >= candles.length - 1 ? 'pending' : 'expired' };

  const rewardR = Math.abs(tp - entry) / risk;
  const end = Math.min(candles.length - 1, fillAt + maxBarsInTrade);
  for (let i = fillAt; i <= end; i++) {
    const b = candles[i];
    const hitSL = short ? b.h >= sl : b.l <= sl;
    // on the fill bar, only count TP if the bar closed beyond entry in our favour
    const hitTP = short ? b.l <= tp : b.h >= tp;
    if (hitSL) return { status: 'loss', fillAt, exitAt: i, r: -1 - costR, exit: sl };
    if (hitTP && i > fillAt) return { status: 'win', fillAt, exitAt: i, r: rewardR - costR, exit: tp };
    if (hitTP && i === fillAt) {
      // ambiguous same-bar fill + target: accept only if the candle opened on the far side of entry
      const ok = short ? b.o >= entry : b.o <= entry;
      if (ok) return { status: 'win', fillAt, exitAt: i, r: rewardR - costR, exit: tp };
    }
  }
  if (end >= candles.length - 1) {
    const mark = candles[candles.length - 1].c;
    const openR = (short ? entry - mark : mark - entry) / risk;
    return { status: 'open', fillAt, r: openR, mark };
  }
  const exit = candles[end].c;
  return { status: 'timeout', fillAt, exitAt: end, r: (short ? entry - exit : exit - entry) / risk - costR, exit };
}

/** Summary statistics for a list of closed trades (each with `r`). */
export function stats(trades) {
  const closed = trades.filter(t => ['win', 'loss', 'timeout'].includes(t.result.status));
  const rs = closed.map(t => t.result.r);
  const n = rs.length;
  const wins = rs.filter(r => r > 0);
  const losses = rs.filter(r => r <= 0);
  const sum = rs.reduce((a, b) => a + b, 0);
  let eq = 0, peak = 0, maxDD = 0, streak = 0, maxStreak = 0;
  for (const r of rs) {
    eq += r; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq);
    streak = r <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak);
  }
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? wins.length / n : 0,
    avgWinR: wins.length ? grossWin / wins.length : 0,
    expectancyR: n ? sum / n : 0,
    totalR: sum,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    maxDrawdownR: maxDD,
    maxLosingStreak: maxStreak,
  };
}

/** Deterministic PRNG so Monte Carlo results are reproducible. */
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Monte Carlo bootstrap: resample the trade R-multiples `runs` times
 * (with replacement, same count) to see the spread of outcomes the edge
 * could plausibly produce. Returns percentiles of total R and max drawdown.
 */
export function monteCarlo(rs, { runs = 5000, seed = 42, riskPct = 1 } = {}) {
  if (rs.length < 5) return null;
  const rnd = mulberry32(seed);
  const totals = [], dds = [];
  let ruin = 0;
  for (let k = 0; k < runs; k++) {
    let eq = 0, peak = 0, dd = 0, equityPct = 100;
    for (let j = 0; j < rs.length; j++) {
      const r = rs[Math.floor(rnd() * rs.length)];
      eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
      equityPct *= 1 + (r * riskPct) / 100;
    }
    if (equityPct < 70) ruin++; // lost 30%+ of the account at this risk per trade
    totals.push(eq); dds.push(dd);
  }
  const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  return {
    runs,
    totalR: { p5: pct(totals, 0.05), p50: pct(totals, 0.5), p95: pct(totals, 0.95) },
    maxDrawdownR: { p50: pct(dds, 0.5), p95: pct(dds, 0.95) },
    probProfitable: totals.filter(x => x > 0).length / runs,
    probLose30pct: ruin / runs,
    riskPct,
  };
}

/** Resample candles to a higher timeframe (multiple of the base). */
export function resample(candles, seconds) {
  const out = [];
  let cur = null;
  for (const c of candles) {
    const bucket = Math.floor(c.t / seconds) * seconds;
    if (!cur || cur.t !== bucket) {
      if (cur) out.push(cur);
      cur = { t: bucket, o: c.o, h: c.h, l: c.l, c: c.c };
    } else {
      cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------- New York clock (sessions) ----------
const _nyCache = new Map();
const _nyFmt = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  : null;
/**
 * New York local time for a unix timestamp: { hour (decimal), date: 'YYYY-MM-DD', tradeDay }.
 * tradeDay rolls over at 17:00 New York (forex/futures day), so the evening Asia session
 * belongs to the next trading day.
 */
export function nyClock(t) {
  const hourKey = Math.floor(t / 3600);
  let base = _nyCache.get(hourKey);
  if (!base) {
    const parts = Object.fromEntries(_nyFmt.formatToParts(new Date(hourKey * 3600 * 1000)).map(p => [p.type, p.value]));
    const h = +parts.hour % 24;
    const d = `${parts.year}-${parts.month}-${parts.day}`;
    const next = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) + 86400000).toISOString().slice(0, 10);
    base = { h, d, tradeDay: h >= 17 ? next : d };
    _nyCache.set(hourKey, base);
  }
  return { hour: base.h + (t % 3600) / 3600, date: base.d, tradeDay: base.tradeDay };
}

/**
 * Session reference levels ("liquidity from the left"): previous trading day high/low,
 * Asia (19:00-24:00 NY) and London (02:00-05:00 NY) highs/lows. Each level is known from
 * `knownAt` (the first bar after its window closed).
 */
export function referenceLevels(candles) {
  const highs = [], lows = [];
  let day = null, dayH = -Infinity, dayL = Infinity, dayEnd = -1;
  let win = null, wH = -Infinity, wL = Infinity, wEnd = -1;
  const windowOf = h => (h >= 19 ? 'asia' : h >= 2 && h < 5 ? 'london' : null);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], k = nyClock(c.t);
    if (k.tradeDay !== day) {
      if (day !== null && dayEnd >= 0) { highs.push({ price: dayH, knownAt: i, kind: 'PDH' }); lows.push({ price: dayL, knownAt: i, kind: 'PDL' }); }
      day = k.tradeDay; dayH = -Infinity; dayL = Infinity;
    }
    dayH = Math.max(dayH, c.h); dayL = Math.min(dayL, c.l); dayEnd = i;
    const w = windowOf(k.hour);
    if (w !== win) {
      if (win && wEnd >= 0) { highs.push({ price: wH, knownAt: i, kind: win + 'H' }); lows.push({ price: wL, knownAt: i, kind: win + 'L' }); }
      win = w; wH = -Infinity; wL = Infinity; wEnd = -1;
    }
    if (w) { wH = Math.max(wH, c.h); wL = Math.min(wL, c.l); wEnd = i; }
  }
  return { highs, lows };
}

/**
 * Daily / weekly bias from the course webinars: once price takes the previous day's (week's)
 * low, the draw is to the upside (+1, look for buys); once it takes the previous high, -1.
 * The latest sweep wins and holds until the next one. No look-ahead: uses bar highs/lows as they print.
 */
export function periodBias(candles, period = 'daily') {
  const out = new Array(candles.length).fill(0);
  const keyOf = t => {
    const d = nyClock(t).tradeDay;
    if (period !== 'weekly') return d;
    const dt = new Date(d + 'T00:00:00Z');
    const monday = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86400000);
    return monday.toISOString().slice(0, 10);
  };
  let key = null, curH = -Infinity, curL = Infinity, prevH = null, prevL = null, bias = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], k = keyOf(c.t);
    if (k !== key) {
      if (key !== null) { prevH = curH; prevL = curL; }
      key = k; curH = -Infinity; curL = Infinity;
    }
    if (prevH !== null) {
      const tookH = c.h > prevH, tookL = c.l < prevL;
      if (tookH && !tookL) bias = -1;
      else if (tookL && !tookH) bias = 1;
    }
    curH = Math.max(curH, c.h); curL = Math.min(curL, c.l);
    out[i] = bias;
  }
  return out;
}

/**
 * Trade management from the webinars: bank `partialPct` at `partialR`, then move the stop to entry
 * (break-even) and let the rest run to the target. Same conventions as simulateTrade (SL first on ties).
 */
function simulateManaged(candles, setup, { costR, maxBarsInTrade, partialR, partialPct }) {
  const { dir, entry, sl, tp } = setup;
  const short = dir === 'short';
  const risk = Math.abs(sl - entry);
  if (!(risk > 0)) return { status: 'invalid' };
  const rewardR = Math.abs(tp - entry) / risk;
  if (partialR >= rewardR) return simulateTrade(candles, setup, { costR, maxBarsInTrade });
  const pPrice = short ? entry - partialR * risk : entry + partialR * risk;
  let fillAt = -1;
  const last = Math.min(setup.expiresAt ?? candles.length - 1, candles.length - 1);
  for (let i = setup.armedAt; i <= last; i++) {
    const b = candles[i];
    if (short ? b.h >= entry : b.l <= entry) { fillAt = i; break; }
    if (short ? b.l <= tp : b.h >= tp) return { status: 'missed', at: i };
  }
  if (fillAt < 0) return { status: last >= candles.length - 1 ? 'pending' : 'expired' };
  let banked = false, stop = sl;
  const end = Math.min(candles.length - 1, fillAt + maxBarsInTrade);
  for (let i = fillAt; i <= end; i++) {
    const b = candles[i];
    const hitStop = short ? b.h >= stop : b.l <= stop;
    if (hitStop) {
      const r = banked ? partialPct * partialR : -1;
      return { status: banked ? (r > 0 ? 'win' : 'loss') : 'loss', fillAt, exitAt: i, r: r - costR, exit: stop, partial: banked };
    }
    if (!banked && i > fillAt && (short ? b.l <= pPrice : b.h >= pPrice)) { banked = true; stop = entry; }
    if (banked && (short ? b.l <= tp : b.h >= tp)) {
      return { status: 'win', fillAt, exitAt: i, r: partialPct * partialR + (1 - partialPct) * rewardR - costR, exit: tp, partial: true };
    }
  }
  if (end >= candles.length - 1) {
    const mark = candles[candles.length - 1].c;
    return { status: 'open', fillAt, r: (short ? entry - mark : mark - entry) / risk, mark };
  }
  const exit = candles[end].c, open = (short ? entry - exit : exit - entry) / risk;
  return { status: 'timeout', fillAt, exitAt: end, r: (banked ? partialPct * partialR + (1 - partialPct) * open : open) - costR, exit };
}

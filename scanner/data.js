// Market data for the scanner (runs in Node 20+ on GitHub Actions).
// Default source: Yahoo Finance chart API (free, no key).
// Optional: Twelve Data (set TWELVEDATA_API_KEY) for spot forex/gold.
//
// Yahoo intraday limits: 5m/15m/30m -> last 60 days, 1h -> last 730 days.

const YAHOO_INTERVAL = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m', '4h': '60m', '1d': '1d' };
const YAHOO_RANGE = { '5m': '60d', '15m': '60d', '30m': '60d', '1h': '730d', '4h': '730d', '1d': '10y' };
const SECONDS = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };

export const tfSeconds = tf => SECONDS[tf];

async function getJSON(url, headers = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (davinci-scanner)', ...headers } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function resample(candles, seconds) {
  const out = [];
  let cur = null;
  for (const c of candles) {
    const b = Math.floor(c.t / seconds) * seconds;
    if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { ...c, t: b }; }
    else { cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; }
  }
  if (cur) out.push(cur);
  return out;
}

async function yahoo(symbol, tf) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${YAHOO_INTERVAL[tf]}&range=${YAHOO_RANGE[tf]}&includePrePost=false`;
  const j = await getJSON(url);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo: no data for ${symbol} ${tf}: ${JSON.stringify(j?.chart?.error)}`);
  const q = r.indicators.quote[0];
  const out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].some(v => v == null || Number.isNaN(v))) continue;
    out.push({ t: r.timestamp[i], o, h, l, c });
  }
  return tf === '4h' ? resample(out, SECONDS['4h']) : out;
}

async function twelvedata(symbol, tf) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error('TWELVEDATA_API_KEY not set');
  const iv = { '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '4h': '4h', '1d': '1day' }[tf];
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${iv}&outputsize=5000&timezone=UTC&apikey=${key}`;
  const j = await getJSON(url);
  if (j.status === 'error') throw new Error(`TwelveData: ${j.message}`);
  return j.values.map(v => ({
    t: Math.floor(Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000),
    o: +v.open, h: +v.high, l: +v.low, c: +v.close,
  })).reverse();
}

async function binance(symbol, tf) {
  const out = [];
  let end = Date.now();
  for (let page = 0; page < 10; page++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=1000&endTime=${end}`;
    const rows = await getJSON(url);
    if (!rows.length) break;
    out.unshift(...rows.map(k => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4] })));
    end = rows[0][0] - 1;
  }
  return out;
}

/** Synthetic candles for offline testing only (DEMO=1). Not market data. */
function demo(market, tf) {
  let seed = [...(market.id + tf)].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const start = { XAUUSD: 4100, NAS100: 21000, US30: 44000 }[market.id] || 100;
  const sec = SECONDS[tf], n = tf === '1h' ? 6000 : 4000;
  const now = Math.floor(Date.now() / 1000 / sec) * sec;
  const out = [];
  let p = start, drift = 0;
  for (let i = 0; i < n; i++) {
    if (i % 60 === 0) drift = (rnd() - 0.5) * 0.0012;
    const vol = 0.0025 * (sec / 3600) ** 0.5;
    const o = p; p = p * (1 + drift + (rnd() - 0.5) * vol);
    out.push({ t: now - (n - i) * sec, o, c: p, h: Math.max(o, p) * (1 + rnd() * vol * 0.4), l: Math.min(o, p) * (1 - rnd() * vol * 0.4) });
  }
  // append the lesson's diagram so the UI has a live setup to show
  const shapes = {
    XAUUSD: [0, 10, 4, 13, -4, 6, 0, 5, -2, 3],             // bearish, waiting for entry
    NAS100: [0, -10, -4, -13, 4, -6, 0, -5, 2, -10.4, -9],   // bullish, entry filled
    US30: [0, 10, 4, 13, -4, 6, 0, 5, -2],
  };
  const shape = shapes[market.id];
  if (shape) {
    const unit = p * 0.0025 * (sec / 3600) ** 0.5;
    const base = p, legs = 8;
    out.splice(0, shape.length * legs);
    let t = out[out.length - 1].t, prev = p;
    for (let k = 1; k < shape.length; k++) {
      const a = base + shape[k - 1] * unit, b = base + shape[k] * unit;
      for (let j = 1; j <= legs; j++) {
        const cl = a + ((b - a) * j) / legs, o = prev, w = Math.abs(b - a) / legs * 0.35;
        t += sec;
        out.push({ t, o, c: cl, h: Math.max(o, cl) + w * rnd(), l: Math.min(o, cl) - w * rnd() });
        prev = cl;
      }
    }
    const shift = now - out[out.length - 1].t;
    for (const c of out) c.t += shift;
  }
  return out;
}

/** Fetch candles for one market from config. Drops the still-forming last bar. */
export async function fetchCandles(market, tf) {
  if (process.env.DEMO) return demo(market, tf);
  const src = market.source || 'yahoo';
  let candles;
  if (src === 'twelvedata') candles = await twelvedata(market.twelvedata || market.symbol, tf);
  else if (src === 'binance') candles = await binance(market.binance || market.symbol, tf);
  else candles = await yahoo(market.yahoo || market.symbol, tf);
  // remove duplicate timestamps and the incomplete current bar
  const seen = new Set();
  candles = candles.filter(c => (seen.has(c.t) ? false : (seen.add(c.t), true)));
  const now = Math.floor(Date.now() / 1000);
  while (candles.length && candles[candles.length - 1].t + SECONDS[tf] > now) candles.pop();
  return candles;
}

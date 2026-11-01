// Shared by the PC app window (pc-provider.js) and the background scanner (worker.js).
import { buildReport } from './engine/report.js';

export const MARKETS = {
  XAUUSD: { id: 'XAUUSD', name: 'Gold', yahoo: 'GC=F', digits: 2, spread: 0.3 },
  NAS100: { id: 'NAS100', name: 'Nasdaq 100', yahoo: 'NQ=F', digits: 1, spread: 1.5 },
  US30: { id: 'US30', name: 'Dow Jones', yahoo: 'YM=F', digits: 0, spread: 2.5 },
  EURUSD: { id: 'EURUSD', name: 'Euro / Dollar', yahoo: 'EURUSD=X', digits: 5, spread: 0.00008 },
  GBPUSD: { id: 'GBPUSD', name: 'Pound / Dollar', yahoo: 'GBPUSD=X', digits: 5, spread: 0.00012 },
  BTCUSD: { id: 'BTCUSD', name: 'Bitcoin', yahoo: 'BTC-USD', digits: 0, spread: 15 },
};

// Rule presets. "session" follows the case studies (New York morning, session liquidity);
// "classic" is the plain 4-step Da Vinci on any hour.
export const STRATEGIES = {
  session: {
    label: 'New York session + session levels + daily bias (case studies)',
    params: { pivotK: 3, entryMode: 'level', tpMode: 'liquidity', minRR: 3, slBufferATR: 0.3, minRiskATR: 0.5, costR: 0.02, session: [8, 11], refLevels: true, bias: 'daily' },
  },
  sessionOnly: {
    label: 'New York session only (8-11 NY)',
    params: { pivotK: 3, entryMode: 'level', tpMode: 'liquidity', minRR: 3, slBufferATR: 0.3, minRiskATR: 0.5, costR: 0.02, session: [8, 11] },
  },
  classic: {
    label: 'Classic Da Vinci (all hours)',
    params: { pivotK: 3, entryMode: 'level', tpMode: 'liquidity', minRR: 3, slBufferATR: 0.3, minRiskATR: 0.5, costR: 0.02 },
  },
};

export const DEFAULT_CONFIG = {
  markets: ['XAUUSD', 'NAS100', 'US30'],
  timeframes: ['5m', '15m'],
  strategy: 'session',
  requireEdge: true,
  telegram: { token: '', chat: '' },
  autoStart: false,
  sound: true,
};

const TF_SEC = { '5m': 300, '15m': 900, '1h': 3600 };
const YAHOO = { '5m': ['5m', '60d'], '15m': ['15m', '60d'], '1h': ['60m', '730d'] };
export const tfSeconds = tf => TF_SEC[tf];

export async function getConfig() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    const c = await r.json();
    return { ...DEFAULT_CONFIG, ...c, telegram: { ...DEFAULT_CONFIG.telegram, ...(c.telegram || {}) } };
  } catch { return { ...DEFAULT_CONFIG }; }
}

export async function saveConfig(cfg) {
  const r = await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg) });
  if (!r.ok) throw new Error(await r.text());
}

/** Candles from Yahoo (through the local server). Drops the bar that is still forming. */
export async function getCandles(market, tf) {
  const [iv, range] = YAHOO[tf];
  const r = await fetch(`/api/candles?symbol=${encodeURIComponent(market.yahoo)}&interval=${iv}&range=${range}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`data ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res || !res.timestamp) throw new Error(j?.chart?.error?.description || 'no data');
  const q = res.indicators.quote[0], sec = TF_SEC[tf];
  const out = [], seen = new Set();
  for (let i = 0; i < res.timestamp.length; i++) {
    const t = res.timestamp[i], o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].some(v => v == null || Number.isNaN(v)) || t % sec !== 0 || seen.has(t)) continue;
    seen.add(t);
    out.push({ t, o, h, l, c });
  }
  const now = Math.floor(Date.now() / 1000);
  while (out.length && out[out.length - 1].t + sec > now) out.pop();
  return out;
}

const cache = new Map();
/** Report for one market/timeframe; rebuilt only when a new candle has closed. */
export async function marketReport(cfg, id, tf, { full = false } = {}) {
  const market = MARKETS[id];
  const params = (STRATEGIES[cfg.strategy] || STRATEGIES.session).params;
  const candles = await getCandles(market, tf);
  if (candles.length < 200) throw new Error(`only ${candles.length} candles`);
  const key = `${id}_${tf}|${cfg.strategy}|${full}`;
  const last = candles[candles.length - 1].t;
  const hit = cache.get(key);
  if (hit && hit.last === last) return hit.report;
  const report = buildReport(market, tf, candles, params, { chartBars: 600, mcRuns: full ? 5000 : 500, withRobustness: full });
  cache.set(key, { last, report });
  return report;
}

export function alertText(report, s) {
  const d = (report.market.digits ?? 2);
  const f = v => Number(v).toFixed(d);
  const a = report.backtest.all, o = report.backtest.outOfSample;
  return {
    title: `${s.dir === 'short' ? 'SELL' : 'BUY'} ${report.market.id} ${report.tf} · RR 1:${(s.rr ?? 0).toFixed(1)}`,
    body: `Entry ${f(s.entry)} · SL ${f(s.sl)} · TP ${f(s.tp)}`,
    text: [
      `<b>${s.dir === 'short' ? '🔴 SELL' : '🟢 BUY'} — ${report.market.id} ${report.tf} — Da Vinci</b>`,
      s.status === 'open' ? 'Entry ho chuki (trade open)' : 'Limit order: price abhi entry tak nahi aayi',
      '', `Entry: <b>${f(s.entry)}</b>`, `Stop loss: <b>${f(s.sl)}</b>`, `Target: <b>${f(s.tp)}</b>`, `RR: <b>1:${(s.rr ?? 0).toFixed(1)}</b>`, '',
      `Backtest: ${a.trades} trades, win ${Math.round(a.winRate * 100)}%, ${a.expectancyR.toFixed(2)}R/trade (unseen data ${o.expectancyR.toFixed(2)}R)`,
      '<i>Ye financial advice nahi. Har trade loss ho sakti hai.</i>',
    ].join('\n'),
  };
}

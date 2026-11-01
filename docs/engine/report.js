// Builds the market report the app shows (chart candles, setups, backtest summary).
// Shared by the cloud scanner (Node) and the PC app (browser).
import { findSetups } from './davinci.js';
import { backtest, robustness } from './backtest.js';

const LIVE = new Set(['forming', 'pending', 'open']);
const round = (v, d) => (v == null ? v : +v.toFixed(d));

export function serializeSetup(s, c, digits) {
  const T = i => (i == null || i < 0 ? null : c[Math.min(i, c.length - 1)].t);
  const P = v => round(v, digits + 1);
  const r = s.result || {};
  return {
    id: s.id, dir: s.dir, status: s.status,
    lb: { t: s.lb.t, top: P(s.lb.top), bottom: P(s.lb.bottom), level: P(s.lb.level) },
    swept: s.swept && { t: s.swept.t, price: P(s.swept.price) },
    bos: s.bos && { t: T(s.bos.i), price: P(s.bos.price) },
    buildup: s.buildup.map(h => ({ t: h.t, price: P(h.price) })),
    respected: s.respected && { t: s.respected.t, price: P(s.respected.price) },
    extreme: s.extreme && { t: s.extreme.t, price: P(s.extreme.price) },
    entry: P(s.entry), sl: P(s.sl), tp: P(s.tp), rr: round(s.rr, 2),
    armedT: T(s.armedAt), fillT: T(r.fillAt), exitT: T(r.exitAt), r: round(r.r, 2),
    steps: {
      liquidityBlock: true,
      buildup: !!s.bos && s.buildup.length > 0,
      engineeredLows: !!s.respected,
      entry: !!s.result,
    },
  };
}

/**
 * Full report for one market/timeframe from raw candles.
 * opts: { chartBars, mcRuns, withRobustness }
 */
export function buildReport(market, tf, candles, params, { chartBars = 600, mcRuns = 5000, withRobustness = true, updated } = {}) {
  const digits = market.digits ?? 2;
  const setups = findSetups(candles, params);
  const bt = backtest(candles, params, { mcRuns });
  const grid = withRobustness ? robustness(candles, params) : [];
  const positive = grid.filter(g => g.trades >= 10 && g.expectancyR > 0).length;
  const counted = grid.filter(g => g.trades >= 10).length;
  const firstChart = Math.max(0, candles.length - chartBars);
  const shown = setups
    .filter(s => LIVE.has(s.status) || (s.result && s.lb.i >= firstChart))
    .filter(s => s.lb.i >= firstChart - 50)
    .map(s => serializeSetup(s, candles, digits));
  return {
    market, tf, key: `${market.id}_${tf}`, updated: updated ?? Math.floor(Date.now() / 1000), params: bt.params,
    lastPrice: candles[candles.length - 1].c,
    candles: candles.slice(firstChart).map(c => [c.t, round(c.o, digits + 1), round(c.h, digits + 1), round(c.l, digits + 1), round(c.c, digits + 1)]),
    setups: shown,
    backtest: {
      from: bt.from, to: bt.to, bars: bt.bars, splitTime: bt.splitTime,
      all: bt.all, inSample: bt.inSample, outOfSample: bt.outOfSample, monteCarlo: bt.monteCarlo,
      equity: bt.equity, recentTrades: bt.trades.slice(-60),
      robustness: { grid, positive, counted },
    },
    setupsFound: setups.length,
  };
}

/** Summary row for the market tabs. */
export function indexItem(report) {
  const live = report.setups.filter(s => s.status === 'pending' || s.status === 'open');
  const bt = report.backtest;
  return {
    key: report.key, market: report.market.id, name: report.market.name, tf: report.tf, lastPrice: report.lastPrice,
    live: live.length, forming: report.setups.filter(s => s.status === 'forming').length,
    latest: live[live.length - 1] || null,
    stats: { trades: bt.all.trades, winRate: bt.all.winRate, expectancyR: bt.all.expectancyR, oosExpectancyR: bt.outOfSample.expectancyR },
  };
}

/** Has this market/timeframe shown an edge good enough to alert on? */
export function edgeOk(report, minTrades = 30) {
  const bt = report.backtest;
  return bt.all.trades >= minTrades && bt.all.expectancyR > 0 && bt.outOfSample.expectancyR > 0;
}

// Backtest report built on the Da Vinci detector.
import { findSetups, tradesFromSetups, DEFAULTS } from './davinci.js';
import { stats, monteCarlo } from './core.js';

const closed = t => ['win', 'loss', 'timeout'].includes(t.result.status);

/**
 * Full report for one market/timeframe:
 *  - all trades (one at a time), win rate, expectancy, profit factor, drawdown
 *  - in-sample (first 70% of bars) vs out-of-sample (last 30%) split
 *  - Monte Carlo: the trade list resampled `mcRuns` times
 */
export function backtest(candles, params = {}, { mcRuns = 5000, splitAt = 0.7 } = {}) {
  const setups = findSetups(candles, params);
  const trades = tradesFromSetups(setups, { candles, maxPerDay: params.maxTradesPerDay || 0, maxLossesPerDay: params.maxLossesPerDay || 0 });
  const done = trades.filter(closed);
  const cut = Math.floor(candles.length * splitAt);
  const inS = done.filter(t => t.result.fillAt < cut);
  const outS = done.filter(t => t.result.fillAt >= cut);
  let eq = 0;
  const equity = done.map(t => ({ t: candles[t.result.exitAt].t, r: +t.result.r.toFixed(3), eq: +(eq += t.result.r).toFixed(3) }));
  return {
    params: { ...DEFAULTS, ...params },
    bars: candles.length,
    from: candles[0]?.t, to: candles[candles.length - 1]?.t,
    splitTime: candles[cut]?.t,
    setupsFound: setups.length,
    armed: setups.filter(s => s.result).length,
    all: stats(done),
    inSample: stats(inS),
    outOfSample: stats(outS),
    monteCarlo: monteCarlo(done.map(t => t.result.r), { runs: mcRuns }),
    equity,
    trades: done.map(t => ({
      id: t.id, dir: t.dir, fill: candles[t.result.fillAt].t, exit: candles[t.result.exitAt].t,
      entry: t.entry, sl: t.sl, tp: t.tp, rr: +t.rr.toFixed(2), r: +t.result.r.toFixed(2), status: t.result.status,
      grade: t.ie?.grade, be: !!t.result.be,
    })),
  };
}

/**
 * Robustness check: the same rules under many nearby settings. A real edge
 * should stay positive across most of them; one lucky setting means nothing.
 */
export function robustness(candles, base = {}) {
  const grid = [];
  const marco = base.model && base.model !== 'davinci';
  for (const pivotK of [2, 3, 4, 5])
    for (const entryMode of marco ? ['inside LB', 'any'] : ['level', 'mid', 'body'])
      for (const minRR of [2, 3, 4])
        for (const bias of marco ? ['none', 'daily', 'htf'] : ['none', 'htf'])
          grid.push(marco ? { ...base, pivotK, entryMode, insideLB: entryMode === 'inside LB', minRR, bias } : { ...base, pivotK, entryMode, minRR, bias });
  return grid.map(p => {
    const trades = tradesFromSetups(findSetups(candles, p), { candles, maxPerDay: p.maxTradesPerDay || 0, maxLossesPerDay: p.maxLossesPerDay || 0 }).filter(closed);
    const s = stats(trades);
    return { pivotK: p.pivotK, entryMode: p.entryMode, minRR: p.minRR, bias: p.bias, trades: s.trades, winRate: +s.winRate.toFixed(3), expectancyR: +s.expectancyR.toFixed(3), profitFactor: Number.isFinite(s.profitFactor) ? +s.profitFactor.toFixed(2) : null, maxDrawdownR: +s.maxDrawdownR.toFixed(2) };
  });
}

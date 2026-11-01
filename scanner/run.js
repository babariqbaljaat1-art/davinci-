// Da Vinci scanner: fetch -> detect -> backtest -> write app data -> Telegram.
// Runs every few minutes on GitHub Actions (see .github/workflows/scan.yml).
//   node scanner/run.js            normal scan
//   node scanner/run.js --dry      no Telegram, no state changes
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fetchCandles } from './data.js';
import { findSetups } from '../docs/engine/davinci.js';
import { backtest, robustness } from '../docs/engine/backtest.js';
import { sendTelegram, setupMessage, resultMessage } from './telegram.js';

const DRY = process.argv.includes('--dry');
const ROOT = new URL('..', import.meta.url).pathname;
const DATA = `${ROOT}docs/data`;
const LIVE = new Set(['forming', 'pending', 'open']);
const FINAL = new Set(['win', 'loss', 'timeout']);

const readJSON = async (p, d) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : d);
const round = (v, d) => (v == null ? v : +v.toFixed(d));

function serializeSetup(s, c, digits) {
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

async function main() {
  const cfg = JSON.parse(await readFile(`${ROOT}config.json`, 'utf8'));
  await mkdir(DATA, { recursive: true });
  const state = await readJSON(`${DATA}/state.json`, { sent: {} });
  const appUrl = process.env.APP_URL || cfg.appUrl;
  const index = { updated: Math.floor(Date.now() / 1000), appUrl, items: [] };

  for (const m of cfg.markets) {
    for (const tf of cfg.timeframes) {
      const key = `${m.id}_${tf}`;
      try {
        const candles = await fetchCandles(m, tf);
        if (candles.length < 200) throw new Error(`only ${candles.length} candles`);
        const digits = m.digits ?? 2;
        const setups = findSetups(candles, cfg.params);
        const bt = backtest(candles, cfg.params, { mcRuns: 5000 });
        const grid = robustness(candles, cfg.params);
        const positive = grid.filter(g => g.trades >= 10 && g.expectancyR > 0).length;
        const counted = grid.filter(g => g.trades >= 10).length;

        const firstChart = Math.max(0, candles.length - cfg.chartBars);
        const shown = setups
          .filter(s => LIVE.has(s.status) || (s.result && s.lb.i >= firstChart))
          .filter(s => s.lb.i >= firstChart - 50)
          .map(s => serializeSetup(s, candles, digits));

        const btSummary = {
          from: bt.from, to: bt.to, bars: bt.bars, splitTime: bt.splitTime,
          all: bt.all, inSample: bt.inSample, outOfSample: bt.outOfSample, monteCarlo: bt.monteCarlo,
          equity: bt.equity, recentTrades: bt.trades.slice(-60),
          robustness: { grid, positive, counted },
        };
        const out = {
          market: m, tf, key, updated: index.updated, params: bt.params,
          lastPrice: candles[candles.length - 1].c,
          candles: candles.slice(firstChart).map(c => [c.t, round(c.o, digits + 1), round(c.h, digits + 1), round(c.l, digits + 1), round(c.c, digits + 1)]),
          setups: shown,
          backtest: btSummary,
        };
        await writeFile(`${DATA}/${key}.json`, JSON.stringify(out));

        const live = shown.filter(s => s.status === 'pending' || s.status === 'open');
        index.items.push({
          key, market: m.id, name: m.name, tf, lastPrice: out.lastPrice,
          live: live.length, forming: shown.filter(s => s.status === 'forming').length,
          latest: live[live.length - 1] || null,
          stats: { trades: bt.all.trades, winRate: bt.all.winRate, expectancyR: bt.all.expectancyR, oosExpectancyR: bt.outOfSample.expectancyR },
        });

        // --- alerts ---
        const edgeOk = !cfg.alerts.requireEdge || (bt.all.trades >= cfg.alerts.minBacktestTrades && bt.outOfSample.expectancyR > 0);
        const lastT = candles[candles.length - 1].t, tfSec = candles[1].t - candles[0].t;
        for (const s of shown) {
          const prev = state.sent[s.id + key];
          const fresh = s.armedT != null && s.armedT >= lastT - 6 * tfSec;   // never alert old setups
          if ((s.status === 'pending' || s.status === 'open') && !prev && fresh && cfg.alerts.onNewSetup && edgeOk) {
            if (!DRY) await sendTelegram(setupMessage(m, tf, s, bt, appUrl));
            state.sent[s.id + key] = s.status;
          } else if (prev && FINAL.has(s.status) && !FINAL.has(prev)) {
            if (!DRY && cfg.alerts.onResult) await sendTelegram(resultMessage(m, tf, s));
            state.sent[s.id + key] = s.status;
          } else if (prev && prev !== s.status) {
            state.sent[s.id + key] = s.status;
          }
        }
        console.log(`${key}: ${candles.length} bars, ${setups.length} setups, live ${live.length}, backtest ${bt.all.trades} trades, win ${(bt.all.winRate * 100).toFixed(0)}%, exp ${bt.all.expectancyR.toFixed(2)}R, OOS ${bt.outOfSample.expectancyR.toFixed(2)}R, robust ${positive}/${counted}`);
      } catch (e) {
        console.error(`${key}: ${e.message}`);
        index.items.push({ key, market: m.id, name: m.name, tf, error: e.message });
      }
    }
  }
  // keep the state file small: forget alerts older than ~60 days of ids
  const ids = Object.keys(state.sent);
  if (ids.length > 2000) for (const id of ids.slice(0, ids.length - 2000)) delete state.sent[id];
  await writeFile(`${DATA}/index.json`, JSON.stringify(index));
  if (!DRY) await writeFile(`${DATA}/state.json`, JSON.stringify(state));
}

main().catch(e => { console.error(e); process.exit(1); });

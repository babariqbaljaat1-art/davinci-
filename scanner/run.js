// Da Vinci scanner: fetch -> detect -> backtest -> write app data -> Telegram.
// Runs every few minutes on GitHub Actions (see .github/workflows/scan.yml).
//   node scanner/run.js            normal scan
//   node scanner/run.js --dry      no Telegram, no state changes
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fetchCandles } from './data.js';
import { buildReport, indexItem } from '../docs/engine/report.js';
import { sendTelegram, setupMessage, resultMessage } from './telegram.js';

const DRY = process.argv.includes('--dry');
const ROOT = new URL('..', import.meta.url).pathname;
const DATA = `${ROOT}docs/data`;
const FINAL = new Set(['win', 'loss', 'timeout']);

const readJSON = async (p, d) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : d);

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
        if (process.env.SAVE_RAW) {
          await mkdir(`${ROOT}raw`, { recursive: true });
          await writeFile(`${ROOT}raw/${key}.json`, JSON.stringify(candles));
        }
        const out = buildReport(m, tf, candles, cfg.params, { chartBars: cfg.chartBars, mcRuns: 5000, updated: index.updated });
        await writeFile(`${DATA}/${key}.json`, JSON.stringify(out));
        const item = indexItem(out);
        index.items.push(item);
        const bt = out.backtest, shown = out.setups, live = shown.filter(s => s.status === 'pending' || s.status === 'open');
        const { positive, counted } = bt.robustness, setups = { length: out.setupsFound };

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

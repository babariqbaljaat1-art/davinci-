// Research: test the course rules on multi-year Dukascopy data, honestly.
//   node research/experiments.mjs <dir with *_5m.json.gz> [out.json]
// Settings are ranked on the first 70% of time only (in-sample); the last 30% (out-of-sample)
// is reported for the chosen settings and was never used to choose them.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findSetups, tradesFromSetups } from '../docs/engine/davinci.js';
import { stats, resample, monteCarlo } from '../docs/engine/core.js';

const DIR = process.argv[2], OUT = process.argv[3] || 'research-results.json';
const SPREAD = { XAUUSD: 0.3, EURUSD: 0.00008, GBPUSD: 0.00012, US30: 2.5, NAS100: 1.5 };
const closed = t => ['win', 'loss', 'timeout'].includes(t.result.status);

const data = {};
for (const f of readdirSync(DIR).filter(f => f.endsWith('_5m.json.gz'))) {
  const id = f.replace('_5m.json.gz', '');
  const rows = JSON.parse(gunzipSync(readFileSync(`${DIR}/${f}`)).toString());
  const c5 = rows.map(([t, o, h, l, c]) => ({ t, o, h, l, c })).filter(x => x.h >= x.l);
  data[id] = { '5m': c5, '15m': resample(c5, 900), '1h': resample(c5, 3600) };
  console.log(id, c5.length, '5m bars', new Date(c5[0].t * 1000).toISOString().slice(0, 10), '→', new Date(c5[c5.length - 1].t * 1000).toISOString().slice(0, 10));
}
const ids = Object.keys(data);
// one time split for every market: 70% of the common time span
const t0 = Math.max(...ids.map(id => data[id]['5m'][0].t)), t1 = Math.min(...ids.map(id => data[id]['5m'].at(-1).t));
const SPLIT = t0 + 0.7 * (t1 - t0);
console.log('in-sample until', new Date(SPLIT * 1000).toISOString().slice(0, 10));

const families = {
  classic: {},
  session: { session: [8, 11] },
  sessionRefs: { session: [8, 11], refLevels: true },
  refs: { refLevels: true },
  sessionDaily: { session: [8, 11], bias: 'daily' },
  sessionRefsDaily: { session: [8, 11], refLevels: true, bias: 'daily' },
  sessionRefsWeekly: { session: [8, 11], refLevels: true, bias: 'weekly' },
};
const variants = [];
for (const pivotK of [2, 3]) for (const entryMode of ['level', 'mid'])
  for (const [tpMode, fixedR, minRR] of [['liquidity', 3, 2], ['fixedR', 2, 2], ['fixedR', 3, 3]])
    variants.push({ pivotK, entryMode, tpMode, fixedR, minRR, slBufferATR: 0.3, minRiskATR: 0.5, costR: 0.02 });

function run(tf, params) {
  const out = { is: [], oos: [] , per: {} };
  for (const id of ids) {
    const c = data[id][tf];
    const tr = tradesFromSetups(findSetups(c, { ...params, spread: SPREAD[id] ?? 0 })).filter(closed);
    const is = tr.filter(t => c[t.result.fillAt].t < SPLIT), oos = tr.filter(t => c[t.result.fillAt].t >= SPLIT);
    out.is.push(...is); out.oos.push(...oos);
    out.per[id] = { is: stats(is), oos: stats(oos) };
  }
  return out;
}

const results = [];
const T = Date.now();
for (const tf of ['5m', '15m', '1h']) {
  for (const [fam, extra] of Object.entries(families)) {
    if (tf === '1h' && fam.startsWith('session')) continue;    // session windows need intraday bars
    for (const v of variants) {
      const params = { ...v, ...extra };
      const r = run(tf, params);
      const is = stats(r.is), oos = stats(r.oos);
      results.push({ tf, family: fam, params, is, oos,
        perMarket: Object.fromEntries(Object.entries(r.per).map(([k, x]) => [k, { isTrades: x.is.trades, isExp: +x.is.expectancyR.toFixed(3), oosTrades: x.oos.trades, oosExp: +x.oos.expectancyR.toFixed(3) }])),
        oosMC: monteCarlo(r.oos.map(t => t.result.r), { runs: 5000 }) });
      process.stdout.write('.');
    }
  }
  console.log(` ${tf} done ${((Date.now() - T) / 1000).toFixed(0)}s`);
}

// ---- report ----
const fmt = s => `${String(s.trades).padStart(5)} tr  win ${(s.winRate * 100).toFixed(0).padStart(2)}%  ${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(3)}R  PF ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf'}`;
for (const tf of ['5m', '15m', '1h']) {
  console.log(`\n=== ${tf}`);
  for (const fam of Object.keys(families)) {
    const rows = results.filter(r => r.tf === tf && r.family === fam);
    if (!rows.length) continue;
    const pos = rows.filter(r => r.is.trades >= 100 && r.is.expectancyR > 0).length;
    const best = rows.filter(r => r.is.trades >= 100).sort((a, b) => b.is.expectancyR - a.is.expectancyR)[0];
    const med = rows.map(r => r.is.expectancyR).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
    console.log(`${fam.padEnd(12)} settings positive in-sample ${pos}/${rows.length}, median IS ${med.toFixed(3)}R`);
    if (best) console.log(`   best IS: ${fmt(best.is)}   →  OOS: ${fmt(best.oos)}   ${JSON.stringify({ k: best.params.pivotK, e: best.params.entryMode, tp: best.params.tpMode === 'fixedR' ? best.params.fixedR + 'R' : 'liq' })}`);
  }
}
writeFileSync(OUT, JSON.stringify({ split: SPLIT, from: t0, to: t1, markets: ids, results }, null, 0));
console.log('\nsaved', OUT);

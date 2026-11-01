// Research 2: does the webinars' trade management (partials + break-even, max trades/day) change the verdict?
//   node research/management.mjs <duka dir> <results.json from experiments.mjs>
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findSetups, tradesFromSetups } from '../docs/engine/davinci.js';
import { stats, resample } from '../docs/engine/core.js';

const [DIR, RES] = process.argv.slice(2);
const prev = JSON.parse(readFileSync(RES));
const SPREAD = { XAUUSD: 0.3, EURUSD: 0.00008, GBPUSD: 0.00012, US30: 2.5, NAS100: 1.5 };
const data = {};
for (const f of readdirSync(DIR).filter(f => f.endsWith('_5m.json.gz'))) {
  const id = f.replace('_5m.json.gz', '');
  const c5 = JSON.parse(gunzipSync(readFileSync(`${DIR}/${f}`)).toString()).map(([t, o, h, l, c]) => ({ t, o, h, l, c })).filter(x => x.h >= x.l);
  data[id] = { '5m': c5, '15m': resample(c5, 900) };
}
const closed = t => ['win', 'loss', 'timeout'].includes(t.result.status);
const fmt = s => `${String(s.trades).padStart(5)} tr win ${(s.winRate * 100).toFixed(0).padStart(2)}% ${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(3)}R`;

const picks = [['5m', 'session'], ['5m', 'sessionDaily'], ['5m', 'sessionRefsDaily'], ['15m', 'classic'], ['15m', 'sessionDaily']];
const managements = [
  ['as before', {}],
  ['50% at 2R + BE', { partialR: 2, partialPct: 0.5 }],
  ['50% at 1R + BE', { partialR: 1, partialPct: 0.5 }],
  ['max 2 trades/day', { maxTradesPerDay: 2 }],
  ['50% at 2R + BE, max 2/day', { partialR: 2, partialPct: 0.5, maxTradesPerDay: 2 }],
];
for (const [tf, fam] of picks) {
  const rows = prev.results.filter(r => r.tf === tf && r.family === fam && r.is.trades >= 100);
  const best = rows.sort((a, b) => b.is.expectancyR - a.is.expectancyR)[0];
  if (!best) continue;
  console.log(`\n${tf} ${fam} (k${best.params.pivotK} ${best.params.entryMode} ${best.params.tpMode === 'fixedR' ? best.params.fixedR + 'R' : 'liq'})`);
  for (const [name, extra] of managements) {
    const is = [], oos = [];
    for (const id of Object.keys(data)) {
      const c = data[id][tf], p = { ...best.params, ...extra, spread: SPREAD[id] };
      const tr = tradesFromSetups(findSetups(c, p), { candles: c, maxPerDay: p.maxTradesPerDay || 0 }).filter(closed);
      for (const t of tr) (c[t.result.fillAt].t < prev.split ? is : oos).push(t);
    }
    console.log(`  ${name.padEnd(26)} IS ${fmt(stats(is))}   OOS ${fmt(stats(oos))}`);
  }
}

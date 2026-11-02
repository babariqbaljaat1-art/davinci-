// Research 8: the shipped Marco presets (pc-common.js STRATEGIES marco / marco4 / candle4), 4 years x 5 markets,
// spread included, first 70% vs unseen last 30%.   node research/marco-preset.mjs <dir with SYMBOL_5m.json.gz> [out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findSetups, tradesFromSetups } from '../docs/engine/davinci.js';
import { stats, resample } from '../docs/engine/core.js';

const [DIR, OUT] = process.argv.slice(2);
const SPREAD = { XAUUSD: 0.3, EURUSD: 0.00008, GBPUSD: 0.00012, US30: 2.5, NAS100: 1.5 };
const KIND = { XAUUSD: 'metal', EURUSD: 'fx', GBPUSD: 'fx', US30: 'index', NAS100: 'index' };
const MARCO = { model: 'marco', pivotK: 3, entryK: 2, insideLB: true, minRR: 3, marcoSlBufferATR: 0.5, marcoMinRiskATR: 1, costR: 0.02, session: [8, 11], bias: 'daily', ie: true, ieMin: 'B', manage: 'ie', maxTradesPerDay: 2, maxLossesPerDay: 2 };
const PRESETS = [
  ['Marco: LB + liquidity taken (preset)', MARCO],
  ['Marco + 4-candle (preset)', { ...MARCO, model: 'marco+candle4' }],
  ['Marco 4-candle only (preset)', { ...MARCO, model: 'candle4' }],
  ['Marco, inducement anywhere below the LB', { ...MARCO, insideLB: false }],
  ['Marco, no daily bias', { ...MARCO, bias: 'none' }],
  ['Marco, no IE grading (simple management)', { ...MARCO, ie: false, manage: 'simple' }],
];
const data = {};
for (const f of readdirSync(DIR).filter(f => f.endsWith('_5m.json.gz'))) {
  const id = f.replace('_5m.json.gz', '');
  const c5 = JSON.parse(gunzipSync(readFileSync(`${DIR}/${f}`)).toString()).map(([t, o, h, l, c]) => ({ t, o, h, l, c })).filter(x => x.h >= x.l);
  data[id] = { '5m': c5, '15m': resample(c5, 900) };
}
const all = Object.values(data).map(d => d['5m']);
const t0 = Math.min(...all.map(c => c[0].t)), t1 = Math.max(...all.map(c => c.at(-1).t)), split = t0 + 0.7 * (t1 - t0);
const closed = t => ['win', 'loss', 'timeout'].includes(t.result.status);
const rows = [];
for (const tf of ['5m', '15m']) for (const [label, preset] of PRESETS) {
  const is = [], oos = [], per = {};
  for (const [id, d] of Object.entries(data)) {
    const c = d[tf], p = { ...preset, kind: KIND[id], spread: SPREAD[id] };
    const tr = tradesFromSetups(findSetups(c, p), { candles: c, maxPerDay: p.maxTradesPerDay, maxLossesPerDay: p.maxLossesPerDay }).filter(closed);
    per[id] = stats(tr);
    for (const t of tr) (c[t.result.fillAt].t < split ? is : oos).push(t);
  }
  const r = { tf, label, all: stats([...is, ...oos]), is: stats(is), oos: stats(oos), per };
  rows.push(r);
  console.log(tf, label.padEnd(44), 'ALL', r.all.trades, (r.all.winRate * 100).toFixed(0) + '%', r.all.expectancyR.toFixed(3), '| IS', r.is.trades, r.is.expectancyR.toFixed(3), '| OOS', r.oos.trades, r.oos.expectancyR.toFixed(3), (r.oos.winRate * 100).toFixed(0) + '%', '|', Object.entries(per).map(([k, v]) => `${k} ${v.trades}/${v.expectancyR.toFixed(2)}`).join(' '));
}
if (OUT) writeFileSync(OUT, JSON.stringify({ t0, t1, split, rows }, null, 1));

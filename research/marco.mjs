// Research 7: Marco's most-taken entry ("as soon as the liquidity is taken" into an LB) and the 4-candle model,
// 4 years x 5 markets, spread included. node research/marco.mjs <dir with SYMBOL_5m.json.gz> [out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findSetups, tradesFromSetups } from '../docs/engine/davinci.js';
import { stats, resample } from '../docs/engine/core.js';

const [DIR, OUT] = process.argv.slice(2);
const SPREAD = { XAUUSD: 0.3, EURUSD: 0.00008, GBPUSD: 0.00012, US30: 2.5, NAS100: 1.5 };
const KIND = { XAUUSD: 'metal', EURUSD: 'fx', GBPUSD: 'fx', US30: 'index', NAS100: 'index' };
const TFS = (process.env.TFS || '5m,15m').split(',');
const data = {};
for (const f of readdirSync(DIR).filter(f => f.endsWith('_5m.json.gz'))) {
  const id = f.replace('_5m.json.gz', '');
  const c5 = JSON.parse(gunzipSync(readFileSync(`${DIR}/${f}`)).toString()).map(([t, o, h, l, c]) => ({ t, o, h, l, c })).filter(x => x.h >= x.l);
  data[id] = { '5m': c5, '15m': resample(c5, 900) };
}
const all = Object.values(data).map(d => d['5m']);
const t0 = Math.min(...all.map(c => c[0].t)), t1 = Math.max(...all.map(c => c.at(-1).t)), split = t0 + 0.7 * (t1 - t0);
const years = (t1 - t0) / (365.25 * 86400);
const closed = t => ['win', 'loss', 'timeout'].includes(t.result.status);
const pct = x => `${(x * 100).toFixed(0).padStart(3)}%`;
const fmt = s => `${String(s.trades).padStart(5)} tr win ${pct(s.winRate)} ${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(3)}R`;
const base = { costR: 0.02, session: [8, 11], minRR: 3, maxTradesPerDay: 2, maxLossesPerDay: 2, marcoSlBufferATR: +(process.env.SLB ?? 0.5), marcoMinRiskATR: +(process.env.MINR ?? 1) };
const variants = [
  ['Marco LB + inducement taken', { model: 'marco' }],
  ['Marco + daily bias (who is induced)', { model: 'marco', bias: 'daily' }],
  ['Marco + IE grade A+B', { model: 'marco', ie: true, ieMin: 'B' }],
  ['4-candle sniper', { model: 'candle4' }],
  ['4-candle + daily bias', { model: 'candle4', bias: 'daily' }],
  ['4-candle + IE grade A+B', { model: 'candle4', ie: true, ieMin: 'B' }],
];
const manages = [['simple', { manage: 'simple' }], ['IE mgmt', { manage: 'ie' }]];
const results = [];
for (const tf of TFS) for (const [vn, vp] of variants) for (const [mn, mp] of manages) {
  const is = [], oos = [], perMkt = {};
  for (const [id, d] of Object.entries(data)) {
    const c = d[tf], p = { ...base, ...vp, ...mp, kind: KIND[id], spread: SPREAD[id] };
    const tr = tradesFromSetups(findSetups(c, p), { candles: c, maxPerDay: p.maxTradesPerDay, maxLossesPerDay: p.maxLossesPerDay }).filter(closed);
    perMkt[id] = stats(tr);
    for (const t of tr) (c[t.result.fillAt].t < split ? is : oos).push(t);
  }
  const a = stats([...is, ...oos]);
  const r = { tf, variant: vn, manage: mn, all: a, is: stats(is), oos: stats(oos), perWeek: a.trades / (years * 52) / Object.keys(data).length,
    avgRR: [...is, ...oos].reduce((s, t) => s + t.rr, 0) / Math.max(1, is.length + oos.length), perMkt };
  results.push(r);
  console.log(`${tf} | ${vn.padEnd(38)} | ${mn.padEnd(7)} ALL ${fmt(a)} | IS ${fmt(r.is)} | OOS ${fmt(r.oos)} | ${r.perWeek.toFixed(2)}/wk/mkt avgRR ${r.avgRR.toFixed(1)}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify({ t0, t1, split, results }, null, 1));

// Research 4: win rate vs reward. Same Da Vinci entries, different targets (1R ... opposing liquidity),
// with and without partials + break-even. Answers "why is the win rate not 70-80%?".
//   node research/winrate.mjs <dir with SYMBOL_5m.json.gz> [out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findSetups, tradesFromSetups } from '../docs/engine/davinci.js';
import { stats, resample } from '../docs/engine/core.js';

const [DIR, OUT] = process.argv.slice(2);
const SPREAD = { XAUUSD: 0.3, EURUSD: 0.00008, GBPUSD: 0.00012, US30: 2.5, NAS100: 1.5 };
const data = {};
for (const f of readdirSync(DIR).filter(f => f.endsWith('_5m.json.gz'))) {
  const id = f.replace('_5m.json.gz', '');
  const c5 = JSON.parse(gunzipSync(readFileSync(`${DIR}/${f}`)).toString()).map(([t, o, h, l, c]) => ({ t, o, h, l, c })).filter(x => x.h >= x.l);
  data[id] = { '5m': c5, '15m': resample(c5, 900) };
}
const all = Object.values(data).map(d => d['5m']);
const t0 = Math.min(...all.map(c => c[0].t)), t1 = Math.max(...all.map(c => c.at(-1).t)), split = t0 + 0.7 * (t1 - t0);
const closed = t => ['win', 'loss', 'timeout'].includes(t.result.status);
const pct = x => `${(x * 100).toFixed(0).padStart(3)}%`;
const fmt = s => `${String(s.trades).padStart(5)} tr win ${pct(s.winRate)} ${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(3)}R`;

const targets = [
  ['1R', { tpMode: 'fixedR', fixedR: 1, minRR: 1 }],
  ['1.5R', { tpMode: 'fixedR', fixedR: 1.5, minRR: 1.5 }],
  ['2R', { tpMode: 'fixedR', fixedR: 2, minRR: 2 }],
  ['3R', { tpMode: 'fixedR', fixedR: 3, minRR: 3 }],
  ['liquidity (RR>=3)', { tpMode: 'liquidity', minRR: 3 }],
  ['liquidity, 50% at 1R + BE', { tpMode: 'liquidity', minRR: 3, partialR: 1, partialPct: 0.5 }],
];
const contexts = [
  ['NY 8-11', { session: [8, 11] }],
  ['NY 8-11 + session levels + daily bias', { session: [8, 11], refLevels: true, bias: 'daily' }],
];
const entries = [
  ['LB level, stop beyond LB', { entryMode: 'level', slBufferATR: 0.1, minRiskATR: 0 }],
  ['LB level, wider stop', { entryMode: 'level', slBufferATR: 0.3, minRiskATR: 0.5 }],
];
const results = [];
for (const tf of ['5m', '15m']) for (const [cn, cp] of contexts) for (const [en, ep] of entries) for (const [tn, tp] of targets) {
  const p0 = { pivotK: 3, costR: 0.02, maxTradesPerDay: 2, ...cp, ...ep, ...tp };
  const is = [], oos = [];
  let be = 0;
  for (const [id, d] of Object.entries(data)) {
    const c = d[tf], p = { ...p0, spread: SPREAD[id] };
    const tr = tradesFromSetups(findSetups(c, p), { candles: c, maxPerDay: p.maxTradesPerDay }).filter(closed);
    for (const t of tr) { (c[t.result.fillAt].t < split ? is : oos).push(t); if (t.result.partial && Math.abs(t.result.r - 0.5 * (p.partialR || 0) + 0.02) < 0.3) be++; }
  }
  const label = `${tf} | ${cn} | ${en} | ${tn}`;
  const r = { label, tf, context: cn, entry: en, target: tn, params: p0, is: stats(is), oos: stats(oos), all: stats([...is, ...oos]) };
  results.push(r);
  console.log(`${label.padEnd(100)} ALL ${fmt(r.all)} | IS ${fmt(r.is)} | OOS ${fmt(r.oos)}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify({ split, t0, t1, results }, null, 1));

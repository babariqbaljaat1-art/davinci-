// Research 3: the case-study entry — Da Vinci on 5m/15m for the zone and target, 1-minute confirmation entry.
//   node research/mtf.mjs <dir with SYMBOL_1m.json.gz> [out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findSetupsMTF, tradesFromSetups } from '../docs/engine/davinci.js';
import { stats } from '../docs/engine/core.js';

const [DIR, OUT] = process.argv.slice(2);
const SPREAD = { XAUUSD: 0.3, EURUSD: 0.00008, GBPUSD: 0.00012, US30: 2.5, NAS100: 1.5 };
const data = {};
for (const f of readdirSync(DIR).filter(f => f.endsWith('_1m.json.gz'))) {
  const id = f.replace('_1m.json.gz', '');
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) continue;
  data[id] = JSON.parse(gunzipSync(readFileSync(`${DIR}/${f}`)).toString()).map(([t, o, h, l, c]) => ({ t, o, h, l, c })).filter(x => x.h >= x.l);
  console.error(id, data[id].length, 'bars');
}
const t0 = Math.min(...Object.values(data).map(c => c[0].t)), t1 = Math.max(...Object.values(data).map(c => c.at(-1).t));
const split = t0 + 0.7 * (t1 - t0);
const closed = t => ['win', 'loss', 'timeout'].includes(t.result.status);
const fmt = s => `${String(s.trades).padStart(5)} tr win ${(s.winRate * 100).toFixed(0).padStart(2)}% avgRR ${s.avgRR.toFixed(1)} ${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(3)}R`;

const base = { pivotK: 3, entryMode: 'level', tpMode: 'liquidity', minRR: 1, slBufferATR: 0.1, minRiskATR: 0, costR: 0.02, session: [8, 11], maxTradesPerDay: 2 };
const grid = [];
for (const htfSeconds of (process.env.HTF || '300,900').split(',').map(Number))
  for (const ctx of [{ name: 'session', p: {} }, { name: 'session+levels+daily', p: { refLevels: true, bias: 'daily' } }])
    for (const target of [{ name: 'liquidity', p: {} }, { name: '1R', p: { mtfFixedR: 1 } }, { name: '2R', p: { mtfFixedR: 2 } }, { name: '3R', p: { mtfFixedR: 3 } }, { name: 'liq, 50% at 1R+BE', p: { partialR: 1, partialPct: 0.5 } }])
      for (const ltfPivotK of (process.env.LTFK || '2,3').split(',').map(Number))
        grid.push({ label: `${htfSeconds / 60}m→1m ${ctx.name} | target ${target.name} | ltfK${ltfPivotK}`, p: { ...base, htfSeconds, ltfPivotK, ...ctx.p, ...target.p } });

const results = [];
for (const g of grid) {
  const is = [], oos = [], per = {};
  for (const [id, c] of Object.entries(data)) {
    const p = { ...g.p, spread: SPREAD[id] };
    const tr = tradesFromSetups(findSetupsMTF(c, p), { candles: c, maxPerDay: p.maxTradesPerDay }).filter(closed);
    per[id] = stats(tr);
    for (const t of tr) (c[t.result.fillAt].t < split ? is : oos).push(t);
  }
  const S = arr => ({ ...stats(arr), avgRR: arr.length ? arr.reduce((a, t) => a + t.rr, 0) / arr.length : 0 });
  const r = { label: g.label, params: g.p, is: S(is), oos: S(oos), per: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { trades: v.trades, winRate: v.winRate, expectancyR: v.expectancyR }])) };
  results.push(r);
  console.log(`${g.label.padEnd(62)} IS ${fmt(r.is)} | OOS ${fmt(r.oos)}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify({ split, t0, t1, results }, null, 1));

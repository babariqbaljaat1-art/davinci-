// Research 5: the full Inter Equity rulebook (ierules.js) on 4 years of Dukascopy data.
// Compares: all Da Vinci setups vs grade A+B vs grade A only, simple vs IE management,
// and shows how often each rule is the one that rejects a setup.
//   node research/ierules.mjs <dir with SYMBOL_5m.json.gz> [out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findSetups, tradesFromSetups } from '../docs/engine/davinci.js';
import { stats, resample } from '../docs/engine/core.js';

const [DIR, OUT] = process.argv.slice(2);
const SPREAD = { XAUUSD: 0.3, EURUSD: 0.00008, GBPUSD: 0.00012, US30: 2.5, NAS100: 1.5 };
const KIND = { XAUUSD: 'metal', EURUSD: 'fx', GBPUSD: 'fx', US30: 'index', NAS100: 'index' };
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const TFS = (process.env.TFS || '5m,15m').split(',');
const data = {};
for (const f of readdirSync(DIR).filter(f => f.endsWith('_5m.json.gz'))) {
  const id = f.replace('_5m.json.gz', '');
  if (ONLY && !ONLY.includes(id)) continue;
  const c5 = JSON.parse(gunzipSync(readFileSync(`${DIR}/${f}`)).toString()).map(([t, o, h, l, c]) => ({ t, o, h, l, c })).filter(x => x.h >= x.l);
  data[id] = { '5m': c5, '15m': resample(c5, 900) };
}
const all = Object.values(data).map(d => d['5m']);
const t0 = Math.min(...all.map(c => c[0].t)), t1 = Math.max(...all.map(c => c.at(-1).t)), split = t0 + 0.7 * (t1 - t0);
const closed = t => ['win', 'loss', 'timeout'].includes(t.result.status);
const pct = x => `${(x * 100).toFixed(0).padStart(3)}%`;
const fmt = s => `${String(s.trades).padStart(5)} tr win ${pct(s.winRate)} ${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(3)}R PF ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf'}`;

const base = { pivotK: 3, entryMode: 'level', tpMode: 'liquidity', minRR: 3, slBufferATR: 0.3, minRiskATR: 0.5, costR: 0.02, session: [8, 11], maxTradesPerDay: 2, maxLossesPerDay: 2 };
const variants = [
  ['all Da Vinci (no IE grading)', { ie: false }],
  ['IE grade A+B', { ie: true, ieMin: 'B' }],
  ['IE grade A only', { ie: true, ieMin: 'A' }],
  ['IE A+B + session levels', { ie: true, ieMin: 'B', refLevels: true }],
];
const manages = [['simple (full to target)', { manage: 'simple' }], ['IE mgmt (80% at T1=liquidity, BE, runner, 16:00)', { manage: 'ie' }], ['IE mgmt (80% at 3R, BE, runner to liquidity)', { manage: 'ie', t1R: 3 }], ['IE mgmt (50% at 3R, BE, runner to liquidity)', { manage: 'ie', t1R: 3, t1Pct: 0.5 }]];

const results = [], rejects = {};
for (const tf of TFS) for (const [vn, vp] of variants) for (const [mn, mp] of manages) {
  const is = [], oos = [], perMkt = {};
  let graded = 0, gA = 0, gB = 0, gX = 0, be = 0;
  for (const [id, d] of Object.entries(data)) {
    const c = d[tf], p = { ...base, ...vp, ...mp, kind: KIND[id], spread: SPREAD[id] };
    const setups = findSetups(c, p);
    if (p.ie) for (const s of setups) if (s.armedAt != null) {
      graded++;
      if (s.ie.grade === 'A') gA++; else if (s.ie.grade === 'B') gB++; else gX++;
      if (mn.startsWith('simple') && vn === 'IE grade A+B') for (const ch of s.ie.checks) if (ch.state === 'fail') rejects[`${tf} ${ch.id}`] = (rejects[`${tf} ${ch.id}`] || 0) + 1;
    }
    const tr = tradesFromSetups(setups, { candles: c, maxPerDay: p.maxTradesPerDay, maxLossesPerDay: p.maxLossesPerDay }).filter(closed);
    perMkt[id] = stats(tr);
    for (const t of tr) { (c[t.result.fillAt].t < split ? is : oos).push(t); if (t.result.be) be++; }
  }
  const label = `${tf} | ${vn} | ${mn}`;
  const years = (t1 - t0) / (365.25 * 86400);
  const r = { label, tf, variant: vn, manage: mn, is: stats(is), oos: stats(oos), all: stats([...is, ...oos]), perMkt, graded, gA, gB, gX, be, perWeek: (is.length + oos.length) / (years * 52) / Object.keys(data).length };
  results.push(r);
  console.log(`${label.padEnd(92)} ALL ${fmt(r.all)} | IS ${fmt(r.is)} | OOS ${fmt(r.oos)} | ${r.perWeek.toFixed(2)}/wk/mkt${p0(r)}`);
}
function p0(r) { return r.graded ? ` | graded ${r.graded}: A ${r.gA} B ${r.gB} X ${r.gX}` : ''; }
console.log('\nRule that rejected the setup (grade X), count:');
console.log(Object.entries(rejects).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join('\n'));
if (OUT) writeFileSync(OUT, JSON.stringify({ split, t0, t1, results, rejects }, null, 1));

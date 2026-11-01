// Research 6: which Inter Equity rules separate better from worse Da Vinci setups in the data?
// For every armed, filled setup (simple management, one result per setup), average R when a rule
// passes vs when it warns/fails.   node research/rulevalue.mjs <dir with SYMBOL_5m.json.gz> [tf]
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findSetups } from '../docs/engine/davinci.js';
import { resample } from '../docs/engine/core.js';
import { IE_LABELS } from '../docs/engine/ierules.js';

const [DIR, TF = '5m'] = process.argv.slice(2);
const SPREAD = { XAUUSD: 0.3, EURUSD: 0.00008, GBPUSD: 0.00012, US30: 2.5, NAS100: 1.5 };
const KIND = { XAUUSD: 'metal', EURUSD: 'fx', GBPUSD: 'fx', US30: 'index', NAS100: 'index' };
const P = { pivotK: 3, entryMode: 'level', tpMode: 'liquidity', minRR: 3, slBufferATR: 0.3, minRiskATR: 0.5, costR: 0.02, session: [8, 11], ie: true, ieMin: 'X' };
const agg = {};
let n = 0;
for (const f of readdirSync(DIR).filter(f => f.endsWith('_5m.json.gz'))) {
  const id = f.replace('_5m.json.gz', '');
  let c = JSON.parse(gunzipSync(readFileSync(`${DIR}/${f}`)).toString()).map(([t, o, h, l, cl]) => ({ t, o, h, l, c: cl })).filter(x => x.h >= x.l);
  if (TF === '15m') c = resample(c, 900);
  for (const s of findSetups(c, { ...P, kind: KIND[id], spread: SPREAD[id] })) {
    if (!s.ie || !s.result || !['win', 'loss', 'timeout'].includes(s.result.status)) continue;
    n++;
    for (const ch of s.ie.checks) {
      const k = ch.state === 'pass' ? 'pass' : ch.state === 'info' ? 'pass' : 'not';
      const a = (agg[ch.id] ??= { pass: { n: 0, r: 0, w: 0 }, not: { n: 0, r: 0, w: 0 } })[k];
      a.n++; a.r += s.result.r; if (s.result.r > 0) a.w++;
    }
    const g = (agg['grade ' + s.ie.grade] ??= { pass: { n: 0, r: 0, w: 0 }, not: { n: 0, r: 0, w: 0 } }).pass;
    g.n++; g.r += s.result.r; if (s.result.r > 0) g.w++;
  }
}
const f = a => a.n ? `${String(a.n).padStart(5)} setups, win ${String(Math.round(100 * a.w / a.n)).padStart(2)}%, ${(a.r / a.n >= 0 ? '+' : '') + (a.r / a.n).toFixed(3)}R` : '    -';
console.log(`${TF}: ${n} filled setups (each counted once, overlapping allowed)`);
for (const [id, v] of Object.entries(agg)) console.log(`${id.padEnd(8)} ${(IE_LABELS[id] || '').slice(0, 48).padEnd(48)} | pass ${f(v.pass)} | warn/fail ${f(v.not)}`);

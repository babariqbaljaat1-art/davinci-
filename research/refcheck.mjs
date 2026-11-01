// Do the engines find the trades the mentor marked in the case studies? Prints every setup near each reference trade.
//   node research/refcheck.mjs <dir with SYMBOL_1m.json.gz>
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findSetups, findSetupsMTF } from '../docs/engine/davinci.js';
import { resample, nyClock } from '../docs/engine/core.js';

const DIR = process.argv[2], DIR5 = process.argv[3];   // DIR5: complete 5m files, used when a 1m day is missing
// [market, NY date, NY time, dir, entry, sl, tp, source]
export const REFS = [
  ['XAUUSD', '2024-01-02', '10:00', 'short', 2070.2, 2071.4, 2061.2, 'CS 2.0 #1 (1m)'],
  ['EURUSD', '2023-09-18', '10:00', 'long', 1.06609, 1.06545, 1.06879, 'CS 2023 #6 (1m)'],
  ['US30', '2023-09-19', '08:10', 'short', 34678.9, 34706.9, 34650.5, 'CS 2023 #7 (5m)'],
  ['EURUSD', '2023-09-20', '08:15', 'long', 1.06956, 1.06918, 1.0712, 'CS 2023 #8 (5m)'],
  ['EURUSD', '2023-09-21', '10:06', 'long', 1.0639, 1.0634, 1.0656, 'CS 2023 #9 (1m)'],
  ['EURUSD', '2023-09-26', '10:00', 'short', 1.05979, 1.06029, 1.05924, 'CS 1.0 #1 (1m)'],
  ['GBPUSD', '2024-08-14', '10:15', 'long', 1.28463, 1.28436, 1.28627, 'Study 9 (1m)'],
  ['XAUUSD', '2024-07-01', '10:15', 'long', 2321.8, 2318.6, 2339.8, 'Study 1 (5m)'],
  ['US30', '2024-07-05', '10:00', 'long', 39198, 39049, 39347, 'Study 2 (1h)'],
];
const cache = {};
const load = id => cache[id] ??= existsSync(`${DIR}/${id}_1m.json.gz`)
  ? JSON.parse(gunzipSync(readFileSync(`${DIR}/${id}_1m.json.gz`)).toString()).map(([t, o, h, l, c]) => ({ t, o, h, l, c })) : null;
const cache5 = {};
const load5 = id => cache5[id] ??= DIR5 && existsSync(`${DIR5}/${id}_5m.json.gz`)
  ? JSON.parse(gunzipSync(readFileSync(`${DIR5}/${id}_5m.json.gz`)).toString()).map(([t, o, h, l, c]) => ({ t, o, h, l, c })) : null;
const SPREAD = { XAUUSD: 0.3, EURUSD: 0.00008, GBPUSD: 0.00012, US30: 2.5, NAS100: 1.5 };
const ny = t => { const k = nyClock(t), h = Math.floor(k.hour + 1e-9), m = Math.round((k.hour - h) * 60); return `${k.date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

for (const [id, day, time, dir, entry, sl, tp, src] of REFS) {
  const all = load(id); if (!all) { console.log(`\n${src} ${id} ${day}: no data`); continue; }
  const t0 = Date.parse(day + 'T00:00:00Z') / 1000 - (process.env.EXTRA?.includes('"ie"') ? 40 : 5) * 86400, t1 = Date.parse(day + 'T00:00:00Z') / 1000 + 2 * 86400;
  const c = all.filter(x => x.t >= t0 && x.t < t1);
  console.log(`\n=== ${src}: ${id} ${day} ${time} NY ${dir} entry ${entry} sl ${sl} tp ${tp} (RR ${(Math.abs(tp - entry) / Math.abs(sl - entry)).toFixed(1)})`);
  const show = (name, list, cc) => {
    const hits = list.filter(s => s.armedAt != null && nyClock(cc[s.armedAt].t).tradeDay === nyClock(Date.parse(day + 'T16:00:00Z') / 1000).tradeDay);
    if (!hits.length) { console.log(`  ${name}: nothing armed that day`); return; }
    for (const s of hits) {
      const ie = s.ie ? ` [IE ${s.ie.grade}${s.ie.checks.filter(x => x.state === 'fail' || x.state === 'warn').map(x => ' ' + x.id + (x.state === 'fail' ? '✗' : '!')).join('')}]` : '';
      console.log(`  ${name}: ${s.dir} armed ${ny(cc[s.armedAt].t)} entry ${+s.entry.toFixed(5)} sl ${+s.sl.toFixed(5)} tp ${+s.tp.toFixed(5)} RR ${s.rr.toFixed(1)} -> ${s.result?.status}${s.result?.fillAt != null ? ' fill ' + ny(cc[s.result.fillAt].t) : ''}${ie}`);
    }
  };
  const full = load5(id), d5 = full ? full.filter(x => x.t >= t0 && x.t < t1) : [];
  const has1m = c.some(x => nyClock(x.t).date === day);
  if (!has1m) console.log('  (no 1-minute data that day, 5m/15m from the complete 5m file)');
  const c5 = has1m ? resample(c, 300) : d5, c15 = resample(c5, 900);
  const P = { session: [7, 12], minRR: 1, spread: SPREAD[id], costR: 0.02, slBufferATR: 0.1, ...JSON.parse(process.env.EXTRA || '{}') };
  show('5m single', findSetups(c5, P), c5);
  show('15m single', findSetups(c15, P), c15);
  if (has1m) {
    show('1m single', findSetups(c, { ...P, pivotK: 2 }), c);
    show('MTF 5m->1m', findSetupsMTF(c, { ...P, htfSeconds: 300 }), c);
    show('MTF 15m->1m', findSetupsMTF(c, { ...P, htfSeconds: 900 }), c);
  }
}

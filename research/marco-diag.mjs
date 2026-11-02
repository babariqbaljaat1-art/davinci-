// Research 7b: is the entry location better than random? Marco model with fixed targets and wider stops.
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { findSetups, tradesFromSetups } from '../docs/engine/davinci.js';
import { stats, resample } from '../docs/engine/core.js';
const [DIR] = process.argv.slice(2);
const SPREAD = { XAUUSD: 0.3, EURUSD: 0.00008, GBPUSD: 0.00012, US30: 2.5, NAS100: 1.5 };
const KIND = { XAUUSD: 'metal', EURUSD: 'fx', GBPUSD: 'fx', US30: 'index', NAS100: 'index' };
const tf = process.env.TF || '15m';
const data = {};
for (const f of readdirSync(DIR).filter(f => f.endsWith('_5m.json.gz'))) {
  const id = f.replace('_5m.json.gz', '');
  const c5 = JSON.parse(gunzipSync(readFileSync(`${DIR}/${f}`)).toString()).map(([t, o, h, l, c]) => ({ t, o, h, l, c })).filter(x => x.h >= x.l);
  data[id] = tf === '5m' ? c5 : resample(c5, tf === '15m' ? 900 : 3600);
}
const closed = t => ['win', 'loss', 'timeout'].includes(t.result.status);
const fmt = s => `${String(s.trades).padStart(5)} tr win ${(s.winRate * 100).toFixed(0).padStart(3)}% ${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(3)}R`;
const STOPS = JSON.parse(process.env.STOPS || '[[0.1,0],[0.3,0.5],[0.5,1]]'), TGT = (process.env.TGT || '1,2,3,0').split(',').map(Number);
for (const [sb, mr] of STOPS) { const sn = `stop ${sb} ATR, min ${mr} ATR`, sp = { marcoSlBufferATR: sb, marcoMinRiskATR: mr };
  for (const fr of TGT) { const tn = fr ? fr + 'R' : 'liquidity', tp = { marcoFixedR: fr };
    const tr = [];
    for (const [id, c] of Object.entries(data)) {
      const p = { model: process.env.MODEL || 'marco', costR: 0.02, session: [8, 11], minRR: 3, bias: process.env.BIAS || 'daily', ...sp, ...tp, kind: KIND[id], spread: SPREAD[id] };
      tr.push(...tradesFromSetups(findSetups(c, p), { candles: c, maxPerDay: 2, maxLossesPerDay: 2 }).filter(closed));
    }
    console.log(`${tf} ${process.env.MODEL || 'marco'}${process.env.BIAS === 'none' ? '' : '+daily'} | ${sn.padEnd(26)} | target ${tn.padEnd(9)} ${fmt(stats(tr))}`);
  } }

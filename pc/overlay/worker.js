// Background scanner: runs in a hidden browser started by the launcher, 24/7 while the PC is on.
import { getConfig, marketReport, alertText, tfSeconds } from './pc-common.js';
import { indexItem, edgeOk } from './engine/report.js';

const FINAL = new Set(['win', 'loss', 'timeout']);
let state = { sent: {} };

async function loadState() {
  try { const s = await (await fetch('/api/state', { cache: 'no-store' })).json(); if (s && s.sent) state = s; } catch { /* first run */ }
}

async function alert(payload) {
  try { await fetch('/api/alert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); } catch { /* server gone */ }
}

async function scan() {
  const cfg = await getConfig();
  const items = [];
  for (const id of cfg.markets) for (const tf of cfg.timeframes) {
    const key = `${id}_${tf}`;
    try {
      const rep = await marketReport(cfg, id, tf);
      items.push(indexItem(rep));
      const lastT = rep.candles[rep.candles.length - 1][0];
      const allow = !cfg.requireEdge || edgeOk(rep);
      for (const s of rep.setups) {
        const k = `${key}|${cfg.strategy}|${s.id}`, prev = state.sent[k];
        const fresh = s.armedT != null && s.armedT >= lastT - 6 * tfSeconds(tf);
        if ((s.status === 'pending' || s.status === 'open') && !prev && fresh) {
          state.sent[k] = s.status;
          if (allow) await alert({ ...alertText(rep, s), telegram: true });
        } else if (prev && FINAL.has(s.status) && !FINAL.has(prev)) {
          state.sent[k] = s.status;
          if (allow) await alert({ title: `${rep.market.id} ${tf}: ${s.status.toUpperCase()}`, body: `${s.r > 0 ? '+' : ''}${s.r}R`, text: `${s.status === 'win' ? '✅' : '❌'} <b>${rep.market.id} ${tf}</b> → ${s.status.toUpperCase()} (${s.r > 0 ? '+' : ''}${s.r}R)`, telegram: true });
        }
      }
    } catch (e) {
      items.push({ key, market: id, tf, error: e.message });
    }
  }
  const keys = Object.keys(state.sent);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete state.sent[k];
  state = { ...state, updated: Math.floor(Date.now() / 1000), strategy: cfg.strategy, items };
  try { await fetch('/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) }); } catch { /* ignore */ }
  document.title = `scan ${new Date().toLocaleTimeString()}`;
}

async function loop() {
  try { await scan(); } catch (e) { console.error(e); }
  setTimeout(loop, 60_000);
}
loadState().then(loop);

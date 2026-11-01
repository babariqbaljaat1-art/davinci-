// Live data provider for the PC app window. Loaded before app.js.
import { MARKETS, STRATEGIES, getConfig, saveConfig, marketReport } from './pc-common.js';
import { indexItem } from './engine/report.js';

let cfg = null;
const $ = s => document.querySelector(s);

async function index() {
  cfg = await getConfig();
  // the background scanner keeps a summary of every market; fall back to computing it here
  let st = null;
  try { st = await (await fetch('/api/state', { cache: 'no-store' })).json(); } catch { /* none yet */ }
  const fresh = st && st.updated && Date.now() / 1000 - st.updated < 600 && st.strategy === cfg.strategy;
  const items = [];
  for (const id of cfg.markets) for (const tf of cfg.timeframes) {
    const key = `${id}_${tf}`;
    const known = fresh && st.items?.find(i => i.key === key);
    if (known) { items.push(known); continue; }
    try { items.push(indexItem(await marketReport(cfg, id, tf))); }
    catch (e) { items.push({ key, market: id, name: MARKETS[id]?.name, tf, error: e.message }); }
  }
  return { updated: fresh ? st.updated : Math.floor(Date.now() / 1000), items, scanner: fresh ? 'on' : 'off' };
}

async function report(key) {
  cfg = cfg || await getConfig();
  const [id, tf] = key.split('_');
  return marketReport(cfg, id, tf, { full: true });
}

function setupSettings({ toast, reload }) {
  const btn = $('#settings-btn'), dlg = $('#settings');
  btn.hidden = false;
  const fill = async () => {
    cfg = await getConfig();
    $('#set-markets').innerHTML = Object.values(MARKETS).map(m => `<label class="opt"><input type="checkbox" name="m" value="${m.id}" ${cfg.markets.includes(m.id) ? 'checked' : ''}> <span translate="no">${m.id}</span> <span class="muted small">${m.name}</span></label>`).join('');
    $('#set-tfs').innerHTML = ['5m', '15m', '1h'].map(tf => `<label class="opt"><input type="checkbox" name="tf" value="${tf}" ${cfg.timeframes.includes(tf) ? 'checked' : ''}> <span translate="no">${tf}</span></label>`).join('');
    $('#set-strategy').innerHTML = Object.entries(STRATEGIES).map(([k, s]) => `<option value="${k}" ${cfg.strategy === k ? 'selected' : ''}>${s.label}</option>`).join('');
    $('#set-edge').checked = !!cfg.requireEdge;
    $('#set-auto').checked = !!cfg.autoStart;
    $('#set-token').value = cfg.telegram.token || '';
    $('#set-chat').value = cfg.telegram.chat || '';
  };
  btn.addEventListener('click', async () => { await fill(); dlg.showModal(); });
  $('#set-cancel').addEventListener('click', () => dlg.close());
  $('#set-form').addEventListener('submit', async e => {
    e.preventDefault();
    const markets = [...dlg.querySelectorAll('input[name=m]:checked')].map(x => x.value);
    const timeframes = [...dlg.querySelectorAll('input[name=tf]:checked')].map(x => x.value);
    if (!markets.length || !timeframes.length) { $('#set-error').textContent = 'Kam se kam ek market aur ek timeframe chuno.'; return; }
    const next = { ...cfg, markets, timeframes, strategy: $('#set-strategy').value, requireEdge: $('#set-edge').checked, autoStart: $('#set-auto').checked,
      telegram: { token: $('#set-token').value.trim(), chat: $('#set-chat').value.trim() } };
    try { await saveConfig(next); cfg = next; dlg.close(); toast('Settings save ho gayi'); reload(); }
    catch (err) { $('#set-error').textContent = `Save nahi hua: ${err.message}`; }
  });
  $('#set-test').addEventListener('click', async () => {
    const token = $('#set-token').value.trim(), chat = $('#set-chat').value.trim();
    if (!token || !chat) { $('#set-error').textContent = 'Pehle bot token aur chat id likho.'; return; }
    await saveConfig({ ...cfg, telegram: { token, chat } });
    const r = await (await fetch('/api/alert', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Da Vinci Scanner', body: 'Test alert', text: '✅ Da Vinci Scanner test message', telegram: true }) })).json();
    $('#set-error').textContent = r.telegram === 'sent' ? 'Telegram par test message chala gaya.' : `Telegram: ${r.telegram}`;
  });
  $('#set-quit').addEventListener('click', async () => {
    await fetch('/api/quit', { method: 'POST', body: '{}' }).catch(() => {});
    document.body.innerHTML = '<p style="padding:24px">Da Vinci Scanner band ho gaya. Ye window band kar do.</p>';
  });
}

window.DAVINCI_PROVIDER = { mode: 'pc', index, report, setupSettings };

import { Chart, drawEquity, fmt } from './chart.js';

const TF_SEC = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
const STATE_TEXT = {
  pending: 'Limit order: entry ka intezar',
  open: 'Trade open (entry ho chuki)',
  forming: 'Setup ban raha hai',
  win: 'Target hit', loss: 'Stop hit', timeout: 'Time exit', missed: 'Entry se pehle target', expired: 'Expire', invalid: 'Invalid',
};
const STEP_TEXT = [
  ['liquidityBlock', 'Liquidity block bana (sweep + displacement)'],
  ['buildup', 'LB ke neeche buildup (BOS + lower high)'],
  ['engineeredLows', 'Lows par liquidity engineer hui'],
  ['entry', 'Entry, SL, TP set (RR ≥ min)'],
];

const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

let index = null, current = null, data = null, showHistory = false, pendingFocus = null;
const chart = new Chart($('#chart'), { onHover: c => showOHLC(c) });

function digitsOf(m) { return m?.digits ?? 2; }
function ago(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 90) return 'abhi';
  if (s < 3600) return `${Math.round(s / 60)} min pehle`;
  if (s < 86400) return `${Math.round(s / 3600)} ghante pehle`;
  return `${Math.round(s / 86400)} din pehle`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3200);
}
function esc(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function pctTxt(v) { return `${Math.round((v || 0) * 100)}%`; }
function rTxt(v) { return `${v > 0 ? '+' : ''}${(v || 0).toFixed(2)}R`; }

async function getJSON(url) {
  const res = await fetch(`${url}?v=${Math.floor(Date.now() / 30000)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function loadIndex() {
  try {
    index = await getJSON('data/index.json');
    const stale = Date.now() / 1000 - index.updated > 3600;
    $('#dot').className = 'dot ' + (stale ? 'stale' : 'ok');
    $('#updated').innerHTML = `<span class="lbl">Update: </span>${ago(index.updated)}`;
    renderTabs();
    notifyNew();
    const [want0, focusId] = decodeURIComponent(location.hash.slice(1)).split('/');
    const want = want0 || store.get('market', null);
    pendingFocus = focusId || null;
    const pick = index.items.find(i => i.key === want) || index.items.find(i => !i.error) || index.items[0];
    if (pick && (!current || current !== pick.key || !data)) await select(pick.key, false);
    else if (current) await select(current, false, true);
  } catch (e) {
    $('#dot').className = 'dot err';
    $('#updated').textContent = 'Data nahi mila';
    showEmpty('Data abhi available nahi. Scanner ki pehli run ke baad yahan chart aayega.');
  }
}

function renderTabs() {
  const nav = $('#markets');
  nav.innerHTML = index.items.map(i => `
    <button class="tab" role="tab" type="button" id="tab-${esc(i.key)}" data-key="${esc(i.key)}" aria-selected="${i.key === current}" aria-controls="panel" tabindex="${i.key === current ? 0 : -1}" translate="no">
      ${esc(i.market)} <span class="tf">${esc(i.tf)}</span>
      ${i.error ? '<span class="badge err" aria-label="Data error">!</span>' : i.live ? `<span class="badge" aria-label="${i.live} live setups">${i.live}</span>` : ''}
    </button>`).join('');
  const tabs = [...nav.querySelectorAll('.tab')];
  tabs.forEach((b, k) => {
    b.addEventListener('click', () => select(b.dataset.key, true));
    // WAI-ARIA tabs: arrow keys move between tabs, Home/End jump
    b.addEventListener('keydown', e => {
      const to = { ArrowRight: k + 1, ArrowLeft: k - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      const t = tabs[(to + tabs.length) % tabs.length];
      t.focus(); t.click();
    });
  });
}

async function select(key, user, keepView = false) {
  current = key;
  store.set('market', key);
  if (user) history.replaceState(null, '', `#${key}`);
  document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.key === key; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  $('#panel').setAttribute('aria-labelledby', `tab-${key}`);
  const item = index?.items.find(i => i.key === key);
  if (item?.error) { showEmpty(`Is market ka data nahi aa saka: ${item.error}`); return; }
  try {
    data = await getJSON(`data/${key}.json`);
  } catch {
    showEmpty('Is market ka data abhi nahi hai.');
    return;
  }
  $('#chart-empty').hidden = true;
  $('#sym').textContent = `${data.market.id} · ${data.market.name}`;
  $('#tfname').textContent = data.tf;
  chart.setData({ candles: data.candles, setups: visibleSetups(), digits: digitsOf(data.market), tfSeconds: TF_SEC[data.tf] });
  if (pendingFocus && data.setups.some(s => s.id === pendingFocus)) {
    toggleHistory(true);
    chart.focus(pendingFocus);
    pendingFocus = null;
  } else if (!keepView) {
    chart.fit();
    const live = data.setups.filter(s => s.status === 'pending' || s.status === 'open');
    if (live.length) chart.focus(live[live.length - 1].id); else chart.focus(null);
  }
  showOHLC(null);
  renderLive();
  renderBacktest();
}

function visibleSetups() {
  return data.setups.filter(s => showHistory || ['pending', 'open', 'forming'].includes(s.status));
}

function showEmpty(msg) {
  const e = $('#chart-empty'); e.textContent = msg; e.hidden = false;
  $('#live').innerHTML = '';
}

function showOHLC(c) {
  if (!data) return;
  const d = digitsOf(data.market);
  const k = c || (() => { const x = data.candles[data.candles.length - 1]; return { o: x[1], h: x[2], l: x[3], c: x[4] }; })();
  $('#ohlc').textContent = `O ${fmt(k.o, d)}  H ${fmt(k.h, d)}  L ${fmt(k.l, d)}  C ${fmt(k.c, d)}`;
}

function renderLive() {
  const d = digitsOf(data.market);
  const live = data.setups.filter(s => s.status === 'pending' || s.status === 'open').reverse();
  const forming = data.setups.filter(s => s.status === 'forming').slice(-2).reverse();
  const card = s => {
    const steps = STEP_TEXT.map(([k, t]) => `<li class="${s.steps[k] ? 'done' : ''}"><span class="ic" aria-hidden="true">${s.steps[k] ? '✓' : ''}</span><span>${t}${s.steps[k] ? '' : ' <span class="muted">(abhi nahi)</span>'}</span></li>`).join('');
    const lv = s.tp != null
      ? `<dl class="levels" translate="no">
          <div><dt>Entry</dt><dd>${fmt(s.entry, d)}</dd></div>
          <div><dt>Stop</dt><dd class="neg">${fmt(s.sl, d)}</dd></div>
          <div><dt>Target</dt><dd class="pos">${fmt(s.tp, d)}</dd></div>
          <div><dt>RR</dt><dd>1:${(s.rr ?? 0).toFixed(1)}</dd></div>
        </dl>`
      : `<dl class="levels" translate="no"><div><dt>LB zone</dt><dd>${fmt(s.lb.bottom, d)}</dd></div><div><dt>LB extreme</dt><dd>${fmt(s.lb.top, d)}</dd></div></dl>`;
    return `<article class="setup ${s.status}" aria-label="${s.dir === 'short' ? 'Sell' : 'Buy'} setup">
      <div class="setup-head">
        <span class="side-pill ${s.dir}">${s.dir === 'short' ? 'SELL' : 'BUY'}</span>
        <strong translate="no">${esc(data.market.id)}&nbsp;${esc(data.tf)}</strong>
        <span class="state">${STATE_TEXT[s.status] || s.status}</span>
      </div>
      ${lv}
      <ul class="checks">${steps}</ul>
      <div class="setup-actions">
        <button class="btn-primary" type="button" data-focus="${esc(s.id)}">Chart par dekho</button>
        ${s.tp != null ? `<button class="btn-ghost" type="button" data-copy="${esc(s.id)}">Levels copy</button>` : ''}
      </div>
    </article>`;
  };
  let html = live.map(card).join('');
  if (!live.length) html += `<p class="none">Is waqt ${esc(data.market.id)} ${esc(data.tf)} par koi ready setup nahi. Scanner har ~10 minute check karta hai.</p>`;
  if (forming.length) html += `<p class="muted small" style="margin:4px 0 0">Ban rahe setups (abhi trade nahi):</p>` + forming.map(card).join('');
  $('#live').innerHTML = html;
  $('#live').querySelectorAll('[data-focus]').forEach(b => b.addEventListener('click', () => {
    if (!showHistory && !visibleSetups().some(s => s.id === b.dataset.focus)) toggleHistory(true);
    chart.focus(b.dataset.focus);
    $('#chart').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }));
  $('#live').querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const s = data.setups.find(x => x.id === b.dataset.copy);
    const txt = `${data.market.id} ${data.tf} ${s.dir === 'short' ? 'SELL' : 'BUY'} | Entry ${fmt(s.entry, d)} | SL ${fmt(s.sl, d)} | TP ${fmt(s.tp, d)} | RR 1:${s.rr.toFixed(1)}`;
    try { await navigator.clipboard.writeText(txt); toast('Levels copy ho gaye'); } catch { toast(txt); }
  }));
}

function renderBacktest() {
  const bt = data.backtest;
  const a = bt.all, o = bt.outOfSample, i = bt.inSample, mc = bt.monteCarlo;
  const from = new Date(bt.from * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const to = new Date(bt.to * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  $('#bt-range').textContent = `${bt.bars.toLocaleString()} candles · ${from} – ${to}`;
  const rob = bt.robustness;
  const robPct = rob.counted ? rob.positive / rob.counted : 0;
  let v, cls;
  if (a.trades < 30) { v = `Sirf ${a.trades} trades mili hain. Itne kam data par faisla mat karo, ye result luck bhi ho sakta hai.`; cls = 'meh'; }
  else if (a.expectancyR > 0 && o.expectancyR > 0 && robPct >= 0.6) { v = `Is data par edge dikh raha hai: ${a.trades} trades, average ${rTxt(a.expectancyR)} per trade, aur out-of-sample bhi positive. Phir bhi guarantee nahi, demo par forward test karo.`; cls = 'good'; }
  else if (a.expectancyR > 0) { v = `Result positive hai lekin mazboot nahi (out-of-sample ya nearby settings kamzor). Abhi sirf demo par chalao.`; cls = 'meh'; }
  else { v = `Is market/timeframe par in rules ka edge nahi dikh raha (${rTxt(a.expectancyR)} per trade). Yahan alerts par trade mat karo.`; cls = 'bad'; }
  const ver = $('#verdict'); ver.textContent = v; ver.className = `verdict ${cls}`;
  const kp = [
    ['Trades', a.trades],
    ['Win rate', pctTxt(a.winRate)],
    ['Avg / trade', `<span class="${a.expectancyR >= 0 ? 'pos' : 'neg'}">${rTxt(a.expectancyR)}</span>`],
    ['Total', `<span class="${a.totalR >= 0 ? 'pos' : 'neg'}">${rTxt(a.totalR)}</span>`],
    ['Profit factor', a.profitFactor == null ? '–' : Number.isFinite(a.profitFactor) ? a.profitFactor.toFixed(2) : '∞'],
    ['Max drawdown', `${(a.maxDrawdownR || 0).toFixed(1)}R`],
  ];
  $('#kpis').innerHTML = kp.map(([k, val]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${val}</div></div>`).join('');
  drawEquity($('#equity'), bt.equity || []);
  $('#split').innerHTML = `Pehle 70% data: <strong>${i.trades}</strong> trades, <strong>${rTxt(i.expectancyR)}</strong>/trade · Baad ke 30% (unseen): <strong>${o.trades}</strong> trades, <strong>${rTxt(o.expectancyR)}</strong>/trade<br>Nearby settings profitable: <strong>${rob.positive}/${rob.counted}</strong> · Lambi losing streak: <strong>${a.maxLosingStreak}</strong>`;
  $('#mc').innerHTML = mc
    ? `Monte Carlo (${mc.runs.toLocaleString()} simulations): <strong>${pctTxt(mc.probProfitable)}</strong> runs profit mein. Total 5%–95%: <strong>${mc.totalR.p5.toFixed(1)}R</strong> se <strong>${mc.totalR.p95.toFixed(1)}R</strong>. Bura drawdown (95%): <strong>${mc.maxDrawdownR.p95.toFixed(1)}R</strong>. 1% risk par 30% account loss ka chance: <strong>${pctTxt(mc.probLose30pct)}</strong>.`
    : 'Monte Carlo ke liye kam se kam 5 trades chahiye.';
  const tb = $('#trades tbody');
  tb.innerHTML = (bt.recentTrades || []).slice(-20).reverse().map(t => `<tr>
    <td>${new Date(t.fill * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}</td>
    <td>${t.dir === 'short' ? 'Sell' : 'Buy'}</td>
    <td class="num">1:${t.rr.toFixed(1)}</td>
    <td class="num ${t.r >= 0 ? 'pos' : 'neg'}">${rTxt(t.r)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Abhi koi trade nahi</td></tr>';
  const gb = $('#grid tbody');
  gb.innerHTML = rob.grid.filter(g => g.trades >= 10).sort((x, y) => y.expectancyR - x.expectancyR).map(g => `<tr>
    <td>${g.pivotK}</td><td>${g.entryMode}</td><td class="num">${g.minRR}</td><td>${g.bias}</td><td class="num">${g.trades}</td>
    <td class="num ${g.expectancyR >= 0 ? 'pos' : 'neg'}">${rTxt(g.expectancyR)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Kisi setting mein 10+ trades nahi</td></tr>';
}

function toggleHistory(on) {
  showHistory = on ?? !showHistory;
  $('#history').setAttribute('aria-pressed', String(showHistory));
  if (data) { chart.setups = visibleSetups(); if (!showHistory) chart.focusId = null; chart.draw(); }
}

// ---- alerts while the app is open (Telegram covers the phone in the background) ----
function notifyNew() {
  const seen = new Set(store.get('seen', []));
  const firstVisit = seen.size === 0;   // don't alert for setups that existed before the first visit
  const fresh = index.items.filter(i => i.latest && !seen.has(i.key + i.latest.id));
  for (const i of fresh) {
    const s = i.latest;
    const msg = `${s.dir === 'short' ? 'SELL' : 'BUY'} ${i.market} ${i.tf} · Entry ${s.entry} · SL ${s.sl} · TP ${s.tp} · RR 1:${(s.rr ?? 0).toFixed(1)}`;
    if (!firstVisit && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.ready.then(r => r.showNotification('Da Vinci setup', { body: msg, icon: 'icons/icon-192.png', tag: i.key + s.id })).catch(() => new Notification('Da Vinci setup', { body: msg }));
    } else if (!firstVisit) toast(msg);
    seen.add(i.key + s.id);
  }
  seen.add('init');
  store.set('seen', [...seen].slice(-300));
}

function setupNotifyButton() {
  const b = $('#notify');
  if (!('Notification' in window)) { b.hidden = true; return; }
  const paint = () => { b.textContent = Notification.permission === 'granted' ? 'Phone alerts: on' : 'Phone alerts on karo'; b.setAttribute('aria-pressed', String(Notification.permission === 'granted')); };
  paint();
  b.addEventListener('click', async () => {
    if (Notification.permission === 'granted') { toast('Is phone par alerts already on hain (app khuli ho tab). Background alerts Telegram se aate hain.'); return; }
    const p = await Notification.requestPermission();
    paint();
    toast(p === 'granted' ? 'Alerts on. App band ho to Telegram alert aayega.' : 'Permission nahi mili. Telegram alerts phir bhi aayenge.');
  });
}

$('#refresh').addEventListener('click', () => { loadIndex(); toast('Refresh…'); });
$('#fit').addEventListener('click', () => chart.fit());
// keyboard control for the chart canvas
$('#chart').addEventListener('keydown', e => {
  const act = { ArrowLeft: () => chart.pan(10), ArrowRight: () => chart.pan(-10), '+': () => chart.zoom(1.25), '=': () => chart.zoom(1.25), '-': () => chart.zoom(0.8), Home: () => chart.fit() }[e.key];
  if (act) { e.preventDefault(); act(); }
});
$('#history').addEventListener('click', () => toggleHistory());
document.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => chart.zoom(b.dataset.zoom === 'in' ? 1.25 : 0.8)));
window.addEventListener('hashchange', () => {
  const [k, f] = decodeURIComponent(location.hash.slice(1)).split('/');
  pendingFocus = f || null;
  if (k) select(k, false, false);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadIndex(); });
setupNotifyButton();
loadIndex();
setInterval(loadIndex, 60_000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

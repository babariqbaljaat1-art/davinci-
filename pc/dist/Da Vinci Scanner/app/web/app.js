import { Chart, drawEquity, fmt } from './chart.js';
import { IE_LABELS, IE_GROUPS } from './engine/ierules.js';

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

const GRADE_TEXT = { A: 'A · full risk', B: 'B · half risk', X: 'X · IE skip', '?': 'Ban raha hai' };
const STATE_ICON = { pass: '✓', fail: '✗', warn: '!', wait: '…', info: '·' };
// USD per 1.0 price move for 1 lot (common CFD contract sizes; brokers differ, check yours)
const LOT_VALUE = { XAUUSD: 100, EURUSD: 100000, GBPUSD: 100000, NAS100: 1, US30: 1, BTCUSD: 1 };

const USD = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const LOTS = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

let index = null, current = null, data = null, showHistory = false, pendingFocus = null, selectSeq = 0;
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

// Data source: the cloud build reads saved JSON; the PC app installs a live provider first.
const provider = window.DAVINCI_PROVIDER || {
  mode: 'cloud',
  index: () => getJSON('data/index.json'),
  report: key => getJSON(`data/${key}.json`),
};

async function getJSON(url) {
  const res = await fetch(`${url}?v=${Math.floor(Date.now() / 30000)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function loadIndex() {
  try {
    index = await provider.index();
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
  const seq = ++selectSeq;
  try {
    if (!data || data.key !== key) { $('#chart-empty').textContent = 'Loading…'; $('#chart-empty').hidden = false; }
    const rep = await provider.report(key);
    if (seq !== selectSeq) return;          // a newer selection is already loading
    data = rep;
  } catch {
    if (seq === selectSeq) showEmpty('Is market ka data abhi nahi hai.');
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
  const live = data.setups.filter(s => (s.status === 'pending' || s.status === 'open') && !s.skip).reverse();
  const skipped = data.setups.filter(s => (s.status === 'pending' || s.status === 'open') && s.skip).slice(-2).reverse();
  const forming = data.setups.filter(s => s.status === 'forming').slice(-2).reverse();
  const card = s => {
    const ie = s.ie;
    const steps = ie ? checklistHTML(s) : STEP_TEXT.map(([k, t]) => `<li class="${s.steps[k] ? 'done' : ''}"><span class="ic" aria-hidden="true">${s.steps[k] ? '✓' : ''}</span><span>${t}${s.steps[k] ? '' : ' <span class="muted">(abhi nahi)</span>'}</span></li>`).join('');
    const lv = s.tp != null
      ? `<dl class="levels" translate="no">
          <div><dt>Entry</dt><dd>${fmt(s.entry, d)}</dd></div>
          <div><dt>Stop</dt><dd class="neg">${fmt(s.sl, d)}</dd></div>
          <div><dt>Target</dt><dd class="pos">${fmt(s.tp, d)}</dd></div>
          <div><dt>RR</dt><dd>1:${(s.rr ?? 0).toFixed(1)}</dd></div>
        </dl>`
      : `<dl class="levels" translate="no"><div><dt>LB zone</dt><dd>${fmt(s.lb.bottom, d)}</dd></div><div><dt>LB extreme</dt><dd>${fmt(s.lb.top, d)}</dd></div></dl>`;
    const forming = s.status === 'forming';
    const grade = !ie ? '' : forming
      ? `<span class="grade g-wait">Ban raha hai${ie.grade === 'X' ? ' · abhi X' : ''}</span>`
      : `<span class="grade g-${ie.grade === '?' ? 'wait' : ie.grade}">${GRADE_TEXT[ie.grade] || ie.grade}</span>`;
    return `<article class="setup ${s.status}${s.skip ? ' skipped' : ''}" aria-label="${s.dir === 'short' ? 'Sell' : 'Buy'} setup">
      <div class="setup-head">
        <span class="side-pill ${s.dir}">${s.dir === 'short' ? 'SELL' : 'BUY'}</span>
        <strong translate="no">${esc(data.market.id)}&nbsp;${esc(data.tf)}</strong>
        ${grade}
        <span class="state">${STATE_TEXT[s.status] || s.status}</span>
      </div>
      ${lv}
      ${s.tp != null && !s.skip ? planHTML(s, d) : ''}
      ${ie ? steps : `<ul class="checks">${steps}</ul>`}
      <div class="setup-actions">
        <button class="btn-primary" type="button" data-focus="${esc(s.id)}">Chart par dekho</button>
        ${s.tp != null ? `<button class="btn-ghost" type="button" data-copy="${esc(s.id)}">Levels copy</button>` : ''}
        ${s.tp != null && !s.skip ? `<button class="btn-ghost" type="button" data-journal="${esc(s.id)}">Journal mein likho</button>` : ''}
      </div>
    </article>`;
  };
  let html = live.map(card).join('');
  if (!live.length) html += `<p class="none">Is waqt ${esc(data.market.id)} ${esc(data.tf)} par koi ready setup nahi. Scanner har ${provider.mode === 'pc' ? 'minute' : '~10 minute'} check karta hai.</p>`;
  if (forming.length) html += `<p class="muted small sub-h">Ban rahe setups (abhi trade nahi):</p>` + forming.map(card).join('');
  if (skipped.length) html += `<details class="more skipped-list"><summary>IE rules ne ${skipped.length} setup skip kiye (wajah dekho)</summary>${skipped.map(card).join('')}</details>`;
  $('#live').innerHTML = html;
  $('#live').querySelectorAll('[data-focus]').forEach(b => b.addEventListener('click', () => {
    if (!showHistory && !visibleSetups().some(s => s.id === b.dataset.focus)) toggleHistory(true);
    chart.focus(b.dataset.focus);
    $('#chart').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }));
  $('#live').querySelectorAll('[data-journal]').forEach(b => b.addEventListener('click', () => {
    const x = data.setups.find(v => v.id === b.dataset.journal);
    addJournal({ id: `${data.key}|${x.id}`, t: Math.floor(Date.now() / 1000), market: data.market.id, tf: data.tf, dir: x.dir, entry: x.entry, sl: x.sl, tp: x.tp, rr: x.rr, grade: x.ie?.grade || '', result: '', note: '' });
  }));
  $('#live').querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const s = data.setups.find(x => x.id === b.dataset.copy);
    const txt = `${data.market.id} ${data.tf} ${s.dir === 'short' ? 'SELL' : 'BUY'} | Entry ${fmt(s.entry, d)} | SL ${fmt(s.sl, d)} | TP ${fmt(s.tp, d)} | RR 1:${s.rr.toFixed(1)}`;
    try { await navigator.clipboard.writeText(txt); toast('Levels copy ho gaye'); } catch { toast(txt); }
  }));
}

function checklistHTML(s) {
  const by = new Map(s.ie.checks.map(([id, st, note]) => [id, { st, note }]));
  const bad = s.ie.checks.filter(([, st]) => st === 'fail' || st === 'warn');
  const ok = s.ie.checks.filter(([, st]) => st === 'pass').length;
  const row = id => {
    const c = by.get(id); if (!c) return '';
    return `<li class="ck ${c.st}"><span class="ic" aria-hidden="true">${STATE_ICON[c.st] || ''}</span><span><span class="sr-only">${c.st}: </span>${esc(IE_LABELS[id] || id)}${c.note ? ` <span class="muted">(${esc(c.note)})</span>` : ''}</span></li>`;
  };
  const top = bad.length ? `<ul class="checks">${bad.map(([id]) => row(id)).join('')}</ul>` : '';
  const groups = IE_GROUPS.map(([g, ids]) => `<li class="grp"><span class="grp-h">${g}</span><ul class="checks">${ids.map(row).join('')}</ul></li>`).join('');
  return `${top}<details class="more ie-all"><summary>IE checklist: ${ok}/${s.ie.checks.length} rules ✓${bad.length ? ` · ${bad.length} masle` : ''}</summary><ul class="groups">${groups}</ul></details>`;
}

function planHTML(s, d) {
  const acct = store.get('acct', { balance: 10000, riskPct: 1 });
  const share = s.ie ? s.ie.risk : 1;
  const riskMoney = acct.balance * (acct.riskPct / 100) * share;
  const dist = Math.abs(s.entry - s.sl);
  const lv = LOT_VALUE[data.market.id];
  const lots = lv && dist > 0 ? riskMoney / (dist * lv) : null;
  const mg = s.ie && s.mgmt ? `<li>T1 <b translate="no">${fmt(s.tp, d)}</b>: 80% close, stop entry par (break-even)</li>
    ${s.mgmt.beAt != null ? `<li>Agar price <b translate="no">${fmt(s.mgmt.beAt, d)}</b> le le pehle hi: stop break-even</li>` : ''}
    <li>${s.mgmt.t2 != null ? `Baqi 20% agli liquidity <b translate="no">${fmt(s.mgmt.t2, d)}</b> tak` : 'Baqi 20% target ke baad break-even stop ke saath'}; 4 pm NY (Friday 12) tak band</li>` : '';
  return `<div class="plan">
    <p class="small"><strong>Size:</strong> ${share < 1 ? 'B setup, aadha risk: ' : ''}${USD.format(riskMoney)} risk${lots != null ? ` ≈ <b translate="no">${LOTS.format(lots)}</b> lots` : ''} <span class="muted">(account ${USD.format(acct.balance)}, ${acct.riskPct}%; contract size broker se check karo)</span></p>
    ${mg ? `<ul class="plan-list small">${mg}</ul>` : ''}
  </div>`;
}

// ---- discipline + journal (stored on this device) ----
function journal() { return store.get('journal', []); }
function addJournal(e) {
  const j = journal();
  if (j.some(x => x.id === e.id)) { toast('Ye trade journal mein pehle se hai'); return; }
  j.push(e); store.set('journal', j.slice(-500));
  renderDiscipline(); toast('Journal mein add ho gaya. Result baad mein likho.');
}
function nyDate(ts) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ts * 1000)); }
function renderDiscipline() {
  const j = journal();
  const today = nyDate(Date.now() / 1000);
  const td = j.filter(x => nyDate(x.t) === today);
  const losses = td.filter(x => x.result === 'loss').length;
  const weekAgo = Date.now() / 1000 - 7 * 86400;
  const wk = j.filter(x => x.t >= weekAgo).length;
  let msg, cls;
  if (losses >= 2) { msg = 'Aaj 2 losses ho gaye. IE rule: aaj ke liye band. Kal fresh aao.'; cls = 'bad'; }
  else if (td.length >= 2) { msg = 'Aaj 2 trades ho gayi. IE rule: din mein 2 se zyada nahi.'; cls = 'meh'; }
  else if (wk > 3) { msg = `Is hafte ${wk} trades. Marco: 1-3 trades per week kaafi hain. Quality over quantity.`; cls = 'meh'; }
  else { msg = `Aaj ${td.length}/2 trades, ${losses}/2 losses. Is hafte ${wk} trades (target 1-3).`; cls = 'good'; }
  const v = $('#disc-verdict'); v.textContent = msg; v.className = `verdict ${cls}`;
  const acct = store.get('acct', { balance: 10000, riskPct: 1 });
  $('#acct-balance').value = acct.balance; $('#acct-risk').value = acct.riskPct;
  const rows = j.slice(-12).reverse().map(x => `<tr>
    <td>${new Date(x.t * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}</td>
    <td translate="no">${esc(x.market)} ${x.dir === 'short' ? 'Sell' : 'Buy'} ${esc(x.grade)}</td>
    <td><select class="j-res" data-id="${esc(x.id)}" aria-label="Result ${esc(x.market)}" name="res-${esc(x.id)}">
      ${['', 'win', 'loss', 'be', 'skipped'].map(o => `<option value="${o}" ${x.result === o ? 'selected' : ''}>${{ '': 'Result…', win: 'Win', loss: 'Loss', be: 'Break-even', skipped: 'Nahi li' }[o]}</option>`).join('')}
    </select></td>
    <td><input class="j-note" data-id="${esc(x.id)}" name="note-${esc(x.id)}" value="${esc(x.note || '')}" placeholder="Note / feeling…" aria-label="Note" autocomplete="off"></td></tr>`).join('');
  $('#journal tbody').innerHTML = rows || '<tr><td colspan="4" class="muted">Abhi koi entry nahi. Setup card par "Journal mein likho" dabao.</td></tr>';
  const upd = (id, k, val) => { const all = journal(); const e = all.find(z => z.id === id); if (e) { e[k] = val; store.set('journal', all); } };
  $('#journal').querySelectorAll('.j-res').forEach(el => el.addEventListener('change', () => { upd(el.dataset.id, 'result', el.value); renderDiscipline(); }));
  $('#journal').querySelectorAll('.j-note').forEach(el => el.addEventListener('change', () => upd(el.dataset.id, 'note', el.value)));
}
function setupDiscipline() {
  const save = () => {
    const balance = Math.max(0, +$('#acct-balance').value || 0), riskPct = Math.min(5, Math.max(0.05, +$('#acct-risk').value || 1));
    store.set('acct', { balance, riskPct });
    $('#acct-balance').value = balance; $('#acct-risk').value = riskPct;   // show the value actually used
    if (data) renderLive();
  };
  $('#acct-balance').addEventListener('change', save);
  $('#acct-risk').addEventListener('change', save);
  $('#journal-csv').addEventListener('click', () => {
    const j = journal();
    const head = 'date,market,tf,side,grade,entry,sl,tp,rr,result,note';
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head, ...j.map(x => [new Date(x.t * 1000).toISOString().slice(0, 16), x.market, x.tf, x.dir, x.grade, x.entry, x.sl, x.tp, x.rr, x.result, x.note].map(q).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'davinci-journal.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  renderDiscipline();
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

async function renderResearch() {
  try {
    const r = await (await fetch('research.json', { cache: 'no-store' })).json();
    const d = t => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    $('#res-intro').textContent = `${r.markets.join(', ')} · ${d(r.from)} – ${d(r.to)} · ${r.configs} settings · ${r.trades.toLocaleString()} trades simulate hui (spread + cost ke saath). Jo settings pehle 70% aur unseen 30% data, dono par positive rahi: ${r.positiveBoth}.`;
    const cell = (n, e) => `${n} tr · <span class="${e >= 0 ? 'pos' : 'neg'}">${rTxt(e)}</span>`;
    $('#res-notes').innerHTML = (r.notes || []).map(n => `<li>${esc(n)}</li>`).join('');
    $('#res-notes').hidden = !(r.notes || []).length;
    $('#res-table tbody').innerHTML = r.rows.map(x => `<tr><td translate="no">${x.tf}</td><td>${esc(x.label)}</td><td class="num">${x.positiveIS}/${x.settings}</td><td class="num">${cell(x.isTrades, x.isExp)}</td><td class="num">${cell(x.oosTrades, x.oosExp)}</td></tr>`).join('');
  } catch { $('#res-intro').textContent = 'Research data nahi mila.'; }
}
renderResearch();

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
setupDiscipline();
if (provider.setupSettings) provider.setupSettings({ toast, reload: () => { data = null; loadIndex(); } });
loadIndex();
setInterval(loadIndex, provider.mode === 'pc' ? 30_000 : 60_000);
if (provider.mode !== 'pc' && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// Telegram alerts. Needs repository secrets TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
const fmt = (v, d) => (v == null ? '-' : Number(v).toFixed(d));
const pct = v => `${Math.round((v || 0) * 100)}%`;

export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.log('[telegram skipped: no secrets]\n' + text); return; }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error('telegram error', res.status, await res.text());
}

export function setupMessage(m, tf, s, bt, appUrl) {
  const d = (m.digits ?? 2) + 1;
  const side = s.dir === 'short' ? '🔴 SELL' : '🟢 BUY';
  const state = s.status === 'open' ? 'Entry trigger ho chuki (trade open)' : 'Limit order: price abhi entry tak nahi aayi';
  const a = bt.all, o = bt.outOfSample, mc = bt.monteCarlo;
  return [
    `<b>${side} — ${m.id} ${tf} — Da Vinci</b>`,
    state,
    ``,
    `Entry: <b>${fmt(s.entry, d)}</b>`,
    `Stop loss: <b>${fmt(s.sl, d)}</b>`,
    `Target: <b>${fmt(s.tp, d)}</b>`,
    `RR: <b>1:${fmt(s.rr, 1)}</b>`,
    ``,
    `Backtest (${m.id} ${tf}): ${a.trades} trades, win ${pct(a.winRate)}, avg ${fmt(a.expectancyR, 2)}R/trade`,
    `Out-of-sample: ${o.trades} trades, ${fmt(o.expectancyR, 2)}R/trade`,
    mc ? `Monte Carlo (${mc.runs}x): profitable ${pct(mc.probProfitable)}` : '',
    appUrl ? `\n<a href="${appUrl}#${m.id}_${tf}">Chart kholo</a>` : '',
    `\n<i>Ye financial advice nahi. Har trade loss ho sakti hai.</i>`,
  ].filter(Boolean).join('\n');
}

export function resultMessage(m, tf, s) {
  const icon = s.status === 'win' ? '✅' : s.status === 'loss' ? '❌' : '⏱';
  return `${icon} <b>${m.id} ${tf}</b> ${s.dir === 'short' ? 'SELL' : 'BUY'} @ ${s.entry} → <b>${s.status.toUpperCase()}</b> (${s.r > 0 ? '+' : ''}${s.r}R)`;
}

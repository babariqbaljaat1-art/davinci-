# Da Vinci Scanner

Inter Equity course ke **Da Vinci setup** ko 24/7 scan karne wala software.
Ye aapke markets par setup dhoondta hai, chart par **Liquidity Block, Entry, Stop Loss, Target aur RR** mark karta hai,
har setup ko saalon ke data par backtest karta hai, aur Telegram par alert bhejta hai. App phone par install ho jaati hai.

> Ye educational tool hai, financial advice nahi. Backtest future profit ki guarantee nahi deta. Har trade loss ho sakti hai.

## Kaise kaam karta hai

```
GitHub Actions (har 10 min, free, 24/7)
  → Yahoo Finance se candles (GC=F gold, NQ=F Nasdaq, YM=F Dow)
  → Da Vinci engine: setups dhoondo + har setup ka result simulate karo
  → Backtest: win rate, R per trade, drawdown, 70/30 split, 5,000 Monte Carlo runs, 72 nearby settings
  → Telegram alert (naya setup / result)
  → GitHub Pages par app + data publish
Phone: https://babariqbaljaat1-art.github.io/davinci-/  → "Add to Home Screen"
```

## Course se jo rules liye gaye (bearish, bullish iska ulta)

1. **Liquidity Block (LB):** price kisi intact swing high ki liquidity leti hai (sweep), aur foran displacement deti hai
   (previous candle ke low ke neeche close, ya bearish imbalance/FVG). Wo swing high = LB.
2. **Buildup LB ke neeche:** price wo low tod deti hai jo sweep se pehle bana tha (BOS, early sellers induce),
   phir LB se neeche kam az kam ek lower high banti hai.
3. **Lows par liquidity engineer:** LB ke baad wala low respect hota hai (baad ka low us se upar). Uske neeche liquidity = target.
4. **Buildup taken → entry:** price buildup highs le kar LB mein aati hai. Sell limit = LB ka 50%,
   Stop = LB high + 0.3 ATR (kam se kam 0.5 ATR), Target = 3R (sirf jab opposite liquidity us se aage ho). RR kam az kam 1:3 (Entries lesson: "anything above three I'll take it").

Setup cancel: LB ke upar close, entry se pehle lows le liye gaye, ya 200 candles tak entry na aaye.

Sources: *12. Da Vinci Setups*, *16. The Model*, *19–20. Liquidity Blocks*, *22–23. Entries*, *24. Direction Bias*,
*25. General Rule System*, *26. Current Narrative*.

**Limitation:** ye course ki mechanical approximation hai. HTF narrative aur "aankh se dekhna" poori tarah code mein nahi aata.
`bias: "htf"` setting ek simple HTF filter on karti hai. Backtest batayega ke wo madad karta hai ya nahi.

## Pehla asli backtest (1 Nov 2026, Yahoo futures data)

| Market | 1h (Jun 2024 – Oct 2026) | 15m (Aug – Oct 2026) |
|---|---|---|
| XAUUSD | 32 trades, win 19%, **−0.30R**/trade | 12 trades, −0.72R |
| NAS100 | 31 trades, win 23%, **−0.15R**/trade | 6 trades, −0.38R |
| US30 | 52 trades, win 21%, **−0.20R**/trade | 17 trades, −0.58R |

320 nearby settings bhi test ki gayi, sirf pehle 70% data par. 1h par ek bhi setting positive nahi aayi.
15m par jo settings positive lagi, wo baad ke 30% (unseen) data par negative ho gayi. Ye overfitting ki nishani hai.

**Matlab:** course ke Da Vinci rules jab mechanical tareeke se (bina discretion) lagaye jayein, to in markets par abhi koi edge nahi dikhta.
Is liye `alerts.requireEdge` default `true` hai: chart par setups dikhte rehte hain, lekin Telegram alert
sirf usi market/timeframe ka aata hai jiska backtest (aur unseen 30% data) positive ho, kam az kam 30 trades ke saath.
Scanner har run par backtest dobara karta hai, to agar kabhi edge ban gaya to alerts khud shuru ho jayenge.

## Setup (ek baar, ~15 minute)

### 1. GitHub Pages on karo
Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### 2. Telegram alerts
1. Telegram mein **@BotFather** kholo → `/newbot` → naam do → **token** copy karo.
2. Apne naye bot ko koi bhi message bhejo (misaal: "hi").
3. Browser mein kholo: `https://api.telegram.org/bot<TOKEN>/getUpdates` → `"chat":{"id": ...}` wala number = **chat id**.
4. Repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `TELEGRAM_BOT_TOKEN` = token
   - `TELEGRAM_CHAT_ID` = chat id

### 3. Pehli scan
Repo → **Actions → scan → Run workflow**. 1–2 minute baad app ka link khulega:
`https://babariqbaljaat1-art.github.io/davinci-/`

### 4. Phone par install
Link Chrome (Android) ya Safari (iPhone) mein kholo → **Add to Home Screen**.

## Settings (`config.json`)

| Setting | Matlab |
|---|---|
| `markets` | Kaun se charts. Yahoo symbols: Gold `GC=F`, Nasdaq `NQ=F`, Dow `YM=F`, EURUSD `EURUSD=X`, GBPUSD `GBPUSD=X`, BTC `BTC-USD` |
| `timeframes` | `5m`, `15m`, `30m`, `1h`, `4h` (5m/15m: sirf 60 din history, 1h/4h: 2 saal) |
| `params.minRR` | Kam se kam RR (default 3) |
| `params.entryMode` | `level` = swept level, `mid` = LB ka 50%, `body` = LB candle body |
| `params.pivotK` | Swing kitna bada ho (2 = chhote swings, 5 = bade) |
| `params.bias` | `none` ya `htf` (higher timeframe narrative filter) |
| `params.minRiskATR` | Stop kam se kam itne ATR door (tight stops noise mein lagte hain) |
| `params.tpMode` | `liquidity` = opposite lows/highs, `fixedR` = `fixedR` guna target (sirf jab liquidity us se aage ho), `nearest` = qareeb wala low |
| `alerts.requireEdge` | `true` = sirf tab alert jab backtest out-of-sample positive ho |

## Imaandari wali baatein

- **Data delay:** Yahoo ka futures data ~10 min delayed hota hai, aur GitHub schedule bhi kabhi kuch minute late chalta hai.
  15m/1h limit-order setups ke liye ye chal jata hai, scalping ke liye nahi.
- **Futures vs spot:** GC=F gold futures hai, TradingView ka OANDA XAUUSD spot. Structure same hota hai, price thoda alag.
  Spot gold chahiye to free [Twelve Data](https://twelvedata.com) key lo, secret `TWELVEDATA_API_KEY` add karo, aur
  market mein `"source": "twelvedata"` likho (free plan ~800 requests/din, is liye 1–2 markets rakho).
- **Koi strategy fail-proof nahi.** App ka "Backtest" section batata hai ke is market/timeframe par edge hai ya nahi.
  Negative ho to us market ke alerts par trade mat karo. Live paise se pehle kuch hafte demo par chalao.
- Repo public hai: code aur signals link wala koi bhi dekh sakta hai. Course ki videos repo mein nahi hain.

## Files

```
docs/engine/davinci.js   Da Vinci detector (browser + Node)
docs/engine/core.js      swings, ATR, trade simulation, stats, Monte Carlo
docs/engine/backtest.js  backtest report + robustness grid
docs/                    mobile app (index.html, app.js, chart.js, style.css, PWA files)
scanner/                 data fetch, scan run, Telegram
test/engine.test.js      tests (course diagram, no-look-ahead, random-walk check)
```

Local test bina internet: `DEMO=1 node scanner/run.js --dry` phir `npx http-server docs`.
Demo data synthetic hai, market data nahi.

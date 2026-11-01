DA VINCI SCANNER (PC APP)
=========================

Ye app aapke PC par chalti hai aur aapke markets ko har minute Da Vinci setup ke liye check karti hai.
Kuch install nahi karna. Windows 10/11 mein jo PowerShell aur Edge pehle se hain, wahi use hote hain.

PEHLI BAAR (1 minute)
---------------------
1. Ye poora "Da Vinci Scanner" folder kisi pakki jagah rakh do (misaal: Documents). Baad mein folder move na karna.
2. "Setup - pehli baar yahan double-click karo.bat" par double-click karo.
3. Desktop par "Da Vinci Scanner" icon ban jayega aur app khul jayegi.

ROZ KA ISTEMAAL
---------------
- Desktop icon par double-click: app ki window khulti hai (chart, live setups, backtest).
- Window band karne par bhi scanner tray mein chalta rehta hai (ghadi ke paas icon).
- Naya setup aaye to Windows notification + awaaz aati hai, aur agar Telegram set hai to phone par message.
- Tray icon par right-click -> "Exit" se scanner band hota hai.

SETTINGS (upar gear icon)
-------------------------
- Markets: XAUUSD, NAS100, US30, EURUSD, GBPUSD, BTCUSD
- Timeframes: 5m, 15m, 1h
- Rules: "Inter Equity full rulebook" (default, neeche dekho), "New York session + session levels +
  daily bias" (case studies wala tareeqa), "New York session only", ya "Classic" (har waqt)
- "Alert sirf tab jab backtest positive ho": ON (default) = sirf un markets par phone/Telegram alert jahan
  backtest aur unseen data dono positive hon. Har IE A/B setup par alert chahiye to isay OFF karo.
  App ki window mein setups har haal mein dikhte hain.
- "Windows start hote hi scanner chalao": PC on hote hi tray mein chal jaye
- Telegram: @BotFather se bot banao, token yahan daalo; bot ko "hi" bhejo, phir
  https://api.telegram.org/bot<TOKEN>/getUpdates kholo, "chat":{"id":...} wala number = chat id.
  "Test message bhejo" se check karo.

INTER EQUITY RULEBOOK (har setup par 20 rules)
-----------------------------------------------
Saari 155 videos (course, case studies, 39 webinars, 15 live calls) parh kar rules banaye gaye.
Har setup card par checklist hai (✓ theek, ! warning, ✗ toota) aur grade:
- A = saare rules theek: poora risk
- B = core rules theek, kuch warning: aadha risk
- X = koi hard rule toota: IE ye trade nahi leta, alert nahi aata ("IE rules ne skip kiye" mein wajah)
Rules: Da Vinci setup (sweep, displacement, buildup, trap, engineered liquidity, 1:3, with structure
nahi, liquidity from the left, LB ke paar liquidity, stop size), direction (4h HTF, aaj ka low/high liya,
HTF extreme), time (sirf New York 8-11, indices 9:30 ke baad, NFP/FOMC aur is hafte ki live red news se
pehle nahi, bank holiday nahi), day type (kal bara move, Asia+London dono bara move, kal FOMC/NFP).
Management: pehle target par 80% close + stop break-even, agla structural low/high liya to break-even,
baqi 20% agli liquidity tak, 4 pm NY (Friday 12) tak band. Din mein 2 trades / 2 losses ke baad band.
"Risk aur discipline" card: account aur risk % likho, har setup par lot size aa jata hai (contract size
broker se check karo). "Journal mein likho" se trade journal mein jaati hai, result aur feeling likho.
Live news: PC app is hafte ka ForexFactory calendar khud laati hai (internet chahiye).

IMAANDAARI WALI BAATEIN
-----------------------
- Data Yahoo Finance se aata hai: gold aur indices futures ~10 minute delayed hote hain, forex taqreeban live.
  Broker (OANDA wagaira) ki prices thodi alag hoti hain.
- 4 saal (Nov 2022 - Oct 2026) ke 5m data par 5 markets mein 192 settings test ki gayi (2.2 lakh trades,
  spread ke saath). Koi bhi setting pehle 70% aur baad ke 30% data, dono par positive nahi rahi.
- Phir poora Inter Equity rulebook (20 rules + IE management) bhi isi data par test hua:
  5m grade A+B 820 trades, win 14%, -0.17R/trade; sirf grade A -0.61R; 15m grade A+B -0.19R.
  Matlab: rules course jaise hain, lekin mechanical version ne 4 saal mein paisa nahi banaya.
  Marco khud kehta hai uska strike rate 35-50% hai, 70-80% wale claims ko wo jhoot kehta hai.
  Isi liye "Alert sirf tab jab backtest positive ho" shuru se ON hai. Demo par forward test karo.
- Backtest panel batata hai ke rules us market/timeframe par kaam kar rahe hain ya nahi. Negative ho to us par trade mat karo.
- Ye educational tool hai, financial advice nahi. Pehle demo account par test karo.

MASLA AAYE TO
-------------
- Log file: %APPDATA%\DaVinciScanner\app.log
- Settings: %APPDATA%\DaVinciScanner\config.json
- App na khule: tray mein icon dekho; ya PC restart karke icon dobara chalao.

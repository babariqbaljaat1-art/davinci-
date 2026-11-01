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
- Rules: "New York session + session levels + daily bias" (case studies wala tareeqa),
  "New York session only", ya "Classic" (har waqt)
- "Alert sirf tab jab backtest positive ho": ON rakhna behtar hai
- "Windows start hote hi scanner chalao": PC on hote hi tray mein chal jaye
- Telegram: @BotFather se bot banao, token yahan daalo; bot ko "hi" bhejo, phir
  https://api.telegram.org/bot<TOKEN>/getUpdates kholo, "chat":{"id":...} wala number = chat id.
  "Test message bhejo" se check karo.

IMAANDAARI WALI BAATEIN
-----------------------
- Data Yahoo Finance se aata hai: gold aur indices futures ~10 minute delayed hote hain, forex taqreeban live.
  Broker (OANDA wagaira) ki prices thodi alag hoti hain.
- 4 saal (Nov 2022 - Oct 2026) ke 5m data par 5 markets mein 192 settings test ki gayi (2.2 lakh trades,
  spread ke saath). Koi bhi setting pehle 70% aur baad ke 30% data, dono par positive nahi rahi.
  Isi liye "Alert sirf tab jab backtest positive ho" shuru se ON hai: alert tabhi aata hai jab
  us market par rules waqai kaam kar rahe hon. Is wajah se alerts kam (ya bilkul nahi) aa sakte hain.
- Backtest panel batata hai ke rules us market/timeframe par kaam kar rahe hain ya nahi. Negative ho to us par trade mat karo.
- Ye educational tool hai, financial advice nahi. Pehle demo account par test karo.

MASLA AAYE TO
-------------
- Log file: %APPDATA%\DaVinciScanner\app.log
- Settings: %APPDATA%\DaVinciScanner\config.json
- App na khule: tray mein icon dekho; ya PC restart karke icon dobara chalao.

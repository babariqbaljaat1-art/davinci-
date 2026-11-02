INTER EQUITY MARCO MODEL INDICATOR (TRADINGVIEW)
=================================================

TradingView par lagane ka tareeqa
---------------------------------
1. TradingView kholo, koi chart (misaal: OANDA:EURUSD ya OANDA:XAUUSD, 5m) kholo.
2. Neeche "Pine Editor" tab kholo.
3. Editor mein jo likha ho sab mita do, phir "Da Vinci indicator.pine" file (GitHub par pine/davinci.pine) ka poora text copy karke paste karo.
4. "Save" dabao (naam: IE Marco), phir "Add to chart".
   Agar TradingView koi laal error dikhaye to us error ki line aur text mujhe bhej do, main theek kar dunga.

Model (Settings -> Entry model)
-------------------------------
- "Marco: LB + liquidity taken" (default): Marco ki sab se zyada li gayi entry.
  "I will always enter as soon as the liquidity is taken."
  1. Left ki liquidity (ek purana high jo abhi tak liya nahi gaya) ek naya high le leta hai:
     wo naya high LIQUIDITY BLOCK (LB) hai ("a high that has swept a previous high"), phir displacement.
  2. LB se neeche ka move retail ke liye BOS hai: "sellers induced".
  3. Price LB ke andar wapas aa kar ek lower high banata hai: early sellers ke stops us ke upar ($$$).
  4. "As soon as this high is stabbed, you are pressing sell": wo high toot-te hi SELL (sellers trapped),
     stop LB ke upar, target wo low jo sell-off ne chhoda (kam se kam 1:3).
  Buy bilkul ulta (mirror).
- "Marco: 4-candle sniper": candle 2 candle 1 ka high spike karke wapas neeche close (bari wick = LB),
  candle 3 neeche high chhodti hai, candle 4 candle 3 ka high leti hai -> candle 3 ke high par sell,
  stop candle 2 ke upar, target left ki intact liquidity. Candle 4 sirf respect kare to trade nahi.
- "Marco: both": dono.
- "Da Vinci: back to the swept level": purana model (LB -> BOS + lower high -> engineered low ->
  swept level par wapas limit).

Chart par Marco ke marks
------------------------
- Peeli line + "$$$": sirf wo high/low jise baad wale high/low ne respect kiya (paas aa kar toda nahi):
  wahan stops pare hain = liquidity. Line wahan khatam hoti hai jahan liquidity le li gayi (dotted).
- Daayein: PDH/PDL, Asia H/L, London H/L ("$$$" = abhi baqi, "taken" = le li gayi). Is se dekho
  "who is induced?": high liya gaya to buyers induced -> sell dhoondo.
- Dashed grey line: left ki liquidity jo LB ne li.
- Neela box "LB": liquidity block, LB extreme se inducement level tak, right taraf drag.
- "sellers induced" / "buyers induced": LB se move jo retail ko andar laya (BOS for retail).
- "$$$" inducement high/low par: early traders ke stops. "sellers trapped" / "buyers trapped": entry.
- Lal box: stop (LB ke paar), hara box: "$$$ target", label par SELL/BUY, IE grade aur RR.
- Label par mouse rakho (phone par tap): IE checklist ki warnings.
- Upar daayein table: is chart ki history par trades, win rate aur avg R.

Inter Equity grade (A / B / X)
------------------------------
Har entry ko course ke rules par check kiya jata hai (saari 155 videos se):
- A = saare rules theek: poora risk
- B = core rules theek, kuch warning (HTF clear nahi, aaj ka high/low abhi nahi liya, chhota
      sweep, stop bara, HTF extreme, kal FOMC/NFP, Asia+London dono bara move): aadha risk
- X = koi hard rule toota: chart par nahi aata, alert nahi aata
      (bank holiday, FOMC din, NFP 8:30 se pehle, kal bara move, 4h HTF ulti direction, stop bohot bara)
- Indices (US30, NAS100 wagaira) 9:30 New York stock open ke baad hi.
- Din mein 2 trades / 2 losses ke baad us din aur entry nahi.
- "Daily bias, who is induced": sell sirf jab pichle din ka high aakhri baar liya gaya ho, buy jab low.
Note: CPI aur doosri red news TradingView ko pata nahi; ForexFactory par khud dekho.
Trade management (T1 par 80% close, stop break-even, baqi runner) label ke tooltip mein likha hai;
table ke stats simple hain (poora size target ya stop tak).

Alert (phone par TradingView app se)
------------------------------------
1. Chart par "Alert" (ghadi icon) dabao.
2. Condition: "IE Marco" -> "Any alert() function call".
3. Notifications mein "Notify on app" tick karo. Create.
Jab bhi entry arm hogi, phone par entry/SL/TP ke saath alert aayega.

Settings
--------
- Session: New York subah 8-11 (Marco: "I'm a New York trader"). Session hamesha New York time mein hai;
  Pakistan time mein taqreeban shaam 6-9 baje (sardiyon mein), garmiyon mein 5-8 baje.
  Session khatam hote hi jo order fill nahi hua wo cancel.
- Stop: LB ke paar 0.5 ATR, kam se kam 1 ATR (tight stops par 4 saal ke data mein spread/wick se stop
  bohot lagta tha).
- "Inducement must be inside the LB": Marco "trapped inside the LB" kehta hai; off karo to LB ke neeche
  wale highs par bhi entry.

Sach (4 saal, 5 markets ka backtest, spread ke saath): koi version mustaqil profit nahi deta
(Marco model 5m: taqreeban 20% win, -0.10R per trade). Marco khud 35-50% strike rate batata hai.
Ye educational tool hai, financial advice nahi. Table mein negative R ho to us chart par is par trade mat karo.

# Marco's trades — where he actually takes entries (course case studies, studies, webinars, YouTube)

Every trade he/the team actually took in the 56 case-study/study videos (sections 5-8 of study-notes.md),
grouped by WHAT TRIGGERED THE ENTRY. (count = number of entries described; some videos have several)

| Entry trigger | Count | Examples |
|---|---|---|
| A. "As soon as the liquidity is taken" inside an LB that supports it: a low/high from the left, the last low before the LB, an inducement low/high, a session low (Asia/London/PDL) or the 9 am low gets stabbed while price trades in the LB -> enter right there, stop beyond the LB, target the opposite (engineered) liquidity | ~32 | 2023 #2, #10; CS1.0 #3, #4, #10, #11, #13, #14, #15; CS2.0 #1, #2, #3, #4, #5, #6, #7, #9, #10, #11, #12; S1, S3, S4, S7, S8, S10, S12, S13, S14, S17, S18; webinars Jan 18 25 gold, Feb 28 25 YM |
| B. Lower-timeframe LB (confirmation): after the HTF liquidity is taken, wait for a 5m/1m LB (sweep + displacement) and enter at it / on its retest | ~22 | 2023 #1, #3, #4, #5, #7, #8, #9; CS1.0 #1, #5, #6, #7, #8, #12; CS2.0 #8, #13; S2, S5, S9, S11, S15 |
| C. Candle-close entry (close back beyond the previous candle after the sweep, then retest) | ~5 | 2023 #1, #4; CS2.0 #7 (#2), #9 (B); only "when I have a time confluence to a T" (YouTube x-7H1E4ToC8) |
| D. Engineered (respected, not swept) liquidity | 1 | S16 ("not wrong, but not as probable") |

What is common to (almost) all of them:
1. Liquidity on the LEFT is taken first (a high/low that was respected = stops resting there), never "predicting".
2. The entry sits at a liquidity block (a high/low that just swept liquidity + displacement); "no liquidity block, no stop loss".
3. Entry = the moment the inducement point (the last low/high before the LB extreme, the "candle 3 low") is stabbed — "as soon as the low is taken I'm entering, as long as it's 3x my risk" (S4).
4. Stop beyond the LB extreme (+ spread / small breathing room).
5. Target = opposite engineered liquidity (equal/respected highs, inducement high, PDH, weekly high); partial at the first structure, BE / roll the stop once the next high is taken.
6. Time: New York, mostly 8:00-10:30 (9-10 trap hour, 10 am candle close); some London open, a few Asia limits at reduced risk.
7. Markets in the course: EURUSD most, then gold, then NAS100/US30.

YouTube confirms it (research/youtube/notes.md):
- "I will always enter as soon as the liquidity is taken." (Full Strategy webinar)
- "As soon as price stabs out this low, anywhere below this black line is a valid buy. Why? LB'll be below." (10,000 Hours)
- 4-candle "sniper" model: c2 sweeps c1 low (LB), c3 prints a low, c4 takes c3 low -> buy at c3 low, stop below c2 low. ("how we actually take all of our entries")
- Entry from the left vs confirmation entry ("exactly how we enter the market on a daily basis").

=> The detector the software should use as its MAIN model: "liquidity taken into the LB" (A), with the 4-candle model as the
   tight version, and the LTF-LB confirmation (B) as the second entry. The Da Vinci (LB -> buildup -> return to the swept level)
   is one special case of A and was entering too deep (at the swept level) compared with what he does.

Second YouTube pass (research/youtube/notes.md) confirms the same trigger in his own words:
- "As soon as we stab out this high, entries are taken just like this ... I don't need the top of the imbalance or the very
  extreme ... I just want to enter as soon as that liquidity is taken. My stop loss is going to go above my liquidity block
  to the left-hand side." (Liquidity Inducement Masterclass Ep. 3)
- New rule taken into the software: "As soon as we take out this low and this low, sells need to be off your cards 100%"
  (Trade Liquidity Properly) -> target taken before the entry = that LB is finished.

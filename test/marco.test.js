// Marco's model: "I will always enter as soon as the liquidity is taken" (LB + inducement taken) and the 4-candle model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findMarcoSetups, liquidityLevels } from '../docs/engine/marco.js';
import { findSetups } from '../docs/engine/davinci.js';
import { mulberry32 } from '../docs/engine/core.js';

// candles that walk through price waypoints, `bars` candles per leg
function path(points, bars = 8, seed = 1, t0 = 1_700_000_000, tf = 900) {
  const rnd = mulberry32(seed);
  const out = [];
  let t = t0, prev = points[0];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    for (let j = 1; j <= bars; j++) {
      const c = a + ((b - a) * j) / bars;
      const o = prev, wig = Math.abs(b - a) / bars * 0.3;
      out.push({ t, o, c, h: Math.max(o, c) + wig * rnd(), l: Math.min(o, c) - wig * rnd() });
      prev = c; t += tf;
    }
  }
  return out;
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) < tol, `${what}: expected ~${b}, got ${a}`);

// high 110 left intact -> 113 runs it (LB) and sells off to 100 -> pullback prints an inducement high
// at 111 inside the LB -> that high is stabbed (sellers trapped) -> sell, target the 100 low
const BEAR = [100, 110, 104, 113, 100, 111, 106, 111.6, 95];

test('Marco: sells as soon as the inducement high inside the LB is taken', () => {
  const s = findMarcoSetups(path(BEAR), { mode: 'pivot' }).find(x => x.dir === 'short' && x.result);
  assert.ok(s, 'expected an armed short');
  assert.equal(s.model, 'pivot');
  near(s.lb.top, 113, 0.6, 'LB extreme');
  near(s.swept.price, 110, 0.6, 'liquidity taken from the left');
  near(s.entry, 111, 0.6, 'entry at the inducement high');
  assert.ok(s.sl > s.lb.top, 'stop beyond the LB');
  near(s.tp, 100, 0.6, 'target = the low the sell-off left');
  assert.ok(s.rr >= 3);
  assert.equal(s.result.status, 'win');
});

test('Marco: mirror gives the buy ("buyers trapped" below the inducement low)', () => {
  const s = findMarcoSetups(path(BEAR.map(x => 200 - x)), { mode: 'pivot' }).find(x => x.dir === 'long' && x.result);
  assert.ok(s, 'expected an armed long');
  near(s.entry, 89, 0.6, 'entry');
  assert.ok(s.sl < s.lb.top, 'stop below the LB');
  assert.equal(s.result.status, 'win');
});

test('Marco: an inducement high below the LB zone is not "inside the LB"', () => {
  const c = path([100, 110, 104, 113, 85, 107, 100, 107.6, 80]);
  assert.equal(findMarcoSetups(c, { mode: 'pivot' }).filter(x => x.dir === 'short' && x.result && x.lb.top > 112).length, 0);
  const loose = findMarcoSetups(c, { mode: 'pivot', insideLB: false }).find(x => x.dir === 'short' && x.result && x.lb.top > 112);
  assert.ok(loose, 'without the inside-LB rule it would trade');
  near(loose.entry, 107, 0.6, 'entry');
});

test('Marco: LB still holding at the last bar = forming (waiting for the inducement)', () => {
  const s = findMarcoSetups(path([100, 110, 104, 113, 100], 13), { mode: 'pivot' }).find(x => x.dir === 'short' && x.status === 'forming');
  assert.ok(s, 'expected a forming short');
  assert.equal(s.tp, null);
  assert.equal(s.armedAt, null);
  near(s.lb.top, 113, 0.6, 'LB extreme');
});

// 4-candle model: c2 spikes c1's high and closes back below (big wick), c3 leaves a lower high,
// c4 takes c3's high -> sell at c3 high, stop above c2, target the liquidity low on the left (98)
function fourCandle(c4High) {
  const c = path([100, 104, 98, 103], 14);
  let t = c.at(-1).t;
  const add = (o, h, l, cl) => { t += 900; c.push({ t, o, h, l, c: cl }); };
  add(102.6, 103.2, 101.8, 102.5);   // c1
  add(102.5, 104.0, 102.2, 102.4);   // c2: LB, spikes the high, closes back below c1 high
  add(102.4, 103.0, 101.9, 102.0);   // c3
  add(102.0, c4High, 101.5, 101.6);  // c4
  let p = 101.6;
  for (let j = 0; j < 10; j++) { const q = p - 0.5; add(p, p + 0.05, q - 0.05, q); p = q; }
  return c;
}

test('4-candle: candle 4 takes candle 3 high -> sell, stop above candle 2, liquidity target', () => {
  const c = fourCandle(103.1);
  const s = findMarcoSetups(c, { mode: 'candle4' }).find(x => x.dir === 'short' && x.lb.top === 104);
  assert.ok(s, 'expected the 4-candle short');
  assert.equal(s.model, 'candle4');
  assert.equal(s.entry, 103.0);
  assert.ok(s.sl > 104);
  near(s.tp, 98, 0.4, 'target = intact low on the left');
  assert.equal(c[s.armedAt].h, 103.1, 'armed on candle 4');
  assert.equal(s.result.status, 'win');
});

test('4-candle: "candle four just respects it ... are we selling that? No" - no fill without the stab', () => {
  const s = findMarcoSetups(fourCandle(102.9), { mode: 'candle4' }).find(x => x.dir === 'short' && x.lb.top === 104);
  assert.ok(s, 'pattern is found');
  assert.equal(s.result.status, 'expired');
});

test('findSetups delegates to the Marco model and keeps the app fields', () => {
  const all = findSetups(path(BEAR), { model: 'marco', minRR: 3, marcoSlBufferATR: 0.1 });
  const s = all.find(x => x.dir === 'short' && x.result);
  assert.ok(s);
  assert.equal(s.model, 'pivot');
  assert.ok(s.id.startsWith('short-pivot-'));
  assert.ok(Array.isArray(s.buildup) && s.buildup.length === 1, 'inducement point kept for the chart');
  assert.ok(s.mgmt && 'beAt' in s.mgmt && 't2' in s.mgmt);
});

test('liquidity marks: only a high that a later high respected is liquidity, the ray ends where it is taken', () => {
  // high 110, pullback, a lower high at 109.8 respects it (equal-ish highs), then price takes 110
  const c = path([100, 110, 105, 109.8, 104, 112, 106], 8);
  const L = liquidityLevels(c, { k: 3, tolATR: 1 }).filter(x => x.high);
  const lvl = L.find(x => Math.abs(x.price - 110) < 0.6);
  assert.ok(lvl, 'the 110 high is marked as liquidity');
  assert.ok(lvl.respAt > lvl.i, 'respected by a later high');
  assert.equal(lvl.taken, true, 'taken by the run to 112');
  assert.ok(!L.some(x => Math.abs(x.price - 112) < 0.6), 'an unrespected high is not liquidity');
});

// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { findSetups, tradesFromSetups } from '../docs/engine/davinci.js';
import { pivots, stats, monteCarlo, mulberry32 } from '../docs/engine/core.js';

// Build candles that walk through price waypoints (a zigzag), `bars` candles per leg.
function path(points, bars = 8, seed = 1, t0 = 1_700_000_000, tf = 900) {
  const rnd = mulberry32(seed);
  const out = [];
  let t = t0, prev = points[0];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    for (let j = 1; j <= bars; j++) {
      const c = a + ((b - a) * j) / bars;
      const o = prev;
      const wig = Math.abs(b - a) / bars * 0.3;
      out.push({ t, o, c, h: Math.max(o, c) + wig * rnd(), l: Math.min(o, c) - wig * rnd() });
      prev = c; t += tf;
    }
  }
  return out;
}

// The bearish diagram from the Da Vinci lesson:
// highs left intact (110) -> swept (113) + displacement -> BOS below 104 ->
// lower highs (buildup) -> respected low -> rally into LB -> sell to the lows.
const BEAR = [100, 110, 104, 113, 96, 106, 100, 105, 98, 110.6, 94, 92];

test('detects the bearish Da Vinci setup from the lesson diagram', () => {
  const c = path(BEAR);
  const setups = findSetups(c, { minRR: 2 });
  const shorts = setups.filter(s => s.dir === 'short' && s.result);
  assert.ok(shorts.length >= 1, 'expected at least one armed short');
  const s = shorts[0];
  assert.ok(Math.abs(s.lb.top - 113) < 0.6, `LB top near 113, got ${s.lb.top}`);
  assert.ok(Math.abs(s.entry - 110) < 0.6, `entry at swept level ~110, got ${s.entry}`);
  assert.ok(s.sl > s.lb.top, 'stop above the LB');
  assert.ok(s.tp < 97 && s.tp > 95, `target at the lows ~96, got ${s.tp}`);
  assert.ok(s.rr >= 2, `RR ${s.rr}`);
  assert.equal(s.result.status, 'win');
});

test('mirror: detects the bullish version', () => {
  const c = path(BEAR.map(x => 200 - x));
  const longs = findSetups(c, { minRR: 2 }).filter(s => s.dir === 'long' && s.result);
  assert.ok(longs.length >= 1);
  const s = longs[0];
  assert.ok(Math.abs(s.entry - 90) < 0.6, `entry ~90, got ${s.entry}`);
  assert.ok(s.sl < s.lb.top, 'stop below the LB (top holds the extreme for longs)');
  assert.equal(s.result.status, 'win');
});

test('no trade when the lows are taken before price returns to the LB', () => {
  // after the buildup price breaks the lows first (liquidity already taken)
  const c = path([100, 110, 104, 113, 96, 106, 100, 105, 98, 90, 111, 95]);
  const wins = findSetups(c, { minRR: 2 }).filter(s => s.dir === 'short' && s.result?.status === 'win' && s.lb.top > 112);
  assert.equal(wins.length, 0);
});

test('no trade without a buildup (straight return into the LB)', () => {
  const c = path([100, 110, 104, 113, 96, 111, 94]);
  const armed = findSetups(c, { minRR: 2 }).filter(s => s.dir === 'short' && s.result && s.lb.top > 112);
  assert.equal(armed.length, 0);
});

test('stop is hit when price runs through the LB', () => {
  const c = path([100, 110, 104, 113, 96, 106, 100, 105, 98, 118, 120]);
  const s = findSetups(c, { minRR: 2 }).find(x => x.dir === 'short' && x.result && x.lb.top > 112);
  assert.ok(s, 'armed setup expected');
  assert.equal(s.result.status, 'loss');
});

test('no look-ahead: setups found on a prefix are identical when more data arrives', () => {
  const rnd = mulberry32(7);
  const c = [];
  let p = 100;
  for (let i = 0; i < 3000; i++) {
    const o = p; p += (rnd() - 0.5) * 2; const h = Math.max(o, p) + rnd(); const l = Math.min(o, p) - rnd();
    c.push({ t: 1_700_000_000 + i * 900, o, h, l, c: p });
  }
  const cut = 2000;
  const early = findSetups(c.slice(0, cut)).filter(s => s.armedAt && s.armedAt < cut - 1);
  const late = findSetups(c);
  for (const s of early) {
    const m = late.find(x => x.id === s.id);
    assert.ok(m, `setup ${s.id} disappeared with more data`);
    assert.equal(m.entry, s.entry); assert.equal(m.sl, s.sl); assert.equal(m.tp, s.tp); assert.equal(m.armedAt, s.armedAt);
  }
});

test('random walk: runs fast and stats are sane', () => {
  const rnd = mulberry32(3);
  const c = [];
  let p = 1000;
  for (let i = 0; i < 12000; i++) {
    const o = p; p *= 1 + (rnd() - 0.5) * 0.004; const h = Math.max(o, p) * (1 + rnd() * 0.001); const l = Math.min(o, p) * (1 - rnd() * 0.001);
    c.push({ t: 1_700_000_000 + i * 3600, o, h, l, c: p });
  }
  const t0 = Date.now();
  const setups = findSetups(c);
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, `too slow: ${ms}ms`);
  const trades = tradesFromSetups(setups);
  const st = stats(trades);
  assert.ok(st.trades >= 0 && st.winRate >= 0 && st.winRate <= 1);
  const mc = monteCarlo(trades.filter(t => t.result.status !== 'open').map(t => t.result.r), { runs: 2000 });
  if (mc) assert.ok(mc.totalR.p5 <= mc.totalR.p95);
  console.log(`random walk 12k bars: ${setups.length} setups, ${st.trades} trades, win ${(st.winRate * 100).toFixed(0)}%, exp ${st.expectancyR.toFixed(2)}R, ${ms}ms`);
});

test('pivots confirm k bars later', () => {
  const c = path([100, 110, 100], 6);
  const { highs } = pivots(c, 3);
  assert.equal(highs.length, 1);
  assert.equal(highs[0].confirmedAt, highs[0].i + 3);
});

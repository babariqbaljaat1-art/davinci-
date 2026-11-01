// Small dependency-free candlestick chart with Da Vinci overlays.
// Touch: drag to pan, pinch to zoom, tap for crosshair. Desktop: drag, wheel.

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Chart {
  constructor(canvas, { onHover } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.candles = [];
    this.setups = [];
    this.focusId = null;
    this.spacing = 8;        // px per bar
    this.offset = 0;         // bars scrolled back into history (negative = empty space right of the last bar)
    this.hover = null;
    this.onHover = onHover;
    this.digits = 2;
    this.tf = 900;
    this._bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setData({ candles, setups, digits, tfSeconds }) {
    const first = !this.candles.length;
    this.candles = candles.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
    this.setups = setups || [];
    this.digits = digits ?? 2;
    this.tf = tfSeconds || 900;
    if (first) this.fit();
    this.draw();
  }

  focus(id) {
    this.focusId = id;
    const s = this.setups.find(x => x.id === id);
    if (s) {
      // put the liquidity block ~30% from the left edge
      const i = this.indexOf(s.lb.t);
      this.offset = this.candles.length - 1 - i + 0.5 - this.visibleBars() * 0.7;
      this.clampOffset();
    }
    this.draw();
  }

  fit() {
    const w = this.plotW();
    this.spacing = Math.max(3, Math.min(14, w / 140));
    this.offset = -6;
    this.draw();
  }

  pan(bars) {
    this.offset += bars;
    this.clampOffset();
    this.draw();
  }

  zoom(f, anchorX) {
    const w = this.plotW();
    const ax = anchorX ?? w * 0.75;
    const barAtAnchor = this.xToBar(ax);
    this.spacing = Math.max(1.5, Math.min(40, this.spacing * f));
    // keep the bar under the anchor in place
    const last = this.candles.length - 1;
    this.offset = last + 0.5 - (w - ax) / this.spacing - barAtAnchor;
    this.clampOffset();
    this.draw();
  }

  // ---------- geometry ----------
  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.max(1, Math.round(r.width * this.dpr));
    this.cv.height = Math.max(1, Math.round(r.height * this.dpr));
    this.W = r.width; this.H = r.height;
    this.draw();
  }
  plotW() { return Math.max(50, (this.W || 300) - 64); }
  plotH() { return Math.max(50, (this.H || 300) - 22); }
  visibleBars() { return this.plotW() / this.spacing; }
  barToX(i) { const last = this.candles.length - 1; return this.plotW() - (last - i - this.offset + 0.5) * this.spacing; }
  xToBar(x) { const last = this.candles.length - 1; return last - this.offset + 0.5 - (this.plotW() - x) / this.spacing; }
  indexOf(t) {
    const c = this.candles;
    if (!c.length) return 0;
    if (t >= c[c.length - 1].t) return c.length - 1 + (t - c[c.length - 1].t) / this.tf;
    let lo = 0, hi = c.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m].t < t) lo = m + 1; else hi = m; }
    return lo;
  }
  timeToX(t) { return this.barToX(this.indexOf(t)); }
  priceToY(p) { return this.top + (this.max - p) / (this.max - this.min) * (this.plotH() - this.top - 6); }
  yToPrice(y) { return this.max - (y - this.top) / (this.plotH() - this.top - 6) * (this.max - this.min); }
  clampOffset() {
    const n = this.candles.length;
    this.offset = Math.max(-this.visibleBars() * 0.6, Math.min(this.offset, n - 5));
  }

  // ---------- input ----------
  _bind() {
    const cv = this.cv;
    const pts = new Map();
    let last = null, pinch = null, moved = false;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      moved = false;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.spacing, cx: (a.x + b.x) / 2 };
      } else last = { x: e.offsetX, y: e.offsetY, off: this.offset };
    });
    cv.addEventListener('pointermove', e => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom((pinch.s * d / pinch.d) / this.spacing, pinch.cx);
        moved = true;
        return;
      }
      if (last && pts.size === 1) {
        const dx = e.offsetX - last.x;
        if (Math.abs(dx) > 3) moved = true;
        if (moved) {
          this.offset = last.off + dx / this.spacing;
          this.clampOffset();
          this.hover = null;
          this.draw();
          return;
        }
      }
      if (e.pointerType === 'mouse') this._setHover(e.offsetX, e.offsetY);
    });
    const end = e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) {
        if (!moved && e.type === 'pointerup') this._setHover(e.offsetX, e.offsetY);
        last = null;
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { this.hover = null; this.draw(); this.onHover?.(null); } });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { this.offset -= e.deltaX / this.spacing; this.clampOffset(); this.draw(); }
      else this.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.offsetX);
    }, { passive: false });
  }
  _setHover(x, y) {
    if (x > this.plotW() || y > this.plotH()) { this.hover = null; this.onHover?.(null); this.draw(); return; }
    const i = Math.round(this.xToBar(x) - 0.5);
    const c = this.candles[Math.max(0, Math.min(this.candles.length - 1, i))];
    this.hover = { x, y, i };
    this.onHover?.(c);
    this.draw();
  }

  // ---------- drawing ----------
  draw() {
    if (!this.ctx || !this.W) return;
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const c = this.candles;
    if (!c.length) return;
    const col = {
      grid: css('--chart-grid'), text: css('--chart-text'), up: css('--up'), down: css('--down'),
      lb: css('--lb'), lbLine: css('--lb-line'), risk: css('--risk'), reward: css('--reward'),
      target: css('--target'), accent: css('--accent'), bg: css('--surface'), muted: css('--muted'),
    };
    const W = this.plotW(), H = this.plotH();
    const iFrom = Math.max(0, Math.floor(this.xToBar(0)) - 1);
    const iTo = Math.min(c.length - 1, Math.ceil(this.xToBar(W)) + 1);
    let max = -Infinity, min = Infinity;
    for (let i = iFrom; i <= iTo; i++) { max = Math.max(max, c[i].h); min = Math.min(min, c[i].l); }
    if (!Number.isFinite(max)) { max = c[c.length - 1].h; min = c[c.length - 1].l; }
    const focus = this.setups.find(s => s.id === this.focusId);
    if (focus) for (const v of [focus.sl, focus.tp, focus.lb.top, focus.entry]) if (v != null) { max = Math.max(max, v); min = Math.min(min, v); }
    const pad = (max - min) * 0.08 || 1;
    this.max = max + pad; this.min = min - pad; this.top = 8;

    // grid + price axis
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';
    const step = niceStep((this.max - this.min) / 6);
    ctx.strokeStyle = col.grid; ctx.lineWidth = 1;
    ctx.fillStyle = col.text;
    for (let p = Math.ceil(this.min / step) * step; p <= this.max; p += step) {
      const y = Math.round(this.priceToY(p)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillText(fmt(p, this.digits), W + 6, y);
    }
    // time axis
    ctx.textBaseline = 'top';
    const every = Math.max(1, Math.round(90 / this.spacing));
    for (let i = iFrom - (iFrom % every); i <= iTo; i += every) {
      if (i < 0) continue;
      const x = Math.round(this.barToX(i)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      if (x > 22 && x < W - 22) ctx.fillText(timeLabel(c[i].t, this.tf), x - 18, H + 5);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    // overlays under candles
    for (const s of this.setups) this._drawSetup(s, col, s.id === this.focusId, false);

    // candles
    const bw = Math.max(1, Math.min(this.spacing * 0.7, this.spacing - 1));
    for (let i = iFrom; i <= iTo; i++) {
      const k = c[i], x = this.barToX(i);
      const up = k.c >= k.o;
      ctx.strokeStyle = ctx.fillStyle = up ? col.up : col.down;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, this.priceToY(k.h)); ctx.lineTo(Math.round(x) + 0.5, this.priceToY(k.l)); ctx.stroke();
      const y1 = this.priceToY(Math.max(k.o, k.c)), y2 = this.priceToY(Math.min(k.o, k.c));
      ctx.fillRect(Math.round(x - bw / 2), y1, Math.max(1, Math.round(bw)), Math.max(1, y2 - y1));
    }

    // labels on top of candles
    for (const s of this.setups) this._drawSetup(s, col, s.id === this.focusId, true);

    // last price line
    const lastC = c[c.length - 1];
    const ly = Math.round(this.priceToY(lastC.c)) + 0.5;
    ctx.setLineDash([2, 3]); ctx.strokeStyle = lastC.c >= lastC.o ? col.up : col.down;
    ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke(); ctx.setLineDash([]);

    // crosshair
    if (this.hover) {
      ctx.strokeStyle = col.muted; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(this.hover.x, 0); ctx.lineTo(this.hover.x, H); ctx.moveTo(0, this.hover.y); ctx.lineTo(W, this.hover.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // axis tags (outside the clip)
    tag(ctx, W, ly, fmt(lastC.c, this.digits), lastC.c >= lastC.o ? col.up : col.down, '#fff');
    if (this.hover && this.hover.y < H) tag(ctx, W, this.hover.y, fmt(this.yToPrice(this.hover.y), this.digits), col.muted, col.bg);
  }

  _drawSetup(s, col, focused, labelsPass) {
    const ctx = this.ctx;
    const active = s.status === 'pending' || s.status === 'open';
    const forming = s.status === 'forming';
    // with a focused setup, only draw it plus other active trades
    if (this.focusId && !focused && !active) return;
    const alpha = focused || active ? 1 : forming ? 0.5 : 0.45;
    const lastT = this.candles[this.candles.length - 1].t;
    const endT = s.exitT || (active ? lastT + this.tf * 12 : forming ? lastT + this.tf * 3 : (s.armedT || s.lb.t) + this.tf * 40);
    const x0 = this.timeToX(s.lb.t), x1 = this.timeToX(endT);
    if (x1 < 0 || x0 > this.plotW()) return;
    ctx.globalAlpha = alpha;

    const yTop = this.priceToY(s.lb.top), yBot = this.priceToY(s.lb.bottom);
    if (!labelsPass) {
      // liquidity run: dashed line from the swept high/low to the LB
      if (s.swept) {
        const xs = this.timeToX(s.swept.t), y = this.priceToY(s.swept.price);
        ctx.strokeStyle = col.muted; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xs, y); ctx.lineTo(x0, y); ctx.stroke(); ctx.setLineDash([]);
      }
      // liquidity block zone
      const lbEnd = s.fillT ? this.timeToX(s.fillT) : x1;
      ctx.fillStyle = col.lb;
      ctx.fillRect(x0 - this.spacing / 2, Math.min(yTop, yBot), lbEnd - x0 + this.spacing / 2, Math.abs(yBot - yTop));
      ctx.strokeStyle = col.lbLine; ctx.lineWidth = 1;
      ctx.strokeRect(x0 - this.spacing / 2 + 0.5, Math.min(yTop, yBot) + 0.5, lbEnd - x0 + this.spacing / 2, Math.abs(yBot - yTop));
      // opposing liquidity (target)
      if (s.extreme) {
        const y = this.priceToY(s.extreme.price), xe = this.timeToX(s.extreme.t);
        ctx.strokeStyle = col.target; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(xe, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
      }
      // position tool
      if (s.tp != null && (s.armedT || s.fillT)) {
        const xa = this.timeToX(s.fillT || s.armedT), ye = this.priceToY(s.entry);
        ctx.fillStyle = col.risk; ctx.fillRect(xa, Math.min(ye, this.priceToY(s.sl)), x1 - xa, Math.abs(this.priceToY(s.sl) - ye));
        ctx.fillStyle = col.reward; ctx.fillRect(xa, Math.min(ye, this.priceToY(s.tp)), x1 - xa, Math.abs(this.priceToY(s.tp) - ye));
        ctx.strokeStyle = col.text; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xa, ye); ctx.lineTo(x1, ye); ctx.stroke();
      }
    } else {
      ctx.font = '600 10px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
      const up = s.dir === 'long';
      label(ctx, 'LB', x0 + 2, up ? Math.max(yTop, yBot) + 13 : Math.min(yTop, yBot) - 2, col.lbLine);
      for (const b of s.buildup || []) {
        const x = this.timeToX(b.t), y = this.priceToY(b.price);
        ctx.fillStyle = col.accent; ctx.beginPath(); ctx.arc(x, y + (up ? 7 : -7), 2.5, 0, 7); ctx.fill();
      }
      if (s.bos) label(ctx, 'BOS', this.timeToX(s.bos.t) + 2, this.priceToY(s.bos.price) + (up ? -2 : 12), col.muted);
      if (s.respected) label(ctx, 'liq', this.timeToX(s.respected.t) - 6, this.priceToY(s.respected.price) + (up ? -4 : 13), col.target);
      if (s.tp != null && (s.armedT || s.fillT)) {
        const xa = this.timeToX(s.fillT || s.armedT);
        const txt = `${s.dir === 'short' ? 'SELL' : 'BUY'}  RR 1:${(s.rr ?? 0).toFixed(1)}${s.r != null && ['win', 'loss'].includes(s.status) ? `  ${s.r > 0 ? '+' : ''}${s.r}R` : ''}`;
        pill(ctx, txt, xa + 3, this.priceToY(s.entry), s.dir === 'short' ? col.down : col.up);
      }
    }
    ctx.globalAlpha = 1;
  }
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
export function fmt(v, d) { return v == null ? '–' : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
function timeLabel(t, tf) {
  const d = new Date(t * 1000);
  if (tf >= 86400) return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.getHours() === 0 && d.getMinutes() === 0 ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : hm;
}
function label(ctx, txt, x, y, color) { ctx.fillStyle = color; ctx.fillText(txt, x, y); }
function pill(ctx, txt, x, y, color) {
  ctx.font = '600 10px system-ui, sans-serif';
  const w = ctx.measureText(txt).width + 10;
  ctx.fillStyle = color; roundRect(ctx, x, y - 8, w, 16, 4); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + 5, y + 0.5);
}
function tag(ctx, W, y, txt, bg, fg) {
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = bg; roundRect(ctx, W + 1, y - 8, 62, 16, 3); ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(txt, W + 5, y + 0.5);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Tiny equity-curve sparkline. */
export function drawEquity(canvas, points) {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  if (!points.length) return;
  const ys = [0, ...points.map(p => p.eq)];
  const max = Math.max(...ys), min = Math.min(...ys), pad = (max - min) * 0.1 || 1;
  const X = i => (i / (ys.length - 1 || 1)) * (r.width - 4) + 2;
  const Y = v => r.height - 4 - ((v - (min - pad)) / (max - min + 2 * pad)) * (r.height - 8);
  ctx.strokeStyle = css('--chart-grid'); ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(r.width, Y(0)); ctx.stroke();
  ctx.strokeStyle = ys[ys.length - 1] >= 0 ? css('--up') : css('--down'); ctx.lineWidth = 1.5;
  ctx.beginPath(); ys.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
}

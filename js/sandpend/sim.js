/* Sand Pendulum: the sand, a long strip seen from above.
 *
 * A W x H heightmap (heights in grid pixels, 0 = level) holds the window of
 * sand around the ball. World x grows as the ball rolls forward; when the
 * window falls behind, the grid is shifted left and fresh sand fills in on
 * the right (`origin` is the world x of grid column 0). The ball carves a
 * groove the shape of its underside, swept from its last position so the
 * groove is smooth, and pushes the sand it moves into ridges at its sides,
 * never back into the groove: volume is conserved. Changes grow a dirty
 * rectangle so only that part is reshaded. Knows nothing about drawing.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});

  class SandStrip {
    constructor(W, H, seed) {
      this.W = W || 1024;
      this.H = H || 384;
      this.h = new Float32Array(this.W * this.H);
      this.origin = 0;
      this.wbuf = new Float32Array(4096);
      let s = ((seed || 1) * 2654435761) >>> 0 || 1;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      this.rnd = rnd;
      // gentle swells defined in world coordinates, so new sand matches old
      this.waves = [];
      for (let k = 0; k < 6; k++) this.waves.push({ a: rnd() * Math.PI * 2, f: 0.01 + rnd() * 0.03, p: rnd() * 6.28, amp: 0.05 + rnd() * 0.08 });
      this.fresh(0, this.W - 1);
      this.dirtyAll();
    }

    // level sand with a faint grain in grid columns x0..x1
    fresh(x0, x1) {
      const { W, H, h, waves, rnd } = this;
      for (let y = 0; y < H; y++) {
        for (let x = x0; x <= x1; x++) {
          const wx = x + this.origin;
          let v = (rnd() - 0.5) * 0.12;
          for (const w of waves) v += w.amp * Math.sin((wx * Math.cos(w.a) + y * Math.sin(w.a)) * w.f + w.p);
          h[y * W + x] = v;
        }
      }
    }
    clear() { this.fresh(0, this.W - 1); this.dirtyAll(); }

    // Move the window S columns forward; returns S.
    shift(S) {
      const { W, H, h } = this;
      for (let y = 0; y < H; y++) h.copyWithin(y * W, y * W + S, y * W + W);
      this.origin += S;
      this.fresh(W - S, W - 1);
      if (this.dirty) { this.dirty.x0 -= S; this.dirty.x1 -= S; if (this.dirty.x1 < 0) this.dirty = null; }
      this.markDirty(W - S - 1, 0, W - 1, H - 1);
      return S;
    }

    dirtyAll() { this.dirty = { x0: 0, y0: 0, x1: this.W - 1, y1: this.H - 1 }; }
    markDirty(x0, y0, x1, y1) {
      const d = this.dirty;
      if (!d) { this.dirty = { x0, y0, x1, y1 }; return; }
      if (x0 < d.x0) d.x0 = x0; if (y0 < d.y0) d.y0 = y0;
      if (x1 > d.x1) d.x1 = x1; if (y1 > d.y1) d.y1 = y1;
    }
    takeDirty() { const d = this.dirty; this.dirty = null; return d; }

    /* Sweep a ball of radius r from world (ax, ay) to (bx, by), its lowest
     * point `sink` below level; displaced sand goes into a ridge of width
     * ridgeW around the contact edge, to the sides and ahead only. A
     * zero-length sweep presses straight down (a crater, ridge all round). */
    carve(ax, ay, bx, by, r, sinkFrac) {
      const sink = (sinkFrac || 0.32) * r, ridgeW = 0.9 * r;
      const { W, H, h } = this;
      ax -= this.origin; bx -= this.origin;
      const a = Math.sqrt(Math.max(1e-6, r * r - (r - sink) * (r - sink))); // contact radius
      const rOut = a + ridgeW;
      const sx = bx - ax, sy = by - ay, sl2 = sx * sx + sy * sy, sl = Math.sqrt(sl2);
      const dx = sl > 1e-6 ? sx / sl : 0, dy = sl > 1e-6 ? sy / sl : 0;
      const x0 = Math.max(1, Math.floor(Math.min(ax, bx) - rOut - 1)), x1 = Math.min(W - 2, Math.ceil(Math.max(ax, bx) + rOut + 1));
      const y0 = Math.max(1, Math.floor(Math.min(ay, by) - rOut - 1)), y1 = Math.min(H - 2, Math.ceil(Math.max(ay, by) + rOut + 1));
      if (x1 < x0 || y1 < y0) return;
      const w = x1 - x0 + 1;
      if (this.wbuf.length < w * (y1 - y0 + 1)) this.wbuf = new Float32Array(w * (y1 - y0 + 1) * 2);
      const wb = this.wbuf, rr = r * r;
      let moved = 0, wsum = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x, k = (y - y0) * w + (x - x0);
          wb[k] = 0;
          let f = sl2 > 1e-9 ? ((x - ax) * sx + (y - ay) * sy) / sl2 : 1;
          f = f < 0 ? 0 : f > 1 ? 1 : f;
          const ox = x - (ax + sx * f), oy = y - (ay + sy * f);
          const d2 = ox * ox + oy * oy, d = Math.sqrt(d2);
          if (d2 < rr) {
            const floor = -sink + (r - Math.sqrt(rr - d2)); // the ball's underside
            if (h[i] > floor) { moved += h[i] - floor; h[i] = floor; }
          }
          if (d > a * 0.85 && d < rOut) {
            const u = (d - a * 0.85) / (rOut - a * 0.85);
            let wt = Math.sin(Math.PI * u);
            wt *= wt;
            if (sl > 1e-6 && d > 1e-6) {
              const c = (ox * dx + oy * dy) / d; // +1 ahead, -1 behind
              if (c < 0) wt *= Math.max(0, 1 + 1.4 * c);
            }
            wb[k] = wt; wsum += wt;
          }
        }
      }
      if (moved > 0 && wsum > 0) {
        const per = moved / wsum;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const k = (y - y0) * w + (x - x0);
            if (wb[k] > 0) h[y * W + x] += wb[k] * per;
          }
        }
      }
      this.markDirty(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
    }
  }

  XB.SandStrip = SandStrip;
})();

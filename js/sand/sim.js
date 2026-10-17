/* Sand Table: the sand itself, a heightmap on a circular table.
 *
 * Heights are in grid pixels (0 = level sand). The ball carves a groove the
 * shape of its own underside; the sand it moves is pushed into a ridge just
 * outside the groove, to the sides and front of the ball (never behind it,
 * where the groove has just been dug), so volume is roughly conserved.
 * Every change grows a dirty rectangle so the renderer only reshades that.
 *
 * Knows nothing about paths, music or drawing.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});

  class SandSim {
    constructor(N) {
      this.N = N || 512;
      const n = this.N;
      this.h = new Float32Array(n * n);
      this.c = n / 2;
      this.R = n / 2 - 4; // table radius in grid pixels
      this.inside = new Uint8Array(n * n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const d = Math.hypot(x + 0.5 - this.c, y + 0.5 - this.c);
          this.inside[y * n + x] = d < this.R ? 1 : 0;
        }
      }
      this.wbuf = new Float32Array(4096);
      this.flatten(1);
    }

    // Level sand with a faint grain: fine per-grain noise plus gentle swells.
    flatten(seed) {
      const n = this.N, h = this.h;
      let s = (seed * 2654435761) >>> 0 || 1;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      // a few random low-frequency waves
      const waves = [];
      for (let k = 0; k < 6; k++) waves.push({ a: rnd() * Math.PI * 2, f: 0.01 + rnd() * 0.03, p: rnd() * 6.28, amp: 0.05 + rnd() * 0.08 });
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let v = (rnd() - 0.5) * 0.12;
          for (const w of waves) v += w.amp * Math.sin((x * Math.cos(w.a) + y * Math.sin(w.a)) * w.f + w.p);
          h[y * n + x] = v;
        }
      }
      this.dirtyAll();
    }

    dirtyAll() { this.dirty = { x0: 0, y0: 0, x1: this.N - 1, y1: this.N - 1 }; }
    markDirty(x0, y0, x1, y1) {
      const d = this.dirty;
      if (!d) { this.dirty = { x0, y0, x1, y1 }; return; }
      if (x0 < d.x0) d.x0 = x0; if (y0 < d.y0) d.y0 = y0;
      if (x1 > d.x1) d.x1 = x1; if (y1 > d.y1) d.y1 = y1;
    }
    takeDirty() { const d = this.dirty; this.dirty = null; return d; }

    // Unit disk (x, y in -1..1, y up) -> grid pixel coordinates.
    toGrid(x, y, pathR) {
      const r = pathR != null ? pathR : this.R;
      return [this.c + x * r, this.c - y * r];
    }

    /* Sweep a sphere of radius r (grid px) from (ax, ay) to (px, py), its
     * lowest point `sink` below level, and push the displaced sand into a
     * ridge of width `ridgeW` around the contact edge. Sweeping along the
     * segment (a capsule) keeps the groove smooth between stamps. With a
     * zero-length segment and dir = false it is a dimple (ridge all round);
     * otherwise nothing is pushed back into the groove behind the ball. */
    press(ax, ay, px, py, r, sink, ridgeW, dir) {
      const n = this.N, h = this.h, ins = this.inside;
      // contact radius where the sphere meets level sand
      const a = Math.sqrt(Math.max(1e-6, r * r - (r - sink) * (r - sink)));
      const rOut = a + ridgeW;
      const sx = px - ax, sy = py - ay, sl2 = sx * sx + sy * sy, sl = Math.sqrt(sl2);
      const dx = sl > 1e-6 ? sx / sl : 0, dy = sl > 1e-6 ? sy / sl : 0;
      const x0 = Math.max(1, Math.floor(Math.min(ax, px) - rOut - 1)), x1 = Math.min(n - 2, Math.ceil(Math.max(ax, px) + rOut + 1));
      const y0 = Math.max(1, Math.floor(Math.min(ay, py) - rOut - 1)), y1 = Math.min(n - 2, Math.ceil(Math.max(ay, py) + rOut + 1));
      if (x1 < x0 || y1 < y0) return;
      const w = x1 - x0 + 1;
      if (this.wbuf.length < w * (y1 - y0 + 1)) this.wbuf = new Float32Array(w * (y1 - y0 + 1) * 2);
      const wb = this.wbuf;
      let moved = 0, wsum = 0;
      const rr = r * r;
      const dirOn = dir && sl > 1e-6;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * n + x, k = (y - y0) * w + (x - x0);
          wb[k] = 0;
          if (!ins[i]) continue;
          // offset from the nearest point of the swept segment
          let f = sl2 > 1e-9 ? ((x - ax) * sx + (y - ay) * sy) / sl2 : 1;
          f = f < 0 ? 0 : f > 1 ? 1 : f;
          const ox = x - (ax + sx * f), oy = y - (ay + sy * f);
          const d2 = ox * ox + oy * oy;
          const d = Math.sqrt(d2);
          if (d2 < rr) {
            // underside of the ball at this distance from its centre
            const floor = -sink + (r - Math.sqrt(rr - d2));
            if (h[i] > floor) { moved += h[i] - floor; h[i] = floor; }
          }
          if (d > a * 0.85 && d < rOut) {
            const u = (d - a * 0.85) / (rOut - a * 0.85);
            let wt = Math.sin(Math.PI * u);
            wt *= wt;
            if (dirOn && d > 1e-6) {
              const c = (ox * dx + oy * dy) / d; // +1 ahead, -1 behind
              wt *= c < 0 ? Math.max(0, 1 + 1.4 * c) : 1; // nothing goes back into the groove
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
            if (wb[k] > 0) h[y * n + x] += wb[k] * per;
          }
        }
      }
      this.markDirty(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
    }

    // The ball rolling through sand: a groove with ridges to the sides.
    carve(ax, ay, px, py, r) { this.press(ax, ay, px, py, r, 0.32 * r, 0.9 * r, true); }
    // A small dimple (an onset): pressed straight down, ridge all round.
    dimple(px, py, r) { this.press(px, py, px, py, r, 0.4 * r, 0.7 * r, false); }
  }

  XB.SandSim = SandSim;
})();

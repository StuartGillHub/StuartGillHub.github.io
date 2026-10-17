/* Sand Pendulum: grains of sand thrown up when the ball is kicked into a
 * turn. Each grain flies in a little arc (world x, y plus height z) and,
 * when it lands, leaves a tiny mark in the sand. Knows nothing about
 * drawing: the renderer draws `grains`, the mode marks the landings.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const GRAVITY = 900; // world units / s^2 (height)

  class Spray {
    constructor() { this.grains = []; this.seed = 9; }
    rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
    // A burst at (x, y): thrown mostly outward (away from the middle, `side`)
    // and back along the groove, more and further for stronger hits.
    burst(x, y, side, strength, forward) {
      const n = Math.round(5 + 18 * strength);
      for (let i = 0; i < n; i++) {
        const sp = (50 + 150 * this.rnd()) * (0.5 + strength);
        const a = (this.rnd() - 0.5) * 2.2; // spread around "outward"
        this.grains.push({
          x, y,
          vx: -forward * (0.2 + 0.5 * this.rnd()) + Math.sin(a) * sp * 0.8,
          vy: side * Math.cos(a) * sp,
          z: 2, vz: 120 + 160 * this.rnd() * strength,
          size: 0.8 + 1.4 * this.rnd(),
        });
      }
      if (this.grains.length > 400) this.grains.splice(0, this.grains.length - 400);
    }
    // move grains; land(x, y, size) for each that comes down
    update(dt, land) {
      const g = this.grains;
      for (let i = g.length - 1; i >= 0; i--) {
        const p = g[i];
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vz -= GRAVITY * dt; p.z += p.vz * dt;
        if (p.z <= 0) { land(p.x, p.y, p.size); g.splice(i, 1); }
      }
    }
  }

  XB.SandSpray = Spray;
})();

/* Pendulum Wave: the mechanics. Deterministic, no physics engine.
 *
 * Pendulum n (0 = longest) has period P_n = T / (K + n) and angle
 * theta_n(t) = A cos(2 pi t / P_n). Pendulum n makes exactly K + n swings
 * every T seconds, so the whole row realigns exactly at every multiple of T.
 * Everything is a function of one time t, so seeking, pausing and
 * resetting are exact. Knows nothing about sound or drawing.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const TAU = Math.PI * 2;

  class PendulumWave {
    constructor(opts) {
      this.count = 15;
      this.T = 60; // realignment period (s)
      this.K = 51; // swings of the longest pendulum per T
      this.A = 25; // amplitude (degrees)
      Object.assign(this, opts || {});
    }
    period(n) { return this.T / (this.K + n); }
    // angle in radians
    theta(n, t) { return ((this.A * Math.PI) / 180) * Math.cos((TAU * t) / this.period(n)); }
    // string length relative to the longest (proportional to P^2)
    length(n) { const r = this.period(n) / this.period(0); return r * r; }

    // Zero crossings of every pendulum in the interval (t0, t1], in time
    // order. theta_n is zero when t / P_n = 1/4 + k/2, so this is the exact
    // sign-change test and catches any number of crossings per frame.
    crossings(t0, t1, out) {
      out = out || [];
      out.length = 0;
      if (!(t1 > t0)) return out;
      for (let n = 0; n < this.count; n++) {
        const P = this.period(n);
        // crossing index k for time t: 2t/P - 1/2
        let k = Math.floor((2 * t0) / P - 0.5) + 1;
        for (;; k++) {
          const tc = P * (k / 2 + 0.25);
          if (tc <= t0) continue;
          if (tc > t1) break;
          out.push({ n, t: tc, dir: k % 2 === 0 ? -1 : 1 });
        }
      }
      out.sort((a, b) => a.t - b.t);
      return out;
    }
    // time since pendulum n last crossed zero (for the flash)
    sinceCrossing(n, t) {
      const P = this.period(n);
      const x = (2 * t) / P - 0.5;
      return (x - Math.floor(x)) * (P / 2);
    }
    // time until the row is next in unison (t = multiple of T)
    untilUnison(t) {
      const r = t - Math.floor(t / this.T) * this.T;
      return r < 1e-9 ? 0 : this.T - r;
    }
  }

  XB.PendulumWave = PendulumWave;
})();

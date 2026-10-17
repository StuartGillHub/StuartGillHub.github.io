/* Sand Pendulum: how the ball swings up and down.
 *
 * A pendulum phase phi, y = A cos(phi), so the ball is at the top or bottom
 * of its swing on the beat. With a song playing, phi is locked to the
 * song's beat grid (XB.Analysis.lightShow: tempo + beat phase), one
 * half-swing per `beatsPerSwing` beats, and A follows the song's loudness
 * (smoothed over ~1.5 s). Without a song, or paused, it keeps swinging at
 * a steady idle tempo. Phase and amplitude are always eased, never set, so
 * the ball never jumps. Knows nothing about sand or drawing.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const IDLE_BPM = 80;
  const LOCK = 1.2; // s: how quickly the swing locks onto the song's beat
  const MAX_PULL = 0.5; // the lock may speed up / slow down the swing by at most 50%
  const EASE_A = 0.8; // s: how quickly the swing size follows the music

  // loudness 0..1 at time t, relative to the song's loud parts
  function loudness(show) {
    const env = show.env, hz = show.envHz, n = env.length;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + env[i];
    const avg = (t) => {
      const a = Math.max(0, Math.min(n - 1, Math.round((t - 0.75) * hz)));
      const b = Math.max(a + 1, Math.min(n, Math.round((t + 0.75) * hz)));
      return (pre[b] - pre[a]) / (b - a);
    };
    const lv = [];
    for (let t = 0; t < n / hz; t += 0.5) lv.push(avg(t));
    lv.sort((x, y) => x - y);
    const full = lv[Math.floor(lv.length * 0.9)] || 1;
    return (t) => Math.max(0, Math.min(1, avg(t) / full));
  }

  class Swing {
    constructor() {
      this.phi = 0;
      this.A = 0.5; // current amplitude (0..1 of the maximum)
      this.beatsPerSwing = 2;
      this.show = null;
      this.level = null;
    }
    // Advance by dt seconds. music = { show, t, playing } (show may be null).
    // Returns y in -1..1.
    step(dt, music) {
      const m = this.beatsPerSwing;
      const show = music && music.playing ? music.show : null;
      if (show !== this.show) { this.show = show; this.level = show ? loudness(show) : null; }
      let period = 60 / IDLE_BPM, targetA = 0.55;
      if (show) {
        period = show.period;
        targetA = 0.2 + 0.8 * this.level(music.t);
      }
      const w = Math.PI / (period * m);
      this.phi += w * dt;
      if (show) {
        // pull towards the song's beat: extremes exactly on the beats
        const target = (Math.PI * (music.t - show.phase)) / (period * m);
        let e = (target - this.phi) % (2 * Math.PI);
        if (e > Math.PI) e -= 2 * Math.PI;
        if (e < -Math.PI) e += 2 * Math.PI;
        const pull = e * (1 - Math.exp(-dt / LOCK));
        const cap = MAX_PULL * w * dt; // never jerks or runs backwards
        this.phi += Math.max(-cap, Math.min(cap, pull));
      }
      this.A += (targetA - this.A) * (1 - Math.exp(-dt / EASE_A));
      return this.A * Math.cos(this.phi);
    }
  }

  XB.SandSwing = Swing;
})();

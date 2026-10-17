/* Pendulum Wave: the bells. Synthesised through the app's existing audio
 * context (XB.AudioEngine): a sine plus an inharmonic partial at ~2.76x
 * (a small bell's characteristic overtone), fast attack, ~1.5 s decay, a
 * light reverb, master gain ~0.3. Notes come from a selectable scale spread
 * over about three octaves. Knows nothing about pendulums or drawing.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});

  const SCALES = {
    pentatonic: { label: 'Pentatonic', steps: [0, 2, 4, 7, 9] },
    major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
    minor: { label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
    wholetone: { label: 'Whole-tone', steps: [0, 2, 4, 6, 8, 10] },
  };
  const OCTAVES = 3;

  // MIDI notes for `count` bells: the scale's notes over three octaves from
  // `root`, picked evenly so the lowest and highest bells span the range.
  function bellNotes(scale, count, root) {
    const st = SCALES[scale].steps;
    const all = [];
    for (let o = 0; o < OCTAVES; o++) for (const s of st) all.push(root + 12 * o + s);
    all.push(root + 12 * OCTAVES);
    const out = [];
    for (let i = 0; i < count; i++) out.push(all[Math.round((i * (all.length - 1)) / (count - 1))]);
    return out;
  }

  class Bells {
    constructor(engine) {
      this.engine = engine;
      this.out = null;
    }
    // Build the bell bus on first use (the context exists after a gesture).
    ensure() {
      if (this.out) return true;
      const ctx = this.engine.ensure();
      if (!ctx) return false;
      this.ctx = ctx;
      this.out = ctx.createGain();
      this.out.gain.value = 0.3; // master gain for the bells
      const comp = ctx.createDynamicsCompressor(); // unison hits stack up
      comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.2;
      this.bus = ctx.createGain();
      this.verb = ctx.createConvolver();
      this.verb.buffer = this.engine.makeImpulse(2.2);
      const wet = ctx.createGain();
      wet.gain.value = 0.16;
      this.bus.connect(comp);
      this.bus.connect(this.verb);
      this.verb.connect(wet);
      wet.connect(comp);
      comp.connect(this.out);
      this.out.connect(this.engine.master);
      return true;
    }
    // Ring one bell at audio-context time `when`.
    ring(midi, when, vel, cents) {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const t = Math.max(when, ctx.currentTime);
      const f = 440 * Math.pow(2, (midi - 69) / 12 + (cents || 0) / 1200);
      const v = 0.22 * (vel == null ? 1 : vel);
      // fundamental and the inharmonic ~2.76x partial (decays faster)
      const parts = [[1, 1, 0.42], [2.76, 0.32, 0.17], [5.4, 0.06, 0.07]];
      for (const [ratio, amp, tau] of parts) {
        if (f * ratio > 16000) continue;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * ratio;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(v * amp, t + 0.004); // fast attack
        g.gain.setTargetAtTime(0, t + 0.004, tau); // ~1.5 s to near silence
        o.connect(g); g.connect(this.bus);
        o.start(t); o.stop(t + tau * 9 + 0.05);
      }
    }
    // Fade out everything ringing (mode switch); a fresh bus is built on next use.
    silence() {
      if (!this.out) return;
      const g = this.out.gain, now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.08);
      const old = this.out;
      setTimeout(() => old.disconnect(), 200);
      this.out = null;
    }
  }

  XB.PendulumBells = { Bells, SCALES, bellNotes };
})();

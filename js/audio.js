/* Audio engine: song playback with an accurate song clock, sample-accurately
 * scheduled xylophone accents for each strike, and a rolling sound on wires.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.buffer = null;
      this.src = null;
      this.playing = false;
      this.startCtx = 0;
      this.startSong = 0;
    }

    ensure() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.songGain = ctx.createGain();
      this.songGain.connect(this.master);
      this.fxGain = ctx.createGain();
      this.fxGain.gain.value = 0.35;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.fxGain.connect(comp);
      comp.connect(this.master);
      // small room reverb for the accents
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(1.3);
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.22;
      this.fxBus = ctx.createGain();
      this.fxBus.connect(this.fxGain);
      this.fxBus.connect(this.reverb);
      this.reverb.connect(this.wet);
      this.wet.connect(this.fxGain);
      this.noise = this.makeNoise(2);
      this.setupRolling();
      return ctx;
    }

    makeImpulse(sec) {
      const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
      const b = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
      }
      return b;
    }
    makeNoise(sec) {
      const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    setupRolling() {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2400;
      this.rollGain = ctx.createGain();
      this.rollGain.gain.value = 0;
      this.rollFilter = bp;
      src.connect(bp); bp.connect(lp); lp.connect(this.rollGain); this.rollGain.connect(this.fxGain);
      src.start();
    }

    async decode(arrayBuffer) {
      const ctx = this.ensure();
      return await new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    }

    // Call synchronously from a tap/click. Browsers (iOS Safari especially)
    // only let audio start inside a user gesture, and on iPhones Web Audio is
    // silenced by the ring/silent switch unless the page is in the
    // "playback" audio session.
    unlock() {
      const ctx = this.ensure();
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* unsupported */ }
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      try {
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
      } catch (e) { /* ignore */ }
      // A (silent) media element playing keeps older iOS in playback mode too.
      if (!this.keepAlive) {
        try {
          const a = new Audio(silentWav());
          a.loop = true;
          a.setAttribute('playsinline', '');
          a.play().catch(() => {});
          this.keepAlive = a;
        } catch (e) { /* ignore */ }
      }
    }

    setBuffer(buf) { this.stop(); this.buffer = buf; }

    play(from) {
      const ctx = this.ensure();
      if (ctx.state !== 'running') ctx.resume();
      this.stopSource();
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(this.songGain);
      const when = ctx.currentTime + 0.06;
      if (from < 0) src.start(when - from, 0);
      else if (from < this.buffer.duration) src.start(when, from);
      this.src = src;
      this.startCtx = when;
      this.startSong = from;
      this.playing = true;
    }
    stopSource() {
      if (this.src) { try { this.src.stop(); } catch (e) { /* not started */ } this.src.disconnect(); this.src = null; }
    }
    stop() { this.stopSource(); this.playing = false; if (this.rollGain) this.rollGain.gain.value = 0; }

    latency() {
      const c = this.ctx;
      if (!c) return 0;
      return (c.outputLatency || 0) + (c.baseLatency || 0);
    }
    // Song time currently *audible*.
    songTime() {
      return this.ctx.currentTime - this.startCtx + this.startSong - this.latency();
    }
    ctxTimeFor(songT) { return this.startCtx + (songT - this.startSong); }

    setSongVolume(v) { this.ensure(); this.songGain.gain.value = v; }
    setFxVolume(v) { this.ensure(); this.fxGain.gain.value = v; }

    xylo(songT, midi, vel, cents) {
      const ctx = this.ctx;
      const t = this.ctxTimeFor(songT);
      if (t < ctx.currentTime - 0.005) return;
      let m = midi;
      while (m < 72) m += 12;
      while (m > 96) m -= 12;
      // match the recording's own tuning so strikes sit in tune with it
      const f = 440 * Math.pow(2, (m - 69) / 12 + (cents || 0) / 1200);
      const v = 0.25 + 0.55 * vel;
      // tuned xylophone bar: fundamental + twelfth (3x) + higher inharmonic modes
      const partials = [[1, 1, 0.32], [3.0, 0.22, 0.09], [5.95, 0.08, 0.045], [9.8, 0.04, 0.025]];
      for (const [ratio, amp, tau] of partials) {
        const o = ctx.createOscillator();
        o.frequency.value = f * ratio;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp * v * 0.5, t + 0.0015);
        g.gain.setTargetAtTime(0, t + 0.0015, tau);
        o.connect(g); g.connect(this.fxBus);
        o.start(t); o.stop(t + tau * 8 + 0.05);
      }
      this.click(t, v * 0.35, 3200);
    }

    click(t, v, freq) {
      const ctx = this.ctx;
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.setTargetAtTime(0, t, 0.006);
      n.connect(bp); bp.connect(g); g.connect(this.fxBus);
      n.start(t, Math.random() * 1.5); n.stop(t + 0.06);
    }

    metal(songT, v) {
      const ctx = this.ctx;
      const t = this.ctxTimeFor(songT);
      if (t < ctx.currentTime - 0.005) return;
      this.click(t, v * 0.5, 5200);
      const o = ctx.createOscillator();
      o.frequency.value = 2630;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v * 0.05, t + 0.001);
      g.gain.setTargetAtTime(0, t + 0.001, 0.04);
      o.connect(g); g.connect(this.fxBus);
      o.start(t); o.stop(t + 0.3);
    }

    // Pinball kicker firing: a solenoid thump pitched to the note (two
    // octaves down, so it stays in key) with a quick downward snap and a click.
    bumper(songT, midi, k, cents) {
      const ctx = this.ctx;
      const t = this.ctxTimeFor(songT);
      if (t < ctx.currentTime - 0.005) return;
      let m = midi - 24;
      while (m < 40) m += 12;
      while (m > 55) m -= 12;
      const f = 440 * Math.pow(2, (m - 69) / 12 + (cents || 0) / 1200);
      const v = 0.35 + 0.65 * k;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f * 2, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v * 0.55, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, 0.07);
      o.connect(g); g.connect(this.fxBus);
      o.start(t); o.stop(t + 0.6);
      this.click(t, v * 0.6, 1800);
    }

    setRolling(speed) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const g = speed > 0 ? Math.min(0.09, 0.012 + speed * 0.022) : 0;
      this.rollGain.gain.setTargetAtTime(g, now, 0.03);
      this.rollFilter.frequency.setTargetAtTime(500 + speed * 420, now, 0.05);
    }
  }

  // 0.25 s of silence as a WAV data URI (8 kHz, 8-bit mono).
  function silentWav() {
    const n = 2000;
    const bytes = new Uint8Array(44 + n);
    const dv = new DataView(bytes.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) bytes[o + i] = t.charCodeAt(i); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    str(36, 'data'); dv.setUint32(40, n, true);
    bytes.fill(128, 44);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }

  XB.AudioEngine = AudioEngine;

  /* ---------- a built-in demo tune with deliberate silences ---------- */
  XB.Demo = {
    notes() {
      const N = [];
      const add = (t, name) => N.push({ t, midi: XB.Demo.midi(name) });
      let t = 0.4;
      for (const n of ['E5', 'G5', 'A5', 'B5', 'D6', 'B5', 'A5', 'G5']) { add(t, n); t += 0.25; }
      for (const n of ['E5', 'D5', 'E5', 'G5']) { add(t, n); t += 0.5; }
      t += 2.2; // silence -> wire
      for (const n of ['C6', 'B5', 'A5', 'G5', 'E5', 'D5', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6', 'D6', 'C6', 'A5', 'G5']) { add(t, n); t += 0.18; }
      t += 0.3;
      for (const [n, d] of [['A5', 1.0], ['G5', 0.75], ['E5', 0.5], ['D5', 0.5], ['E5', 0.5]]) { add(t, n); t += d; }
      t += 2.8; // silence -> wire
      const sync = [0, 0.375, 0.75, 1.0, 1.375, 1.75, 2.0, 2.5, 3.0, 3.25, 3.5, 3.75, 4.0];
      const mel = ['A5', 'C6', 'A5', 'G5', 'E5', 'G5', 'A5', 'E5', 'D5', 'E5', 'G5', 'A5', 'C6'];
      sync.forEach((o, i) => add(t + o, mel[i]));
      t += 4.8;
      t += 2.6; // silence -> wire
      const gaps = [0.5, 0.45, 0.4, 0.35, 0.3, 0.3, 0.25, 0.25, 0.2, 0.2, 0.18, 0.16, 0.16, 0.15, 0.15, 0.6];
      const run = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6', 'D6', 'C6', 'A5', 'G5', 'E5', 'D5', 'E5', 'G5', 'C6'];
      for (let i = 0; i < run.length; i++) { add(t, run[i]); t += gaps[i] || 0; }
      return N;
    },
    midi(name) {
      const map = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
      let k = map[name[0]], i = 1;
      if (name[i] === '#') { k++; i++; }
      return 12 * (parseInt(name.slice(i), 10) + 1) + k;
    },
    async render() {
      const notes = XB.Demo.notes();
      const sr = 44100;
      const dur = notes[notes.length - 1].t + 2.5;
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ctx = new Offline(2, Math.ceil(dur * sr), sr);
      const out = ctx.createGain();
      out.gain.value = 0.55;
      out.connect(ctx.destination);
      for (const n of notes) {
        const f = 440 * Math.pow(2, (n.midi - 69) / 12);
        const t = n.t;
        // plucked "kalimba / e-piano" voice
        const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.005;
        const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = f / 2;
        const g = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, 0.28);
        g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.18, t + 0.003); g2.gain.setTargetAtTime(0, t + 0.003, 0.1);
        g3.gain.setValueAtTime(0, t); g3.gain.linearRampToValueAtTime(0.25, t + 0.01); g3.gain.setTargetAtTime(0, t + 0.01, 0.35);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f * 5;
        o1.connect(lp); lp.connect(g); o2.connect(g2); o3.connect(g3);
        g.connect(out); g2.connect(out); g3.connect(out);
        for (const o of [o1, o2, o3]) { o.start(t); o.stop(t + 2); }
      }
      const buf = await ctx.startRendering();
      return { buffer: buf, truth: notes.map((n) => n.t) };
    },
  };
})();

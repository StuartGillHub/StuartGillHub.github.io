/* Sand Table mode: a steel ball drawing theta-rho patterns in sand.
 *
 * Glue only: the path (XB.SandPath), the sand (XB.SandSim) and the look
 * (XB.SandRenderer) are separate. The music link reads the app's existing
 * analysis of the loaded track:
 *   - loudness (RMS, smoothed over ~2 s) sets the ball's speed, 0.7-1.4x
 *   - spectral centroid (brightness) picks each new pattern's parameter,
 *     only when a pattern starts, so the lines stay clean
 *   - each melody onset (the same onsets Xylofall turns into bars) presses a
 *     small dimple beside the ball
 * With no track (or paused) the ball keeps drawing at a constant slow speed.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const BASE_SPEED = 0.15; // unit-disk radii per second at 1x
  const ERASE_SPEED = 2.5; // the wiping spiral runs faster
  const IDLE_FACTOR = 0.8; // music factor with no track / paused
  const DRAWINGS = ['rose', 'hypotrochoid', 'star', 'lissajous', 'spiral'];
  const LABELS = { auto: 'Playlist (all)', spiral: 'Spiral', rose: 'Rose', hypotrochoid: 'Spirograph', star: 'Precessing star', lissajous: 'Polar Lissajous' };

  // Music features from the app's analysis, sampled at 10 Hz.
  function musicFeatures(an) {
    if (!an || !an.rms || !an.centroid) return null;
    const fps = XB.Analysis.SR / XB.Analysis.HOP;
    const HZ = 10;
    const n = Math.max(1, Math.ceil((an.nFrames / fps) * HZ));
    const rms = new Float32Array(n), cen = new Float32Array(n), w = new Float32Array(n);
    for (let f = 0; f < an.nFrames; f++) {
      const i = Math.min(n - 1, Math.floor((f / fps) * HZ));
      const e = an.rms[f];
      rms[i] += e; cen[i] += an.centroid[f] * e; w[i] += e;
    }
    const per = fps / HZ;
    for (let i = 0; i < n; i++) { cen[i] = w[i] > 1e-9 ? cen[i] / w[i] : 0; rms[i] /= per; }
    // moving averages: ~2 s for loudness, ~4 s for brightness (loudness-weighted)
    const smooth = (src, half, weight) => {
      const out = new Float32Array(n);
      let s = 0, ws = 0;
      const val = (i) => (weight ? src[i] * weight[i] : src[i]);
      const wt = (i) => (weight ? weight[i] : 1);
      for (let i = 0; i < Math.min(n, half); i++) { s += val(i); ws += wt(i); }
      for (let i = 0; i < n; i++) {
        if (i + half < n) { s += val(i + half); ws += wt(i + half); }
        if (i - half - 1 >= 0) { s -= val(i - half - 1); ws -= wt(i - half - 1); }
        out[i] = ws > 1e-9 ? s / ws : 0;
      }
      return out;
    };
    const lvl = smooth(rms, HZ * 1, null);
    const bright = smooth(cen, HZ * 2, w);
    const pct = (a, q) => { const s = Array.from(a).filter((v) => v > 0).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * q)] : 1; };
    const loud = pct(lvl, 0.9) || 1;
    const c10 = pct(bright, 0.1), c90 = pct(bright, 0.9);
    const at = (arr, t) => {
      const x = Math.max(0, Math.min(n - 1, t * HZ));
      const i = Math.min(n - 2, Math.floor(x)), u = x - i;
      return n < 2 ? arr[0] : arr[i] + (arr[i + 1] - arr[i]) * u;
    };
    return {
      speedAt: (t) => 0.7 + 0.7 * Math.max(0, Math.min(1, at(lvl, t) / loud)),
      brightnessAt: (t) => Math.max(0, Math.min(0.999, (at(bright, t) - c10) / Math.max(1, c90 - c10))),
    };
  }

  function SandMode(host) {
    const canvas = host.canvas;
    const ctx = canvas.getContext('2d');
    const settings = { speed: 1, pattern: 'auto', ballR: 0.035, light: 210, dimples: true };
    const sim = new XB.SandSim(512);
    const look = new XB.SandRenderer(sim);
    let drawn = 0; // drawings since the last erase (playlist)
    let cycle = 0; // playlist position
    let golden = 0.3; // parameter source when there's no music
    let pendingErase = false;
    const player = new XB.SandPath.PathPlayer(nextSpec);
    let feats = null, featsFor = null;
    let onsetIdx = 0, lastT = null, side = 1;
    let lastStamp = null; // previous stamp (grid px): each stamp sweeps from it
    let patternSel = null;

    const ballPx = () => settings.ballR * sim.R; // ball radius in grid px
    // radius the ball centre travels: fixed (room for the largest ball), so
    // resizing the ball never moves it
    const pathR = () => sim.R * (1 - 0.06) - 2;
    const ballUnit = () => ballPx() / pathR(); // ball radius in path units

    function param() {
      if (feats && host.playing()) return feats.brightnessAt(host.time());
      golden = (golden + 0.618034) % 1;
      return golden;
    }
    function nextSpec() {
      player.ctx.pitch = 2 * ballUnit();
      if (pendingErase) { pendingErase = false; drawn = 0; return { kind: 'erase', p: 0 }; }
      if (settings.pattern !== 'auto') return { kind: settings.pattern, p: param() };
      if (drawn >= 2) { drawn = 0; return { kind: 'erase', p: 0 }; }
      drawn++;
      return { kind: DRAWINGS[cycle++ % DRAWINGS.length], p: param() };
    }
    function nextPattern() { player.begin(); }
    function erase() { pendingErase = true; player.begin(); }

    // music: refresh features when a new track's analysis appears
    function syncMusic(t) {
      const an = host.analysis();
      if (an !== featsFor) { featsFor = an; feats = musicFeatures(an); lastT = null; }
      const notes = host.notes() || [];
      // find our place in the onsets after a seek / restart / new song
      if (lastT === null || t < lastT - 0.05 || t > lastT + 0.75) {
        let lo = 0, hi = notes.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].t < t) lo = m + 1; else hi = m; }
        onsetIdx = lo;
      }
      lastT = t;
      return notes;
    }

    function update(dt) {
      dt = Math.min(0.1, Math.max(0, dt));
      const playing = host.playing();
      const t = host.time();
      const notes = syncMusic(t);
      const factor = feats && playing ? feats.speedAt(t) : IDLE_FACTOR;
      const erasing = player.path && player.path.kind === 'erase';
      const dist = BASE_SPEED * settings.speed * factor * (erasing ? ERASE_SPEED : 1) * dt;
      const R = pathR(), r = ballPx();
      player.advance(dist, 0.3 * ballUnit(), (x, y) => {
        const [gx, gy] = sim.toGrid(x, y, R);
        const a = lastStamp || [gx, gy];
        sim.carve(a[0], a[1], gx, gy, r);
        lastStamp = [gx, gy];
      });
      // onsets that have just passed: a dimple just beside the ball
      if (playing) {
        while (onsetIdx < notes.length && notes[onsetIdx].t <= t) {
          const nt = notes[onsetIdx++];
          if (!settings.dimples || t - nt.t > 0.3) continue;
          const p = player.pos;
          side = -side;
          const off = 2.6 * ballUnit();
          const x = p.x - p.dy * off * side, y = p.y + p.dx * off * side;
          if (Math.hypot(x, y) > 1) continue;
          const [gx, gy] = sim.toGrid(x, y, R);
          sim.dimple(gx, gy, r * (0.32 + 0.18 * (nt.strength || 0.5)));
        }
      }
    }

    function render() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      // backdrop: the app's warm dark, lit a little from the lamp's side
      ctx.fillStyle = XB.Palette.BG;
      ctx.fillRect(0, 0, W, H);
      const top = 64 * dpr, bottom = (host.transportShown() ? 96 : 24) * dpr;
      const cy = top + (H - top - bottom) / 2;
      const R = Math.max(40, Math.min(W * 0.44, (H - top - bottom) * 0.45));
      const az = (settings.light * Math.PI) / 180;
      const glow = ctx.createRadialGradient(W / 2 + Math.cos(az) * R * 1.4, cy - Math.sin(az) * R * 1.4, 0, W / 2, cy, Math.max(W, H) * 0.8);
      glow.addColorStop(0, 'rgba(255,180,92,0.16)'); glow.addColorStop(1, 'rgba(255,180,92,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      const pr = pathR();
      const [gx, gy] = sim.toGrid(player.pos.x, player.pos.y, pr);
      look.draw(ctx, { cx: W / 2, cy, R }, { gx, gy, r: ballPx() });
      // what is being drawn
      if (player.path) {
        ctx.fillStyle = 'rgba(251,241,227,0.55)';
        ctx.font = `${12 * dpr}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(player.path.label, W / 2, cy + R + 28 * dpr);
      }
    }

    function onKey(e) {
      if (e.code === 'KeyN') { nextPattern(); return true; }
      if (e.code === 'KeyE') { erase(); return true; }
      return false;
    }

    return {
      id: 'sand',
      name: 'Sand Table',
      init() { canvas.classList.remove('hidden'); lastT = null; },
      update,
      render,
      onKey,
      dispose() { canvas.classList.add('hidden'); },
      getControls() {
        return [
          { type: 'heading', label: 'Sand Table' },
          { type: 'range', label: 'Speed', min: 0.3, max: 3, step: 0.05, value: settings.speed, format: (v) => v.toFixed(2) + '×', onInput: (v) => { settings.speed = v; } },
          { type: 'select', label: 'Pattern', value: settings.pattern, options: Object.entries(LABELS), onChange: (v) => { settings.pattern = v; nextPattern(); }, bind: (el) => { patternSel = el; } },
          { type: 'buttons', items: [
            { label: 'Next pattern', title: 'N', onClick: nextPattern },
            { label: 'Erase', title: 'E', onClick: erase },
          ] },
          { type: 'range', label: 'Ball size', min: 0.02, max: 0.06, step: 0.001, value: settings.ballR, format: (v) => (v * 100).toFixed(1) + '% of table', onInput: (v) => { settings.ballR = v; } },
          { type: 'range', label: 'Light angle', min: 0, max: 359, step: 1, value: settings.light, format: (v) => v + '°', onInput: (v) => { settings.light = v; look.setLight(v); } },
          { type: 'check', label: 'Note dimples', hint: 'Each note of the song presses a small dimple beside the ball.', value: settings.dimples, onChange: (on) => { settings.dimples = on; } },
        ];
      },
      // for tests
      _debug: { sim, player, settings, look, nextPattern, erase, musicFeatures },
    };
  }

  XB.SandMode = SandMode;
  XB.SandMode.musicFeatures = musicFeatures;
})();

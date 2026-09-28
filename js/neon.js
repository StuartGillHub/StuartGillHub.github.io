/* Neon club look: dark wall, colour-washing moving lights, laser fans and
 * strobes, all choreographed from the song's beat grid, kick drum, energy
 * envelope and drops (see XB.Analysis.lightShow). Everything is a function
 * of song time, so it stays locked to the music and survives seeking.
 */
import * as THREE from 'three';

// Electric palettes, lime-led; the show moves on every 16 beats and at drops.
const PALETTES = [
  ['#b6ff00', '#00ffd0', '#39ff14'],
  ['#ccff00', '#00e5ff', '#e8fff0'],
  ['#39ff14', '#b6ff00', '#00b3ff'],
  ['#e4ff1a', '#00ff88', '#7dffea'],
];
// Note colours span lime -> green -> cyan -> electric blue.
const NEON_HUES = [74, 82, 90, 98, 108, 122, 140, 158, 172, 184, 194, 204];
export const neonNoteColor = (pc) => new THREE.Color().setHSL(NEON_HUES[pc] / 360, 1, 0.55);
const THUNDER = new THREE.Color('#e6f0ff');

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
function hash(n) {
  let h = (n * 374761393) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Dim club reflected in glossy surfaces: dark room with neon tubes.
function clubRoom() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: '#020302', side: THREE.BackSide })));
  const tube = (w, h, c, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry || 0; env.add(m);
  };
  tube(8, 0.15, '#b6ff00', 0, 2.6, -3);
  tube(8, 0.15, '#00e5ff', 0, -2.6, -3);
  tube(0.15, 4, '#39ff14', -4.8, 0, 0, Math.PI / 2);
  tube(0.15, 4, '#b6ff00', 4.8, 0, 0, Math.PI / 2);
  tube(3, 1.2, '#1c241c', 0, 0.5, 4.9);
  return env;
}

function beamTexture() {
  const W = 256, H = 32;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H * 2 - 1;
    const prof = Math.exp(-v * v * 9);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const a = prof * Math.pow(1 - u, 1.3) * Math.min(1, u * 40);
      const k = (y * W + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = 255 * a;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class NeonShow {
  constructor(r3d, paintNormal) {
    this.r = r3d;
    const scene = r3d.scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    const pm = new THREE.PMREMGenerator(r3d.r);
    this.env = pm.fromScene(clubRoom(), 0.02).texture;
    this.palette = PALETTES[0].map((c) => new THREE.Color(c));
    this.tmp = new THREE.Color();

    // --- lights ---
    this.ambient = new THREE.HemisphereLight('#1d2a1a', '#000000', 0.2);
    this.group.add(this.ambient);
    this.front = new THREE.DirectionalLight('#9dffb0', 0.12);
    this.group.add(this.front, this.front.target);
    this.washes = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.SpotLight('#ff2bd6', 0, 0, 0.42, 0.65, 0);
      if (i === 0) {
        s.castShadow = true;
        s.shadow.mapSize.set(1024, 1024);
        s.shadow.bias = -0.0003;
        s.shadow.radius = 3;
        s.shadow.camera.near = 0.3;
        s.shadow.camera.far = 8;
      }
      this.group.add(s, s.target);
      this.washes.push(s);
    }
    this.ballLight = new THREE.PointLight('#ff2bd6', 0, 1.1, 2);
    this.group.add(this.ballLight);

    // --- lasers: two emitters below the frame, each fanning several beams ---
    const tex = beamTexture();
    const geo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
    this.beams = [];
    this.BEAMS = 8;
    for (let e = 0; e < 3; e++) {
      for (let k = 0; k < this.BEAMS; k++) {
        const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
        const halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
        core.renderOrder = halo.renderOrder = 10;
        core.frustumCulled = halo.frustumCulled = false;
        this.group.add(core, halo);
        this.beams.push({ e, k, core, halo });
      }
    }

    // --- shockwave rings that burst across the wall ---
    this.rings = [];
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 96), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      ring.renderOrder = 9;
      ring.frustumCulled = false;
      this.group.add(ring);
      this.rings.push(ring);
    }

    // --- skin materials ---
    this.wallMat = new THREE.MeshStandardMaterial({ color: '#141614', roughness: 0.42, metalness: 0.15, normalMap: paintNormal, normalScale: new THREE.Vector2(0.22, 0.22) });
    this.railMat = new THREE.MeshStandardMaterial({ color: '#050605', metalness: 0.5, roughness: 0.3, emissive: '#b6ff00', emissiveIntensity: 1.5 });
    this.tieMat = new THREE.MeshStandardMaterial({ color: '#2b2b36', metalness: 0.9, roughness: 0.3, envMap: this.env });
    this.barMat = (pc) => new THREE.MeshPhysicalMaterial({
      color: '#050605', metalness: 0.85, roughness: 0.2, envMap: this.env, envMapIntensity: 1.4,
      clearcoat: 1, clearcoatRoughness: 0.05, emissive: neonNoteColor(pc), emissiveIntensity: 0,
    });
    // idle neon edge strips, one shared material per note so they can breathe together
    this.stripMats = [];
    for (let pc = 0; pc < 12; pc++) {
      this.stripMats.push(new THREE.MeshBasicMaterial({ color: neonNoteColor(pc), toneMapped: false }));
    }
    this.ballTex = null;

    // full-screen strobe (DOM, so it can be switched off completely)
    this.flashEl = document.getElementById('strobe');
    this.strobes = [];
    this.show = null;
  }

  ballMaterial(map) {
    if (!this.ballMat) {
      this.ballMat = new THREE.MeshPhysicalMaterial({
        map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.3,
        roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03, envMap: this.env,
      });
    }
    return this.ballMat;
  }

  // Full-screen flash schedule: single strobes on loud kicks, and thunder
  // bursts (flash, flicker, bigger flash) at drops and phrase downbeats.
  // Every flicker counts: no 1-second window ever holds more than 3 flashes
  // (the photosensitivity guideline for full-screen flashing).
  prepare(show) {
    if (this.show === show) return;
    this.show = show;
    const env = (t) => show.env[Math.max(0, Math.min(show.env.length - 1, Math.round(t * show.envHz)))];
    const loud = [...show.env].sort((a, b) => a - b)[Math.floor(show.env.length * 0.8)] || 1;
    const P = show.period;
    const accepted = [];
    const fits = (t) => {
      let n = 0;
      for (let i = accepted.length - 1; i >= 0 && accepted[i].t > t - 1; i--) {
        if (Math.abs(accepted[i].t - t) < 0.07) return false;
        n++;
      }
      return n < 3;
    };
    const add = (t, a, tail) => { if (fits(t)) { accepted.push({ t, a, tail }); return true; } return false; };
    const rings = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const thunder = (t) => {
      // flash, flicker, then the big one with a long tail, unevenly spaced
      const pat = [[0, 0.8, 0.04], [0.08 + 0.05 * rnd(), 0.45, 0.03], [0.2 + 0.08 * rnd(), 1, 0.14]];
      let any = false;
      for (const [dt, amp, tail] of pat) any = add(t + dt, amp, tail) || any;
      if (any) rings.push(t);
    };
    // events in time order: thunder at drops and loud phrase downbeats, strobes on loud kicks
    const events = [];
    for (const d of show.drops) events.push({ t: d, kind: 'thunder' });
    const dur = show.env.length / show.envHz;
    for (let b = 0; show.phase + b * P < dur; b += 16) {
      const t = show.phase + b * P;
      if (env(t + P) >= Math.max(0.6, loud * 0.97)) events.push({ t, kind: 'thunder' });
    }
    for (const k of show.kicks) {
      if (env(k.t) < Math.max(0.55, loud * 0.95)) continue;
      const bi = Math.round((k.t - show.phase) / P);
      const peak = env(k.t) >= Math.max(0.8, loud * 1.05);
      if (bi % 4 === 0 || (peak && bi % 2 === 0)) events.push({ t: k.t, kind: 'strobe', s: k.s });
    }
    events.sort((a, b) => a.t - b.t || (a.kind === 'thunder' ? -1 : 1));
    for (const e of events) {
      if (e.kind === 'thunder') thunder(e.t);
      else add(e.t, 0.55 + 0.35 * e.s, 0.05);
    }
    accepted.sort((a, b) => a.t - b.t);
    this.flashes = accepted;
    this.flashT = accepted.map((f) => f.t);
    this.ringT = rings;
    this.kickT = show.kicks.map((k) => k.t);
    // kept for tests: the moments a full-screen flash starts
    this.strobes = this.flashT;
  }

  energyAt(t) {
    const s = this.show;
    const f = t * s.envHz;
    const i = Math.max(0, Math.min(s.env.length - 2, Math.floor(f)));
    const u = Math.max(0, Math.min(1, f - i));
    return s.env[i] + (s.env[i + 1] - s.env[i]) * u;
  }

  lastBefore(arr, t) {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  update(t, ball, cam, opts) {
    const s = this.show;
    if (!s) return;
    const r = this.r;
    const vw = r.visW, vh = r.visH;
    const P = s.period;
    const bt = (t - s.phase) / P;
    const beat = Math.floor(bt), ph = bt - beat;
    const E = Math.max(0, Math.min(1.1, this.energyAt(t)));
    const hot = smooth((E - 0.45) / 0.3); // how "peak-time" this moment is

    // palette: next one every 16 beats and at each drop, crossfading over a beat
    const dropsBefore = this.lastBefore(s.drops, t) + 1;
    const phrase = Math.floor(beat / 16) + dropsBefore * 3;
    const intoPhrase = ((bt % 16) + 16) % 16;
    const pa = PALETTES[((phrase % 4) + 4) % 4], pb = PALETTES[(((phrase - 1) % 4) + 4) % 4];
    const mix = smooth(intoPhrase);
    for (let i = 0; i < 3; i++) this.palette[i].set(pb[i]).lerp(this.tmp.set(pa[i]), mix);

    // kick pulse
    const ki = this.lastBefore(this.kickT, t);
    let kp = 0;
    if (ki >= 0) kp = s.kicks[ki].s * Math.exp(-(t - s.kicks[ki].t) / 0.11);
    const beatPulse = Math.exp(-ph * P / 0.12);
    const wild = !!opts.strobes;
    const punch = wild ? 1 : 0.35;

    // flashes: most recent strobe / thunder flicker
    let flash = 0;
    const fi = this.lastBefore(this.flashT, t);
    if (fi >= 0) { const f = this.flashes[fi]; flash = f.a * Math.exp(-(t - f.t) / f.tail); }
    if (this.flashEl) {
      this.flashEl.style.opacity = wild ? Math.min(0.9, 0.9 * flash).toFixed(3) : '0';
      this.flashEl.style.background = '#e6f0ff';
    }
    const fl = wild ? flash : 0;

    // drop / peak state
    const di = this.lastBefore(s.drops, t);
    const sinceDrop = di >= 0 ? t - s.drops[di] : 1e9;
    const dropHot = sinceDrop < P * 16 && E > 0.25;

    // moving washes: lime pools sweeping the black wall, pumping on the kick,
    // blown white by thunder
    const w = (2 * Math.PI) / (P * (hot > 0.5 ? 4 : 8));
    this.washes.forEach((l, i) => {
      l.color.copy(this.palette[i]).lerp(THUNDER, Math.min(1, fl * 1.2));
      l.position.set(cam.x + (i - 1) * vw * 0.45, cam.y + vh * 0.85, 2.3);
      l.target.position.set(cam.x + Math.sin(w * t + i * 2.1) * vw * 0.34, cam.y + Math.cos(w * 0.7 * t + i * 1.3) * vh * 0.28, 0);
      l.intensity = (0.3 + 1.8 * E) * (1 + 2.2 * kp * punch) + 22 * fl;
      l.angle = 0.2 + 0.1 * E + 0.3 * fl;
    });
    this.front.position.set(cam.x - 1, cam.y + 1, 3);
    this.front.target.position.set(cam.x, cam.y, 0);
    this.front.intensity = 0.06 + 2.2 * fl;
    this.ambient.intensity = 0.05 + 0.07 * E + 1.4 * fl;

    // lasers: gated patterns that fire on and off with the beat
    const L = Math.max(smooth((E - 0.35) / 0.25), dropHot ? 1 : 0);
    const step = Math.floor(beat / 2);
    const modes = hot > 0.6 || dropHot ? ['chase', 'pulse16', 'hit', 'pulse8'] : ['pulse8', 'sweep', 'hit', 'pulse8'];
    const mode = modes[Math.floor(hash(step * 3 + 1) * modes.length)];
    const sub8 = (bt * 2) % 1, sub16 = (bt * 4) % 1;
    const n16 = Math.floor(bt * 4);
    const len = Math.hypot(vw, vh) * 1.4;
    const aimOf = (n, e) => 0.3 + 0.8 * hash(n * 7 + e * 13);
    const spreadOf = (n, e) => 0.2 + 0.8 * hash(n * 11 + e * 5 + 3);
    const nB = this.BEAMS;
    for (const b of this.beams) {
      const top = b.e === 2;
      // the top rig only joins at drops and peaks
      const rigOn = top ? (dropHot || hot > 0.8 ? 1 : 0) : 1;
      let gate;
      if (mode === 'pulse8') gate = sub8 < 0.45 ? 1 : 0;
      else if (mode === 'pulse16') gate = sub16 < 0.5 ? 1 : 0;
      else if (mode === 'hit') gate = Math.exp(-ph * P / 0.07);
      else if (mode === 'chase') gate = ((n16 + (b.e === 1 ? nB / 2 : 0)) % nB) === b.k || ((n16 + 3) % nB) === b.k ? 1 : 0;
      else gate = 0.75 + 0.25 * beatPulse; // sweep: continuous, moving fast
      // snap to a new aim every beat (every half beat when hot)
      const snap = hot > 0.6 || dropHot ? Math.floor(bt * 2) : beat;
      const aim = aimOf(snap, b.e) + (mode === 'sweep' ? 0.45 * Math.sin((2 * Math.PI * t) / (P * 2) + b.e) : 0);
      const spread = spreadOf(step, b.e);
      const off = (b.k / (nB - 1) - 0.5) * spread;
      let ang, x, y;
      if (top) {
        ang = -Math.PI / 2 + (aim - 0.7) * 0.9 + off;
        x = cam.x; y = cam.y + vh * 0.6;
      } else {
        const side = b.e === 0 ? 1 : -1;
        ang = side > 0 ? aim + off : Math.PI - aim - off;
        x = cam.x - side * vw * 0.56; y = cam.y - vh * 0.56;
      }
      for (const m of [b.core, b.halo]) {
        m.position.set(x, y, 0.55);
        m.rotation.set(0, 0, ang);
        m.scale.set(len, m === b.core ? 0.007 : 0.035, 1);
      }
      const c = this.palette[top ? 2 : b.e === 0 ? 0 : 1];
      // lasers black out under a thunder flash, then slam back
      const a = L * rigOn * gate * (1 + 0.8 * kp * punch) * (1 - Math.min(1, fl * 1.5));
      b.core.material.color.copy(c).multiplyScalar(3.4 * a);
      b.halo.material.color.copy(c).multiplyScalar(0.1 * a);
      b.core.visible = b.halo.visible = a > 0.01;
    }

    // shockwave rings from the ball at drops and thunder
    const ri = this.lastBefore(this.ringT, t);
    this.rings.forEach((ring, j) => {
      const idx = ri - j;
      const age = idx >= 0 ? t - this.ringT[idx] : 1e9;
      const on = age < 0.9 && wild;
      ring.visible = on;
      if (!on) return;
      const rad = 0.08 + 2.6 * (1 - Math.pow(1 - age / 0.9, 2.2));
      const cx = ball ? ball.x : cam.x, cy = ball ? ball.y : cam.y;
      ring.position.set(cx, cy, 0.02);
      ring.scale.setScalar(rad);
      ring.material.color.copy(this.palette[0]).lerp(THUNDER, 0.3).multiplyScalar(3 * Math.pow(1 - age / 0.9, 1.5));
    });

    // neon rails pulse hard with the kick
    this.railMat.emissive.copy(this.palette[2]).lerp(THUNDER, fl);
    this.railMat.emissiveIntensity = 1.4 + 1.6 * E + 3.5 * kp * punch + 4 * fl;
    // edge strips breathe with the beat
    const breathe = 1.2 + 0.7 * E + 1.4 * beatPulse * punch + 3 * fl;
    for (let pc = 0; pc < 12; pc++) this.stripMats[pc].color.copy(neonNoteColor(pc)).multiplyScalar(breathe);

    // the ball glows lime and lights its surroundings
    if (this.ballMat) {
      this.ballMat.emissive.copy(this.palette[0]).lerp(this.tmp.set('#ffffff'), 0.12);
      this.ballMat.emissiveIntensity = 0.32 + 0.6 * kp * punch + 0.6 * fl;
    }
    if (ball) {
      // inside the ball: it lights the wall and bars around it, not its own face
      this.ballLight.position.set(ball.x, ball.y, 0.11);
      this.ballLight.color.copy(this.palette[0]);
      this.ballLight.intensity = 0.3 + 0.45 * E + 0.8 * kp * punch;
    }

    // a small camera punch on loud kicks, and the glow blooms on flashes
    this.camPunch = wild ? 1 - 0.018 * kp * hot : 1;
    this.bloomBoost = 0.7 * fl + 0.2 * kp * hot * punch;
  }
}

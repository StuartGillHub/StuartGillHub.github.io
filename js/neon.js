/* Neon club look: dark wall, colour-washing moving lights, laser fans and
 * strobes, all choreographed from the song's beat grid, kick drum, energy
 * envelope and drops (see XB.Analysis.lightShow). Everything is a function
 * of song time, so it stays locked to the music and survives seeking.
 */
import * as THREE from 'three';

// Neon palettes; the show moves to the next one every 16 beats and at drops.
const PALETTES = [
  ['#ff2bd6', '#00e5ff', '#7a5cff'],
  ['#00ffa3', '#ff3d7f', '#2de2e6'],
  ['#ffb000', '#ff006e', '#8338ec'],
  ['#3a86ff', '#ff00a8', '#00f5d4'],
];
const NEON_HUES = [330, 350, 18, 45, 90, 150, 175, 195, 215, 250, 280, 305];
export const neonNoteColor = (pc) => new THREE.Color().setHSL(NEON_HUES[pc] / 360, 1, 0.56);

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
function hash(n) {
  let h = (n * 374761393) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Dim club reflected in glossy surfaces: dark room with neon tubes.
function clubRoom() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: '#07060b', side: THREE.BackSide })));
  const tube = (w, h, c, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry || 0; env.add(m);
  };
  tube(8, 0.15, '#ff2bd6', 0, 2.6, -3);
  tube(8, 0.15, '#00e5ff', 0, -2.6, -3);
  tube(0.15, 4, '#7a5cff', -4.8, 0, 0, Math.PI / 2);
  tube(0.15, 4, '#ff2bd6', 4.8, 0, 0, Math.PI / 2);
  tube(3, 1.2, '#2a2438', 0, 0.5, 4.9);
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
    this.ambient = new THREE.HemisphereLight('#3a3160', '#050308', 0.35);
    this.group.add(this.ambient);
    this.front = new THREE.DirectionalLight('#6a5cff', 0.18);
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
    for (let e = 0; e < 2; e++) {
      for (let k = 0; k < 6; k++) {
        const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
        const halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
        core.renderOrder = halo.renderOrder = 10;
        core.frustumCulled = halo.frustumCulled = false;
        this.group.add(core, halo);
        this.beams.push({ e, k, core, halo });
      }
    }

    // --- skin materials ---
    this.wallMat = new THREE.MeshStandardMaterial({ color: '#2a2636', roughness: 0.45, metalness: 0.15, normalMap: paintNormal, normalScale: new THREE.Vector2(0.22, 0.22) });
    this.railMat = new THREE.MeshStandardMaterial({ color: '#0d0d12', metalness: 0.5, roughness: 0.3, emissive: '#00e5ff', emissiveIntensity: 1.2 });
    this.tieMat = new THREE.MeshStandardMaterial({ color: '#2b2b36', metalness: 0.9, roughness: 0.3, envMap: this.env });
    this.barMat = (pc) => new THREE.MeshPhysicalMaterial({
      color: '#0c0c12', metalness: 0.85, roughness: 0.22, envMap: this.env, envMapIntensity: 1.4,
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

  // Strobe moments: kicks in the loudest passages, the first bars after a
  // drop, never more than 3 flashes a second (photosensitivity guideline).
  prepare(show) {
    if (this.show === show) return;
    this.show = show;
    const strobes = [];
    const env = (t) => show.env[Math.max(0, Math.min(show.env.length - 1, Math.round(t * show.envHz)))];
    const loud = [...show.env].sort((a, b) => a - b)[Math.floor(show.env.length * 0.8)] || 1;
    const push = (t) => { if (!strobes.length || t - strobes[strobes.length - 1] >= 0.34) strobes.push(t); };
    const cand = show.kicks.filter((k) => env(k.t) >= Math.max(0.55, loud * 0.95)).map((k) => k.t);
    for (const d of show.drops) for (let b = 0; b < 8; b++) cand.push(d + b * show.period);
    cand.sort((a, b) => a - b).forEach(push);
    this.strobes = strobes;
    this.kickT = show.kicks.map((k) => k.t);
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
    const safe = !opts.strobes;
    const punch = safe ? 0.35 : 1;

    // strobe
    let flash = 0;
    const si = this.lastBefore(this.strobes, t);
    if (si >= 0) flash = Math.exp(-(t - this.strobes[si]) / 0.045);
    if (this.flashEl) this.flashEl.style.opacity = opts.strobes ? (0.62 * flash).toFixed(3) : '0';

    // moving washes sweep the wall, pumping with the kick
    const w = (2 * Math.PI) / (P * 8);
    this.washes.forEach((l, i) => {
      l.color.copy(this.palette[i]).lerp(this.tmp.set('#ffffff'), 0.6 * flash * punch);
      l.position.set(cam.x + (i - 1) * vw * 0.45, cam.y + vh * 0.85, 2.3);
      l.target.position.set(cam.x + Math.sin(w * t + i * 2.1) * vw * 0.34, cam.y + Math.cos(w * 0.7 * t + i * 1.3) * vh * 0.28, 0);
      l.intensity = (2.2 + 6 * E) * (1 + 1.4 * kp * punch) + 10 * flash * punch;
      l.angle = 0.3 + 0.12 * E;
    });
    this.front.position.set(cam.x - 1, cam.y + 1, 3);
    this.front.target.position.set(cam.x, cam.y, 0);
    this.ambient.intensity = 0.25 + 0.25 * E;

    // lasers: in the energetic parts, pattern changes on every other beat
    let L = smooth((E - 0.42) / 0.3);
    const di = this.lastBefore(s.drops, t);
    if (di >= 0 && t - s.drops[di] < P * 16) L = Math.max(L, smooth((E - 0.15) / 0.2));
    const step = Math.floor(beat / 2), next = step + 1;
    const ease = smooth((ph + (beat % 2)) / 2 * 1.6 - 0.3);
    const aimOf = (n, e) => 0.35 + 0.7 * hash(n * 7 + e * 13);
    const spreadOf = (n, e) => 0.15 + 0.65 * hash(n * 11 + e * 5 + 3);
    const len = Math.hypot(vw, vh) * 1.3;
    for (const b of this.beams) {
      const side = b.e === 0 ? 1 : -1;
      const aim = aimOf(step, b.e) + (aimOf(next, b.e) - aimOf(step, b.e)) * ease + 0.12 * Math.sin((2 * Math.PI * t) / (P * 4) + b.e);
      const spread = spreadOf(step, b.e) + (spreadOf(next, b.e) - spreadOf(step, b.e)) * ease;
      const off = (b.k / 5 - 0.5) * spread;
      // angle measured from the wall's horizontal; left emitter fires up-right
      const ang = side > 0 ? aim + off : Math.PI - aim - off;
      const x = cam.x - side * vw * 0.56, y = cam.y - vh * 0.56;
      for (const m of [b.core, b.halo]) {
        m.position.set(x, y, 0.55);
        m.rotation.set(0, 0, ang);
        m.scale.set(len, m === b.core ? 0.007 : 0.07, 1);
      }
      const c = this.palette[b.e === 0 ? 0 : 1];
      const a = L * (0.55 + 0.45 * beatPulse) * (1 + 0.8 * kp * punch);
      b.core.material.color.copy(c).multiplyScalar(2.6 * a);
      b.halo.material.color.copy(c).multiplyScalar(0.22 * a);
      b.core.visible = b.halo.visible = a > 0.01;
    }

    // neon rails pulse with the kick
    this.railMat.emissive.copy(this.palette[2]);
    this.railMat.emissiveIntensity = 1.5 + 1.2 * E + 2.5 * kp * punch;
    // edge strips breathe with the beat
    const breathe = 1.1 + 0.5 * E + 0.9 * beatPulse * punch;
    for (let pc = 0; pc < 12; pc++) this.stripMats[pc].color.copy(neonNoteColor(pc)).multiplyScalar(breathe);

    // the ball glows and lights its surroundings
    if (this.ballMat) {
      // a glowing sphere, not a blob: moderate self-light, a halo from bloom on the kick
      this.ballMat.emissive.copy(this.palette[0]).lerp(this.tmp.set('#ffffff'), 0.12);
      this.ballMat.emissiveIntensity = 0.3 + 0.5 * kp * punch;
    }
    if (ball) {
      // inside the ball: it lights the wall and bars around it, not its own face
      this.ballLight.position.set(ball.x, ball.y, 0.11);
      this.ballLight.color.copy(this.palette[0]);
      this.ballLight.intensity = 0.25 + 0.35 * E + 0.5 * kp * punch;
    }
  }
}

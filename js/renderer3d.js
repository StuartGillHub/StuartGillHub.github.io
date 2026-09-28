/* 3D renderer (Three.js). The physics lives in the wall plane; here it is
 * dressed as a real object: a painted brick wall lit by warm light, wooden
 * xylophone bars standing off the wall on brass pegs, brass wire tracks that
 * stick out of the wall and cradle the ball from underneath, soft shadows,
 * reflections and a gentle bloom for the strike glow.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { NeonShow, neonNoteColor } from './neon.js';

const XB = window.XB;
const { R, T, G } = XB.PHYS;
const ZB = 0.11; // distance of the ball / bar centres from the wall
const BAR_D = 0.07; // bar depth (front-to-back)
const RAIL_R = 0.0042; // wire radius
const PEG_R = 0.0062; // steel pin radius
const FOV = 30;

// Anodised-aluminium tints, one per pitch class (subtle, around the colour wheel).
const METAL_HUES = [8, 28, 44, 62, 95, 150, 180, 200, 222, 255, 290, 330];
const metalTint = (pc) => new THREE.Color().setHSL(METAL_HUES[pc] / 360, 0.34, 0.68);
// Warm tonewoods (kept for the start shelf).
const WOODS = ['#7b2f1d', '#a3502b', '#5f3a24', '#b8733f', '#8c3a22', '#caa06a',
  '#6e2a1a', '#b5613a', '#4f3322', '#9c5a36', '#7d4527', '#d0a877'];
const GLOW = new THREE.Color('#ffb45c');
const BRASS = '#c9a063';

// A dim room with warm neon strips, used only for reflections, so polished
// metal and lacquer pick up the same light that washes the wall.
function neonRoom(bright) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: bright ? '#b9a391' : '#211915', side: THREE.BackSide }));
  env.add(room);
  const strip = (w, h, color, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry || 0; env.add(m);
  };
  strip(8, 0.25, '#ffb070', 0, -2.4, -3);      // amber neon low on the far wall
  strip(8, 0.25, '#ff9a5a', 0, -2.4, 3);
  strip(0.25, 3, '#ff6f8a', 4.5, -1, 0, Math.PI / 2); // rose accent
  strip(7, 3.2, '#6e5c50', 0, 0.4, 4.9);       // soft warm panel behind the viewer: lifts faces
  strip(2.2, 1.2, '#fff1e0', 1.5, 2.5, -2);     // small bright softbox for crisp speculars
  if (bright) {
    strip(10, 3, '#f3dcc4', 0, -0.5, -4.95);    // the lit wall behind
    strip(10, 0.5, '#ffc890', 0, -2.7, 0, 0);   // hot neon line below
  }
  return env;
}

function barColorCss(midi) {
  return '#' + metalTint(((midi % 12) + 12) % 12).getHexString();
}

class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap; // uses shadow.radius for soft edges

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#23170f');
    const pm = new THREE.PMREMGenerator(r);
    this.sceneEnv = pm.fromScene(neonRoom(false), 0.03).texture;
    scene.environment = this.sceneEnv;
    // polished steel reflects the brightly lit white wall around it
    this.metalEnv = pm.fromScene(neonRoom(true), 0.02).texture;
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);

    // --- lights: warm key with soft shadows, warm sky/bounce, glow pool ---
    // Studio look: dim room ambient
    const studio = (this.studio = new THREE.Group());
    scene.add(studio);
    studio.add(new THREE.HemisphereLight('#fff3e6', '#3a2a22', 0.42));
    // warm amber neon strip below the frame, washing up the wall: grazing
    // light that throws long shadows of the bars, pegs and ball upwards
    const key = (this.key = new THREE.SpotLight('#ffa05a', 22, 0, 1.2, 1, 1.2));
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.01;
    key.shadow.radius = 3.5;
    key.shadow.blurSamples = 12;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 9;
    studio.add(key, key.target);
    // a second, rosier neon from lower right for colour depth (no shadows)
    const neon2 = (this.neon2 = new THREE.SpotLight('#ff7a8c', 5, 0, 1.1, 1, 1.2));
    studio.add(neon2, neon2.target);
    // and an amber one lower left, so together they read as a long strip
    const neon3 = (this.neon3 = new THREE.SpotLight('#ffb066', 4, 0, 1.1, 1, 1.2));
    studio.add(neon3, neon3.target);
    // faint frontal fill so the fronts of the bars never go black
    const fill = (this.fill = new THREE.DirectionalLight('#ffe8d2', 0.45));
    studio.add(fill, fill.target);
    this.glowLights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(GLOW, 0, 0.8, 2);
      scene.add(l);
      this.glowLights.push(l);
    }

    // --- wall ---
    const tex = TX.makePaintTextures(2048);
    const REP = 12;
    for (const t of [tex.map, tex.normalMap, tex.roughnessMap]) t.repeat.set(REP, REP);
    this.wall = new THREE.Mesh(
      new THREE.PlaneGeometry(TX.PAINT_TILE * REP, TX.PAINT_TILE * REP),
      new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap, normalScale: new THREE.Vector2(0.32, 0.32) })
    );
    this.wall.receiveShadow = true;
    scene.add(this.wall);
    this.studioWallMat = this.wall.material;
    this.neon = new NeonShow(this, tex.normalMap);

    // --- shared materials ---
    this.woodTex = TX.makeWoodTexture();
    this.letterTex = TX.makeLetterAtlas();
    this.brushed = TX.makeBrushedTexture();
    this.brass = new THREE.MeshStandardMaterial({ color: BRASS, metalness: 1, roughness: 0.28 });
    // sleek polished steel for the pegs that hold the bars
    this.chrome = new THREE.MeshPhysicalMaterial({ color: '#f2f3f5', metalness: 1, roughness: 0.06, envMap: this.metalEnv, envMapIntensity: 1.1 });
    this.brassDark = new THREE.MeshStandardMaterial({ color: '#8d6a3d', metalness: 1, roughness: 0.4 });
    this.letterMat = new THREE.MeshStandardMaterial({ map: this.letterTex, color: '#3a3431', metalness: 0.3, roughness: 0.55, transparent: true, depthWrite: false });
    this.letterGeoms = [];
    for (let i = 0; i < 12; i++) {
      const g = new THREE.PlaneGeometry(0.032, 0.032);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 12);
      this.letterGeoms.push(g);
    }
    this.pegGeo = new THREE.CylinderGeometry(PEG_R, PEG_R, 1, 20).rotateX(Math.PI / 2);
    this.tipGeo = new THREE.SphereGeometry(PEG_R, 20, 12);
    this.flangeGeo = new THREE.CylinderGeometry(0.011, 0.012, 0.004, 24).rotateX(Math.PI / 2);
    this.capGeo = new THREE.SphereGeometry(0.0075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);

    // --- ball ---
    this.ballTex = TX.makeBallTexture();
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(R, 48, 32),
      new THREE.MeshPhysicalMaterial({ map: this.ballTex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 })
    );
    this.studioBallMat = this.ball.material;
    this.ball.castShadow = true;
    this.ball.position.z = ZB;
    scene.add(this.ball);

    this.courseGroup = new THREE.Group();
    scene.add(this.courseGroup);

    // --- post: bloom for glows ---
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.6, 1.02);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.cam = { x: 0, y: 0 };
    this.course = null;
    this.active = new Set();
    this.skin = 'studio';
    this.resize();
  }

  /* ---------------- skins ---------------- */
  setSkin(name) {
    if (name === this.skin) return;
    this.skin = name;
    const neon = name === 'neon';
    this.studio.visible = !neon;
    this.neon.group.visible = neon;
    this.wall.material = neon ? this.neon.wallMat : this.studioWallMat;
    this.ball.material = neon ? this.neon.ballMaterial(this.ballTex) : this.studioBallMat;
    this.scene.background.set(neon ? '#000000' : '#23170f');
    this.scene.environment = neon ? this.neon.env : this.sceneEnv;
    this.scene.environmentIntensity = neon ? 0.8 : 0.55;
    this.r.toneMappingExposure = neon ? 1.0 : 0.95;
    this.bloom.strength = neon ? 0.8 : 0.42;
    this.bloom.radius = neon ? 0.55 : 0.6;
    this.bloom.threshold = neon ? 0.85 : 1.02;
    this.glowLights.forEach((l) => { l.intensity = 0; });
    document.body.classList.toggle('skin-neon', neon);
    // rebuild the course with this skin's materials
    if (this.course) { const c = this.course; this.clearCourse(); this.course = null; this.pendingCourse = c; }
  }

  // Adaptive quality: if frames are slow, render at a lower pixel ratio.
  adapt() {
    const now = performance.now();
    if (this.lastT) {
      const dt = now - this.lastT;
      if (dt < 200) this.avg = this.avg ? this.avg * 0.95 + dt * 0.05 : dt;
      this.frames = (this.frames || 0) + 1;
      if (this.frames > 90 && this.avg > 24 && this.quality > 0.55) {
        this.quality = Math.max(0.55, this.quality - 0.2);
        this.frames = 0;
        this.resize();
      }
    }
    this.lastT = now;
  }

  resize() {
    if (this.quality == null) this.quality = 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    const aspect = this.W / this.H;
    this.r.setPixelRatio(this.dpr);
    this.r.setSize(this.W, this.H, false);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(this.W, this.H);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // frame at least 1.45 m wide and 1.95 m tall: close enough to see detail
    this.visH = Math.max(1.95, 1.45 / aspect);
    this.visW = this.visH * aspect;
    this.dist = this.visH / (2 * Math.tan((FOV * Math.PI) / 360));
    // the uplights' beams must span the view's width
    // just wide enough to cover the view: a tighter cone keeps shadow detail crisp
    const reach = Math.hypot(this.visH * 1.3, 1.9);
    this.key.angle = Math.min(1.0, Math.atan((Math.max(this.visW, this.visH * 0.8) * 0.62) / reach) + 0.3);
    this.neon2.angle = this.neon3.angle = Math.min(1.1, this.key.angle + 0.1);
    // keep the wall exposure the same whatever the framing distance
    const k = Math.pow(reach / 4.2, 1.2);
    this.key.intensity = 20 * k;
    this.neon2.intensity = 4.5 * k;
    this.neon3.intensity = 5 * k;
  }

  /* ---------------- building the course ---------------- */
  clearCourse() {
    for (const o of this.barObjs || []) if (o.flashMat) o.flashMat.dispose();
    const g = this.courseGroup;
    g.traverse((o) => {
      if (o.isMesh) {
        if (o.userData.ownGeo) o.geometry.dispose();
        if (o.userData.ownMat) o.material.dispose();
        if (o.userData.capMat) o.userData.capMat.dispose();
      }
    });
    g.clear();
    this.barObjs = [];
    this.active.clear();
  }

  buildCourse(course) {
    this.clearCourse();
    this.course = course;
    for (const b of course.bars) this.barObjs.push(this.makeBar(b));
    for (const w of course.wires) this.courseGroup.add(this.makeWire(w));
    this.courseGroup.add(this.makeLedge(course));
    this.courseGroup.add(this.makeCup(course));
    this.barTimes = course.bars.map((b) => b.t);
  }

  makeBar(b) {
    const L = b.lenL + b.lenR;
    const grp = new THREE.Group();
    const cx = b.sx + b.tX * (b.lenR - b.lenL) * 0.5 - b.nx * T * 0.5;
    const cy = b.sy + b.tY * (b.lenR - b.lenL) * 0.5 - b.ny * T * 0.5;
    grp.position.set(cx, cy, ZB);
    grp.rotation.z = Math.atan2(b.tY, b.tX);
    const pc = ((b.midi % 12) + 12) % 12;
    // sleek glockenspiel bar: polished, faintly brushed, anodised tint;
    // a thin-film sheen that blooms into colour when it is struck
    const neon = this.skin === 'neon';
    const mat = neon ? this.neon.barMat(pc) : new THREE.MeshPhysicalMaterial({
      color: metalTint(pc), metalness: 1, roughness: 0.17, roughnessMap: this.brushed,
      envMap: this.sceneEnv, envMapIntensity: 2.2,
      clearcoat: 0.6, clearcoatRoughness: 0.08,
      iridescence: 0.08, iridescenceIOR: 1.5, iridescenceThicknessRange: [180, 520],
      emissive: GLOW.clone(), emissiveIntensity: 0,
    });
    mat.userData.hue = METAL_HUES[pc] / 360;
    const bar = new THREE.Mesh(new RoundedBoxGeometry(L, T, BAR_D, 2, 0.006), mat);
    bar.castShadow = bar.receiveShadow = true;
    bar.userData.ownGeo = bar.userData.ownMat = true;
    grp.add(bar);
    let strip = null;
    if (neon) {
      // neon edge along the struck face (on the side the ball hits)
      strip = new THREE.Mesh(new THREE.BoxGeometry(L * 0.94, 0.0035, 0.004), this.neon.stripMats[pc]);
      strip.position.set(0, T / 2 - 0.004, BAR_D / 2 + 0.001);
      strip.userData.ownGeo = true;
      grp.add(strip);
    }
    // Polished steel pins at the vibration nodes, out of the wall and under
    // the bar (a xylophone bar rests on its nodes), just proud of its front.
    const capMat = new THREE.MeshPhysicalMaterial({ color: '#f4f5f7', metalness: 1, roughness: 0.05, envMap: neon ? this.neon.env : this.metalEnv, envMapIntensity: neon ? 1.6 : 1.1, emissive: neon ? neonNoteColor(pc) : GLOW, emissiveIntensity: 0 });
    const pinY = -T / 2 - PEG_R * 0.92;
    const zFront = BAR_D / 2 + 0.014;
    const pinLen = ZB + zFront;
    for (const u of [-L / 2 + 0.224 * L, L / 2 - 0.224 * L]) {
      const peg = new THREE.Mesh(this.pegGeo, capMat);
      peg.scale.z = pinLen;
      peg.position.set(u, pinY, (zFront - ZB) / 2);
      peg.castShadow = true;
      grp.add(peg);
      const tip = new THREE.Mesh(this.tipGeo, capMat);
      tip.position.set(u, pinY, zFront);
      grp.add(tip);
      const fl = new THREE.Mesh(this.flangeGeo, this.chrome);
      fl.position.set(u, pinY, -ZB + 0.002);
      grp.add(fl);
    }
    bar.userData.capMat = capMat;
    if (L > 0.1 && !neon) {
      const lt = new THREE.Mesh(this.letterGeoms[pc], this.letterMat);
      lt.position.set(0, 0, BAR_D / 2 + 0.0008);
      if (b.ceil) lt.rotation.z = Math.PI; // bar hangs upside down: keep the letter upright
      grp.add(lt);
    }
    grp.updateMatrixWorld(true);
    grp.traverse((o) => { o.matrixAutoUpdate = false; });
    grp.matrixAutoUpdate = true;
    this.courseGroup.add(grp);
    return { grp, mat, capMat, strip, pc, base: { x: cx, y: cy, rot: grp.rotation.z }, b };
  }

  makeWire(seg) {
    // sample the centre line every ~1 cm
    const idx = [];
    let last = -1;
    for (let i = 0; i <= seg.n; i++) {
      if (i === 0 || i === seg.n || seg.ss[i] - last >= 0.01) { idx.push(i); last = seg.ss[i]; }
    }
    const m = idx.length;
    const total = seg.ss[seg.n];
    // The rail pair's roll angle φ round the ball: D = cos φ·(−n) + sin φ·(−z).
    // φ = 0 puts the rails under a ball heading right, φ = π under one
    // heading left; on vertical stretches (φ = π/2) they sit on the wall
    // side. Following gravity this is simply φ = |heading|, which changes
    // smoothly through every corner. In loops the ball is pressed outwards,
    // so there the rails run round the outside. φ is then smoothed along
    // the track so no corner gets a kink.
    const phi = new Float32Array(m);
    const loopW = new Float32Array(m);
    for (let k = 0; k < m; k++) loopW[k] = seg.lp ? seg.lp[idx[k]] : 0;
    for (let k = 0; k < m; k++) {
      const i = idx[k];
      const th = seg.th[i];
      const pg = Math.acos(Math.max(-1, Math.min(1, Math.cos(th))));
      let lw = 0, c2 = 0;
      for (let j = Math.max(0, k - 6); j <= Math.min(m - 1, k + 6); j++) { lw += loopW[j]; c2++; }
      lw /= c2;
      const a0 = Math.max(0, i - 4), a1 = Math.min(seg.n, i + 4);
      const kappa = (seg.th[a1] - seg.th[a0]) / (seg.ss[a1] - seg.ss[a0] || 1e-6);
      const N = kappa * seg.sp[i] * seg.sp[i] + G * Math.cos(th);
      const pl = N >= 0 ? 0 : Math.PI;
      phi[k] = pg * (1 - lw) + pl * lw;
    }
    const phiS = new Float32Array(m);
    const SIG = 7;
    for (let k = 0; k < m; k++) {
      let s2 = 0, w2 = 0;
      for (let j = Math.max(0, k - 3 * SIG); j <= Math.min(m - 1, k + 3 * SIG); j++) {
        const w = Math.exp(-((j - k) ** 2) / (2 * SIG * SIG));
        s2 += phi[j] * w; w2 += w;
      }
      phiS[k] = s2 / w2;
    }
    const railA = [], railB = [], frames = [];
    for (let k = 0; k < m; k++) {
      const i = idx[k];
      const th = seg.th[i];
      const s = seg.ss[i];
      const tv = new THREE.Vector3(Math.cos(th), Math.sin(th), 0);
      const nv = new THREE.Vector3(-Math.sin(th), Math.cos(th), 0);
      const D = nv.clone().multiplyScalar(-Math.cos(phiS[k])).add(new THREE.Vector3(0, 0, -Math.sin(phiS[k])));
      const Wv = new THREE.Vector3().crossVectors(tv, D);
      const f = Math.max(0, 1 - s / 0.09);
      const flare = f * f;
      const alpha = 0.8 + 0.35 * flare;
      const off = (R + RAIL_R + 0.0004) * (1 + 0.4 * flare);
      const c = new THREE.Vector3(seg.xs[i], seg.ys[i], ZB);
      const ca = Math.cos(alpha) * off, sa = Math.sin(alpha) * off;
      railA.push(c.clone().addScaledVector(D, ca).addScaledVector(Wv, sa));
      railB.push(c.clone().addScaledVector(D, ca).addScaledVector(Wv, -sa));
      frames.push({ c, D, s, total });
    }
    const geos = [];
    for (const pts of [railA, railB]) {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      geos.push(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), RAIL_R, 7, false));
      for (const p of [pts[0], pts[pts.length - 1]]) geos.push(new THREE.SphereGeometry(RAIL_R * 1.05, 8, 6).translate(p.x, p.y, p.z));
    }
    const rails = new THREE.Mesh(mergeGeometries(geos), this.skin === 'neon' ? this.neon.railMat : this.brass);
    rails.castShadow = true; rails.receiveShadow = true;
    rails.userData.ownGeo = true;

    // cross ties cradling the ball, and stand-offs back to the wall
    const tg = [];
    let nextTie = 0.03, nextPost = 0.14;
    for (let k = 0; k < m; k++) {
      const { c, D, s } = frames[k];
      if (s >= nextTie) {
        const mid = c.clone().addScaledVector(D, 0.05);
        const curve = new THREE.QuadraticBezierCurve3(railA[k], mid, railB[k]);
        tg.push(new THREE.TubeGeometry(curve, 8, 0.0016, 5, false));
        nextTie += 0.06;
      }
      if (s >= nextPost && total - s > 0.06) {
        const b = c.clone().addScaledVector(D, 0.045);
        const len = b.z;
        tg.push(new THREE.CylinderGeometry(0.0024, 0.0024, len, 8).rotateX(Math.PI / 2).translate(b.x, b.y, len / 2));
        tg.push(new THREE.CylinderGeometry(0.008, 0.009, 0.003, 16).rotateX(Math.PI / 2).translate(b.x, b.y, 0.0015));
        nextPost += 0.27;
      }
    }
    const grp = new THREE.Group();
    grp.add(rails);
    if (tg.length) {
      const ties = new THREE.Mesh(mergeGeometries(tg), this.skin === 'neon' ? this.neon.tieMat : this.brass);
      ties.castShadow = true;
      ties.userData.ownGeo = true;
      grp.add(ties);
    }
    return grp;
  }

  makeLedge(course) {
    const { ledge } = course;
    const a = ledge.start, e = ledge.end.p;
    const ang = Math.atan2(e.y - a.y, e.x - a.x);
    const len = Math.hypot(e.x - a.x, e.y - a.y) + 0.12;
    const grp = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ map: this.woodTex, color: '#a0703f', roughness: 0.5, clearcoat: 0.4 });
    const shelf = new THREE.Mesh(new RoundedBoxGeometry(len, 0.03, 0.15, 2, 0.006), mat);
    shelf.castShadow = shelf.receiveShadow = true;
    shelf.userData.ownGeo = shelf.userData.ownMat = true;
    // centre so that the top face sits R below the ball's path, ending at the edge
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const nx = -uy, ny = ux;
    shelf.position.set(e.x - ux * (len / 2 - 0.01) - nx * (R + 0.015), e.y - uy * (len / 2 - 0.01) - ny * (R + 0.015), ZB - 0.005);
    shelf.rotation.z = ang;
    grp.add(shelf);
    for (const f of [0.2, 0.8]) {
      const px = e.x - ux * len * f - nx * (R + 0.045), py = e.y - uy * len * f - ny * (R + 0.045);
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, ZB), this.brassDark);
      br.position.set(px, py, ZB / 2);
      br.castShadow = true;
      br.userData.ownGeo = true;
      grp.add(br);
    }
    return grp;
  }

  makeCup(course) {
    const c = course.cup;
    const grp = new THREE.Group();
    const prof = [[0, 0], [0.05, 0], [0.062, 0.006], [0.07, 0.03], [0.074, 0.048], [0.078, 0.05]].map((p) => new THREE.Vector2(p[0], p[1]));
    const cup = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), new THREE.MeshStandardMaterial({ color: BRASS, metalness: 1, roughness: 0.22, side: THREE.DoubleSide }));
    cup.position.set(c.x, c.y - 0.004, ZB);
    cup.castShadow = cup.receiveShadow = true;
    cup.userData.ownGeo = cup.userData.ownMat = true;
    grp.add(cup);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, ZB - 0.06, 10).rotateX(Math.PI / 2), this.brassDark);
    rod.position.set(c.x, c.y + 0.02, (ZB - 0.06) / 2);
    rod.userData.ownGeo = true;
    grp.add(rod);
    return grp;
  }

  /* ---------------- per frame ---------------- */
  updateBars(t) {
    const times = this.barTimes;
    // bars struck within the last 1.6 s are animated
    let lo = 0, hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t - 1.6) lo = mid + 1; else hi = mid; }
    const now = new Set();
    const lights = [];
    for (let i = lo; i < times.length && times[i] <= t; i++) now.add(i);
    for (const i of this.active) if (!now.has(i)) this.resetBar(this.barObjs[i]);
    for (const i of now) {
      const o = this.barObjs[i];
      const b = o.b;
      const age = t - b.t;
      const env = Math.exp(-age / 0.07);
      const dip = -0.005 * (0.4 + b.vin * 0.15) * env * Math.cos(age * Math.PI * 22);
      const rock = 0.018 * Math.exp(-age / 0.25) * Math.sin(age * Math.PI * 14) * (0.3 + b.strength);
      o.grp.position.set(o.base.x + b.nx * dip, o.base.y + b.ny * dip, ZB);
      o.grp.rotation.z = o.base.rot + rock;
      const glow = Math.exp(-age / 0.32) * (0.55 + 0.45 * b.strength);
      if (this.skin === 'neon') {
        // the bar flares in its note colour; its neon edge blazes
        o.mat.emissiveIntensity = 0.55 * glow;
        o.capMat.emissiveIntensity = 2 * glow;
        if (o.strip) {
          if (!o.flashMat) o.flashMat = new THREE.MeshBasicMaterial({ toneMapped: false });
          o.strip.material = o.flashMat;
          o.flashMat.color.copy(neonNoteColor(o.pc)).lerp(new THREE.Color('#ffffff'), 0.2 * glow).multiplyScalar(1.4 + 5 * glow);
        }
        lights.push({ o, glow, age });
        continue;
      }
      o.mat.emissiveIntensity = 0.34 * glow;
      // the flash drifts from warm gold through the bar's own tint as it fades
      const h0 = 0.09, h1 = o.mat.userData.hue;
      let dh = h1 - h0; if (dh > 0.5) dh -= 1; if (dh < -0.5) dh += 1;
      const mix = Math.min(1, age / 0.45);
      o.mat.emissive.setHSL((h0 + dh * mix + 1) % 1, 0.75, 0.55);
      o.mat.iridescence = 0.08 + 0.9 * glow;
      o.capMat.emissiveIntensity = 1.6 * glow;
      lights.push({ o, glow, age });
    }
    this.active = now;
    lights.sort((a, b) => a.age - b.age);
    this.glowLights.forEach((l, k) => {
      const e = lights[k];
      if (!e) { l.intensity = 0; return; }
      l.position.set(e.o.base.x, e.o.base.y, ZB + 0.22);
      if (this.skin === 'neon') {
        l.color.copy(neonNoteColor(e.o.pc));
        l.intensity = 0.22 * e.glow;
      } else {
        l.color.copy(GLOW);
        l.intensity = 0.12 * e.glow;
      }
    });
  }
  resetBar(o) {
    o.grp.position.set(o.base.x, o.base.y, ZB);
    o.grp.rotation.z = o.base.rot;
    o.mat.emissiveIntensity = 0;
    if (this.skin !== 'neon') o.mat.iridescence = 0.08;
    o.capMat.emissiveIntensity = 0;
    if (o.strip) o.strip.material = this.neon.stripMats[o.pc];
  }

  draw(course, camTrack, t, show, opts) {
    this.adapt();
    let ball;
    if (course) {
      if (course !== this.course) this.buildCourse(course);
      this.pendingCourse = null;
      ball = XB.Course.evalAt(course, t, {});
      this.cam = this.focusBall ? { x: ball.x, y: ball.y } : XB.Camera.at(camTrack, t, ball, this.visW, this.visH);
      this.ball.visible = true;
      this.ball.position.set(ball.x, ball.y, ZB);
      this.ball.rotation.z = ball.ang;
      this.updateBars(t);
      this.lastBall = ball;
    } else {
      if (this.course) { this.clearCourse(); this.course = null; }
      const s = performance.now() / 1000;
      this.cam = { x: Math.sin(s * 0.1) * 0.3, y: Math.sin(s * 0.07) * 0.2 };
      this.ball.visible = false;
    }
    const { x, y } = this.cam;
    const D = this.dist * (this.zoom || 1) * (this.skin === 'neon' && this.neon.camPunch ? this.neon.camPunch : 1);
    // look at the wall from slightly above and to the left: bar tops,
    // track depth and cast shadows all read as 3D
    this.camera.position.set(x - D * 0.07, y + D * 0.2, ZB + D);
    this.camera.lookAt(x, y, ZB);
    const TW = TX.PAINT_TILE;
    this.wall.position.set(Math.round(x / TW) * TW, Math.round(y / TW) * TW, 0);
    const vh = this.visH;
    // the neon sits below the frame and ~1 m out from the wall
    this.key.position.set(x - 0.1 * this.visW, y - vh * 0.95, 1.9);
    this.key.target.position.set(x, y - vh * 0.05, 0);
    this.neon2.position.set(x + 0.4 * this.visW, y - vh * 0.9, 1.9);
    this.neon2.target.position.set(x + 0.1 * this.visW, y - vh * 0.05, 0);
    this.neon3.position.set(x - 0.5 * this.visW, y - vh * 0.9, 1.9);
    this.neon3.target.position.set(x - 0.25 * this.visW, y - vh * 0.05, 0);
    this.fill.position.set(x - 0.5, y + 0.8, 3);
    this.fill.target.position.set(x, y, 0);
    if (this.skin === 'neon' && show) {
      this.neon.prepare(show);
      this.neon.update(t, ball, this.cam, opts || { strobes: true });
      this.bloom.strength = 0.8 + (this.neon.bloomBoost || 0);
    } else if (this.neon.flashEl) this.neon.flashEl.style.opacity = '0';
    this.composer.render();
  }
}

// Fall back to the 2D renderer if WebGL isn't available.
function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}
if (webglOK()) {
  XB.Renderer = Renderer3D;
  XB.barColor = barColorCss;
}

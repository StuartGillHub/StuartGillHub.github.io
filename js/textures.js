/* Procedural textures: painted brick wall (colour + normal + roughness),
 * wood grain for the bars, the ball's lacquer, and a note-letter atlas.
 * Everything is generated at start-up so the site needs no image assets.
 */
import * as THREE from 'three';

/* ---------- periodic value noise ---------- */
function hash(i, j, seed) {
  let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function makeNoise(period, seed) {
  // value noise on a lattice of `period` cells that wraps across [0,1)
  return (u, v) => {
    const x = u * period, y = v * period;
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const m = (k) => ((k % period) + period) % period;
    const a = hash(m(i), m(j), seed), b = hash(m(i + 1), m(j), seed);
    const c = hash(m(i), m(j + 1), seed), d = hash(m(i + 1), m(j + 1), seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(noises, u, v) {
  let s = 0, amp = 0.5, tot = 0;
  for (const n of noises) { s += n(u, v) * amp; tot += amp; amp *= 0.5; }
  return s / tot;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ---------- painted brick wall ---------- */
export const WALL_TILE = 2.25; // metres covered by one texture tile

export function makeBrickTextures(size = 2048) {
  const S = size;
  const cols = 10, rows = 30; // 225 x 75 mm brick pitch
  const cw = S / cols, rh = S / rows;
  const mortar = (0.011 / WALL_TILE) * S; // 11 mm joints
  const bevel = mortar * 0.9;
  const n1 = [makeNoise(8, 1), makeNoise(16, 2), makeNoise(32, 3), makeNoise(64, 4)];
  const nFine = [makeNoise(256, 5), makeNoise(512, 6)];
  const nWorn = [makeNoise(12, 7), makeNoise(24, 8), makeNoise(48, 9)];

  const height = new Float32Array(S * S);
  const col = new Uint8ClampedArray(S * S * 4);
  const rough = new Uint8ClampedArray(S * S * 4);

  // per-brick random properties
  const brickRnd = (r, c, k) => hash(r * 31 + c, k * 17 + 3, 99);

  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rh);
    const ly = y - row * rh;
    const off = (row % 2) * cw * 0.5;
    for (let x = 0; x < S; x++) {
      const xx = (x + off) % S;
      const c = Math.floor(xx / cw);
      const lx = xx - c * cw;
      const u = x / S, v = y / S;
      // hand-made bricks: slightly wavy, chipped edges
      const d = Math.min(lx, cw - lx, ly, rh - ly) + (fbm(nFine, u * 0.5, v * 0.5) - 0.5) * mortar * 0.25;
      const big = fbm(n1, u, v);
      const fine = fbm(nFine, u, v);
      const b = smooth(mortar * 0.5, mortar * 0.5 + bevel, d); // 0 mortar .. 1 brick face
      // slightly irregular, pillowy brick faces
      const face = 0.7 + 0.12 * brickRnd(row, c, 1) + 0.18 * big + 0.05 * fine;
      const h = b * face + (1 - b) * (0.1 + 0.08 * fine);
      const idx = y * S + x;
      height[idx] = h;

      // paint: warm cream limewash, varying per brick, worn in places
      const tint = brickRnd(row, c, 2) * 0.1 - 0.05;
      // old limewash: mostly intact, a little terracotta ghosting through
      const worn = 0.3 * smooth(0.6, 0.85, fbm(nWorn, u, v) * 0.8 + 0.35 * brickRnd(row, c, 3));
      let r = 226 + tint * 255, g = 206 + tint * 230, bl = 178 + tint * 200;
      r = r * (1 - worn) + 170 * worn;
      g = g * (1 - worn) + 100 * worn;
      bl = bl * (1 - worn) + 72 * worn;
      const shade = 0.9 + 0.1 * fine + 0.06 * (big - 0.5);
      // mortar: a touch greyer and darker, with ambient occlusion at the joint
      const ao = 0.88 + 0.12 * b;
      // limewash covers the joints too: they read through relief, not colour
      const mr = r * 0.95, mg = g * 0.94, mb = bl * 0.92;
      const k = idx * 4;
      col[k] = (b * r + (1 - b) * mr) * shade * ao;
      col[k + 1] = (b * g + (1 - b) * mg) * shade * ao;
      col[k + 2] = (b * bl + (1 - b) * mb) * shade * ao;
      col[k + 3] = 255;
      const ro = 205 + 40 * (1 - b) + 20 * fine;
      rough[k] = rough[k + 1] = rough[k + 2] = ro; rough[k + 3] = 255;
    }
  }

  // normal map from the height field
  const nrm = new Uint8ClampedArray(S * S * 4);
  const strength = 4.2;
  for (let y = 0; y < S; y++) {
    const ym = ((y - 1 + S) % S) * S, yp = ((y + 1) % S) * S, y0 = y * S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S;
      const dx = (height[y0 + xp] - height[y0 + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      // canvas y runs down, texture v runs up: flip dy
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const k = (y0 + x) * 4;
      nrm[k] = (nx * 0.5 + 0.5) * 255;
      nrm[k + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[k + 2] = (nz * 0.5 + 0.5) * 255;
      nrm[k + 3] = 255;
    }
  }

  const toTex = (data, srgb) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    c.getContext('2d').putImageData(new ImageData(data, S, S), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: toTex(col, true), normalMap: toTex(nrm, false), roughnessMap: toTex(rough, false) };
}

/* ---------- smooth painted plaster wall ---------- */
export const PAINT_TILE = 1.2; // metres covered by one texture tile

export function makePaintTextures(size = 2048) {
  const S = size;
  // roller stipple (~3-5 mm), a softer mid scale, and very broad trowel mottling
  const stip = [makeNoise(320, 21), makeNoise(640, 22)];
  const mid = [makeNoise(48, 23), makeNoise(96, 24)];
  const broad = [makeNoise(4, 25), makeNoise(8, 26)];
  const height = new Float32Array(S * S);
  const col = new Uint8ClampedArray(S * S * 4);
  const rough = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const st = fbm(stip, u, v), md = fbm(mid, u, v), br = fbm(broad, u, v);
      const idx = y * S + x;
      height[idx] = st * 0.75 + md * 0.25;
      // warm white emulsion; almost no colour variation
      const l = 0.985 + 0.012 * (br - 0.5) + 0.008 * (st - 0.5);
      const k = idx * 4;
      col[k] = 243 * l; col[k + 1] = 241 * l; col[k + 2] = 237 * l; col[k + 3] = 255;
      const ro = 200 + 22 * (st - 0.5) + 14 * (br - 0.5);
      rough[k] = rough[k + 1] = rough[k + 2] = ro; rough[k + 3] = 255;
    }
  }
  const nrm = new Uint8ClampedArray(S * S * 4);
  const strength = 1.6;
  for (let y = 0; y < S; y++) {
    const ym = ((y - 1 + S) % S) * S, yp = ((y + 1) % S) * S, y0 = y * S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S;
      const dx = (height[y0 + xp] - height[y0 + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const k = (y0 + x) * 4;
      nrm[k] = (nx / l * 0.5 + 0.5) * 255;
      nrm[k + 1] = (ny / l * 0.5 + 0.5) * 255;
      nrm[k + 2] = (nz / l * 0.5 + 0.5) * 255;
      nrm[k + 3] = 255;
    }
  }
  const toTex = (data, srgb) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    c.getContext('2d').putImageData(new ImageData(data, S, S), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: toTex(col, true), normalMap: toTex(nrm, false), roughnessMap: toTex(rough, false) };
}

/* ---------- brushed metal (roughness streaks along the bar) ---------- */
export function makeBrushedTexture() {
  const W = 1024, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const n1 = [makeNoise(512, 31), makeNoise(1024, 32)];
  const n2 = [makeNoise(4, 33)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // fine streaks: vary quickly across the bar, slowly along it
      const st = fbm(n1, x / W / 64, y / H);
      const sl = fbm(n2, x / W, y / H);
      const v = 150 + 70 * st + 20 * sl;
      const k = (y * W + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/* ---------- wood grain ---------- */
export function makeWoodTexture() {
  const W = 1024, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const nA = [makeNoise(4, 11), makeNoise(8, 12), makeNoise(16, 13)];
  const nB = [makeNoise(64, 14), makeNoise(128, 15)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const warp = fbm(nA, u, v) * 3.2;
      const ring = (v * 7 + warp) % 1;
      const line = Math.pow(Math.abs(Math.sin(ring * Math.PI)), 6);
      const fleck = fbm(nB, u * 1, v * 1);
      const l = 0.78 + 0.16 * (1 - line) + 0.08 * (fleck - 0.5);
      const k = (y * W + x) * 4;
      img.data[k] = 255 * l; img.data[k + 1] = 242 * l; img.data[k + 2] = 228 * l; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/* ---------- ball: deep red lacquer with a cream band on a meridian ---------- */
export function makeBallTexture() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#9e1b24';
  g.fillRect(0, 0, W, H);
  // two meridian stripes form one great circle through the poles in the
  // y-z plane, so spinning about z (facing the wall) is clearly visible
  g.fillStyle = '#f3e6cf';
  for (const u of [0.25, 0.75]) g.fillRect(u * W - 16, 0, 32, H);
  g.fillStyle = '#c9a15a';
  for (const u of [0.25, 0.75]) { g.fillRect(u * W - 19, 0, 3, H); g.fillRect(u * W + 16, 0, 3, H); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ---------- note letter atlas (C, C#, ... B) ---------- */
export const NOTE_LABELS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export function makeLetterAtlas() {
  const cell = 128;
  const c = document.createElement('canvas');
  c.width = cell * 12; c.height = cell;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 ${cell * 0.62}px Georgia, 'Times New Roman', serif`;
  NOTE_LABELS.forEach((l, i) => {
    g.fillStyle = '#fff';
    g.fillText(l, cell * (i + 0.5), cell * 0.54);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

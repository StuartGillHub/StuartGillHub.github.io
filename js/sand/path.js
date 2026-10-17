/* Sand Table: theta-rho paths.
 *
 * Patterns live in the unit disk (rho 0..1). Each generator returns a
 * canonical curve that starts at angle 0; the player rotates it so it starts
 * where the ball is, and if the radius doesn't match it first draws a short
 * bridging spiral. Every path is resampled to equal arc-length steps, so the
 * ball moves at a constant speed along it and never jumps.
 *
 * Pure geometry: knows nothing about sand, music or drawing.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const TAU = Math.PI * 2;
  const DS = 0.0025; // resampled spacing (unit-disk units)
  const BRIDGE_TURNS = 0.6; // turns of the bridging spiral per unit of radius change

  const pick = (list, p) => list[Math.min(list.length - 1, Math.floor(p * list.length))];
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  /* ---- pattern generators ----
   * gen(p, ctx) -> { label, startRho, fn(u) -> [x, y], u1 }
   * p (0..1) chooses the pattern's parameter (petals, gear ratio ...).
   * ctx: { rho0 } where the ball is now, { pitch } for the erase spiral.
   * Canonical curves start at (startRho, angle 0).
   */
  const PATTERNS = {
    // Archimedean spiral: in to the centre if the ball is out, else out to the rim.
    spiral(p, ctx) {
      const pitch = 0.07 + 0.06 * p; // radius change per turn
      return spiralFrom(ctx.rho0, pitch, 'Spiral');
    },
    // Rose r = |cos(k theta)|, precessing slowly so the petals fill in.
    rose(p) {
      const k = pick([2, 3, 4, 5, 6, 7, 8], p);
      const laps = 2;
      const eps = 1 / (2 * k * laps); // total drift: half a petal
      return {
        label: `Rose · ${2 * k} petals`, startRho: 1, u1: laps * Math.PI,
        fn: (u) => { const th = u * (1 + eps), r = Math.abs(Math.cos(k * u)); return [r * Math.cos(th), r * Math.sin(th)]; },
      };
    },
    // Hypotrochoid (spirograph): gear ratio R/r picked by p.
    hypotrochoid(p) {
      const [R, r] = pick([[5, 3], [7, 3], [8, 3], [7, 4], [9, 4], [11, 4], [8, 5], [11, 5], [13, 5]], p);
      const d = 0.8 * r;
      const span = R - r + d;
      const q = (R - r) / r;
      return {
        label: `Spirograph · ${R}:${r}`, startRho: 1, u1: (TAU * r) / gcd(R, r),
        fn: (t) => [((R - r) * Math.cos(t) + d * Math.cos(q * t)) / span, ((R - r) * Math.sin(t) - d * Math.sin(q * t)) / span],
      };
    },
    // Star polygon {n/m}: straight chords between rim points, precessing a little each lap.
    star(p) {
      const n = pick([5, 7, 8, 9, 11, 12, 13], p);
      let m = Math.floor((n - 1) / 2);
      while (gcd(n, m) !== 1) m--;
      const laps = n <= 8 ? 2 : 1;
      const chords = n * laps;
      const prec = (TAU / n) / chords * 0.5; // total drift: half a vertex
      const vert = (j) => { const a = (j * m * TAU) / n + j * prec; return [Math.cos(a), Math.sin(a)]; };
      return {
        label: `Star · ${n}/${m}`, startRho: 1, u1: chords,
        fn: (u) => {
          const j = Math.min(chords - 1, Math.floor(u)), f = u - j;
          const a = vert(j), b = vert(j + 1);
          return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        },
      };
    },
    // Polar Lissajous: angle and radius oscillate at a ratio a:b, with a slow
    // drift that carries the figure once round the table.
    lissajous(p) {
      const [a, b] = pick([[2, 3], [3, 4], [3, 5], [4, 5], [5, 6], [5, 7]], p);
      const cycles = 6;
      const u1 = TAU * cycles;
      const drift = TAU / u1;
      return {
        label: `Lissajous · ${a}:${b}`, startRho: 1, u1,
        fn: (t) => {
          const th = drift * t + 1.1 * Math.sin(a * t / b);
          const r = 0.5 + 0.5 * Math.cos(t);
          return [r * Math.cos(th), r * Math.sin(th)];
        },
      };
    },
  };

  // Tight spiral covering the whole table: wipes the drawing. Starts at the
  // rim (spiralling in) or the centre (spiralling out), whichever is nearer.
  function erasePattern(ctx) {
    const from = ctx.rho0 >= 0.5 ? 1 : 0;
    const s = spiralFrom(from, ctx.pitch, 'Erase');
    return s;
  }

  function spiralFrom(rho0, pitch, label) {
    const inward = rho0 >= 0.5;
    const span = inward ? rho0 : 1 - rho0;
    const turns = Math.max(0.5, span / pitch);
    return {
      label, startRho: rho0, u1: turns * TAU,
      fn: (u) => {
        const r = inward ? rho0 - (u / TAU) * pitch : rho0 + (u / TAU) * pitch;
        const rc = Math.max(0, Math.min(1, r));
        return [rc * Math.cos(u), rc * Math.sin(u)];
      },
    };
  }

  /* ---- sampling ---- */
  // Sample fn densely and append points every DS of arc length to `out`
  // (rotated by `rot`). `out` already ends at the curve's start point.
  function resample(fn, u1, rot, out) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const coarse = 2000;
    let len = 0;
    let [px, py] = fn(0);
    for (let i = 1; i <= coarse; i++) {
      const [x, y] = fn((u1 * i) / coarse);
      len += Math.hypot(x - px, y - py);
      px = x; py = y;
    }
    const n = Math.max(coarse, Math.ceil((len / DS) * 3));
    [px, py] = fn(0);
    let need = DS; // arc length still to go before the next point
    for (let i = 1; i <= n; i++) {
      const [x, y] = fn((u1 * i) / n);
      const seg = Math.hypot(x - px, y - py);
      let t = 0;
      while (seg - t >= need) {
        t += need;
        const f = t / seg;
        const qx = px + (x - px) * f, qy = py + (y - py) * f;
        out.push(qx * c - qy * s, qx * s + qy * c);
        need = DS;
      }
      need -= seg - t;
      px = x; py = y;
    }
    return out;
  }

  // Build one continuous path from the ball's position into a pattern.
  function buildPath(kind, p, ball, ctx) {
    const rho0 = Math.min(1, Math.hypot(ball.x, ball.y));
    const th0 = rho0 > 1e-6 ? Math.atan2(ball.y, ball.x) : 0;
    const c = Object.assign({ rho0 }, ctx);
    const pat = kind === 'erase' ? erasePattern(c) : PATTERNS[kind](p, c);
    const pts = [ball.x, ball.y];
    let th = th0;
    const dr = pat.startRho - rho0;
    if (Math.abs(dr) > 0.004) {
      // bridging spiral, turning the same way as the patterns (anticlockwise)
      const dth = TAU * BRIDGE_TURNS * Math.abs(dr);
      resample((u) => {
        const f = u / dth, r = rho0 + dr * f, a = th0 + u;
        return [r * Math.cos(a), r * Math.sin(a)];
      }, dth, 0, pts);
      th = th0 + dth;
    }
    resample(pat.fn, pat.u1, th, pts);
    return { kind, label: pat.label, pts: new Float32Array(pts), n: pts.length / 2 };
  }

  /* ---- player: constant arc-length speed along the current path ---- */
  class PathPlayer {
    constructor(next) {
      this.next = next; // () => { kind, p } for the next pattern
      this.ctx = { pitch: 0.07 };
      this.pos = { x: 0, y: 0, dx: 1, dy: 0 };
      this.path = null;
      this.s = 0; // index position along path (in DS steps, fractional)
    }
    // Start the next pattern from wherever the ball is now (no jump).
    begin(spec) {
      const s = spec || this.next();
      this.path = buildPath(s.kind, s.p, this.pos, this.ctx);
      this.s = 0;
      return this.path;
    }
    // Move `dist` along the path, calling visit(x, y, dx, dy) every `step`
    // of travel (for stamping). Rolls into the next pattern at the end.
    advance(dist, step, visit) {
      if (!this.path) this.begin();
      let remain = dist / DS;
      const stepI = Math.max(0.25, step / DS);
      this.carry = this.carry || 0;
      let guard = 0;
      while (remain > 1e-9 && guard++ < 1e5) {
        const P = this.path;
        const room = P.n - 1 - this.s;
        if (room <= 1e-9) { this.begin(); continue; }
        const until = Math.min(remain, stepI - this.carry, room);
        this.s += until; remain -= until; this.carry += until;
        this.locate();
        if (this.carry >= stepI - 1e-9) { this.carry = 0; visit(this.pos.x, this.pos.y, this.pos.dx, this.pos.dy); }
      }
    }
    locate() {
      const P = this.path, pts = P.pts;
      const i = Math.min(P.n - 2, Math.floor(this.s)), f = this.s - i;
      const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3];
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
      this.pos.x = ax + dx * f; this.pos.y = ay + dy * f;
      if (l > 1e-9) { this.pos.dx = dx / l; this.pos.dy = dy / l; }
    }
    progress() { return this.path ? this.s / Math.max(1, this.path.n - 1) : 0; }
  }

  XB.SandPath = { PATTERNS: Object.keys(PATTERNS), PathPlayer, buildPath, DS };
})();

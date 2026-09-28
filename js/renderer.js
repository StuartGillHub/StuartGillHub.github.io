/* Canvas renderer: pegboard wall, wall-mounted xylophone bars and wire
 * tracks with cast shadows, and a glossy spinning ball. World units are
 * metres with y up; one world transform maps them to device pixels.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const { R, T, RAIL } = XB.PHYS;
  const TAU = Math.PI * 2;

  // Light comes from the upper left; things stand off the wall by `depth`
  // metres, so their shadows fall down-right proportionally.
  const LIGHT = { x: 0.55, y: 0.85 };

  function barColor(midi, l, a) {
    const pc = ((midi % 12) + 12) % 12;
    const hue = (pc * 29 + 350) % 360;
    return `hsla(${hue}, 78%, ${l}%, ${a == null ? 1 : a})`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.wireCache = new WeakMap();
      this.cam = { x: 0, y: 0 };
      this.resize();
    }

    resize() {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.W = window.innerWidth;
      this.H = window.innerHeight;
      this.canvas.width = Math.round(this.W * this.dpr);
      this.canvas.height = Math.round(this.H * this.dpr);
      this.canvas.style.width = this.W + 'px';
      this.canvas.style.height = this.H + 'px';
      this.scale = Math.min(this.W / 1.5, this.H / 2.35);
      this.visW = this.W / this.scale;
      this.visH = this.H / this.scale;
      this.s = this.scale * this.dpr; // device px per metre
      this.buildWall();
      this.buildVignette();
    }

    buildWall() {
      const spacing = 0.05, holes = 8;
      const px = Math.max(16, Math.round(spacing * holes * this.s));
      this.tilePx = px;
      this.tileWorld = spacing * holes;
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const g = c.getContext('2d');
      g.fillStyle = '#34313b';
      g.fillRect(0, 0, px, px);
      // fibre noise
      const img = g.getImageData(0, 0, px, px);
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd() - 0.5) * 14;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
      const hp = px / holes;
      const hr = Math.max(1.2, hp * 0.12);
      for (let i = 0; i < holes; i++) {
        for (let j = 0; j < holes; j++) {
          const cx = (i + 0.5) * hp, cy = (j + 0.5) * hp;
          g.fillStyle = 'rgba(255,255,255,0.07)';
          g.beginPath(); g.arc(cx + hr * 0.15, cy + hr * 0.35, hr * 1.12, 0, TAU); g.fill();
          g.fillStyle = '#131218';
          g.beginPath(); g.arc(cx, cy, hr, 0, TAU); g.fill();
        }
      }
      this.wallPattern = this.ctx.createPattern(c, 'repeat');
    }

    buildVignette() {
      const w = this.canvas.width, h = this.canvas.height;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(w * 0.42, h * 0.3, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.62);
      grd.addColorStop(0, 'rgba(255,236,210,0.10)');
      grd.addColorStop(0.45, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.62)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      this.vignette = c;
    }

    setWorld() {
      const s = this.s;
      this.ctx.setTransform(s, 0, 0, -s, this.dpr * this.W * 0.5 - this.cam.x * s, this.dpr * this.H * 0.5 + this.cam.y * s);
    }

    shadow(depth, blur, alpha) {
      const ctx = this.ctx, s = this.s;
      ctx.shadowColor = `rgba(0,0,0,${alpha})`;
      ctx.shadowBlur = blur * s;
      ctx.shadowOffsetX = LIGHT.x * depth * s;
      ctx.shadowOffsetY = LIGHT.y * depth * s;
    }
    noShadow() {
      const ctx = this.ctx;
      ctx.shadowColor = 'rgba(0,0,0,0)';
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    }

    /* ---------- wall ---------- */
    drawWall() {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const k = this.tilePx / this.tileWorld;
      const ox = this.dpr * this.W * 0.5 - this.cam.x * k;
      const oy = this.dpr * this.H * 0.5 + this.cam.y * k;
      const m = (a, b) => ((a % b) + b) % b;
      if (this.wallPattern.setTransform) {
        this.wallPattern.setTransform(new DOMMatrix([1, 0, 0, 1, m(ox, this.tilePx), m(oy, this.tilePx)]));
      }
      ctx.fillStyle = this.wallPattern;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // pegboard sheet seams every 1.22 m (4 ft), with screws
      this.setWorld();
      const vw = this.visW, vh = this.visH;
      const x0 = this.cam.x - vw / 2 - 0.1, x1 = this.cam.x + vw / 2 + 0.1;
      const y0 = this.cam.y - vh / 2 - 0.1, y1 = this.cam.y + vh / 2 + 0.1;
      const S = 1.22;
      ctx.lineWidth = 0.004;
      for (let yy = Math.floor(y0 / S) * S; yy <= y1; yy += S) {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath(); ctx.moveTo(x0, yy - 0.004); ctx.lineTo(x1, yy - 0.004); ctx.stroke();
      }
      for (let xx = Math.floor(x0 / S) * S; xx <= x1; xx += S) {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath(); ctx.moveTo(xx, y0); ctx.lineTo(xx, y1); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath(); ctx.moveTo(xx + 0.004, y0); ctx.lineTo(xx + 0.004, y1); ctx.stroke();
      }
      for (let yy = Math.floor(y0 / S) * S; yy <= y1; yy += S) {
        for (let xx = Math.floor(x0 / 0.305) * 0.305; xx <= x1; xx += 0.305) {
          this.screw(xx + 0.0125, yy - 0.025, 0.0055, 0.4);
        }
      }
    }

    screw(x, y, r, rot) {
      const ctx = this.ctx;
      const g = ctx.createRadialGradient(x - r * 0.4, y + r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, '#f3f4f6');
      g.addColorStop(0.6, '#9ca3af');
      g.addColorStop(1, '#4b5563');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(30,30,35,0.8)';
      ctx.lineWidth = r * 0.28;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(rot) * r * 0.7, y - Math.sin(rot) * r * 0.7);
      ctx.lineTo(x + Math.cos(rot) * r * 0.7, y + Math.sin(rot) * r * 0.7);
      ctx.stroke();
    }

    /* ---------- wires ---------- */
    wireGeom(seg) {
      let g = this.wireCache.get(seg);
      if (g) return g;
      const pts = [];
      let lastS = -1;
      for (let i = 0; i <= seg.n; i++) {
        if (i === seg.n || seg.ss[i] - lastS >= 0.006) {
          pts.push(i);
          lastS = seg.ss[i];
        }
      }
      const left = new Path2D(), right = new Path2D(), ties = new Path2D();
      const mounts = [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let nextTie = 0.02, nextMount = 0.12;
      const total = seg.ss[seg.n];
      pts.forEach((i, k) => {
        const x = seg.xs[i], y = seg.ys[i], th = seg.th[i], s = seg.ss[i];
        const nx = -Math.sin(th), ny = Math.cos(th);
        // flared mouth at the catch, slight flare at the launch lip
        const fm = Math.max(0, 1 - s / 0.09);
        const flare = 1 + 0.55 * fm * fm + 0.2 * Math.max(0, 1 - (total - s) / 0.03);
        const off = RAIL * flare;
        const lx = x + nx * off, ly = y + ny * off;
        const rx = x - nx * off, ry = y - ny * off;
        if (k === 0) { left.moveTo(lx, ly); right.moveTo(rx, ry); } else { left.lineTo(lx, ly); right.lineTo(rx, ry); }
        if (s >= nextTie) {
          ties.moveTo(lx, ly); ties.lineTo(rx, ry);
          nextTie += 0.045;
        }
        if (s >= nextMount && total - s > 0.05) {
          mounts.push({ x: rx - nx * 0.012, y: ry - ny * 0.012, th });
          nextMount += 0.26;
        }
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      });
      g = { left, right, ties, mounts, box: { minX: minX - 0.1, maxX: maxX + 0.1, minY: minY - 0.1, maxY: maxY + 0.1 } };
      this.wireCache.set(seg, g);
      return g;
    }

    drawWire(seg) {
      const ctx = this.ctx;
      const g = this.wireGeom(seg);
      if (!this.visible(g.box)) return;
      // mounting brackets (behind the rails)
      for (const m of g.mounts) {
        this.shadow(0.012, 0.01, 0.5);
        ctx.fillStyle = '#5b6170';
        ctx.beginPath(); ctx.arc(m.x, m.y, 0.011, 0, TAU); ctx.fill();
        this.noShadow();
        ctx.strokeStyle = '#8a909c';
        ctx.lineWidth = 0.0045;
        ctx.beginPath(); ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - Math.sin(m.th) * 0.014, m.y + Math.cos(m.th) * 0.014); ctx.stroke();
        this.screw(m.x, m.y, 0.0055, m.th);
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // cross ties
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 0.0035;
      ctx.stroke(g.ties);
      // rails: shadowed dark body + bright specular core
      this.shadow(0.02, 0.012, 0.55);
      ctx.strokeStyle = '#7c8390';
      ctx.lineWidth = 0.0075;
      ctx.stroke(g.left); ctx.stroke(g.right);
      this.noShadow();
      ctx.strokeStyle = '#c9ced6';
      ctx.lineWidth = 0.0042;
      ctx.stroke(g.left); ctx.stroke(g.right);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 0.0014;
      ctx.stroke(g.left); ctx.stroke(g.right);
    }

    visible(box) {
      const hw = this.visW / 2 + 0.2, hh = this.visH / 2 + 0.2;
      return !(box.maxX < this.cam.x - hw || box.minX > this.cam.x + hw || box.maxY < this.cam.y - hh || box.minY > this.cam.y + hh);
    }

    /* ---------- bars ---------- */
    drawBar(b, t) {
      const ctx = this.ctx;
      const L = b.lenL + b.lenR;
      const hw = this.visW / 2 + 0.4, hh = this.visH / 2 + 0.4;
      if (Math.abs(b.sx - this.cam.x) > hw || Math.abs(b.sy - this.cam.y) > hh) return;
      const age = t - b.t;
      let dip = 0, rock = 0, glow = 0;
      if (age >= 0 && age < 1.2) {
        const env = Math.exp(-age / 0.07);
        dip = -0.006 * (0.4 + b.vin * 0.15) * env * Math.cos(age * TAU * 11);
        rock = 0.02 * Math.exp(-age / 0.25) * Math.sin(age * TAU * 7) * (0.3 + b.strength);
        glow = Math.exp(-age / 0.28);
      }
      ctx.save();
      ctx.translate(b.sx + b.nx * dip, b.sy + b.ny * dip);
      ctx.rotate(Math.atan2(b.tY, b.tX) + rock);

      const played = age >= 0;
      const lit = played ? 1 : 0.82;
      // body with shadow on the wall
      this.shadow(0.018, 0.014, 0.6);
      const grad = ctx.createLinearGradient(0, 0, 0, -T);
      grad.addColorStop(0, barColor(b.midi, 74 * lit + glow * 12, 1));
      grad.addColorStop(0.18, barColor(b.midi, 58 * lit + glow * 14, 1));
      grad.addColorStop(0.75, barColor(b.midi, 44 * lit + glow * 10, 1));
      grad.addColorStop(1, barColor(b.midi, 30 * lit, 1));
      ctx.fillStyle = grad;
      roundRect(ctx, -b.lenL, -T, L, T, 0.008);
      ctx.fill();
      this.noShadow();
      // top edge specular
      ctx.strokeStyle = `rgba(255,255,255,${0.45 + 0.4 * glow})`;
      ctx.lineWidth = 0.0022;
      ctx.beginPath(); ctx.moveTo(-b.lenL + 0.008, -0.0025); ctx.lineTo(b.lenR - 0.008, -0.0025); ctx.stroke();
      // subtle grain
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 0.0012;
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath(); ctx.moveTo(-b.lenL + 0.01, -T * k / 4.2); ctx.lineTo(b.lenR - 0.01, -T * k / 4.2 + 0.001 * (k - 2)); ctx.stroke();
      }
      // mounting pins at the vibration nodes (22.4% from each end)
      const n1 = -b.lenL + 0.224 * L, n2 = b.lenR - 0.224 * L;
      for (const u of [n1, n2]) this.screw(u, -T * 0.5, 0.0062, 0.7 + u * 9);
      // engraved note letter, like a real (toy) xylophone
      if (L > 0.1 && this.s * T > 11) {
        ctx.save();
        ctx.translate((n1 + n2) / 2, -T * 0.52);
        ctx.scale(1 / this.s, -1 / this.s);
        ctx.font = `700 ${Math.round(this.s * T * 0.52)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.4 * glow})`;
        ctx.fillText(b.label || (b.label = XB.Analysis.noteName(b.midi).replace(/-?\d+$/, '')), 0, 0);
        ctx.restore();
      }
      ctx.restore();

      if (glow > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const cx = b.sx - b.nx * T * 0.5 + b.tX * (b.lenR - b.lenL) * 0.5;
        const cy = b.sy - b.ny * T * 0.5 + b.tY * (b.lenR - b.lenL) * 0.5;
        const rad = L * 0.75 + 0.05;
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        rg.addColorStop(0, barColor(b.midi, 60, 0.55 * glow * (0.5 + 0.5 * b.strength)));
        rg.addColorStop(1, barColor(b.midi, 50, 0));
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.fill();
        ctx.restore();
        // struck-point ripple
        if (age < 0.45) {
          const k = age / 0.45;
          ctx.strokeStyle = barColor(b.midi, 75, (1 - k) * 0.5);
          ctx.lineWidth = 0.004 * (1 - k) + 0.001;
          ctx.beginPath(); ctx.arc(b.sx, b.sy, 0.02 + k * 0.16, 0, TAU); ctx.stroke();
        }
      }
    }

    /* ---------- ledge & cup ---------- */
    drawLedge(course) {
      const ctx = this.ctx;
      const { ledge } = course;
      const a = ledge.start, e = ledge.end.p;
      const ang = Math.atan2(e.y - a.y, e.x - a.x);
      const len = Math.hypot(e.x - a.x, e.y - a.y) + 0.1;
      ctx.save();
      ctx.translate(e.x - Math.sin(-ang) * 0 , e.y);
      ctx.rotate(ang);
      ctx.translate(0, -R);
      this.shadow(0.02, 0.014, 0.6);
      const g = ctx.createLinearGradient(0, 0, 0, -0.03);
      g.addColorStop(0, '#caa27a'); g.addColorStop(1, '#6d4a2f');
      ctx.fillStyle = g;
      roundRect(ctx, -len, -0.03, len + 0.01, 0.03, 0.006);
      ctx.fill();
      this.noShadow();
      this.screw(-len + 0.04, -0.015, 0.006, 0.3);
      this.screw(-0.05, -0.015, 0.006, 1.2);
      ctx.restore();
    }

    drawCup(course, front) {
      const ctx = this.ctx;
      const c = course.cup;
      const w = 0.07, bot = c.y;
      if (Math.abs(c.y - this.cam.y) > this.visH) return;
      ctx.save();
      if (!front) {
        // back wall of a small tin cup screwed to the pegboard
        this.shadow(0.03, 0.02, 0.55);
        const g = ctx.createLinearGradient(c.x - w, 0, c.x + w, 0);
        g.addColorStop(0, '#3a3f48'); g.addColorStop(0.5, '#565d69'); g.addColorStop(1, '#2c3037');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(c.x - w - 0.012, bot + 0.1);
        ctx.lineTo(c.x - w, bot + 0.012);
        ctx.quadraticCurveTo(c.x - w, bot - 0.01, c.x - w + 0.02, bot - 0.01);
        ctx.lineTo(c.x + w - 0.02, bot - 0.01);
        ctx.quadraticCurveTo(c.x + w, bot - 0.01, c.x + w, bot + 0.012);
        ctx.lineTo(c.x + w + 0.012, bot + 0.1);
        ctx.quadraticCurveTo(c.x, bot + 0.112, c.x - w - 0.012, bot + 0.1);
        ctx.fill();
        this.noShadow();
        this.screw(c.x, bot + 0.07, 0.006, 0.4);
      } else {
        const fh = 0.036;
        const g = ctx.createLinearGradient(c.x - w, 0, c.x + w, 0);
        g.addColorStop(0, '#7e8794'); g.addColorStop(0.3, '#e5e7eb'); g.addColorStop(0.55, '#9aa3ae'); g.addColorStop(1, '#4b5260');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(c.x - w - 0.01, bot + fh);
        ctx.lineTo(c.x - w - 0.002, bot + 0.004);
        ctx.quadraticCurveTo(c.x - w - 0.002, bot - 0.014, c.x - w + 0.02, bot - 0.014);
        ctx.lineTo(c.x + w - 0.02, bot - 0.014);
        ctx.quadraticCurveTo(c.x + w + 0.002, bot - 0.014, c.x + w + 0.002, bot + 0.004);
        ctx.lineTo(c.x + w + 0.01, bot + fh);
        ctx.quadraticCurveTo(c.x, bot + fh - 0.01, c.x - w - 0.01, bot + fh);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 0.002;
        ctx.beginPath();
        ctx.moveTo(c.x - w - 0.01, bot + fh);
        ctx.quadraticCurveTo(c.x, bot + fh - 0.01, c.x + w + 0.01, bot + fh);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ---------- ball ---------- */
    drawBall(p, ghost) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (ghost) {
        ctx.globalAlpha = ghost;
        ctx.fillStyle = '#f2ede4';
        ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
        ctx.restore();
        return;
      }
      this.shadow(0.05, 0.03, 0.6);
      ctx.fillStyle = '#efe9df';
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      this.noShadow();
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.clip();
      ctx.rotate(p.ang);
      ctx.fillStyle = '#d7263d';
      ctx.fillRect(-R * 1.1, -R * 0.36, R * 2.2, R * 0.72);
      ctx.fillStyle = '#efe9df';
      ctx.beginPath(); ctx.arc(R * 0.0, 0, R * 0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1f2937';
      ctx.beginPath(); ctx.arc(R * 0.0, 0, R * 0.08, 0, TAU); ctx.fill();
      ctx.restore();
      // spherical shading: light from upper-left (world +y is up)
      const sh = ctx.createRadialGradient(-R * 0.35, R * 0.4, R * 0.05, 0, 0, R * 1.05);
      sh.addColorStop(0, 'rgba(255,255,255,0.35)');
      sh.addColorStop(0.45, 'rgba(255,255,255,0)');
      sh.addColorStop(0.85, 'rgba(0,0,0,0.28)');
      sh.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = sh;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      // specular highlight + faint rim light
      const hl = ctx.createRadialGradient(-R * 0.38, R * 0.42, 0, -R * 0.38, R * 0.42, R * 0.32);
      hl.addColorStop(0, 'rgba(255,255,255,0.95)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.beginPath(); ctx.arc(-R * 0.38, R * 0.42, R * 0.32, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,220,0.25)';
      ctx.lineWidth = R * 0.06;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.97, -0.6, 0.9); ctx.stroke();
      ctx.restore();
    }

    /* ---------- frame ---------- */
    draw(course, camTrack, t) {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!course) {
        this.cam = { x: 0, y: 0 };
        this.drawWall();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.vignette, 0, 0);
        return;
      }
      const ball = XB.Course.evalAt(course, t, {});
      this.cam = XB.Camera.at(camTrack, t, ball, this.visW, this.visH);
      this.drawWall();
      this.setWorld();
      if (t < course.tStart + 3 || this.visible({ minX: -1, maxX: 1, minY: course.ledge.end.p.y - 0.2, maxY: course.ledge.end.p.y + 0.2 })) this.drawLedge(course);
      for (const w of course.wires) this.drawWire(w);
      this.drawCup(course, false);
      for (const b of course.bars) this.drawBar(b, t);

      // gentle motion blur: faint ghosts along the recent path when fast
      if (ball.speed > 1.2) {
        const tmp = {};
        for (let k = 3; k >= 1; k--) {
          XB.Course.evalAt(course, t - k * 0.006, tmp);
          this.drawBall(tmp, 0.1);
        }
      }
      this.drawBall(ball);
      this.drawCup(course, true);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.vignette, 0, 0);
      this.lastBall = ball;
    }
  }

  XB.Renderer2D = Renderer;
  XB.barColor = barColor;
})();

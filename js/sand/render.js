/* Sand Table: drawing. Shades the heightmap with a low, warm directional
 * light (normals from height gradients; lambert plus a subtle specular
 * glint), then composes the table rim, the sand, the ball's soft shadow and
 * a shaded steel ball onto a 2D canvas.
 *
 * Only the sim's dirty rectangle is reshaded each frame. All the look lives
 * here (colours from XB.Palette), so the scene can be restyled without
 * touching the path or the simulation.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const P = XB.Palette;

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  // Look: warm sand under a warm low lamp.
  const STYLE = {
    sand: mix(hex(P.ACCENT2), hex(P.TEXT), 0.35).map((v) => v * 0.86), // pale warm sand
    light: mix([255, 255, 255], hex(P.GLOW), 0.45), // lamp colour
    ambient: 0.3, // light in full shadow
    diffuse: 0.6, // brightness of level sand (relative)
    relief: 0.9, // exaggerates slopes for the shading
    spec: 0.14, // strength of the glint on slopes facing the lamp
    shine: 48,
    elevation: 22 * (Math.PI / 180), // lamp height above the table
  };

  class SandRenderer {
    constructor(sim) {
      this.sim = sim;
      const n = sim.N;
      this.off = document.createElement('canvas');
      this.off.width = this.off.height = n;
      this.octx = this.off.getContext('2d');
      this.img = this.octx.createImageData(n, n);
      this.setLight(210);
    }

    // Lamp direction: azimuth in degrees (0 = from the right, 90 = from the top).
    setLight(deg) {
      this.az = (deg * Math.PI) / 180;
      const e = STYLE.elevation;
      // grid y points down, so flip the y component
      this.L = [Math.cos(this.az) * Math.cos(e), -Math.sin(this.az) * Math.cos(e), Math.sin(e)];
      const H = [this.L[0], this.L[1], this.L[2] + 1];
      const hl = Math.hypot(H[0], H[1], H[2]);
      this.H = H.map((v) => v / hl);
      this.sim.dirtyAll();
    }

    shade(rect) {
      if (!rect) return;
      const sim = this.sim, n = sim.N, h = sim.h, ins = sim.inside, data = this.img.data;
      const x0 = Math.max(1, rect.x0), y0 = Math.max(1, rect.y0);
      const x1 = Math.min(n - 2, rect.x1), y1 = Math.min(n - 2, rect.y1);
      const [lx, ly, lz] = this.L, [hx, hy, hz] = this.H;
      const S = STYLE, k = S.relief * 0.5;
      const flat = lz; // lambert of level sand
      const dScale = S.diffuse / flat;
      const [sr, sg, sb] = S.sand, [Lr, Lg, Lb] = S.light.map((v) => v / 255);
      for (let y = y0; y <= y1; y++) {
        let i = y * n + x0;
        for (let x = x0; x <= x1; x++, i++) {
          const o = i * 4;
          if (!ins[i]) { data[o + 3] = 0; continue; }
          const nx = -(h[i + 1] - h[i - 1]) * k, ny = -(h[i + n] - h[i - n]) * k;
          const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
          const lam = Math.max(0, (nx * lx + ny * ly + lz) * inv);
          const nh = Math.max(0, (nx * hx + ny * hy + hz) * inv);
          const spec = S.spec * Math.pow(nh, S.shine);
          // deeper sand a touch darker (it sees less of the room)
          const occl = Math.min(1.05, Math.max(0.8, 1 + h[i] * 0.025));
          const dif = (S.ambient + lam * dScale) * occl;
          data[o] = Math.min(255, sr * dif * Lr + 255 * spec * Lr);
          data[o + 1] = Math.min(255, sg * dif * Lg + 255 * spec * Lg);
          data[o + 2] = Math.min(255, sb * dif * Lb + 255 * spec * Lb);
          data[o + 3] = 255;
        }
      }
      this.octx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }

    // view: { cx, cy, R } table centre and radius on screen (device px)
    draw(ctx, view, ball) {
      const sim = this.sim;
      this.shade(sim.takeDirty());
      const { cx, cy, R } = view;
      const k = R / sim.R; // grid px -> screen px
      const lsx = Math.cos(this.az), lsy = -Math.sin(this.az); // light direction on screen

      // table rim: a brass ring lit from the lamp side
      const rim = R * 0.07;
      const g = ctx.createLinearGradient(cx + lsx * (R + rim), cy + lsy * (R + rim), cx - lsx * (R + rim), cy - lsy * (R + rim));
      g.addColorStop(0, '#f3d9a4'); g.addColorStop(0.45, P.BRASS); g.addColorStop(1, '#4a3420');
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = R * 0.08;
      ctx.shadowOffsetX = -lsx * R * 0.03; ctx.shadowOffsetY = -lsy * R * 0.03;
      ctx.beginPath(); ctx.arc(cx, cy, R + rim, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, R + rim * 0.35, 0, Math.PI * 2); ctx.fillStyle = '#2b1d12'; ctx.fill();

      // the sand
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.off, cx - sim.c * k, cy - sim.c * k, sim.N * k, sim.N * k);
      // the rim's own shadow on the sand, on the side nearest the lamp
      const sh = ctx.createRadialGradient(cx - lsx * R * 0.05, cy - lsy * R * 0.05, R * 0.9, cx - lsx * R * 0.05, cy - lsy * R * 0.05, R * 1.06);
      sh.addColorStop(0, 'rgba(30,18,8,0)'); sh.addColorStop(1, 'rgba(30,18,8,0.5)');
      ctx.fillStyle = sh; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

      if (ball) this.drawBall(ctx, cx + (ball.gx - sim.c) * k, cy + (ball.gy - sim.c) * k, ball.r * k, lsx, lsy);
      ctx.restore();
    }

    drawBall(ctx, x, y, r, lsx, lsy) {
      // soft shadow, stretched away from the low lamp
      const len = r * 1.3 / Math.tan(STYLE.elevation) * 0.35;
      ctx.save();
      ctx.translate(x - lsx * len, y - lsy * len);
      ctx.rotate(Math.atan2(lsy, lsx));
      ctx.scale(1 + len / r * 0.5, 1);
      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.25);
      sg.addColorStop(0, 'rgba(25,14,6,0.55)'); sg.addColorStop(0.55, 'rgba(25,14,6,0.3)'); sg.addColorStop(1, 'rgba(25,14,6,0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // polished steel (same tones as the 2D renderer's ball), highlight toward the lamp
      const hx = x + lsx * r * 0.42, hy = y + lsy * r * 0.42;
      const bg = ctx.createRadialGradient(hx, hy, r * 0.05, x, y, r);
      bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.18, '#f3f4f6'); bg.addColorStop(0.6, '#9ca3af'); bg.addColorStop(1, '#3f4651');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // warm reflection of the sand on the far side
      const rg = ctx.createRadialGradient(x - lsx * r * 0.55, y - lsy * r * 0.55, 0, x - lsx * r * 0.55, y - lsy * r * 0.55, r * 0.7);
      rg.addColorStop(0, 'rgba(242,198,125,0.35)'); rg.addColorStop(1, 'rgba(242,198,125,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  XB.SandRenderer = SandRenderer;
  XB.SandStyle = STYLE;
})();

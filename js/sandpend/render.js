/* Sand Pendulum: drawing. Shades the sand under a low warm lamp (normals
 * from height gradients, lambert plus a faint specular glint), reshading
 * only what changed, and draws the steel ball with a soft shadow. The
 * camera is fixed vertically and follows the ball forward only. All of the
 * look lives here (colours from XB.Palette).
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const P = XB.Palette;

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  const STYLE = {
    sand: mix(hex(P.ACCENT2), hex(P.TEXT), 0.35).map((v) => v * 0.86),
    light: mix([255, 255, 255], hex(P.GLOW), 0.45),
    ambient: 0.3,
    diffuse: 0.6,
    relief: 0.9,
    spec: 0.14,
    shine: 48,
    elevation: 22 * (Math.PI / 180),
  };

  class StripRenderer {
    constructor(strip) {
      this.strip = strip;
      this.off = document.createElement('canvas');
      this.off.width = strip.W; this.off.height = strip.H;
      this.octx = this.off.getContext('2d');
      this.img = this.octx.createImageData(strip.W, strip.H);
      this.setLight(150);
    }

    // lamp azimuth in degrees (0 = from the right, 90 = from the top)
    setLight(deg) {
      this.az = (deg * Math.PI) / 180;
      const e = STYLE.elevation;
      this.L = [Math.cos(this.az) * Math.cos(e), -Math.sin(this.az) * Math.cos(e), Math.sin(e)];
      const Hv = [this.L[0], this.L[1], this.L[2] + 1], hl = Math.hypot(Hv[0], Hv[1], Hv[2]);
      this.Hv = Hv.map((v) => v / hl);
      this.strip.dirtyAll();
    }

    // keep the shaded image in step with a strip shift
    shifted(S) { this.octx.drawImage(this.off, -S, 0); }

    shade(rect) {
      if (!rect) return;
      const st = this.strip, W = st.W, h = st.h, data = this.img.data;
      const x0 = Math.max(0, rect.x0), y0 = Math.max(0, rect.y0);
      const x1 = Math.min(W - 1, rect.x1), y1 = Math.min(st.H - 1, rect.y1);
      if (x1 < x0 || y1 < y0) return;
      const [lx, ly, lz] = this.L, [hx, hy, hz] = this.Hv;
      const S = STYLE, k = S.relief * 0.5, dScale = S.diffuse / lz;
      const [sr, sg, sb] = S.sand, [Lr, Lg, Lb] = S.light.map((v) => v / 255);
      for (let y = y0; y <= y1; y++) {
        const yu = y > 0 ? -W : 0, yd = y < st.H - 1 ? W : 0;
        let i = y * W + x0;
        for (let x = x0; x <= x1; x++, i++) {
          const xl = x > 0 ? -1 : 0, xr = x < W - 1 ? 1 : 0;
          const nx = -(h[i + xr] - h[i + xl]) * k, ny = -(h[i + yd] - h[i + yu]) * k;
          const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
          const lam = Math.max(0, (nx * lx + ny * ly + lz) * inv);
          const nh = Math.max(0, (nx * hx + ny * hy + hz) * inv);
          const spec = S.spec * Math.pow(nh, S.shine);
          const occl = Math.min(1.05, Math.max(0.8, 1 + h[i] * 0.025));
          const dif = (S.ambient + lam * dScale) * occl;
          const o = i * 4;
          data[o] = Math.min(255, sr * dif * Lr + 255 * spec * Lr);
          data[o + 1] = Math.min(255, sg * dif * Lg + 255 * spec * Lg);
          data[o + 2] = Math.min(255, sb * dif * Lb + 255 * spec * Lb);
          data[o + 3] = 255;
        }
      }
      this.octx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }

    // view: { W, H, k (screen px per grid px), left (world x at screen left),
    //         top (grid y at screen top) }; ball: { x, y, r, flash 0..1, hitAge s }
    // grains: [{ x, y, z, size }] thrown sand
    draw(ctx, view, ball, grains) {
      const st = this.strip;
      this.shade(st.takeDirty());
      const { W, H, k, left, top } = view;
      ctx.fillStyle = P.BG;
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.off, left - st.origin, top, W / k, H / k, 0, 0, W, H);
      // the lamp's warm fall-off across the bed
      const lsx = Math.cos(this.az), lsy = -Math.sin(this.az);
      const g = ctx.createLinearGradient(W / 2 + lsx * W * 0.6, H / 2 + lsy * H * 0.6, W / 2 - lsx * W * 0.6, H / 2 - lsy * H * 0.6);
      g.addColorStop(0, 'rgba(255,180,92,0.10)'); g.addColorStop(1, 'rgba(30,18,8,0.28)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (grains) this.drawGrains(ctx, grains, view, lsx, lsy);
      if (ball) {
        const bx = (ball.x - left) * k, by = (ball.y - top) * k, br = ball.r * k;
        if (ball.flash > 0.01) this.drawHit(ctx, bx, by, br, ball.flash, ball.hitAge);
        this.drawBall(ctx, bx, by, br, lsx, lsy, ball.flash);
      }
    }

    // a hit: warm light pooling on the sand and a ring kicked out from the ball
    drawHit(ctx, x, y, r, f, age) {
      const g = P.GLOW;
      const pool = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 4.5);
      pool.addColorStop(0, `rgba(255,180,92,${0.38 * f})`); pool.addColorStop(1, 'rgba(255,180,92,0)');
      ctx.fillStyle = pool;
      ctx.beginPath(); ctx.arc(x, y, r * 4.5, 0, Math.PI * 2); ctx.fill();
      const ringR = r * (1.3 + 5 * Math.min(1, age / 0.35));
      ctx.strokeStyle = g; ctx.globalAlpha = 0.55 * f * Math.max(0, 1 - age / 0.35);
      ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.beginPath(); ctx.arc(x, y, ringR, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawGrains(ctx, grains, view, lsx, lsy) {
      const { k, left, top } = view;
      ctx.fillStyle = 'rgba(25,14,6,0.28)';
      for (const p of grains) { // shadows, offset away from the lamp by height
        const s = p.size * k * 0.7;
        ctx.fillRect((p.x - left - lsx * p.z * 0.6) * k - s / 2, (p.y - top - lsy * p.z * 0.6) * k - s / 2, s, s);
      }
      const c = STYLE.sand.map((v) => Math.min(255, Math.round(v * 1.15)));
      ctx.fillStyle = `rgb(${c.join(',')})`;
      for (const p of grains) {
        const s = p.size * k * (1 + p.z * 0.004);
        ctx.fillRect((p.x - left) * k - s / 2, (p.y - top - p.z * 0.15) * k - s / 2, s, s);
      }
    }

    drawBall(ctx, x, y, r, lsx, lsy, flash) {
      const len = ((r * 1.3) / Math.tan(STYLE.elevation)) * 0.35;
      ctx.save();
      ctx.translate(x - lsx * len, y - lsy * len);
      ctx.rotate(Math.atan2(lsy, lsx));
      ctx.scale(1 + (len / r) * 0.5, 1);
      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.25);
      sg.addColorStop(0, 'rgba(25,14,6,0.55)'); sg.addColorStop(0.55, 'rgba(25,14,6,0.3)'); sg.addColorStop(1, 'rgba(25,14,6,0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      const hx = x + lsx * r * 0.42, hy = y + lsy * r * 0.42;
      const bg = ctx.createRadialGradient(hx, hy, r * 0.05, x, y, r);
      bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.18, '#f3f4f6'); bg.addColorStop(0.6, '#9ca3af'); bg.addColorStop(1, '#3f4651');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      const rg = ctx.createRadialGradient(x - lsx * r * 0.55, y - lsy * r * 0.55, 0, x - lsx * r * 0.55, y - lsy * r * 0.55, r * 0.7);
      rg.addColorStop(0, 'rgba(242,198,125,0.35)'); rg.addColorStop(1, 'rgba(242,198,125,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      if (flash > 0.01) { // the steel catches the light on the hit
        ctx.fillStyle = `rgba(255,214,150,${0.45 * flash})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  XB.SandStripRenderer = StripRenderer;
})();

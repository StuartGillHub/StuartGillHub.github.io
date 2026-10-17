/* Pendulum Wave: drawing (placeholder shapes, warm palette).
 *
 * The row of pendulums runs across the screen and each swings towards and
 * away from the viewer; a camera raised a little above the bar turns the
 * swing into the familiar travelling "snake". Everything about the look is
 * here, so it can be restyled without touching mechanics or sound.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const P = XB.Palette;

  const STYLE = {
    tilt: 0.55, // camera elevation (radians): how much of the swing shows as up/down
    skew: 0.12, // a little sideways lean of the swing, for depth
    bar: P.BRASS,
    string: 'rgba(251,241,227,0.45)',
    flash: P.GLOW,
    bobFrom: P.ACCENT, bobTo: P.ACCENT2, // longest to shortest
  };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

  class PendulumRenderer {
    // view: { W, H, top, bottom } device pixels; wave: PendulumWave;
    // state: { t, flash(n) -> 0..1 }
    draw(ctx, view, wave, state) {
      const { W, H, top, bottom } = view;
      ctx.fillStyle = P.BG;
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(W / 2, top, 0, W / 2, top, Math.max(W, H));
      glow.addColorStop(0, 'rgba(255,180,92,0.14)'); glow.addColorStop(1, 'rgba(255,180,92,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

      const n = wave.count;
      const margin = Math.min(W * 0.1, 120 * view.dpr);
      const barY = top + 28 * view.dpr;
      const span = W - 2 * margin;
      const gap = span / (n - 1);
      const bobR = Math.max(5, Math.min(gap * 0.36, 26 * view.dpr));
      // longest string must fit at its lowest point on screen: depth on
      // screen is L cos(theta - tilt), deepest at theta = tilt (or the
      // amplitude limit), with room for a nearer-looking bob
      const Arad = (wave.A * Math.PI) / 180;
      const deepest = Arad >= STYLE.tilt ? 1 : Math.cos(Arad - STYLE.tilt);
      const avail = H - bottom - barY - bobR * 1.4 - 12 * view.dpr;
      const Lpx = Math.max(40, avail / deepest);

      // top bar
      ctx.fillStyle = STYLE.bar;
      ctx.fillRect(margin - gap * 0.6, barY - 7 * view.dpr, span + gap * 1.2, 10 * view.dpr);
      const c0 = hex(STYLE.bobFrom), c1 = hex(STYLE.bobTo), cf = hex(STYLE.flash);
      // draw back-to-front: pendulums swung away from the viewer first
      const order = [];
      for (let i = 0; i < n; i++) order.push(i);
      const z = order.map((i) => Math.sin(wave.theta(i, state.t)));
      order.sort((a, b) => z[a] - z[b]);
      for (const i of order) {
        const th = wave.theta(i, state.t);
        const L = Lpx * wave.length(i);
        const px = margin + i * gap, py = barY;
        const down = L * Math.cos(th), out = L * Math.sin(th); // out: towards the viewer
        const bx = px + out * STYLE.skew;
        const by = py + down * Math.cos(STYLE.tilt) + out * Math.sin(STYLE.tilt);
        const scale = 1 + 0.18 * (out / Lpx); // nearer looks bigger
        const fl = state.flash(i);
        ctx.strokeStyle = STYLE.string;
        ctx.lineWidth = Math.max(1, view.dpr);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.stroke();
        const base = lerp(c0, c1, i / (n - 1));
        const col = lerp(base, cf, fl * 0.85);
        const r = bobR * scale * (1 + 0.15 * fl);
        if (fl > 0.02) {
          const g = ctx.createRadialGradient(bx, by, r * 0.5, bx, by, r * 3);
          g.addColorStop(0, `rgba(${cf[0]},${cf[1]},${cf[2]},${0.55 * fl})`);
          g.addColorStop(1, `rgba(${cf[0]},${cf[1]},${cf[2]},0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(bx, by, r * 3, 0, Math.PI * 2); ctx.fill();
        }
        const bg = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.35, r * 0.1, bx, by, r);
        bg.addColorStop(0, `rgb(${lerp(col, [255, 255, 255], 0.55).join(',')})`);
        bg.addColorStop(1, `rgb(${lerp(col, [0, 0, 0], 0.45).join(',')})`);
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  XB.PendulumRenderer = PendulumRenderer;
  XB.PendulumStyle = STYLE;
})();

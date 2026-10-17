/* Sand Pendulum mode: a steel ball rolls forward through a bed of sand,
 * seen from above, swinging up and down in time with the music and leaving
 * its groove behind it. The camera follows the ball forward only: the ball
 * always sits on the same vertical line of the screen, and the camera never
 * follows its up-and-down swing.
 *
 * Glue only: the swing (XB.SandSwing), the sand (XB.SandStrip) and the
 * look (XB.SandStripRenderer) are separate.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const GW = 1024, GH = 384; // sand grid (grid px = world units)
  const SHIFT = 128; // columns moved per window shift
  const BALL_AT = 0.62; // the ball's fixed place across the screen
  const SPEED = 110; // world units per second at 1x
  const SURGE = 0.6; // extra forward speed right after a hit

  function SandPendulumMode(host) {
    const canvas = host.canvas;
    const ctx = canvas.getContext('2d');
    const settings = { speed: 1, swing: 0.8, beats: 2, ball: 0.028, light: 150, effects: true, flicks: 0.08 };
    const spray = new XB.SandSpray();
    function smooth() { strip.clear(); spray.grains.length = 0; }
    const strip = new XB.SandStrip(GW, GH, 7);
    const look = new XB.SandStripRenderer(strip);
    const swing = new XB.SandSwing();
    const ball = { x: null, y: GH / 2 };
    let view = null;

    const radius = () => settings.ball * GH;
    function layout() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      // fill the screen with sand; wide screens crop the top and bottom
      const k = Math.max(H / GH, W / (GW - SHIFT - 64));
      const visW = W / k, visH = H / k;
      view = { W, H, k, visW, visH, top: (GH - visH) / 2 };
      if (ball.x === null) ball.x = BALL_AT * visW + 8;
      view.left = ball.x - BALL_AT * visW;
    }
    // half the height the ball may swing through, in grid units
    const reach = () => settings.swing * (view.visH / 2 - radius() - 16);

    let flash = 0, hitAge = 1;
    function update(dt) {
      dt = Math.min(0.1, Math.max(0, dt));
      if (!view) layout();
      const r = radius(), amp = reach();
      swing.beatsPerSwing = settings.beats;
      swing.flickSize = settings.flicks;
      swing.setMusic(host.show(), host.notes());
      // sub-steps so each sweep of the ball is short (<= 0.3 r); the kick
      // out of a turn is the fastest part of the swing
      const forwardMax = SPEED * settings.speed * (1 + SURGE) * dt;
      const vy = (2 * amp * 2.6) / (0.3 * settings.beats);
      const n = Math.max(1, Math.min(120, Math.ceil((forwardMax + vy * dt) / (0.3 * r))));
      const sdt = dt / n;
      const playing = host.playing(), t = host.time();
      for (let j = 0; j < n; j++) {
        const s = swing.step(sdt, { playing, t: t - dt + (j + 1) * sdt });
        // each hit also drives the ball forward for a moment
        const nx = ball.x + SPEED * settings.speed * (1 + SURGE * s.env) * sdt, ny = GH / 2 + s.y * amp;
        strip.carve(ball.x, ball.y, nx, ny, r);
        const px = ball.x, py = ball.y;
        ball.x = nx; ball.y = ny;
        for (const e of swing.events) hit(e, r, px, py);
      }
      flash *= Math.exp(-dt / 0.22);
      hitAge += dt;
      spray.update(dt, (x, y, size) => strip.carve(x, y, x, y, 0.9 + size * 0.9, 0.5));
      // keep the sand window around the camera
      const left = ball.x - BALL_AT * view.visW;
      while (left - strip.origin > SHIFT) look.shifted(strip.shift(SHIFT));
    }
    // the ball is kicked into a turn: a crater, thrown sand and a flash
    function hit(e, r, px, py) {
      if (!settings.effects) return;
      const s = Math.max(0.15, Math.min(1, e.hit));
      // swept along the last bit of travel, so no sand falls back into the groove
      strip.carve(px, py, ball.x, ball.y, r * (1.1 + 0.35 * s), 0.38 + 0.2 * s);
      spray.burst(ball.x, ball.y, Math.sign(ball.y - GH / 2) || 1, s, SPEED * settings.speed);
      flash = Math.max(flash, 0.35 + 0.65 * s);
      hitAge = 0;
    }

    function render() {
      layout();
      look.draw(ctx, view, { x: ball.x, y: ball.y, r: radius(), flash, hitAge }, spray.grains);
    }



    return {
      id: 'sandpend',
      name: 'Sand Pendulum',
      init() { canvas.classList.remove('hidden'); },
      update,
      render,
      onKey(e) {
        if (e.code === 'KeyC') { smooth(); return true; }
        return false;
      },
      dispose() { canvas.classList.add('hidden'); },
      getControls() {
        return [
          { type: 'heading', label: 'Sand Pendulum' },
          { type: 'range', label: 'Forward speed', min: 0.25, max: 3, step: 0.05, value: settings.speed, format: (v) => v.toFixed(2) + '×', onInput: (v) => { settings.speed = v; } },
          { type: 'range', label: 'Swing size', min: 0.15, max: 1, step: 0.01, value: settings.swing, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { settings.swing = v; } },
          { type: 'select', label: 'One swing every', value: String(settings.beats), options: [['1', 'beat'], ['2', '2 beats'], ['4', 'bar (4 beats)']], onChange: (v) => { settings.beats = +v; } },
          { type: 'range', label: 'Ball size', min: 0.015, max: 0.05, step: 0.001, value: settings.ball, format: (v) => (v * 200).toFixed(1) + '% of height', onInput: (v) => { settings.ball = v; } },
          { type: 'check', label: 'Hit effects', hint: 'On each turn: a crater, a spray of sand and a flash.', value: settings.effects, onChange: (on) => { settings.effects = on; } },
          { type: 'range', label: 'Note flicks', min: 0, max: 0.2, step: 0.01, value: settings.flicks, format: (v) => (v ? Math.round(v * 500) + '%' : 'off'), onInput: (v) => { settings.flicks = v; } },
          { type: 'range', label: 'Light angle', min: 0, max: 359, step: 1, value: settings.light, format: (v) => v + '°', onInput: (v) => { settings.light = v; look.setLight(v); } },
          { type: 'buttons', items: [{ label: 'Smooth the sand', title: 'C', onClick: smooth }] },
        ];
      },
      // for tests
      _debug: { strip, swing, ball, settings, look, spray, get view() { return view; } },
    };
  }

  XB.SandPendulumMode = SandPendulumMode;
})();

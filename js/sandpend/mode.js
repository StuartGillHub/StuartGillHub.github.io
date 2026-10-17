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

  function SandPendulumMode(host) {
    const canvas = host.canvas;
    const ctx = canvas.getContext('2d');
    const settings = { speed: 1, swing: 0.75, beats: 2, ball: 0.028, light: 150 };
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

    function update(dt) {
      dt = Math.min(0.1, Math.max(0, dt));
      if (!view) layout();
      const r = radius(), amp = reach();
      const forward = SPEED * settings.speed * dt;
      // sub-steps so each sweep of the ball is short (<= 0.3 r)
      const vy = (amp * Math.PI) / (0.35 * settings.beats);
      const n = Math.max(1, Math.min(80, Math.ceil((forward + vy * dt) / (0.3 * r))));
      const sdt = dt / n;
      const show = host.show(), playing = host.playing(), t = host.time();
      for (let j = 0; j < n; j++) {
        swing.beatsPerSwing = settings.beats;
        const y = swing.step(sdt, { show, playing, t: t - dt + (j + 1) * sdt });
        const nx = ball.x + forward / n, ny = GH / 2 + y * amp;
        strip.carve(ball.x, ball.y, nx, ny, r);
        ball.x = nx; ball.y = ny;
      }
      // keep the sand window around the camera
      const left = ball.x - BALL_AT * view.visW;
      while (left - strip.origin > SHIFT) look.shifted(strip.shift(SHIFT));
    }

    function render() {
      layout();
      look.draw(ctx, view, { x: ball.x, y: ball.y, r: radius() });
    }

    function smooth() { strip.clear(); }

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
          { type: 'range', label: 'Light angle', min: 0, max: 359, step: 1, value: settings.light, format: (v) => v + '°', onInput: (v) => { settings.light = v; look.setLight(v); } },
          { type: 'buttons', items: [{ label: 'Smooth the sand', title: 'C', onClick: smooth }] },
        ];
      },
      // for tests
      _debug: { strip, swing, ball, settings, look, get view() { return view; } },
    };
  }

  XB.SandPendulumMode = SandPendulumMode;
})();

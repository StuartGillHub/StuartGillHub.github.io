/* Camera: a smooth, slightly anticipating track that is then iteratively
 * corrected so the ball always stays inside a safe box. Built once per course
 * and viewport; at runtime a final hard clamp guarantees the ball is on screen.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});

  function gaussSmooth(src, sigmaSamples, shift) {
    const n = src.length;
    const out = new Float32Array(n);
    const half = Math.ceil(sigmaSamples * 3);
    const ker = new Float32Array(2 * half + 1);
    for (let k = -half; k <= half; k++) {
      const d = k - (shift || 0);
      ker[k + half] = Math.exp(-(d * d) / (2 * sigmaSamples * sigmaSamples));
    }
    for (let i = 0; i < n; i++) {
      let s = 0, ws = 0;
      for (let k = -half; k <= half; k++) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        const w = ker[k + half];
        s += src[j] * w; ws += w;
      }
      out[i] = s / ws;
    }
    return out;
  }

  function build(course, visW, visH) {
    const dt = 1 / 30;
    const t0 = course.tStart - 0.5;
    const t1 = course.tEnd + 0.5;
    const n = Math.ceil((t1 - t0) / dt) + 1;
    const bx = new Float32Array(n), by = new Float32Array(n);
    const tmp = {};
    for (let i = 0; i < n; i++) {
      XB.Course.evalAt(course, t0 + i * dt, tmp);
      bx[i] = tmp.x; by[i] = tmp.y;
    }
    // Look slightly ahead (ball falls, so we want to see where it's going).
    let cy = gaussSmooth(by, 0.5 / dt, 0.22 / dt);
    let cx = gaussSmooth(bx, 1.4 / dt, 0.3 / dt);
    // bias so the ball sits a bit above centre (more room below)
    for (let i = 0; i < n; i++) cy[i] -= visH * 0.06;

    const mY = visH * 0.3, mX = visW * 0.34;
    for (let it = 0; it < 8; it++) {
      const corrY = new Float32Array(n), corrX = new Float32Array(n);
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const dy = by[i] - cy[i];
        if (dy > mY) corrY[i] = dy - mY; else if (dy < -mY) corrY[i] = dy + mY;
        const dx = bx[i] - cx[i];
        if (dx > mX) corrX[i] = dx - mX; else if (dx < -mX) corrX[i] = dx + mX;
        worst = Math.max(worst, Math.abs(corrY[i]), Math.abs(corrX[i]));
      }
      if (worst < 1e-3) break;
      const sy = gaussSmooth(corrY, 0.26 / dt), sx = gaussSmooth(corrX, 0.35 / dt);
      for (let i = 0; i < n; i++) { cy[i] += sy[i] * 1.6; cx[i] += sx[i] * 1.6; }
    }
    return { t0, dt, n, cx, cy };
  }

  function at(cam, t, ball, visW, visH) {
    let f = (t - cam.t0) / cam.dt;
    f = Math.max(0, Math.min(cam.n - 1.001, f));
    const i = Math.floor(f), u = f - i;
    // Catmull-Rom keeps the camera's velocity continuous between samples
    const cr = (a) => {
      const p0 = a[Math.max(0, i - 1)], p1 = a[i], p2 = a[Math.min(cam.n - 1, i + 1)], p3 = a[Math.min(cam.n - 1, i + 2)];
      return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
    };
    let x = cr(cam.cx);
    let y = cr(cam.cy);
    if (ball) {
      const mY = visH * 0.42, mX = visW * 0.42;
      if (ball.y - y > mY) y = ball.y - mY;
      if (ball.y - y < -mY) y = ball.y + mY;
      if (ball.x - x > mX) x = ball.x - mX;
      if (ball.x - x < -mX) x = ball.x + mX;
    }
    return { x, y };
  }

  XB.Camera = { build, at };
})();

/* Course planner.
 *
 * The ball's motion is simulated forward in time with real gravity. Every note
 * time is a collision: the ball is wherever ballistic flight has carried it at
 * that instant, and a bar is placed exactly there. The bar's tilt is chosen
 * (by search) so that a physical reflection with restitution and friction
 * sends the ball on a good flight toward the next note. Because bars are
 * placed *at* the ball, every strike is sample-exact with the music.
 *
 * Long gaps with no notes are bridged with wire tracks: the ball is caught by
 * a rail, rolls under gravity (solid sphere, 5/7 g sin θ, rolling resistance)
 * along a procedurally steered curve – waves, hairpins and loops – and the
 * rail simply ends when the remaining time equals a short flight to the next
 * note.
 *
 * World units are metres, y is up.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});

  const G = 9.81;
  const R = 0.042; // ball radius
  const T = 0.04; // bar thickness (face height seen on the wall)
  const E = 0.7; // coefficient of restitution (hard ball on a metal glockenspiel bar)
  const MU = 0.3; // Coulomb friction at the strike (slip -> spin)
  const RAIL = R + 0.006; // rail centre offset from ball centre
  const BAND = 0.62; // horizontal half-width wire tracks stay within
  const BAR_BAND = 1.15; // horizontal half-width the bouncing section roams
  const WIRE_H = 1 / 480; // wire integration step (s)

  XB.PHYS = { G, R, T, E, MU, RAIL };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const barLength = (midi) => clamp(0.3 - (midi - 55) * 0.0045, 0.13, 0.3);

  /* ---------------- flight ---------------- */
  function flight(t0, t1, p, v, w, a) {
    return { type: 'F', t0, t1, p0: { x: p.x, y: p.y }, v0: { x: v.x, y: v.y }, w, a0: a };
  }
  function flightEnd(seg) {
    const tau = seg.t1 - seg.t0;
    return {
      p: { x: seg.p0.x + seg.v0.x * tau, y: seg.p0.y + seg.v0.y * tau - 0.5 * G * tau * tau },
      v: { x: seg.v0.x, y: seg.v0.y - G * tau },
      a: seg.a0 + seg.w * tau,
    };
  }

  /* ---------------- bounce ---------------- */
  // Pick the bar tilt that sends the ball closest to a musically sensible
  // target for the next strike, using a real reflection model.
  // Penalty for a flight path (forward or backward in time from the strike)
  // that would pass through the bar being struck.
  function clipPenalty(v, sign, dur, nx, ny, tX, tY, half) {
    let pen = 0;
    const steps = 10;
    for (let k = 1; k <= steps; k++) {
      const tau = (dur * k) / steps;
      const dx = sign * v.x * tau;
      const dy = sign * v.y * tau - 0.5 * G * tau * tau;
      const w = dx * nx + dy * ny;
      if (w > -0.02 * R || w < -2 * R - T) continue;
      const u = Math.abs(dx * tX + dy * tY);
      const over = half + R * 1.05 - u;
      if (over > 0) pen += over * over;
    }
    return pen;
  }

  // Rigid-body impact of a solid sphere (I = 2/5 m R^2) on a fixed bar with
  // normal n and tangent t = (n.y, -n.x): restitution on the normal part,
  // Coulomb friction on the slip of the contact point, capped at the impulse
  // that makes the ball roll. Returns outgoing velocity and spin.
  function impact(vx, vy, w, nx, ny) {
    const tX = ny, tY = -nx;
    const vn = vx * nx + vy * ny;
    const vt = vx * tX + vy * tY;
    const slip = vt + w * R;
    const jn = (1 + E) * -vn; // per unit mass
    let jt = Math.min(MU * jn, (2 / 7) * Math.abs(slip));
    jt = slip > 0 ? -jt : jt;
    const vt2 = vt + jt;
    const vn2 = -E * vn;
    return { x: tX * vt2 + nx * vn2, y: tY * vt2 + ny * vn2, w: w + (2.5 * jt) / R };
  }

  // Pick the bar tilt that sends the ball closest to a musically sensible
  // target for the next strike, using the rigid-body impact model.
  // Penalty for a flight that would pass through bars already on the wall.
  function barsPenalty(p, v, dur, recent) {
    if (!recent.length) return 0;
    let pen = 0;
    const steps = 12;
    for (let k = 2; k <= steps; k++) {
      const tau = (dur * k) / steps;
      const x = p.x + v.x * tau, y = p.y + v.y * tau - 0.5 * G * tau * tau;
      for (const b of recent) {
        const dx = x - b.sx, dy = y - b.sy;
        if (dx * dx + dy * dy > 0.2) continue;
        const u = dx * b.tX + dy * b.tY;
        const w = dx * b.nx + dy * b.ny;
        const cu = Math.max(-b.lenL - u, 0, u - b.lenR);
        const cw = Math.max(-T - w, 0, w);
        const d = Math.hypot(cu, cw);
        if (d < R * 1.3) pen += (R * 1.3 - d) * 10;
      }
    }
    return pen;
  }

  // Penalty for landing (= placing the next bar) on a spot the ball has
  // recently flown through: that bar would sit across the earlier path.
  function trailPenalty(lx, ly, trail) {
    let pen = 0;
    for (let i = 0; i < trail.length; i += 2) {
      const d = Math.hypot(lx - trail[i], ly - trail[i + 1]);
      if (d < 0.12) pen += (0.12 - d) * 3;
    }
    return pen;
  }

  // Where the ball should head after a strike. side: how this bar is struck
  // ('floor' from above, 'ceil' on its underside); nextSide: how the next one
  // will be. A ceiling bar has to be reached while the ball is still rising.
  function strikeTarget(p, vin, dt, dir, side, nextSide, steer) {
    const pingPong = side === 'ceil' || nextSide === 'ceil';
    // Musical staircase: short notes = small steps; longer notes = bigger hops.
    const reach = (pingPong ? 0.06 + 1.0 * dt : Math.min(0.06 + 0.6 * dt, 0.8)) * steer;
    // A bounce can only give back ~e*|v| of speed: if the ideal hop is out of
    // reach energetically, aim lower instead of asking for the impossible.
    const vmax = 0.7 * E * Math.hypot(vin.x, vin.y);
    let dy;
    // up to a bar overhead: high enough to still be rising when we get there
    if (nextSide === 'ceil') dy = 0.4 * dt + 0.5 * G * dt * dt - 0.02;
    else if (side === 'ceil') dy = -(0.12 + 0.3 * dt + 0.5 * G * dt * dt); // knocked back down, below where we came from
    else dy = -Math.max(Math.min(0.07 + 0.38 * dt, 0.6), 0.5 * G * dt * dt - vmax * dt);
    // keep the ball calm enough for what's coming (fast notes need a slow ball)
    const vcap = pingPong ? 3.4 : 2.1 + 2 * dt;
    return { tx: p.x + dir * reach, ty: p.y + dy, vcap };
  }

  // Cheap part of a strike's cost: aim, tilt, speed and arrival direction.
  function coreCost(p, out, dt, tgt, tilt, nextSide) {
    const lx = p.x + out.x * dt;
    const ly = p.y + out.y * dt - 0.5 * G * dt * dt;
    let cost = (lx - tgt.tx) ** 2 + 1.5 * (ly - tgt.ty) ** 2 + 0.012 * tilt * tilt;
    const steep = Math.abs(tilt) - 0.75;
    if (steep > 0) cost += 0.25 * steep * steep;
    const arriveVy = out.y - G * dt;
    if (nextSide === 'ceil') {
      if (arriveVy < 0.45) cost += 0.25 * (0.45 - arriveVy) ** 2;
    } else if (arriveVy > -0.6) {
      // strongly prefer arriving at the next bar on the way down
      cost += 0.08 * (arriveVy + 0.6) ** 2;
    }
    const vo = Math.hypot(out.x, out.y);
    if (vo > tgt.vcap) cost += 0.3 * (vo - tgt.vcap) ** 2;
    return { cost, lx, ly };
  }

  // Best achievable cheap cost for the strike after this one (lookahead).
  function nextStrikeCost(p, v, w, dt, dir, side) {
    const tgt = strikeTarget(p, v, dt, dir, side, 'floor', 1);
    const base = side === 'ceil' ? Math.PI : 0;
    let best = Infinity;
    for (let phi = base - 1.15; phi <= base + 1.15; phi += 0.05) {
      const nx = Math.sin(phi), ny = Math.cos(phi);
      if (v.x * nx + v.y * ny > -0.2) continue;
      const out = impact(v.x, v.y, w, nx, ny);
      const c = coreCost(p, out, dt, tgt, phi - base, 'floor').cost;
      if (c < best) best = c;
    }
    return best;
  }

  // Choose this bar's tilt. With `ahead` = {dt} it also looks one strike
  // ahead, so a bounce that sets up a good next strike is preferred.
  function planBounce(p, vin, win, dt, dir, rnd, half, prevDt, recent, trail, side, nextSide, ahead) {
    const tgt = strikeTarget(p, vin, dt, dir, side, nextSide, 0.88 + 0.24 * rnd());
    const back = Math.min(prevDt, 0.4);
    const fwd = Math.min(dt, 0.5);
    const base = side === 'ceil' ? Math.PI : 0;
    let best = null;
    const evalPhi = (phi, minApproach, look) => {
      const nx = Math.sin(phi), ny = Math.cos(phi);
      const vn = vin.x * nx + vin.y * ny;
      if (vn > -minApproach) return; // must be moving into the bar
      const tX = ny, tY = -nx;
      const out = impact(vin.x, vin.y, win, nx, ny);
      const core = coreCost(p, out, dt, tgt, phi - base, nextSide);
      let cost = core.cost;
      if (best && cost > best.cost) return;
      const vout = { x: out.x, y: out.y };
      cost += 4 * (clipPenalty(vin, -1, back, nx, ny, tX, tY, half) + clipPenalty(vout, 1, fwd, nx, ny, tX, tY, half));
      if (best && cost > best.cost) return;
      cost += barsPenalty(p, vout, dt, recent) + trailPenalty(core.lx, core.ly, trail);
      if (best && cost > best.cost) return;
      if (look && ahead) {
        const p1 = { x: core.lx, y: core.ly };
        const v1 = { x: out.x, y: out.y - G * dt };
        const c1 = nextStrikeCost(p1, v1, out.w, ahead.dt, dir, nextSide);
        if (!isFinite(c1)) return;
        cost += 0.7 * c1;
      }
      if (!best || cost < best.cost) best = { cost, phi, nx, ny, tX, tY, vout, omega: out.w };
    };
    // coarse pass with lookahead, then refine around the winner
    for (let phi = base - 1.15; phi <= base + 1.15 + 1e-9; phi += 0.02) evalPhi(phi, 0.2, true);
    if (best) {
      const c = best.phi;
      best = null;
      for (let phi = c - 0.02; phi <= c + 0.02 + 1e-9; phi += 0.004) evalPhi(phi, 0.2, true);
    }
    if (!best) for (let phi = -Math.PI; phi <= Math.PI; phi += 0.01) evalPhi(phi, 0.02, false);
    if (!best) {
      // ball is barely moving – a flat bar and a tiny hop
      best = { cost: Infinity, phi: 0, nx: 0, ny: 1, tX: 1, tY: 0, vout: { x: dir * 0.4, y: 1.2 }, omega: (-dir * 0.4) / R };
    }
    return best;
  }

  /* ---------------- wire track ---------------- */
  // Rolling resistance on a two-wire track: proportional to the normal force
  // (so turns and loops cost energy) plus a little air drag.
  const RR = 0.05, DRAG = 0.03;
  const wireAcc = (theta, v, kappa) => {
    const normal = kappa * v * v + G * Math.cos(theta);
    return -(5 / 7) * G * Math.sin(theta) - RR * Math.abs(normal) - DRAG * v * v;
  };
  // Minimum speed reached going round a loop entered at speed v.
  function loopMinSpeed(v, theta, dir, radius) {
    const h = 1 / 600;
    const k = dir / radius;
    let turned = 0, minv = v;
    while (turned < 2 * Math.PI) {
      const ds = v * h;
      theta += k * ds;
      turned += ds / radius;
      v += wireAcc(theta, v, k) * h;
      if (v < minv) minv = v;
      if (v < 0.3) return 0;
    }
    return minv;
  }

  function buildWire(p0, v0, t0, dur, dirIn, rnd) {
    const n = Math.max(2, Math.ceil(dur / WIRE_H));
    const h = dur / n;
    const xs = new Float32Array(n + 1);
    const ys = new Float32Array(n + 1);
    const th = new Float32Array(n + 1);
    const sp = new Float32Array(n + 1);
    const an = new Float32Array(n + 1);
    const ss = new Float32Array(n + 1);
    const lp = new Uint8Array(n + 1);

    let x = p0.x, y = p0.y;
    let dir = Math.abs(v0.x) > 0.15 ? Math.sign(v0.x) : dirIn;
    if (x * dir > BAND * 0.6) dir = -dir;
    // The ball lands on a gently sloping, flared rail mouth: the velocity
    // component into the rails is absorbed (clack), the tangential part kept.
    const inAng = Math.atan2(v0.y, v0.x);
    const catchAlpha = 0.3;
    let theta = dir > 0 ? -catchAlpha : -(Math.PI - catchAlpha);
    // don't make the ball turn back on itself at the catch
    if (Math.cos(theta - inAng) < 0.2) theta = inAng + clamp(wrap(theta - inAng), -1.2, 1.2);
    let v = clamp(Math.hypot(v0.x, v0.y) * Math.cos(theta - inAng) * 0.95, 0.5, 2.4);
    let omega = 0, ang = 0, s = 0;
    let mode = 'run', turnSign = 0, turned = 0, newDir = dir;
    const vDes = 1.4 + 0.3 * rnd();
    const waveA = 0.035 + 0.05 * rnd();
    const waveL = 0.6 + 0.6 * rnd();
    const waveP = rnd() * Math.PI * 2;
    const loopR = 0.14 + 0.05 * rnd();
    let loopWanted = dur > 2.2 && rnd() < 0.85;
    let lastFeature = 0, featureCount = 0, finalTurn = false, lastWasLoop = false;
    const TURN_R = 0.13 + 0.04 * rnd();

    for (let i = 0; i <= n; i++) {
      xs[i] = x; ys[i] = y; th[i] = theta; sp[i] = v; an[i] = ang; ss[i] = s; lp[i] = mode === 'loop' ? 1 : 0;
      if (i === n) break;
      const remaining = dur - i * h;
      let kappa = 0;
      const turnTime = (Math.PI * TURN_R) / Math.max(v, 0.6) + 0.15;

      if (mode === 'run' && s - lastFeature > 0.25) {
        const outward = x * dir;
        if (remaining > turnTime && (outward > BAND ||
            (!finalTurn && outward > 0.15 && remaining < turnTime + 0.9))) {
          mode = 'turn'; newDir = -dir; turnSign = dir > 0 ? -1 : 1;
          if (remaining < turnTime + 0.9) finalTurn = true;
        } else if (loopWanted && x * dir < -0.2 && remaining > 1.9) {
          mode = 'dive';
        }
      }

      if (mode === 'turn') {
        kappa = turnSign / TURN_R;
        if (Math.cos(theta) * newDir > 0.9) {
          mode = 'run'; dir = newDir; lastFeature = s; featureCount++; lastWasLoop = false;
        }
      } else if (mode === 'loop') {
        kappa = (dir > 0 ? 1 : -1) / loopR;
        turned += Math.abs(kappa) * v * h;
        if (turned >= 2 * Math.PI) { mode = 'run'; loopWanted = false; lastFeature = s; featureCount++; lastWasLoop = true; }
      } else {
        let alpha;
        if (mode === 'dive') {
          alpha = 0.7;
          const target = dir > 0 ? -alpha : -(Math.PI - alpha);
          if (Math.abs(wrap(target - theta)) < 0.12 && x * dir > -0.15 && loopMinSpeed(v, theta, dir, loopR) > 0.95) {
            mode = 'loop'; turned = 0;
          } else if (remaining < 1.2 || x * dir > BAND * 0.7) {
            mode = 'run'; loopWanted = false;
          }
        } else {
          const postLoop = featureCount > 0 && !loopWanted && s - lastFeature < 0.8 && lastWasLoop;
          alpha = postLoop ? clamp(0.085 + 0.4 * (vDes - v), -0.25, 0.5) : clamp(0.085 + 0.3 * (vDes - v), -0.04, 0.5);
          alpha += waveA * Math.sin((2 * Math.PI * s) / waveL + waveP);
        }
        if (mode === 'loop') {
          kappa = (dir > 0 ? 1 : -1) / loopR;
        } else {
          if (remaining < 0.4) alpha = 0.12; // launch lip
          const target = dir > 0 ? -alpha : -(Math.PI - alpha);
          kappa = clamp(6 * wrap(target - theta), -1 / 0.2, 1 / 0.2);
        }
      }

      const ds = v * h;
      theta += kappa * ds;
      v = Math.max(0.3, v + wireAcc(theta, v, kappa) * h);
      x += Math.cos(theta) * ds;
      y += Math.sin(theta) * ds;
      s += ds;
      // the rail that carries the ball decides its spin direction
      const normal = kappa * v * v + G * Math.cos(theta);
      const wT = (normal >= 0 ? -1 : 1) * (v / R);
      omega += (wT - omega) * Math.min(1, 25 * h);
      ang += omega * h;
    }
    const last = n;
    return {
      seg: { type: 'W', t0, t1: t0 + dur, h, n, xs, ys, th, sp, an, ss, lp, a0: 0 },
      end: {
        p: { x: xs[last], y: ys[last] },
        v: { x: Math.cos(th[last]) * sp[last], y: Math.sin(th[last]) * sp[last] },
        omega, dir,
      },
      features: featureCount,
    };
  }

  // A short inclined start ledge the ball rolls off.
  function buildLedge(pEdge, t0, t1, dir) {
    const dur = t1 - t0;
    const n = Math.max(2, Math.ceil(dur / WIRE_H));
    const h = dur / n;
    const beta = 0.075;
    const a = (5 / 7) * G * Math.sin(beta);
    const cosb = Math.cos(beta) * dir, sinb = -Math.sin(beta);
    const L = 0.5 * a * dur * dur;
    const xs = new Float32Array(n + 1), ys = new Float32Array(n + 1);
    const th = new Float32Array(n + 1), sp = new Float32Array(n + 1);
    const an = new Float32Array(n + 1), ss = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const tau = i * h;
      const d = 0.5 * a * tau * tau - L;
      xs[i] = pEdge.x + cosb * d;
      ys[i] = pEdge.y + sinb * d;
      th[i] = Math.atan2(sinb, cosb);
      sp[i] = a * tau;
      an[i] = (-dir * (0.5 * a * tau * tau)) / R;
      ss[i] = d + L;
    }
    const vEnd = a * dur;
    return {
      seg: { type: 'W', ledge: true, t0, t1, h, n, xs, ys, th, sp, an, ss, a0: 0 },
      end: { p: { x: pEdge.x, y: pEdge.y }, v: { x: cosb * vEnd, y: sinb * vEnd }, omega: (-dir * vEnd) / R, a: an[n] },
      start: { x: xs[0], y: ys[0] },
      beta,
    };
  }

  /* ---------------- build a whole course ---------------- */
  function build(notesIn, opts) {
    const o = Object.assign({ wireGap: 0.8, seed: 7 }, opts || {});
    const rnd = mulberry32(o.seed);
    const notes = [];
    for (const nt of notesIn) {
      if (!notes.length || nt.t - notes[notes.length - 1].t >= 0.07) notes.push(nt);
    }
    const segs = [];
    const bars = [];
    const wires = [];
    const events = []; // for sounds: {t, type}
    let dir = 1;

    if (!notes.length) notes.push({ t: 1, midi: 72, strength: 0.5 });

    // --- start: roll off a ledge, then either drop or ride a wire ---
    const first = notes[0].t;
    const gap1 = notes[1] ? notes[1].t - first : 0.5;
    const drop = clamp(0.22 + 0.35 * gap1, 0.26, 0.42);
    const wireStart = first > o.wireGap + drop + 0.4;
    const tRelease = wireStart ? -0.25 : first - drop;
    const tPre = tRelease - 0.9;
    const edge = { x: -0.3, y: 0 };
    const ledge = buildLedge(edge, tPre, tRelease, dir);
    segs.push(ledge.seg);
    let st = { p: ledge.end.p, v: ledge.end.v, w: ledge.end.omega, a: ledge.end.a, t: tRelease };

    const addFlight = (tEnd) => {
      const seg = flight(st.t, tEnd, st.p, st.v, st.w, st.a);
      segs.push(seg);
      const e = flightEnd(seg);
      st = { p: e.p, v: e.v, w: st.w, a: e.a, t: tEnd };
    };
    const addWireBridge = (tNext) => {
      // descend at least ~0.2 m below the launch point before the catch
      const vy = st.v.y;
      let f1 = (vy + Math.sqrt(vy * vy + 2 * G * 0.2)) / G;
      f1 = clamp(f1, 0.18, 0.45);
      const f2 = 0.22;
      const tw = tNext - st.t - f1 - f2;
      if (tw < 0.22) { addFlight(tNext); return; }
      addFlight(st.t + f1);
      const w = buildWire(st.p, st.v, st.t, tw, dir, rnd);
      w.seg.a0 = st.a;
      for (let i = 0; i < w.seg.an.length; i++) w.seg.an[i] += st.a;
      segs.push(w.seg);
      wires.push(w.seg);
      events.push({ t: w.seg.t0, type: 'catch', speed: Math.hypot(st.v.x, st.v.y) });
      events.push({ t: w.seg.t1, type: 'launch' });
      dir = w.end.dir;
      st = { p: w.end.p, v: w.end.v, w: w.end.omega, a: w.seg.an[w.seg.n], t: w.seg.t1 };
      addFlight(tNext);
    };

    if (wireStart) addWireBridge(first);
    else addFlight(first);

    // Fast passages: the ball may also strike the underside of a bar, so it
    // can ping-pong between two staggered rows instead of racing downhill.
    // "Fast" is relative to this song: notes clearly quicker than its usual pace.
    const gaps = notes.slice(1).map((n, k) => n.t - notes[k].t).filter((g) => g < o.wireGap).sort((a, b) => a - b);
    const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0.4;
    const FAST = o.fastGap || clamp(0.85 * medGap, 0.2, 0.3);
    const CEIL_BONUS = 0.04;
    let nextPlanned = 'floor';
    let side = 'floor';

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const next = notes[i + 1];
      const isLast = !next;
      // a ceiling strike needs the ball to actually be rising into the bar
      side = nextPlanned === 'ceil' && st.v.y > 0 ? 'ceil' : 'floor';
      const gap = isLast ? 0.62 : next.t - note.t;
      const isWire = !isLast && gap > o.wireGap;
      // Keep going the way the ball is already travelling; turn back near the
      // edge of the band on a longer note (its higher arc clears the bars
      // above), or at the hard edge whatever the rhythm.
      // Follow the ball's own travel, except inside a fast passage, where the
      // direction is held so one odd bounce can't fold the run back on itself.
      const inRun = gap < FAST && i > 0 && note.t - notes[i - 1].t < FAST;
      if (Math.abs(st.v.x) > 0.35 && !inRun) dir = Math.sign(st.v.x);
      let outward = st.p.x * dir;
      let steep = false;
      if (outward > BAR_BAND * 0.5 && gap > 0.36) dir = -dir;
      else if (outward > BAR_BAND * 1.8) {
        // at the hard edge: turn on a note long enough to arc back over the
        // bars; in a fast run, step steeply down instead of doubling back
        dir = -dir;
      }
      const hop = isWire ? 0.3 : gap;
      // pitch sets the natural bar length; tight runs get shorter bars
      const localGap = Math.min(isWire ? 1 : gap, i ? note.t - notes[i - 1].t : 1);
      const L = clamp(Math.min(barLength(note.midi), 1.1 * (0.06 + 0.6 * localGap)), 0.08, 0.3);
      const recent = bars.slice(-14);
      // where the ball has been over the last ~1.5 s (excluding the approach)
      const trail = [];
      const tmp = {};
      const tc = { segs, segStarts: segs.map((sg) => sg.t0) };
      const recentGap = Math.max(0.3, 2.5 * Math.min(gap, i ? note.t - notes[i - 1].t : 1));
      for (let tt = st.t - 1.5; tt < st.t - recentGap; tt += 0.03) {
        if (tt < segs[0].t0) continue;
        evalAt(tc, tt, tmp);
        trail.push(tmp.x, tmp.y);
      }
      const prevGap = i ? note.t - notes[i - 1].t : 0.4;
      const ahead = !isLast && !isWire && notes[i + 2] && notes[i + 2].t - next.t <= o.wireGap ? { dt: notes[i + 2].t - next.t } : null;
      let b = planBounce(st.p, st.v, st.w, hop, dir, rnd, L / 2, prevGap, recent, trail, side, 'floor', ahead);
      if (side === 'ceil' && !isFinite(b.cost)) {
        // no way to meet the bar overhead after all: strike one from above
        side = 'floor';
        b = planBounce(st.p, st.v, st.w, hop, dir, rnd, L / 2, prevGap, recent, trail, side, 'floor', ahead);
      }
      // In fast passages also try setting up a strike on the underside of
      // the next bar; take it when it works out as well as a normal step.
      const fastHere = !isWire && !isLast && gap < FAST && side === 'floor' && ahead && ahead.dt < FAST * 1.4;
      if (fastHere && st.p.x * dir < BAR_BAND * 2) {
        const bc = planBounce(st.p, st.v, st.w, hop, dir, rnd, L / 2, prevGap, recent, trail, side, 'ceil', ahead);
        if (bc.cost - CEIL_BONUS < b.cost) { b = bc; nextPlanned = 'ceil'; } else nextPlanned = 'floor';
      } else nextPlanned = 'floor';
      const off = (rnd() - 0.5) * 0.25 * L;
      bars.push({
        sx: st.p.x - b.nx * R, sy: st.p.y - b.ny * R,
        t: note.t, midi: note.midi, strength: note.strength,
        cx: st.p.x, cy: st.p.y, // ball centre at contact
        nx: b.nx, ny: b.ny, tX: b.tX, tY: b.tY,
        lenL: L / 2 + off, lenR: L / 2 - off, L0: L,
        vin: Math.hypot(st.v.x, st.v.y),
        ceil: side === 'ceil',
      });
      st.v = b.vout;
      st.w = b.omega;

      if (isLast) {
        addFlight(note.t + gap);
        // finale: the ball drops into a cup and settles
        const cup = { x: st.p.x, y: st.p.y - R, t: st.t };
        let vy = Math.abs(st.v.y) * 0.35;
        st.v = { x: 0, y: vy };
        st.w *= 0.3;
        events.push({ t: st.t, type: 'cup' });
        let k = 0;
        while (vy > 0.18 && k < 8) {
          const dt = (2 * vy) / G;
          addFlight(st.t + dt);
          events.push({ t: st.t, type: 'cup', soft: true, vel: vy });
          vy *= 0.4;
          st.v = { x: 0, y: vy };
          st.w *= 0.5;
          k++;
        }
        segs.push({ type: 'R', t0: st.t, t1: Infinity, p0: { x: st.p.x, y: st.p.y }, a0: st.a });
        return finish({ segs, bars, wires, events, cup, ledge, tPre, notes });
      }
      if (isWire) addWireBridge(next.t);
      else addFlight(next.t);
    }
  }

  function finish(course) {
    course.tStart = course.tPre;
    course.tEnd = course.cup.t + 1.2;
    course.segStarts = course.segs.map((s) => s.t0);
    resolveClearances(course);
    course.bounds = courseBounds(course);
    return course;
  }

  /* ---------------- evaluation ---------------- */
  function findSeg(course, t) {
    const a = course.segStarts;
    let lo = 0, hi = a.length - 1;
    if (t <= a[0]) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (a[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function evalAt(course, t, out) {
    out = out || {};
    const i = findSeg(course, t);
    const seg = course.segs[i];
    out.seg = seg;
    out.onWire = false;
    if (seg.type === 'F') {
      const tau = t - seg.t0;
      out.x = seg.p0.x + seg.v0.x * tau;
      out.y = seg.p0.y + seg.v0.y * tau - 0.5 * G * tau * tau;
      out.vx = seg.v0.x;
      out.vy = seg.v0.y - G * tau;
      out.ang = seg.a0 + seg.w * tau;
      out.speed = Math.hypot(out.vx, out.vy);
    } else if (seg.type === 'W') {
      let f = (t - seg.t0) / seg.h;
      if (f < 0) f = 0;
      if (f > seg.n) f = seg.n;
      const k = Math.min(seg.n - 1, Math.floor(f));
      const u = f - k;
      out.x = seg.xs[k] + (seg.xs[k + 1] - seg.xs[k]) * u;
      out.y = seg.ys[k] + (seg.ys[k + 1] - seg.ys[k]) * u;
      out.ang = seg.an[k] + (seg.an[k + 1] - seg.an[k]) * u;
      const th = seg.th[k], v = seg.sp[k] + (seg.sp[k + 1] - seg.sp[k]) * u;
      out.vx = Math.cos(th) * v;
      out.vy = Math.sin(th) * v;
      out.speed = v;
      out.onWire = !seg.ledge;
    } else {
      out.x = seg.p0.x; out.y = seg.p0.y; out.vx = 0; out.vy = 0; out.speed = 0; out.ang = seg.a0;
    }
    return out;
  }

  /* ---------------- clearance: no bar may intersect the ball's path ---------------- */
  function resolveClearances(course) {
    const pts = [];
    const tmp = {};
    const step = 1 / 240;
    for (let t = course.tStart; t <= course.cup.t + 0.01; t += step) {
      evalAt(course, t, tmp);
      pts.push({ x: tmp.x, y: tmp.y, t });
    }
    const BK = 0.25;
    const buckets = new Map();
    for (const p of pts) {
      const k = Math.floor(p.y / BK);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    }
    const minHalf = 0.028;
    const clear = R * 0.985;
    for (const b of course.bars) {
      const sx = b.cx - b.nx * R, sy = b.cy - b.ny * R; // surface point
      b.sx = sx; b.sy = sy;
      const k0 = Math.floor((sy - 0.45) / BK), k1 = Math.floor((sy + 0.45) / BK);
      for (let k = k0; k <= k1; k++) {
        const list = buckets.get(k);
        if (!list) continue;
        for (const p of list) {
          const dx = p.x - sx, dy = p.y - sy;
          const u = dx * b.tX + dy * b.tY;
          const w = dx * b.nx + dy * b.ny;
          if (w >= clear || w <= -T - clear) continue;
          if (Math.abs(p.t - b.t) < 0.012) continue; // the strike itself
          if (u >= 0) {
            if (u < b.lenR + R) b.lenR = Math.max(minHalf, u - R * 1.05);
          } else if (-u < b.lenL + R) {
            b.lenL = Math.max(minHalf, -u - R * 1.05);
          }
        }
      }
    }
    // Bars must not overlap each other either (later bar yields).
    const bars = course.bars;
    for (let j = 0; j < bars.length; j++) {
      const bj = bars[j];
      for (let i = 0; i < bars.length; i++) {
        if (i === j) continue;
        const bi = bars[i];
        if (Math.abs(bi.sx - bj.sx) > 0.7 || Math.abs(bi.sy - bj.sy) > 0.7) continue;
        for (let s = 0; s <= 12; s++) {
          const u = -bj.lenL + ((bj.lenL + bj.lenR) * s) / 12;
          for (const wv of [0, -T]) {
            const px = bj.sx + bj.tX * u + bj.nx * wv;
            const py = bj.sy + bj.tY * u + bj.ny * wv;
            const dx = px - bi.sx, dy = py - bi.sy;
            const ui = dx * bi.tX + dy * bi.tY;
            const wi = dx * bi.nx + dy * bi.ny;
            if (ui > -bi.lenL - 0.012 && ui < bi.lenR + 0.012 && wi < 0.012 && wi > -T - 0.012) {
              if (j < i) continue; // let the later bar shrink
              if (u >= 0) bj.lenR = Math.max(minHalf, u - 0.015);
              else bj.lenL = Math.max(minHalf, -u - 0.015);
            }
          }
        }
      }
    }
  }

  function courseBounds(course) {
    let minY = Infinity, maxY = -Infinity;
    for (const b of course.bars) { minY = Math.min(minY, b.cy); maxY = Math.max(maxY, b.cy); }
    return { minY, maxY };
  }

  XB.Course = { build, evalAt };
})();

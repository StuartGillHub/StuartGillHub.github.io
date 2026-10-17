/* Sand Pendulum: how the ball moves up and down.
 *
 * The ball turns on musical hits. Turns sit on the song's beat grid (one
 * every `beatsPerSwing` beats), each snapped to the strongest kick or note
 * near that beat, so the change of direction lands on something you hear.
 * Between two turns the ball is *kicked* out of the first (fast departure)
 * and eases into the next (it is almost still just before the hit, then
 * the hit launches it), so every turn reads as an impact, not a smooth
 * crest. Stronger hits throw it further; quiet passages swing small.
 * Notes between turns add small flicks to the line.
 *
 * With a song playing, the position is a pure function of song time (exact
 * sync, seek-safe). With no song, or paused, an idle groove at 80 BPM runs
 * on its own clock. Switching between the two (or seeking) is blended over
 * a moment, so the ball never jumps. Knows nothing about sand or drawing.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const IDLE_BPM = 80;
  const SNAP = 0.075; // s: how far a turn may move to land on a hit
  const KICK = 2.6; // departure speed relative to the average (ease-out power)
  const BLEND = 0.35; // s: time to blend away a jump (seek, play/pause)

  // smoothed loudness 0..1 relative to the song's loud parts
  function loudness(show) {
    const env = show.env, hz = show.envHz, n = env.length;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + env[i];
    const avg = (t) => {
      const a = Math.max(0, Math.min(n - 1, Math.round((t - 0.75) * hz)));
      const b = Math.max(a + 1, Math.min(n, Math.round((t + 0.75) * hz)));
      return (pre[b] - pre[a]) / (b - a);
    };
    const lv = [];
    for (let t = 0; t < n / hz; t += 0.5) lv.push(avg(t));
    lv.sort((x, y) => x - y);
    const full = lv[Math.floor(lv.length * 0.9)] || 1;
    return (t) => Math.max(0, Math.min(1, avg(t) / full));
  }

  // Turn schedule for a song: [{ t, side (+1/-1), amp 0..1, hit 0..1 }],
  // plus the notes left over for flicks.
  function songTurns(show, notes, m) {
    const level = loudness(show);
    const hits = [];
    for (const k of show.kicks || []) hits.push({ t: k.t, s: Math.min(1, k.s) });
    for (const n of notes || []) hits.push({ t: n.t, s: n.strength == null ? 0.5 : n.strength });
    hits.sort((a, b) => a.t - b.t);
    const dur = show.env.length / show.envHz;
    const step = show.period * m;
    const turns = [];
    let side = 1, j = 0;
    const used = new Set();
    for (let g = show.phase; g < dur + step; g += step) {
      // strongest hit within SNAP of this beat
      while (j < hits.length && hits[j].t < g - SNAP) j++;
      let best = -1;
      for (let i = j; i < hits.length && hits[i].t <= g + SNAP; i++) if (best < 0 || hits[i].s > hits[best].s) best = i;
      const t = best >= 0 ? hits[best].t : g;
      const hit = best >= 0 ? hits[best].s : 0.25;
      if (best >= 0) used.add(best);
      const L = level(t);
      const amp = 0.25 + 0.75 * Math.min(1, 0.55 * L + 0.45 * hit * (0.4 + 0.6 * L));
      if (turns.length && t <= turns[turns.length - 1].t + 0.05) continue;
      turns.push({ t, side, amp, hit: hit * (0.3 + 0.7 * L) });
      side = -side;
    }
    const flicks = hits.filter((h, i) => !used.has(i) && h.s > 0.4);
    return { turns, flicks, step };
  }

  // Kicked out of a turn, easing into the next one.
  const ease = (u) => 1 - Math.pow(1 - u, KICK);
  // a quick bump for flicks: rises in ~40 ms, gone in ~0.3 s
  const bump = (tau) => (tau <= 0 ? 0 : (tau / 0.05) * Math.exp(1 - tau / 0.05));

  function find(turns, t) {
    let lo = 0, hi = turns.length - 1;
    if (!turns.length || t < turns[0].t) return -1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (turns[mid].t <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }

  class Swing {
    constructor() {
      this.beatsPerSwing = 2;
      this.flickSize = 0.08;
      this.song = null; this.songKey = null;
      this.idleT = 0;
      this.offset = 0; // blended-away difference after a jump
      this.last = null; // { y, src, t }
      this.events = []; // turns passed during the last step: { side, hit }
    }

    setMusic(show, notes) {
      const key = show ? `${this.beatsPerSwing}|${show.period}` : null;
      if (show && (show !== this.songShow || notes !== this.songNotes || key !== this.songKey)) {
        this.song = songTurns(show, notes, this.beatsPerSwing);
        this.songShow = show; this.songNotes = notes; this.songKey = key;
      }
      if (!show) this.song = null;
    }

    // idle turns: a steady groove with a gentle accent every other swing
    idleTurn(i) {
      const step = (60 / IDLE_BPM) * this.beatsPerSwing;
      return { t: i * step, side: i % 2 ? -1 : 1, amp: i % 4 === 0 ? 0.65 : 0.5, hit: i % 4 === 0 ? 0.6 : 0.4 };
    }

    // y in -1..1 at song time t (song) or idle clock (idle), plus the hit
    // envelope of the latest turn (for effects).
    sample(src, t) {
      let a, b;
      if (src === 'song') {
        const T = this.song.turns, i = find(T, t);
        // before the first turn: ease in from the middle
        a = i >= 0 ? T[i] : { t: T[0].t - this.song.step, side: 0, amp: 0, hit: 0 };
        b = T[i + 1] || { t: a.t + this.song.step, side: -a.side, amp: a.amp };
      } else {
        const step = (60 / IDLE_BPM) * this.beatsPerSwing;
        const i = Math.floor(t / step);
        a = this.idleTurn(i); b = this.idleTurn(i + 1);
      }
      const u = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-3, b.t - a.t)));
      const ya = a.side * a.amp, yb = b.side * b.amp;
      let y = ya + (yb - ya) * ease(u);
      if (src === 'song' && this.flickSize > 0) {
        // notes between turns flick the ball briefly along its way
        const F = this.song.flicks, dir = Math.sign(yb - ya);
        let lo = 0, hi = F.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (F[mid].t < t - 0.4) lo = mid + 1; else hi = mid; }
        // only flicks that start in the first half of a swing, where the
        // ball is moving fast: later, a flick could make it go backwards,
        // and a change of direction must only ever happen on a hit
        const span = b.t - a.t;
        for (let k = lo; k < F.length && F[k].t <= t; k++) {
          const uf = (F[k].t - a.t) / span;
          if (uf < 0.05 || uf > 0.5) continue;
          y += dir * this.flickSize * F[k].s * bump(t - F[k].t);
        }
      }
      return { y, env: a.hit * Math.exp(-(t - a.t) / 0.2), a };
    }

    // Advance by dt (wall seconds). music = { playing, t } with setMusic()
    // called beforehand. Returns { y, env }; this.events lists turns passed.
    step(dt, music) {
      const src = music.playing && this.song ? 'song' : 'idle';
      let t;
      if (src === 'song') t = music.t;
      else { this.idleT += dt; t = this.idleT; }
      const s = this.sample(src, t);
      this.events.length = 0;
      const last = this.last;
      if (last && last.src === src) {
        // turns passed since the last step
        if (src === 'song') {
          const T = this.song.turns;
          if (t > last.t && t - last.t < 0.5) {
            for (let i = Math.max(0, find(T, last.t) + 1); i < T.length && T[i].t <= t; i++) this.events.push(T[i]);
          }
        } else {
          const step = (60 / IDLE_BPM) * this.beatsPerSwing;
          for (let i = Math.floor(last.t / step) + 1; i * step <= t; i++) this.events.push(this.idleTurn(i));
        }
      }
      // blend away any jump: source switch, seek, or a big time step
      const jumped = !last || last.src !== src || (src === 'song' && Math.abs(t - last.t) > 0.5);
      if (jumped && last) this.offset = last.y - s.y;
      this.offset *= Math.exp(-dt / BLEND);
      const y = s.y + this.offset;
      this.last = { y, src, t };
      return { y, env: s.env };
    }
  }

  XB.SandSwing = Swing;
  XB.SandSwing.songTurns = songTurns;
})();

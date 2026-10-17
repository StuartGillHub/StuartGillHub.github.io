/* Pendulum Wave mode: glue between the mechanics (XB.PendulumWave), the
 * bells (XB.PendulumBells) and the drawing (XB.PendulumRenderer).
 *
 * The pendulums run on their own clock t (advanced by dt x time speed), so
 * the bells are generative. Bells are scheduled a little ahead at the exact
 * zero-crossing times, so they ring in time whatever the frame rate. With a
 * song loaded, "Accompany" plays it quietly underneath.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const LOOKAHEAD = 0.12; // seconds of bells scheduled ahead
  const SONG_UNDER = 0.35; // song level while accompanying
  const FLASH = 0.18; // flash fade time (s)

  function fmtTime(s) {
    if (!isFinite(s)) return '–';
    s = Math.max(0, Math.ceil(s));
    const m = Math.floor(s / 60);
    return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
  }

  function PendulumMode(host) {
    const canvas = host.canvas;
    const ctx = canvas.getContext('2d');
    const wave = new XB.PendulumWave();
    const bells = new XB.PendulumBells.Bells(host.audio);
    const look = new XB.PendulumRenderer();
    const settings = { speed: 1, scale: 'pentatonic', accompany: false };
    let t = 0; // pendulum time
    let schedT = 0; // pendulum time up to which bells are scheduled
    let running = true;
    let notes = [];
    let readout = null, accompanyBox = null, lastReadout = 0;
    const crossBuf = [];

    function retune() {
      // bells sit in the song's key when there is one (C otherwise)
      const key = host.key();
      const tonic = key ? key.tonic : 0;
      const root = 48 + (((tonic + 6) % 12) - 6);
      notes = XB.PendulumBells.bellNotes(settings.scale, wave.count, root);
    }
    function resetUnison() { t = 0; schedT = 0; }

    let keyFor;
    function update(dt) {
      dt = Math.min(0.25, Math.max(0, dt));
      if (host.key() !== keyFor) { keyFor = host.key(); retune(); } // a song was loaded
      if (!running) { schedT = t; return; }
      t += dt * settings.speed;
      const ac = host.audio.ctx;
      // only while audio is running (a suspended context would bank them up)
      if (!ac || ac.state !== 'running') { schedT = t; return; }
      // ring every crossing between what's scheduled and a little ahead
      const until = t + LOOKAHEAD * settings.speed;
      if (schedT < t - 0.5 * settings.speed) schedT = t; // after a stall, don't play a backlog
      const cents = host.tuning();
      for (const c of wave.crossings(schedT, until, crossBuf)) {
        const when = ac.currentTime + (c.t - t) / settings.speed;
        bells.ring(notes[c.n], when, c.dir > 0 ? 1 : 0.9, cents);
      }
      schedT = until;
    }

    function render() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      look.draw(ctx, { W, H, dpr, top: 64 * dpr, bottom: (host.transportShown() ? 96 : 24) * dpr }, wave, {
        t,
        flash: (n) => Math.exp(-wave.sinceCrossing(n, t) / settings.speed / FLASH),
      });
      const now = performance.now();
      if (now - lastReadout > 200) {
        lastReadout = now;
        if (readout) readout.textContent = running ? fmtTime(wave.untilUnison(t) / settings.speed) : 'paused';
        if (accompanyBox) accompanyBox.checked = settings.accompany && host.playing();
      }
    }

    function setAccompany(on) {
      if (on && !host.hasTrack()) {
        host.toast('Load a song first, then switch on Accompany.');
        if (accompanyBox) accompanyBox.checked = false;
        return;
      }
      settings.accompany = on;
      if (on) host.playSong(); else host.pauseSong();
    }

    function onKey(e) {
      if (e.code === 'Space') {
        running = !running;
        if (settings.accompany && host.hasTrack()) { if (running) host.playSong(); else host.pauseSong(); }
        return true;
      }
      if (e.code === 'KeyR') { resetUnison(); return true; }
      return false;
    }

    return {
      id: 'pendulum',
      name: 'Pendulum Wave',
      init() {
        canvas.classList.remove('hidden');
        host.audio.ensure(); // resumed by the app's gesture unlock if needed
        host.setSongScale(SONG_UNDER);
        settings.accompany = false;
        running = true;
        retune();
        schedT = t;
      },
      update,
      render,
      onKey,
      dispose() {
        canvas.classList.add('hidden');
        bells.silence();
        host.setSongScale(1);
      },
      getControls() {
        const retime = () => { schedT = t; };
        return [
          { type: 'heading', label: 'Pendulum Wave' },
          { type: 'readout', label: 'Next unison in', bind: (el) => { readout = el; } },
          { type: 'range', label: 'Time speed', min: 0.25, max: 4, step: 0.05, value: settings.speed, format: (v) => v.toFixed(2) + '×', onInput: (v) => { settings.speed = v; retime(); } },
          { type: 'range', label: 'K (swings of the longest per cycle)', min: 10, max: 80, step: 1, value: wave.K, format: (v) => String(v), onInput: (v) => { wave.K = v; retime(); } },
          { type: 'range', label: 'T (cycle length)', min: 10, max: 180, step: 1, value: wave.T, format: (v) => v + ' s', onInput: (v) => { wave.T = v; retime(); } },
          { type: 'range', label: 'A (amplitude)', min: 5, max: 45, step: 1, value: wave.A, format: (v) => v + '°', onInput: (v) => { wave.A = v; } },
          { type: 'select', label: 'Bell scale', value: settings.scale, options: Object.entries(XB.PendulumBells.SCALES).map(([k, s]) => [k, s.label]), onChange: (v) => { settings.scale = v; retune(); } },
          { type: 'buttons', items: [{ label: 'Reset to unison', title: 'R', onClick: resetUnison }] },
          { type: 'check', label: 'Accompany', hint: 'Plays the loaded song quietly underneath; the bells keep their own time.', value: settings.accompany, onChange: setAccompany, bind: (el) => { accompanyBox = el; } },
        ];
      },
      // for tests
      _debug: { wave, bells, settings, get t() { return t; }, set t(v) { t = v; schedT = v; }, notes: () => notes },
    };
  }

  XB.PendulumMode = PendulumMode;
})();

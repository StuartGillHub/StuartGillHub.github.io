/* App controller: file loading, analysis, course building, playback loop. */
(function () {
  'use strict';
  const XB = window.XB;
  const $ = (id) => document.getElementById(id);

  const canvas = $('stage');
  const renderer = new (XB.Renderer || XB.Renderer2D)(canvas);
  const audio = new XB.AudioEngine();

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const settings = { density: 0.7, wireGap: 1.0, songVol: 0.9, fxVol: 0.35, sync: 0, look: 'auto', strobes: !reducedMotion, bumpers: 'auto', rests: true };
  const state = {
    analysis: null, buffer: null, course: null, cam: null, name: '',
    playing: false, time: 0, fxCursor: 0, evCursor: 0, seed: 1,
  };
  XB.app = { state, settings, renderer, audio };

  /* ---------- UI helpers ---------- */
  const show = (el, on) => el.classList.toggle('hidden', !on);
  let toastTimer = 0;
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg; show(el, true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => show(el, false), ms || 3500);
  }
  function fmt(t) {
    t = Math.max(0, t);
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function setProgress(p, label) {
    $('progressBar').style.width = Math.round(p * 100) + '%';
    if (label) $('progressLabel').textContent = label;
  }

  /* ---------- loading ---------- */
  async function loadFile(file) {
    if (!file) return;
    pause();
    show($('welcome'), false); show($('progress'), true); show($('bigPlay'), false);
    setProgress(0.01, 'Reading ' + file.name);
    try {
      const ab = await file.arrayBuffer();
      setProgress(0.02, 'Decoding audio');
      const buf = await audio.decode(ab);
      await useBuffer(buf, file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      console.error(err);
      show($('progress'), false);
      show($('welcome'), !state.course);
      toast("Sorry, that file couldn't be decoded. Try an MP3, WAV or M4A.", 5000);
    }
  }

  async function loadDemo() {
    pause();
    show($('welcome'), false); show($('progress'), true); show($('bigPlay'), false);
    setProgress(0.02, 'Composing the demo tune');
    audio.ensure();
    const { buffer, truth } = await XB.Demo.render();
    XB.app.demoTruth = truth;
    await useBuffer(buffer, 'Demo tune');
  }

  /* ---------- Audius ---------- */
  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let audiusReq = 0;
  function openAudius() {
    show($('audiusSheet'), true);
    show($('welcome'), false);
    if (!$('audiusList').children.length) listAudius('');
    setTimeout(() => $('audiusQuery').focus({ preventScroll: true }), 50);
  }
  function closeAudius() {
    show($('audiusSheet'), false);
    if (!state.course && $('progress').classList.contains('hidden')) show($('welcome'), true);
  }
  function audiusMessage(text) {
    $('audiusList').innerHTML = '';
    const li = document.createElement('li');
    li.className = 'msg';
    li.textContent = text;
    $('audiusList').appendChild(li);
  }
  async function listAudius(query) {
    const req = ++audiusReq;
    $('audiusLabel').textContent = query ? `Results for “${query}”` : 'Trending this week';
    audiusMessage('Loading…');
    try {
      const tracks = query ? await XB.Audius.search(query) : await XB.Audius.trending();
      if (req !== audiusReq) return;
      if (!tracks.length) { audiusMessage('No playable tracks found. Try another search.'); return; }
      const list = $('audiusList');
      list.innerHTML = '';
      for (const t of tracks) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.className = 'song-row';
        b.type = 'button';
        const img = document.createElement(t.artwork ? 'img' : 'div');
        if (t.artwork) { img.src = t.artwork; img.alt = ''; img.loading = 'lazy'; } else img.className = 'noart';
        const mid = document.createElement('div');
        const ti = document.createElement('div'); ti.className = 't'; ti.textContent = t.title;
        const ar = document.createElement('div'); ar.className = 'a'; ar.textContent = t.artist + (t.genre ? ` · ${t.genre}` : '');
        mid.append(ti, ar);
        const d = document.createElement('div'); d.className = 'd'; d.textContent = fmtDur(t.duration);
        b.append(img, mid, d);
        b.addEventListener('click', () => loadAudius(t));
        li.appendChild(b);
        list.appendChild(li);
      }
    } catch (err) {
      console.error(err);
      if (req !== audiusReq) return;
      audiusMessage("Couldn't reach Audius. Check your connection. If you opened Xylofall from a claude.ai link, Audius won't work there: that page isn't allowed to fetch music from other sites. Use the hosted copy instead.");
    }
  }
  async function loadAudius(track) {
    closeAudius();
    pause();
    show($('welcome'), false); show($('progress'), true); show($('bigPlay'), false);
    setProgress(0.01, `Downloading “${track.title}”`);
    try {
      const ab = await XB.Audius.download(track, (p, bytes) =>
        setProgress(0.01 + 0.04 * p, `Downloading “${track.title}” · ${(bytes / 1e6).toFixed(1)} MB`));
      setProgress(0.05, 'Decoding audio');
      const buf = await audio.decode(ab);
      await useBuffer(buf, `${track.title} · ${track.artist}`, track.link);
    } catch (err) {
      console.error(err);
      show($('progress'), false);
      show($('welcome'), !state.course);
      toast("That track couldn't be loaded from Audius. Try another one.", 5000);
    }
  }

  async function useBuffer(buf, name, link) {
    state.buffer = buf;
    state.name = name;
    audio.setBuffer(buf);
    state.analysis = await XB.Analysis.analyse(buf, setProgress);
    let h = 7;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    state.seed = (h ^ Math.round(buf.duration * 1000)) >>> 0;
    rebuild();
    applyLook();
    show($('progress'), false);
    show($('transport'), true);
    drawTimeline();
    $('songName').textContent = name;
    // credit the source when a song comes from Audius
    $('songLink').href = link || '#';
    show($('songLink'), !!link);
    state.time = state.course.tStart;
    play();
    // If the browser blocked audio (no recent gesture), offer a big play button.
    setTimeout(() => {
      if (audio.ctx && audio.ctx.state !== 'running') { pause(); show($('bigPlay'), true); }
    }, 400);
  }

  /* ---------- look (skin) ---------- */
  let strobeWarned = false;
  function applyLook() {
    if (!renderer.setSkin) return;
    const show = state.analysis ? XB.Analysis.lightShow(state.analysis) : null;
    state.show = show;
    const skin = settings.look === 'auto' ? (show ? show.suggested : 'studio') : settings.look;
    renderer.setSkin(skin);
    state.skin = skin;
    if (skin === 'neon' && settings.strobes && !strobeWarned) {
      strobeWarned = true;
      toast('Neon look uses flashing lights. You can turn strobe flashes off in Settings.', 6000);
    }
    updateStats();
  }
  function updateStats() {
    if (!state.course) return;
    const wires = state.course.wires.length;
    const look = state.skin === 'neon' ? 'Neon' : 'Studio';
    const bpm = state.show ? ` · ${Math.round(state.show.bpm)} BPM` : '';
    $('stats').textContent = `${state.analysis.key.name}${bpm} · ${look} look · ${state.course.bars.length} bars · ${wires} wire track${wires === 1 ? '' : 's'}`;
  }

  // How hard the music is driving at time t, for Auto bumpers: the loudness
  // around that moment (relative to the song's loud parts), boosted for
  // driving dance tracks and held back for gentle ones.
  function bumperDrive(show) {
    const env = show.env, hz = show.envHz, n = env.length;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + env[i];
    const avg = (t) => {
      const a = Math.max(0, Math.min(n - 1, Math.round((t - 1) * hz)));
      const b = Math.max(a + 1, Math.min(n, Math.round((t + 1) * hz)));
      return (pre[b] - pre[a]) / (b - a);
    };
    // the song's own "full on" level: 90th percentile of the 2 s average
    const lv = [];
    for (let t = 0; t < n / hz; t += 0.5) lv.push(avg(t));
    lv.sort((x, y) => x - y);
    const full = lv[Math.floor(lv.length * 0.9)] || 1;
    const drive = show.suggested === 'neon' ? 1.05 : 0.72;
    return (t) => Math.min(1.2, avg(t) / full) * drive;
  }

  function rebuild() {
    if (!state.analysis) return;
    const keepTime = state.course ? currentTime() : null;
    const notes = XB.Analysis.pickOnsets(state.analysis, settings.density);
    state.notes = notes;
    state.course = XB.Course.build(notes, {
      wireGap: settings.wireGap, seed: state.seed,
      restEvery: settings.rests ? 15 : 0,
      bumpers: settings.bumpers, energyAt: bumperDrive(XB.Analysis.lightShow(state.analysis)),
    });
    state.cam = XB.Camera.build(state.course, renderer.visW, renderer.visH);
    updateStats();
    drawTimeline();
    if (keepTime !== null) seek(keepTime);
  }

  /* ---------- transport ---------- */
  function currentTime() {
    if (state.playing) return audio.songTime() + settings.sync / 1000;
    return state.time;
  }
  function endTime() {
    return Math.max(state.buffer ? state.buffer.duration : 0, state.course ? state.course.tEnd : 0);
  }
  function resetCursors(t) {
    const bars = state.course.bars;
    let i = 0;
    while (i < bars.length && bars[i].t < t) i++;
    state.fxCursor = i;
    const ev = state.course.events;
    let j = 0;
    while (j < ev.length && ev[j].t < t) j++;
    state.evCursor = j;
  }
  function play() {
    if (!state.course) return;
    if (state.time >= endTime() - 0.05) state.time = state.course.tStart;
    audio.play(state.time - settings.sync / 1000 + audio.latency());
    state.playing = true;
    resetCursors(state.time);
    document.body.classList.add('playing');
    show($('bigPlay'), false);
  }
  function pause() {
    if (!state.playing) return;
    state.time = currentTime();
    state.playing = false;
    audio.stop();
    document.body.classList.remove('playing');
  }
  function toggle() { state.playing ? pause() : play(); }
  function seek(t) {
    const was = state.playing;
    if (was) { state.playing = false; audio.stop(); }
    state.time = Math.max(state.course.tStart, Math.min(endTime(), t));
    if (was) play();
  }

  /* ---------- timeline ---------- */
  function drawTimeline() {
    const c = $('timelineCanvas');
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, r.width * dpr); c.height = Math.max(1, r.height * dpr);
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (!state.course) return;
    const dur = endTime();
    const t0 = state.course.tStart;
    const X = (t) => ((t - t0) / (dur - t0)) * c.width;
    g.fillStyle = 'rgba(201,160,99,0.45)';
    for (const w of state.course.wires) g.fillRect(X(w.t0), c.height * 0.35, X(w.t1) - X(w.t0), c.height * 0.3);
    for (const b of state.course.bars) {
      g.fillStyle = XB.barColor(b.midi, 62, 0.95);
      const h = c.height * (0.35 + 0.6 * b.strength);
      g.fillRect(X(b.t) - dpr * 0.5, (c.height - h) / 2, Math.max(1, dpr), h);
    }
  }

  /* ---------- main loop ---------- */
  function frame() {
    requestAnimationFrame(frame);
    const course = state.course;
    let t = currentTime();
    if (course && state.playing && t > endTime() + 0.3) {
      pause(); state.time = endTime(); t = state.time;
    }
    renderer.draw(course, state.cam, t, state.show, settings);
    if (!course) return;

    if (state.playing && audio.ctx) {
      // schedule strike accents slightly ahead of time (sample-accurate)
      const horizon = audio.songTime() + audio.latency() + 0.25;
      const bars = course.bars;
      while (state.fxCursor < bars.length && bars[state.fxCursor].t < horizon) {
        const b = bars[state.fxCursor++];
        if (settings.fxVol > 0) audio.xylo(b.t, b.midi, 0.35 + 0.65 * b.strength, state.analysis.tuning);
        if (settings.fxVol > 0 && b.kick > 0.15) audio.bumper(b.t, b.midi, b.kick, state.analysis.tuning);
      }
      const ev = course.events;
      while (state.evCursor < ev.length && ev[state.evCursor].t < horizon) {
        const e = ev[state.evCursor++];
        if (settings.fxVol <= 0) continue;
        if (e.type === 'catch') audio.metal(e.t, Math.min(1, 0.3 + (e.speed || 1) * 0.15));
        else if (e.type === 'launch') audio.metal(e.t, 0.25);
        else if (e.type === 'cup') audio.metal(e.t, e.soft ? Math.min(0.6, e.vel || 0.3) : 0.9);
      }
      const b = renderer.lastBall;
      audio.setRolling(b && b.onWire ? b.speed : 0);
    }

    const dur = endTime();
    const t0 = course.tStart;
    const p = Math.max(0, Math.min(1, (t - t0) / (dur - t0)));
    $('playhead').style.left = `calc(${(p * 100).toFixed(3)}% - 1px)`;
    $('timeLabel').textContent = window.innerWidth > 560 ? `${fmt(t)} / ${fmt(dur)}` : fmt(t);
  }
  requestAnimationFrame(frame);

  /* ---------- wiring ---------- */
  // Unlock audio inside every tap, before any async work happens.
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
    window.addEventListener(ev, () => audio.unlock(), { capture: true, passive: true });
  }
  $('file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('file2').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('demoBtn').addEventListener('click', loadDemo);
  $('audiusBtn').addEventListener('click', openAudius);
  $('audiusBtn2').addEventListener('click', openAudius);
  $('audiusClose').addEventListener('click', closeAudius);
  $('audiusSheet').addEventListener('click', (e) => { if (e.target === $('audiusSheet')) closeAudius(); });
  $('audiusForm').addEventListener('submit', (e) => { e.preventDefault(); listAudius($('audiusQuery').value.trim()); });
  $('demoBtn2').addEventListener('click', loadDemo);
  $('playBtn').addEventListener('click', toggle);
  $('bigPlay').addEventListener('click', play);
  $('restartBtn').addEventListener('click', () => { seek(state.course.tStart); if (!state.playing) play(); });
  $('settingsBtn').addEventListener('click', () => $('settings').classList.toggle('hidden'));
  canvas.addEventListener('click', () => { if (state.course) toggle(); $('settings').classList.add('hidden'); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') closeAudius();
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' && state.course) { e.preventDefault(); toggle(); }
    if (e.code === 'ArrowRight' && state.course) seek(currentTime() + 5);
    if (e.code === 'ArrowLeft' && state.course) seek(currentTime() - 5);
  });

  const tl = $('timeline');
  function tlSeek(e) {
    if (!state.course) return;
    const r = tl.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const t0 = state.course.tStart;
    seek(t0 + (x / r.width) * (endTime() - t0));
  }
  tl.addEventListener('pointerdown', (e) => {
    tlSeek(e);
    const move = (ev) => tlSeek(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  function bindRange(id, key, fmtFn, onChange, live) {
    const el = $(id), out = $(id + 'Out') || $(id.replace(/Gap$/, '') + 'Out');
    const upd = () => { settings[key] = parseFloat(el.value); if (out) out.textContent = fmtFn(settings[key]); };
    upd();
    el.addEventListener('input', () => { upd(); if (live) onChange(); });
    el.addEventListener('change', () => { upd(); if (!live) onChange(); });
  }
  bindRange('density', 'density', (v) => Math.round(v * 100) + '%', rebuild, false);
  $('wireOut') && bindRange('wireGap', 'wireGap', (v) => v.toFixed(2) + ' s', rebuild, false);
  bindRange('songVol', 'songVol', (v) => Math.round(v * 100) + '%', () => audio.setSongVolume(settings.songVol), true);
  bindRange('fxVol', 'fxVol', (v) => (v ? Math.round(v * 100) + '%' : 'off'), () => audio.setFxVolume(settings.fxVol), true);
  bindRange('sync', 'sync', (v) => (v > 0 ? '+' : '') + v + ' ms', () => { if (state.playing) { pause(); play(); } }, false);
  // apply initial volumes once the context exists
  const origEnsure = audio.ensure.bind(audio);
  audio.ensure = () => {
    const had = !!audio.ctx;
    const c = origEnsure();
    if (!had) { audio.songGain.gain.value = settings.songVol; audio.fxGain.gain.value = settings.fxVol; }
    return c;
  };

  // drag & drop anywhere
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; show($('dropzone'), true); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; show($('dropzone'), false); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; show($('dropzone'), false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    renderer.resize();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.course) state.cam = XB.Camera.build(state.course, renderer.visW, renderer.visH);
      drawTimeline();
    }, 120);
    if (state.course) state.cam = XB.Camera.build(state.course, renderer.visW, renderer.visH);
  });

  // Look + strobe controls
  document.querySelectorAll('input[name="look"]').forEach((el) => {
    el.addEventListener('change', () => { if (el.checked) { settings.look = el.value; applyLook(); } });
  });
  document.querySelectorAll('input[name="bumpers"]').forEach((el) => {
    el.addEventListener('change', () => { if (el.checked) { settings.bumpers = el.value; rebuild(); } });
  });
  $('rests').checked = settings.rests;
  $('rests').addEventListener('change', () => { settings.rests = $('rests').checked; rebuild(); });
  $('strobes').checked = settings.strobes;
  $('strobes').addEventListener('change', () => { settings.strobes = $('strobes').checked; });

  // Debug / testing hooks
  XB.app.loadDemo = loadDemo;
  XB.app.seek = seek;
  XB.app.pause = pause;
  XB.app.play = play;
  XB.app.rebuild = rebuild;
  XB.app.renderAt = (t) => { pause(); state.time = t; renderer.draw(state.course, state.cam, t, state.show, settings); };
  XB.app.setLook = (v) => { settings.look = v; document.querySelector(`input[name="look"][value="${v}"]`).checked = true; applyLook(); };
})();

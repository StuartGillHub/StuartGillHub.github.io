/* Audio analysis: onset ("key note") detection + pitch estimation.
 *
 * The song is mixed to mono and resampled to 22.05 kHz, then a log-compressed
 * spectral-flux onset function is computed from a short-time Fourier transform.
 * Peaks of that function (above an adaptive threshold) are the moments the ball
 * must strike a bar. For each picked onset a harmonic-sum pitch estimate gives
 * the bar its note (colour, length and optional xylophone accent).
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});

  const SR = 22050;
  const FRAME = 2048;
  const HOP = 256;
  // Empirically calibrated (see demo tune) offset from frame start to the
  // actual onset position for the flux peak.
  const ONSET_OFFSET = FRAME * 0.5 - HOP * 0.5 + 0.025 * SR;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const fftCache = new Map();
  function getFFT(n) {
    if (fftCache.has(n)) return fftCache.get(n);
    const levels = Math.round(Math.log2(n));
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const fft = function (re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = i + j, b = a + half;
            const tr = re[b] * cos[k] + im[b] * sin[k];
            const ti = im[b] * cos[k] - re[b] * sin[k];
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
    };
    fftCache.set(n, fft);
    return fft;
  }

  function hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    return w;
  }

  async function toMono(audioBuffer) {
    const len = Math.max(1, Math.ceil(audioBuffer.duration * SR));
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new Offline(1, len, SR);
    const src = off.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(off.destination);
    src.start(0);
    const rendered = await off.startRendering();
    return rendered.getChannelData(0);
  }

  const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

  async function analyse(audioBuffer, onProgress) {
    onProgress && onProgress(0.02, 'Resampling');
    const samples = await toMono(audioBuffer);
    const nFrames = Math.max(1, Math.floor((samples.length - FRAME) / HOP) + 1);
    const fft = getFFT(FRAME);
    const win = hann(FRAME);
    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    const half = FRAME / 2;
    let prev = new Float32Array(half);
    let cur = new Float32Array(half);
    const flux = new Float32Array(nFrames);
    const rms = new Float32Array(nFrames);
    const norm = 4 / FRAME; // sinusoid amplitude A -> magnitude ~A
    const maxBin = Math.floor((11000 / SR) * FRAME);
    // band energies for the light show: kick/bass and hi-hats/air
    const lowE = new Float32Array(nFrames);
    const highE = new Float32Array(nFrames);
    const lowTop = Math.round((150 / SR) * FRAME);
    const highBot = Math.round((4000 / SR) * FRAME);

    for (let f = 0; f < nFrames; f++) {
      const off = f * HOP;
      let e = 0;
      for (let i = 0; i < FRAME; i++) {
        const s = samples[off + i] || 0;
        e += s * s;
        re[i] = s * win[i];
        im[i] = 0;
      }
      rms[f] = Math.sqrt(e / FRAME);
      fft(re, im);
      let sum = 0, lo = 0, hi = 0;
      for (let k = 1; k < maxBin; k++) {
        const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * norm;
        if (k <= lowTop) lo += m * m; else if (k >= highBot) hi += m * m;
        const l = Math.log1p(1000 * m);
        cur[k] = l;
        const d = l - prev[k];
        if (d > 0) sum += d;
      }
      flux[f] = f === 0 ? 0 : sum;
      lowE[f] = lo; highE[f] = hi;
      const t = prev; prev = cur; cur = t;
      if (f % 600 === 0) {
        onProgress && onProgress(0.05 + 0.85 * (f / nFrames), 'Listening for notes');
        await yieldFrame();
      }
    }

    // Light smoothing, then normalise so thresholds are song-independent.
    const odf = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) {
      const a = flux[f - 1] || 0, b = flux[f], c = flux[f + 1] || 0;
      odf[f] = 0.25 * a + 0.5 * b + 0.25 * c;
    }
    const sorted = Array.from(odf).sort((a, b) => a - b);
    const ref = sorted[Math.floor(sorted.length * 0.995)] || 1;
    for (let f = 0; f < nFrames; f++) odf[f] /= ref || 1;

    // Local mean for adaptive thresholding (+-120 ms).
    const W = Math.round((0.12 * SR) / HOP);
    const mean = new Float32Array(nFrames);
    let acc = 0, cnt = 0;
    for (let f = 0; f < Math.min(W, nFrames); f++) { acc += odf[f]; cnt++; }
    for (let f = 0; f < nFrames; f++) {
      const add = f + W, rem = f - W - 1;
      if (add < nFrames) { acc += odf[add]; cnt++; }
      if (rem >= 0) { acc -= odf[rem]; cnt--; }
      mean[f] = acc / cnt;
    }
    const rsorted = Array.from(rms).sort((a, b) => a - b);
    const loud = rsorted[Math.floor(rsorted.length * 0.95)] || 1;

    onProgress && onProgress(0.93, 'Finding the key');
    const an = {
      samples, odf, mean, rms, loud, nFrames, lowE, highE,
      duration: audioBuffer.duration,
      chromaCache: new Map(),
    };
    await analyseHarmony(an);
    onProgress && onProgress(0.97, 'Placing bars');
    return an;
  }

  function frameTime(f) {
    return (f * HOP + ONSET_OFFSET) / SR;
  }

  /* sensitivity 0..1 : 0 = only the strongest hits, 1 = nearly every note */
  function pickOnsets(an, sensitivity) {
    const s = Math.min(1, Math.max(0, sensitivity));
    const delta = 0.03 + 0.42 * Math.pow(1 - s, 1.6);
    const minGap = 0.36 - 0.26 * s;
    const { odf, mean, nFrames, rms, loud } = an;
    const nb = Math.max(2, Math.round((0.05 * SR) / HOP));
    const cands = [];
    for (let f = 2; f < nFrames - 2; f++) {
      const v = odf[f];
      const strength = v - mean[f];
      if (strength < delta) continue;
      let isMax = true;
      for (let k = -nb; k <= nb; k++) {
        if (k && odf[f + k] > v) { isMax = false; break; }
      }
      if (!isMax) continue;
      // ignore onsets in near-silence (noise / reverb tails)
      const lvl = Math.max(rms[f] || 0, rms[f + 2] || 0, rms[f + 4] || 0);
      if (lvl < loud * 0.03) continue;
      const a = odf[f - 1], c = odf[f + 1];
      const den = a - 2 * v + c;
      const d = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      cands.push({ f, t: frameTime(f + d), strength });
    }
    // Keep the strongest onsets that respect the minimum spacing.
    const byStrength = cands.slice().sort((a, b) => b.strength - a.strength);
    const kept = [];
    const times = [];
    for (const c of byStrength) {
      let ok = true;
      for (let i = 0; i < times.length; i++) {
        if (Math.abs(times[i] - c.t) < minGap) { ok = false; break; }
      }
      if (ok) { kept.push(c); times.push(c.t); }
    }
    kept.sort((a, b) => a.t - b.t);
    const maxS = kept.reduce((m, c) => Math.max(m, c.strength), 1e-6);
    const out = kept.filter((c) => c.t >= 0.02);
    // Choose each strike's note from what is actually sounding at that
    // instant, weighted towards the song's key and the surrounding harmony,
    // then place it in the xylophone's register close to the previous one.
    const scale = an.key.scale;
    const ctx = new Float32Array(12);
    let prev = 79;
    return out.map((c) => {
      const ch = chromaAt(an, c.f, c.t);
      let bestPc = an.key.tonic, bestS = -1;
      for (let pc = 0; pc < 12; pc++) {
        const sc = (ch[pc] + 0.35 * ctx[pc]) * (scale[pc] ? 1 : 0.3);
        if (sc > bestS) { bestS = sc; bestPc = pc; }
      }
      for (let pc = 0; pc < 12; pc++) ctx[pc] = 0.6 * ctx[pc] + ch[pc];
      let midi = 72 + bestPc, bestD = Infinity;
      for (let m = 72 + bestPc - 12; m <= 91; m += 12) {
        if (m < 72) continue;
        const d = Math.abs(m - prev) + (m > 88 ? 2 : 0);
        if (d < bestD) { bestD = d; midi = m; }
      }
      prev = midi;
      return { t: c.t, strength: Math.min(1, c.strength / maxS), midi };
    });
  }

  // Harmonic-sum pitch estimate on a 4096 window just after the onset.
  const PN = 4096;
  const pWin = hann(PN);
  function spectrum(samples, start) {
    const fft = getFFT(PN);
    const re = new Float64Array(PN), im = new Float64Array(PN);
    for (let i = 0; i < PN; i++) re[i] = (samples[start + i] || 0) * pWin[i];
    fft(re, im);
    const mag = new Float32Array(PN / 2);
    for (let k = 0; k < PN / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    return mag;
  }
  // Spectral peaks (frequency by parabolic interpolation on log magnitude).
  function peaksAt(samples, start) {
    const mag = spectrum(samples, start);
    const binHz = SR / PN;
    const k0 = Math.floor(90 / binHz), k1 = Math.min(mag.length - 2, Math.floor(4200 / binHz));
    let mx = 0;
    for (let k = k0; k <= k1; k++) if (mag[k] > mx) mx = mag[k];
    const peaks = [];
    if (mx <= 0) return peaks;
    for (let k = k0; k <= k1; k++) {
      const b = mag[k];
      if (b < mx * 0.03 || b < mag[k - 1] || b < mag[k + 1]) continue;
      const la = Math.log(mag[k - 1] + 1e-9), lb = Math.log(b + 1e-9), lc = Math.log(mag[k + 1] + 1e-9);
      const den = la - 2 * lb + lc;
      const d = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (la - lc)) / den)) : 0;
      peaks.push({ f: (k + d) * binHz, m: b / mx });
    }
    return peaks;
  }

  // Pitch-class profile of a set of peaks, relative to the song's tuning.
  function chromaOf(peaks, tuning) {
    const ch = new Float32Array(12);
    for (const p of peaks) {
      const midi = 69 + 12 * Math.log2(p.f / 440) - tuning / 100;
      const r = Math.round(midi);
      const dev = Math.abs(midi - r);
      if (dev > 0.35) continue; // between semitones: noise or a drum
      const w = Math.pow(p.m, 0.6) * Math.cos(Math.PI * dev) * (p.f > 1200 ? 0.5 : 1);
      ch[((r % 12) + 12) % 12] += w;
    }
    let tot = 0;
    for (let i = 0; i < 12; i++) tot += ch[i];
    if (tot > 0) for (let i = 0; i < 12; i++) ch[i] /= tot;
    return ch;
  }

  function chromaAt(an, f, t) {
    if (an.chromaCache.has(f)) return an.chromaCache.get(f);
    const s0 = Math.max(0, Math.round((t + 0.02) * SR));
    const peaks = peaksAt(an.samples, s0).concat(peaksAt(an.samples, s0 + Math.round(0.07 * SR)));
    const ch = chromaOf(peaks, an.tuning);
    an.chromaCache.set(f, ch);
    return ch;
  }

  // Krumhansl–Kessler key profiles.
  const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function corr(a, b, rot) {
    let ma = 0, mb = 0;
    for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
    ma /= 12; mb /= 12;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) {
      const x = a[(i + rot) % 12] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return num / Math.sqrt(da * db || 1);
  }

  // Global tuning (cents off A440) and key, from frames across the song.
  async function analyseHarmony(an) {
    const { samples, rms, loud, nFrames } = an;
    const N = 260;
    const frames = [];
    for (let i = 0; i < N; i++) {
      const f = Math.floor(((i + 0.5) / N) * nFrames);
      if (rms[f] > loud * 0.08) frames.push(f);
    }
    const peakSets = [];
    let sx = 0, sy = 0;
    for (let i = 0; i < frames.length; i++) {
      const peaks = peaksAt(samples, frames[i] * HOP);
      peakSets.push(peaks);
      for (const p of peaks) {
        if (p.f < 100 || p.f > 2000) continue;
        const cents = 1200 * Math.log2(p.f / 440);
        const a = (2 * Math.PI * cents) / 100;
        sx += p.m * Math.cos(a); sy += p.m * Math.sin(a);
      }
      if (i % 40 === 39) await yieldFrame();
    }
    an.tuning = frames.length ? (Math.atan2(sy, sx) * 100) / (2 * Math.PI) : 0;
    const total = new Float32Array(12);
    for (const peaks of peakSets) {
      const ch = chromaOf(peaks, an.tuning);
      for (let i = 0; i < 12; i++) total[i] += ch[i];
    }
    let best = { r: -2, tonic: 0, minor: false };
    for (let t = 0; t < 12; t++) {
      const rM = corr(total, MAJOR, t), rm = corr(total, MINOR, t);
      if (rM > best.r) best = { r: rM, tonic: t, minor: false };
      if (rm > best.r) best = { r: rm, tonic: t, minor: true };
    }
    const steps = best.minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11];
    const scale = new Array(12).fill(false);
    for (const st of steps) scale[(best.tonic + st) % 12] = true;
    an.key = { tonic: best.tonic, minor: best.minor, scale, name: NOTE_NAMES[best.tonic] + (best.minor ? ' minor' : ' major') };
  }

  /* ---------- light show: tempo, beat grid, kicks, energy, drops ---------- */
  function lightShow(an) {
    if (an.show) return an.show;
    const { odf, rms, lowE, highE, nFrames } = an;
    const fps = SR / HOP;
    const pct = (arr, q) => { const a = Array.from(arr).sort((x, y) => x - y); return a[Math.floor(a.length * q)] || 1e-9; };

    // Energy envelope (0..~1), smoothed over ~0.25 s, sampled at 30 Hz.
    const ENV_HZ = 30;
    const nEnv = Math.ceil((nFrames / fps) * ENV_HZ) + 1;
    const env = new Float32Array(nEnv);
    const ref = pct(rms, 0.95);
    const win = Math.round(0.12 * fps);
    for (let i = 0; i < nEnv; i++) {
      const c = Math.round((i / ENV_HZ) * fps);
      let s = 0, n = 0;
      for (let f = Math.max(0, c - win); f <= Math.min(nFrames - 1, c + win); f++) { s += rms[f]; n++; }
      env[i] = n ? Math.min(1.2, s / n / ref) : 0;
    }

    // Kick drum hits: onsets in the bass band.
    const lowL = new Float32Array(nFrames);
    const lref = pct(lowE, 0.97) || 1e-9;
    for (let f = 0; f < nFrames; f++) lowL[f] = Math.log1p((20 * lowE[f]) / lref);
    const lowFlux = new Float32Array(nFrames);
    for (let f = 2; f < nFrames; f++) lowFlux[f] = Math.max(0, lowL[f] - Math.max(lowL[f - 1], lowL[f - 2]));
    const lfRef = pct(lowFlux, 0.99) || 1e-9;
    const kicks = [];
    const nb = Math.round(0.06 * fps);
    let lastK = -1;
    for (let f = nb; f < nFrames - nb; f++) {
      const v = lowFlux[f] / lfRef;
      if (v < 0.28) continue;
      let isMax = true;
      for (let k = -nb; k <= nb; k++) if (k && lowFlux[f + k] > lowFlux[f]) { isMax = false; break; }
      if (!isMax) continue;
      const t = (f * HOP + ONSET_OFFSET) / SR;
      if (lastK >= 0 && t - lastK < 0.2) continue;
      kicks.push({ t, s: Math.min(1, v) });
      lastK = t;
    }

    // Tempo: autocorrelation of the onset function (70–180 BPM), with a
    // gentle preference for tempos near 120.
    const oc = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) oc[f] = odf[f] + 0.5 * lowFlux[f] / lfRef;
    const maxF = Math.min(nFrames, Math.round(150 * fps));
    let bestLag = Math.round(fps * 0.5), bestScore = -1;
    for (let lag = Math.round((60 / 180) * fps); lag <= Math.round((60 / 70) * fps); lag++) {
      let s = 0;
      for (let f = lag; f < maxF; f++) s += oc[f] * oc[f - lag];
      const bpm = (60 * fps) / lag;
      s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }
    // refine the period with a parabola through neighbouring lags
    const acf = (lag) => { let s = 0; for (let f = lag; f < maxF; f++) s += oc[f] * oc[f - lag]; return s; };
    const a = acf(bestLag - 1), b = acf(bestLag), c = acf(bestLag + 1);
    const den = a - 2 * b + c;
    const lagF = bestLag + (den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0);
    const period = lagF / fps;
    const bpm = 60 / period;
    // Beat phase: the grid offset that lines up with the most onset energy,
    // weighted towards the kick drum (hats and stabs often sit off the beat).
    const pc = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) pc[f] = 0.35 * odf[f] + 1.5 * lowFlux[f] / lfRef;
    let bestPh = 0, bestPs = -1;
    for (let k = 0; k < 64; k++) {
      const ph = (k / 64) * period;
      let s = 0;
      for (let t = ph; t < Math.min(nFrames / fps, 150); t += period) {
        const f = Math.round((t * SR - ONSET_OFFSET) / HOP);
        if (f >= 0 && f < nFrames) s += pc[f] + 0.5 * (pc[f - 1] || 0) + 0.5 * (pc[f + 1] || 0);
      }
      if (s > bestPs) { bestPs = s; bestPh = ph; }
    }

    // Drops: the smoothed energy jumps up sharply.
    const drops = [];
    const avg = (i, w) => { let s = 0, n = 0; for (let j = Math.max(0, i - w); j < Math.min(nEnv, i + w); j++) { s += env[j]; n++; } return n ? s / n : 0; };
    for (let i = ENV_HZ * 2; i < nEnv - ENV_HZ; i += 3) {
      const before = avg(i - ENV_HZ, ENV_HZ), after = avg(i + ENV_HZ / 2, ENV_HZ / 2);
      if (after > 0.35 && after > before * 1.7 + 0.08 && (!drops.length || i / ENV_HZ - drops[drops.length - 1] > 8)) {
        // place the drop on the first strong onset of the new section
        let t = i / ENV_HZ;
        for (let j = i; j < Math.min(nEnv - 1, i + ENV_HZ); j++) if (env[j + 1] - env[j] > 0.08) { t = (j + 1) / ENV_HZ; break; }
        drops.push(t);
      }
    }

    // Character of the track, for choosing a look automatically.
    let onGrid = 0, gridN = 0;
    const dur = nFrames / fps;
    for (let t = bestPh; t < dur; t += period) {
      gridN++;
      // binary search nearest kick
      let lo = 0, hi = kicks.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (kicks[m].t < t) lo = m + 1; else hi = m; }
      const d = Math.min(Math.abs((kicks[lo] || { t: 1e9 }).t - t), Math.abs((kicks[lo - 1] || { t: 1e9 }).t - t));
      if (d < 0.07) onGrid++;
    }
    const kickRegularity = gridN ? onGrid / gridN : 0;
    let lowSum = 0, highSum = 0, allSum = 0;
    for (let f = 0; f < nFrames; f++) { lowSum += lowE[f]; highSum += highE[f]; allSum += rms[f] * rms[f]; }
    let meanEnergy = 0;
    for (let i = 0; i < nEnv; i++) meanEnergy += env[i];
    meanEnergy /= nEnv || 1;
    const danceable = kickRegularity > 0.55 && bpm >= 100 && bpm <= 180;
    const suggested = danceable || (bpm >= 118 && kickRegularity > 0.4) ? 'neon' : 'studio';

    an.show = {
      bpm, period, phase: bestPh, kicks, env, envHz: ENV_HZ, drops,
      kickRegularity, meanEnergy, suggested,
    };
    return an.show;
  }

  function noteName(midi) {
    return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  XB.Analysis = { analyse, pickOnsets, lightShow, noteName, SR };
})();

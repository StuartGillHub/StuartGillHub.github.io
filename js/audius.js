/* Audius: an open music streaming service whose public API lets apps search
 * the catalogue and stream full tracks. Used here to fetch a song, which then
 * goes through the same analysis as an uploaded file.
 * API: https://api.audius.co/v1 (no key needed; app_name identifies the app).
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  const API = 'https://api.audius.co/v1';
  const APP = 'Xylofall';

  async function getJSON(path, params) {
    const q = new URLSearchParams(Object.assign({ app_name: APP }, params || {}));
    const res = await fetch(`${API}${path}?${q}`);
    if (!res.ok) throw new Error(`Audius replied ${res.status}`);
    const body = await res.json();
    return body.data || [];
  }

  // Only tracks anyone can stream in full.
  function playable(tracks) {
    return tracks.filter((t) => t && t.id && t.is_streamable !== false && !t.is_stream_gated && !t.is_delete);
  }

  function describe(t) {
    const art = t.artwork || {};
    return {
      id: t.id,
      title: t.title || 'Untitled',
      artist: (t.user && (t.user.name || t.user.handle)) || 'Unknown artist',
      duration: t.duration || 0,
      genre: t.genre || '',
      artwork: art['150x150'] || art['480x480'] || '',
      link: t.permalink ? `https://audius.co${t.permalink}` : 'https://audius.co',
    };
  }

  async function trending() {
    return playable(await getJSON('/tracks/trending', { time: 'week', limit: 30 })).map(describe);
  }

  async function search(query) {
    return playable(await getJSON('/tracks/search', { query, limit: 30 })).map(describe);
  }

  // Download the full track (MP3), reporting progress 0..1 when the size is known.
  async function download(track, onProgress) {
    const res = await fetch(`${API}/tracks/${encodeURIComponent(track.id)}/stream?app_name=${APP}`);
    if (!res.ok) throw new Error(`Audius replied ${res.status}`);
    const total = +res.headers.get('content-length') || 0;
    if (!res.body || !res.body.getReader) return await res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (onProgress) onProgress(total ? got / total : Math.min(0.95, got / 8e6), got);
    }
    const out = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out.buffer;
  }

  XB.Audius = { trending, search, download };
})();

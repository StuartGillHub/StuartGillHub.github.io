/* Visualisation modes.
 *
 * A mode is an object:
 *   id, name
 *   init()            become the active mode (show its canvas, start state)
 *   update(dt)        advance by dt seconds (called every frame)
 *   render(ctx)       draw; ctx = { t, dt, playing } for the frame
 *   onKey(e)          handle a key the app didn't use; return true if used
 *   dispose()         stop being active (hide canvas, release work)
 *   getControls()     the mode's own controls for the settings panel:
 *                     { element } to show existing markup, or a list of
 *                     descriptors (see mount below)
 *
 * The app owns the shared pieces (audio, file loading, analysis, transport,
 * panel, global keys) and switches modes; switching stops the audio.
 */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});

  // Build descriptor controls into `root`, with the panel's own styling.
  //   { type: 'heading', label }
  //   { type: 'range', label, min, max, step, value, format(v), onInput(v) }
  //   { type: 'select', label, options: [[value, label]], value, onChange(v) }
  //   { type: 'buttons', items: [{ label, onClick, title }] }
  //   { type: 'check', label, hint, value, onChange(on), bind(input) }
  //   { type: 'readout', label, bind(el) }   (the mode writes el.textContent)
  function mount(root, spec) {
    root.innerHTML = '';
    if (!spec) return;
    if (spec.element) { spec.element.classList.remove('hidden'); return; }
    for (const c of spec) {
      if (c.type === 'heading') {
        const h = document.createElement('h3'); h.textContent = c.label; root.appendChild(h);
      } else if (c.type === 'range') {
        const lab = document.createElement('label');
        const out = document.createElement('output');
        const inp = document.createElement('input');
        Object.assign(inp, { type: 'range', min: c.min, max: c.max, step: c.step, value: c.value });
        const upd = () => { out.textContent = c.format ? c.format(+inp.value) : inp.value; };
        upd();
        inp.addEventListener('input', () => { upd(); c.onInput(+inp.value); });
        lab.append(c.label + ' ', out, inp);
        root.appendChild(lab);
      } else if (c.type === 'select') {
        const lab = document.createElement('label');
        const sel = document.createElement('select');
        sel.className = 'select';
        for (const [v, t] of c.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
        sel.value = c.value;
        sel.addEventListener('change', () => c.onChange(sel.value));
        lab.append(c.label, sel);
        root.appendChild(lab);
        if (c.bind) c.bind(sel);
      } else if (c.type === 'buttons') {
        const row = document.createElement('div');
        row.className = 'btn-row';
        for (const it of c.items) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'btn'; b.textContent = it.label;
          if (it.title) b.title = it.title;
          b.addEventListener('click', it.onClick);
          row.appendChild(b);
        }
        root.appendChild(row);
      } else if (c.type === 'check') {
        const lab = document.createElement('label');
        lab.className = 'check';
        const inp = document.createElement('input');
        inp.type = 'checkbox'; inp.checked = !!c.value;
        inp.addEventListener('change', () => c.onChange(inp.checked));
        lab.append(inp, ' ' + c.label);
        if (c.hint) { const s = document.createElement('small'); s.textContent = c.hint; lab.appendChild(s); }
        root.appendChild(lab);
        if (c.bind) c.bind(inp);
      } else if (c.type === 'readout') {
        const row = document.createElement('div');
        row.className = 'readout';
        const val = document.createElement('output');
        row.append(c.label + ' ', val);
        root.appendChild(row);
        if (c.bind) c.bind(val);
      }
    }
  }
  function unmount(root, spec) {
    if (spec && spec.element) spec.element.classList.add('hidden');
    root.innerHTML = '';
  }

  XB.Modes = { mount, unmount, list: [] };
})();

/* Warm colour constants shared by every mode (the Studio look's glow and
 * brass, and the UI's tokens in style.css). Change them here to restyle. */
(function () {
  'use strict';
  const XB = (window.XB = window.XB || {});
  XB.Palette = {
    GLOW: '#ffb45c', // warm lamp / strike glow
    BRASS: '#c9a063', // brass rails, cup, table rim
    BG: '#23170f', // page background (--bg)
    ACCENT: '#c9793a', // --accent
    ACCENT2: '#f2c67d', // --accent2
    TEXT: '#fbf1e3', // --text
  };
})();

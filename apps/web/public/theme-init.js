// Runs from <head> before first paint so the page never flashes the wrong theme.
// Keep in sync with src/shared/theme (a unit test checks the storage keys and values).
(function () {
  var dark = false;
  var palettes = ['emerald', 'rose', 'ocean', 'sand', 'graphite'];
  var palette = 'emerald';
  try {
    var stored = localStorage.getItem('spending.theme');
    if (stored === 'dark') dark = true;
    else if (stored !== 'light') dark = matchMedia('(prefers-color-scheme: dark)').matches;
    var storedPalette = localStorage.getItem('spending.palette');
    if (palettes.indexOf(storedPalette) !== -1) palette = storedPalette;
  } catch (e) {
    try {
      dark = matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e2) {}
  }
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.setAttribute('data-palette', palette);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = dark ? '#0d1013' : '#fafaf9';
})();

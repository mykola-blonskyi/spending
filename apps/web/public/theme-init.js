// Runs from <head> before first paint so the page never flashes the wrong theme.
// Keep in sync with src/shared/theme/theme.ts (a unit test checks the storage key and values).
(function () {
  var dark = false;
  try {
    var stored = localStorage.getItem('spending.theme');
    if (stored === 'dark') dark = true;
    else if (stored !== 'light') dark = matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    try {
      dark = matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e2) {}
  }
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = dark ? '#0d1013' : '#fafaf9';
})();

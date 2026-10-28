// Runs before styles load so a saved dark theme never flashes white.
(() => {
  'use strict';
  const key = 'jeff-va-theme-v1';
  const normalize = value => value === 'dark' ? 'dark' : 'light';
  function apply(value) {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    const color = document.querySelector('meta[name="theme-color"]');
    if (color) color.content = theme === 'dark' ? '#080808' : '#171717';
    const control = document.getElementById('workspaceTheme');
    if (control) control.value = theme;
  }
  let saved = 'light';
  try { saved = localStorage.getItem(key); } catch { /* Appearance works without storage. */ }
  apply(saved);
  document.addEventListener('DOMContentLoaded', () => {
    const control = document.getElementById('workspaceTheme');
    if (!control) return;
    control.value = document.documentElement.dataset.theme;
    control.addEventListener('change', () => {
      apply(control.value);
      try { localStorage.setItem(key, normalize(control.value)); } catch { /* Keep this visit usable. */ }
    });
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();

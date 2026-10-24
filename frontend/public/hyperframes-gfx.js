/* SKY//PULSE presentation-only motion opt-in; never handles device credentials. */
(() => {
  'use strict';
  const button = document.getElementById('gfxMotionToggle');
  if (!button || !document.body.classList.contains('skyhub-gfx')) return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userChoice = false;
  let enabled = !preference.matches;

  function render() {
    document.body.dataset.gfxMotion = enabled ? 'on' : 'off';
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? 'Visuelle Animationen ausschalten' : 'Visuelle Animationen einschalten');
    button.textContent = enabled ? 'GFX · AN' : 'GFX · AUS';
  }

  button.addEventListener('click', () => {
    userChoice = true;
    enabled = !enabled;
    render();
  });
  if (typeof preference.addEventListener === 'function') {
    preference.addEventListener('change', event => {
      if (!userChoice) {
        enabled = !event.matches;
        render();
      }
    });
  }
  render();
})();

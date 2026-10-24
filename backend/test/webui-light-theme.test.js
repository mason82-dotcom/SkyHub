'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pages = [
  ['index.html', 'dashboard'],
  ['smart-farming.html', 'smart-farming'],
  ['wpml-editor.html', 'wpml-editor'],
  ['wpml-route-library.html', 'routes'],
  ['wpml-survey-preview.html', 'survey'],
  ['pilot-login.html', 'pilot']
];
const root = path.resolve(__dirname, '../../frontend/public');
const html = name => fs.readFileSync(path.join(root, name), 'utf8');

test('shared light stylesheet defines accessible UI tokens and is syntactically balanced', () => {
  const css = fs.readFileSync(path.join(root, 'skyhub-light.css'), 'utf8');
  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /--sky-bg:\s*#f3f6fb/);
  assert.match(css, /--sky-primary:\s*#2458d3/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
  assert.doesNotMatch(css, /color-scheme:\s*dark/);
});

for (const [filename, page] of pages) {
  test(`${filename} loads the shared light theme last and retains its safety contract`, () => {
    const source = html(filename);
    assert.match(source, new RegExp(`<body data-skyhub-page="${page}"`));
    assert.equal((source.match(/href="\/skyhub-light\.css"/g) || []).length, 1);
    assert.ok(source.indexOf('href="/skyhub-light.css"') > source.indexOf('</style>'));
    assert.doesNotMatch(source, /color-scheme:\s*dark/);
    assert.match(source, /<script\b/);
  });
}
const globalLinks = ['/', '/wpml-editor.html', '/wpml-route-library.html',
  '/wpml-survey-preview.html', '/smart-farming.html'];
for (const [filename] of pages.filter(([, page]) => page !== 'pilot')) {
  test(`${filename} has shared navigation to the five operator modules`, () => {
    const source = html(filename);
    assert.match(source, /<nav class="skyhub-global-nav" aria-label="SkyHub-Bereiche">/);
    for (const href of globalLinks)
      assert.ok(source.includes(`href="${href}"`), `${filename} missing ${href}`);
    assert.equal((source.match(/aria-current="page"/g) || []).length, 1);
  });
}
test('pairing UI stays compact without introducing additional navigation', () => {
  assert.doesNotMatch(html('pilot-login.html'), /skyhub-global-nav/);
});
test('live dashboard keeps read-only, operational and TAK contract identifiers', () => {
  const source = html('index.html');
  for (const id of ['token', 'connect', 'map', 'tabOperations', 'tabTak',
    'operationsPanel', 'takPanel', 'devices', 'showTrack']) {
    assert.ok(source.includes(`id="${id}"`), `missing ${id}`);
  }
  assert.match(source, /keine Flugsteuerung/);
  assert.match(source, /TAK-Backend nicht integriert/);
});
test('experimental Smart Farming and offline WPML disclaimers remain visible', () => {
  assert.match(html('smart-farming.html'), /Keine kalibrierte Vegetationskarte/);
  assert.match(html('wpml-editor.html'), /Keine Flugfreigabe|Keine Flugauftrag|keine Flugfreigabe/i);
  assert.match(html('wpml-route-library.html'), /lokalen Browser-Speicher im Klartext/);
  assert.match(html('wpml-survey-preview.html'), /Keine Flugplanung/);
});

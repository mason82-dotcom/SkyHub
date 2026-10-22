'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(
  path.join(__dirname, '..', 'server.js'),
  'utf8'
);

test('DR API is behind authentication middleware', () => {
  const authPosition = server.indexOf(
    "app.use('/api',auth);"
  );

  const drPosition = server.indexOf(
    "app.use('/api/dr/minio',createMinioDrRouter("
  );

  assert.ok(authPosition >= 0);
  assert.ok(drPosition > authPosition);
});

test('DR API is disabled by default', () => {
  assert.match(
    server,
    /process\.env\.SKYHUB_MINIO_DR_ENABLED==='true'/
  );
});

test('DR API requires configured report directory', () => {
  assert.match(
    server,
    /process\.env\.SKYHUB_MINIO_DR_REPORT_DIR/
  );

  assert.match(
    server,
    /path\.isAbsolute\(drDirectory\)/
  );
});

test('DR API is not in token-free LAN allowlist', () => {
  const start = server.indexOf(
    'const lanReadPaths=new Set('
  );

  const end = server.indexOf(
    'function lanView(',
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const allowlist = server.slice(start, end);

  assert.equal(
    allowlist.includes('/dr/minio'),
    false
  );
});

test('DR router exposes no write methods', () => {
  const router = fs.readFileSync(
    path.join(__dirname, '..', 'minio-dr-api.js'),
    'utf8'
  );

  assert.doesNotMatch(
    router,
    /router\.(post|put|patch|delete)\s*\(/
  );
});

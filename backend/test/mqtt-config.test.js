'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validateBrokerConfig} = require('../mqtt-config');

test('Pi host gateway connects to the existing MQTT service on TCP 1884', () => {
  const config = validateBrokerConfig('mqtt://host.docker.internal:1884', '1884');
  assert.deepEqual(config, {
    url:'mqtt://host.docker.internal:1884',
    host:'host.docker.internal',port:1884,secure:false
  });
});
test('Pi LAN broker on port 1884 is accepted', () => {
  assert.equal(validateBrokerConfig('mqtt://192.168.178.50:1884', '1884').port,1884);
});
test('Pi deployment fails fast on 1883 (including the implicit MQTT default)', () => {
  assert.throws(()=>validateBrokerConfig('mqtt://host.docker.internal:1883', '1884'),/requires port 1884/);
  assert.throws(()=>validateBrokerConfig('mqtt://host.docker.internal', '1884'),/requires port 1884/);
});
test('An external non-Pi installation can use its own port', () => {
  assert.equal(validateBrokerConfig('mqtts://broker.example.org:8883').port,8883);
});
test('Rejects missing, malformed, non-TCP and credential-bearing URLs', () => {
  assert.throws(()=>validateBrokerConfig('', '1884'),/required/);
  assert.throws(()=>validateBrokerConfig('not a URL','1884'),/valid URL/);
  assert.throws(()=>validateBrokerConfig('http://host:1884','1884'),/mqtt/);
  assert.throws(()=>validateBrokerConfig('mqtt://user:secret@host:1884','1884'),/credentials/);
  assert.throws(()=>validateBrokerConfig('mqtt://host:1884','eighty'),/TCP port/);
});

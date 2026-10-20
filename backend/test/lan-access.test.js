'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createLanAccess,parseLanCidr,clientAddress}=require('../lan-access');

test('LAN view is off unless a CIDR is configured',()=>{
  const off=createLanAccess('');
  assert.equal(off.enabled,false);
  assert.equal(off.allows('172.18.0.1','192.168.178.70'),false);
});

test('only narrow private networks outside Docker ranges are accepted',()=>{
  assert.deepEqual(parseLanCidr('192.168.178.0/24'),['192.168.178.0',24]);
  for(const bad of ['0.0.0.0/0','192.168.0.0/8','8.8.8.0/24','172.17.0.0/16','172.20.0.0/24',
    '192.168.178.0','192.168.178.300/24','fd00::/8','192.168.178.0/33']){
    assert.throws(()=>parseLanCidr(bad),undefined,bad);
  }
});

test('client is the last X-Forwarded-For hop when the peer is Docker or loopback',()=>{
  assert.equal(clientAddress('172.18.0.1','192.168.178.70'),'192.168.178.70');
  assert.equal(clientAddress('::ffff:127.0.0.1','8.8.8.8, 192.168.178.70'),'192.168.178.70');
  assert.equal(clientAddress('172.18.0.1',undefined),'172.18.0.1');
  // A public peer is never replaced by a header it supplied itself.
  assert.equal(clientAddress('203.0.113.9','192.168.178.70'),'203.0.113.9');
});

test('home LAN clients via Caddy are allowed; SSH tunnel, Tailscale and other nets are not',()=>{
  const lan=createLanAccess('192.168.178.0/24');
  assert.equal(lan.enabled,true);
  assert.equal(lan.allows('172.18.0.1','192.168.178.70'),true);
  assert.equal(lan.allows('::ffff:172.18.0.1','192.168.178.63'),true);
  // SSH tunnel: no forwarding header, peer is the Docker gateway.
  assert.equal(lan.allows('172.18.0.1',undefined),false);
  assert.equal(lan.allows('172.18.0.1','100.98.97.84'),false);
  assert.equal(lan.allows('172.18.0.1','192.168.179.5'),false);
  // Spoofed earlier hop does not matter: Caddy's own entry is last.
  assert.equal(lan.allows('172.18.0.1','192.168.178.70, 8.8.8.8'),false);
  assert.equal(lan.allows('172.18.0.1','fe80::1'),false);
});

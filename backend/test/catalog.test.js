'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDeviceModel } = require('../catalog');

test('model lookup uses domain and both type components', () => {
  assert.equal(resolveDeviceModel({domain:0,type:77,subType:0}), 'Mavic 3E');
  assert.equal(resolveDeviceModel({domain:0,type:77,subType:1}), 'Mavic 3T');
  assert.equal(resolveDeviceModel({domain:0,type:99,subType:0}), 'Matrice 4E');
  assert.equal(resolveDeviceModel({domain:0,type:99,subType:1}), 'Matrice 4T');
  assert.equal(resolveDeviceModel({domain:2,type:174,subType:0}), 'DJI RC Plus 2 Enterprise');
  assert.equal(resolveDeviceModel({domain:1,type:89,subType:0}), 'Matrice 4T Camera');
  assert.equal(resolveDeviceModel({domain:0,type:89,subType:0}), 'Matrice 350 RTK');
  assert.equal(resolveDeviceModel({domain:1,type:68,subType:0}), null);
});

test('Mavic 3M aircraft observed via RC Pro resolves by domain/type/sub_type',()=>{
  assert.equal(resolveDeviceModel({domain:'0',type:77,subType:2}),'Mavic 3M');
  assert.equal(resolveDeviceModel({domain:'1',type:77,subType:2}),null);
});

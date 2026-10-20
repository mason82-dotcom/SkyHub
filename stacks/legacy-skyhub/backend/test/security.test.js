const test = require('node:test');
const assert = require('node:assert/strict');

const { bearerToken, safeEqual } = require('../lib/security');

test('constant-time credential comparison rejects missing and different values', () => {
    assert.equal(safeEqual('same-secret', 'same-secret'), true);
    assert.equal(safeEqual('same-secret', 'other-value'), false);
    assert.equal(safeEqual(undefined, 'same-secret'), false);
});

test('bearer parser accepts only a bounded explicit bearer credential', () => {
    const token = 'a'.repeat(32);
    assert.equal(bearerToken(`Bearer ${token}`), token);
    assert.equal(bearerToken(`Basic ${token}`), undefined);
    assert.equal(bearerToken('Bearer short'), undefined);
});

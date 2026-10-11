const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRng, dailySeed, hash } = require('../rng.js');

test('zelfde seed geeft dezelfde reeks', () => {
  const a = makeRng('2026-10-11'), b = makeRng('2026-10-11');
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
});

test('andere seed geeft een andere reeks', () => {
  const a = makeRng('2026-10-11'), b = makeRng('2026-10-12');
  const sa = Array.from({ length: 20 }, () => a.next());
  const sb = Array.from({ length: 20 }, () => b.next());
  assert.notDeepEqual(sa, sb);
});

test('next blijft in [0,1) en int(n) in 0..n-1', () => {
  const r = makeRng('bereik');
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
    const n = r.int(3);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 3);
    seen.add(n);
  }
  assert.equal(seen.size, 3);
});

test('vaste waarden: de generator verandert niet stilletjes', () => {
  const r = makeRng('tafeltennisrun');
  const first = [r.next(), r.next(), r.next()].map((v) => v.toFixed(8));
  assert.deepEqual(first, ['0.75853195', '0.28181864', '0.05667857']);
  assert.equal(hash('abc'), hash('abc'));
});

test('dailySeed geeft de lokale datum als YYYY-MM-DD', () => {
  assert.equal(dailySeed(new Date(2026, 9, 11, 23, 59)), '2026-10-11');
  assert.equal(dailySeed(new Date(2026, 0, 2, 0, 1)), '2026-01-02');
});

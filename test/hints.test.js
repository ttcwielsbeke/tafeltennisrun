const test = require('node:test');
const assert = require('node:assert/strict');
const { hintFor, learnFrom, TIPS } = require('../hints.js');

// een minimale speltoestand: speler op 100 m, 20 m/s, in de middelste baan
function state(items, extra) {
  return Object.assign({ alive: true, dist: 100, vel: 20, lane: 1, items }, extra || {});
}
const ob = (id, type, lane, z) => ({ id, type, lane, z, len: 1 });

test('een obstakel in je baan binnen 1,5 s geeft de juiste tip', () => {
  assert.equal(hintFor(state([ob('a', 'nopper', 1, 120)]), {}, true).kind, 'lane');
  assert.equal(hintFor(state([ob('a', 'table', 1, 120)]), {}, true).kind, 'jump');
  assert.equal(hintFor(state([ob('a', 'net', 1, 120)]), {}, true).kind, 'slide');
  assert.equal(hintFor(state([ob('a', 'machine', 1, 120)]), {}, true).kind, 'slide');
  assert.equal(hintFor(state([ob('a', 'table', 1, 120)]), {}, true).id, 'a');
});

test('tekst past bij het toestel: vegen op touch, toetsen op een pc', () => {
  const s = state([ob('a', 'table', 1, 120)]);
  assert.equal(hintFor(s, {}, true).text, TIPS.jump.touch);
  assert.equal(hintFor(s, {}, false).text, TIPS.jump.keys);
  // het pixellettertype heeft geen pijltjes-tekens
  for (const k of Object.keys(TIPS)) for (const t of [TIPS[k].touch, TIPS[k].keys]) assert.ok(!/[←→↑↓]/.test(t), t);
});

test('geen tip: te ver, andere baan, al voorbij, gebroken, geleerd of gebotst', () => {
  assert.equal(hintFor(state([ob('a', 'table', 1, 131)]), {}, true), null);          // 1,55 s ver
  assert.equal(hintFor(state([ob('a', 'table', 0, 120)]), {}, true), null);
  assert.equal(hintFor(state([ob('a', 'table', 1, 98)]), {}, true), null);
  assert.equal(hintFor(state([Object.assign(ob('a', 'table', 1, 120), { broken: true })]), {}, true), null);
  assert.equal(hintFor(state([ob('a', 'table', 1, 120)]), { jump: true }, true), null);
  assert.equal(hintFor(state([ob('a', 'table', 1, 120)], { alive: false }), {}, true), null);
  assert.equal(hintFor(state([ob('b', 'ball', 1, 110)]), {}, true), null);            // geen obstakel
});

test('het dichtstbijzijnde obstakel telt', () => {
  const s = state([ob('far', 'net', 1, 125), ob('near', 'nopper', 1, 110)]);
  assert.equal(hintFor(s, {}, true).id, 'near');
});

test('geleerd zodra je het getipte obstakel levend voorbij bent', () => {
  const hint = { kind: 'jump', id: 'a' };
  const items = [ob('a', 'table', 1, 120)];
  assert.deepEqual(learnFrom(state(items, { dist: 110 }), hint, {}), {});                 // nog niet voorbij
  assert.deepEqual(learnFrom(state(items, { dist: 122 }), hint, {}), { jump: true });     // voorbij (z + len < dist)
  assert.deepEqual(learnFrom(state(items, { dist: 122, alive: false }), hint, {}), {});   // gebotst: niet geleerd
  assert.deepEqual(learnFrom(state(items, { dist: 122 }), null, { lane: true }), { lane: true });
  const learned = { lane: true };
  assert.notEqual(learnFrom(state(items, { dist: 122 }), hint, learned), learned, 'geeft een nieuw object');
});

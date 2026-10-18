const test = require('node:test');
const assert = require('node:assert/strict');
const { unlockedSkins, newSkins, cycleSkin } = require('../skins.js');
const { skins } = require('../config.js');

test('het clubshirt is er altijd, de rest komt met je beste score', () => {
  assert.deepEqual(unlockedSkins(0, skins).map((k) => k.id), ['club']);
  assert.deepEqual(unlockedSkins(undefined, skins).map((k) => k.id), ['club']);
  assert.deepEqual(unlockedSkins(750, skins).map((k) => k.id), ['club', 'trainer', 'links']);
  assert.equal(unlockedSkins(999999, skins).length, skins.length);
});

test('nieuw vrijgespeeld: enkel wat tussen de oude en de nieuwe beste score ligt', () => {
  assert.deepEqual(newSkins(200, 800, skins).map((k) => k.id), ['trainer', 'links']);
  assert.deepEqual(newSkins(800, 900, skins), []);
  assert.deepEqual(newSkins(0, 0, skins), []);           // het clubshirt is niet "nieuw"
});

test('door de tenues bladeren gaat rond', () => {
  assert.equal(cycleSkin('club', 1, skins), 'trainer');
  assert.equal(cycleSkin('club', -1, skins), skins[skins.length - 1].id);
  assert.equal(cycleSkin('onbekend', 1, skins), 'trainer');
});

test('elk tenue in config.js heeft een tekening in render.js', () => {
  require('../render.js');
  const kits = globalThis.TTR.KITS;
  for (const k of skins) assert.ok(kits[k.id], k.id);
});

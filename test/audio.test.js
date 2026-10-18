const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudio } = require('../audio.js');

test('zonder Web Audio: aanzetten lukt niet en spelen doet niets, zonder fouten', () => {
  const a = createAudio();
  assert.equal(a.setOn(true), false);
  assert.equal(a.on, false);
  for (const n of a.names) assert.equal(a.play(n), false);
  a.startAmbience();
  a.stopAmbience();
  a.wake();
});

test('elke gebeurtenis in het spel heeft een geluid', () => {
  const a = createAudio();
  for (const ev of ['jump', 'slide', 'lane', 'ball', 'shield', 'magnet', 'timeout', 'bak', 'block', 'crash', 'land', 'cheer']) {
    assert.ok(a.names.includes(ev), ev);
  }
});

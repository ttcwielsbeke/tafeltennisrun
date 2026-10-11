const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const { bot } = require('./bot.js');

// vast script: frame → acties
const SCRIPT = { 30: ['left'], 90: ['right'], 150: ['right'], 180: ['jump'], 232: ['slide'], 320: ['left'] };

function runScript(seed, frames) {
  const s = G.createGame(seed);
  for (let f = 0; f < frames && s.alive; f++) G.step(s, SCRIPT[f] || []);
  return s;
}

function runBot(seed, frames) {
  const s = G.createGame(seed);
  while (s.alive && s.frame < frames) G.step(s, bot(s));
  return s;
}

test('vaste seed + vast script = altijd dezelfde afloop', () => {
  const a = runScript('2026-10-11', 600), b = runScript('2026-10-11', 600);
  assert.equal(a.frame, b.frame);
  assert.equal(G.scoreOf(a), G.scoreOf(b));
  assert.equal(a.crashedBy, b.crashedBy);
  assert.deepEqual(
    { frame: a.frame, score: G.scoreOf(a), alive: a.alive, crashedBy: a.crashedBy },
    GOLDEN.script
  );
});

test('autopiloot: twee minuten op de baan van 2026-10-11 geeft een vaste score', () => {
  const s = runBot('2026-10-11', 60 * 120);
  assert.deepEqual({ frame: s.frame, score: G.scoreOf(s), balls: s.balls, alive: s.alive }, GOLDEN.bot);
});

test('een goede speler overleeft: de autopiloot haalt 3 minuten op 5 seeds', () => {
  for (const seed of ['2026-10-11', '2026-10-12', 'a', 'b', 'c']) {
    const s = runBot(seed, 60 * 180);
    assert.ok(s.alive, seed + ': gebotst op ' + s.crashedBy + ' na ' + (s.frame / 60).toFixed(1) + ' s');
  }
});

test('niets doen eindigt snel, maar niet meteen (eerste 40 m vrij)', () => {
  const s = G.createGame('2026-10-11');
  while (s.alive && s.frame < 60 * 60) G.step(s, []);
  assert.equal(s.alive, false);
  assert.ok(s.frame / 60 > 3.5);
});

test('besturing: baan, springen en sliden', () => {
  const s = G.createGame('x');
  G.step(s, ['left']); assert.equal(s.lane, 0);
  G.step(s, ['left']); assert.equal(s.lane, 0);          // niet van de baan af
  G.step(s, ['right', 'right']); assert.equal(s.lane, 2);
  G.step(s, ['jump']); assert.ok(s.vy > 0);
  for (let i = 0; i < 10; i++) G.step(s, []);
  assert.ok(s.y > 0.5);
  G.step(s, ['slide']); assert.ok(s.vy < 0 && s.sliding > 0);   // in de lucht: snel naar beneden
});

test('schild vangt één botsing op, magneet trekt ballen aan', () => {
  const s = G.createGame('x');
  s.items = [{ id: 't1', type: 'nopper', lane: 1, z: 2, len: 0.6, row: 'r' },
             { id: 'b1', type: 'ball', lane: 0, z: 5, len: 0.3 }];
  s.nextChunk = 99;     // geen nieuwe stukken inladen
  s.shield = true; s.magnet = 600;
  const nopper = s.items[0];
  for (let i = 0; i < 40; i++) G.step(s, []);
  assert.equal(s.alive, true);
  assert.equal(s.shield, false);
  assert.equal(nopper.broken, true);
  assert.equal(s.balls, 1);
});

test('de lus doet vaste stappen van 1/60 s, los van de beeldsnelheid', () => {
  let updates = 0;
  const loop = G.createLoop({ update() { updates++; }, render() {} });
  for (let t = 0; t <= 1000; t += 1000 / 144) loop.frame(t);   // 144 Hz-scherm
  assert.ok(Math.abs(updates - 60) <= 2, 'updates=' + updates);
  updates = 0; loop.reset();
  for (let t = 0; t <= 1000; t += 1000 / 30) loop.frame(t);    // trage gsm
  assert.ok(Math.abs(updates - 60) <= 2, 'updates=' + updates);
});

// Gouden waarden: veranderen enkel als de spelregels, config.js of world.js veranderen.
// Dan bewust opnieuw berekenen en hier aanpassen.
const GOLDEN = {
  script: { frame: 430, score: 73, alive: false, crashedBy: 'table' },   // onder het net door, dan tegen een tafel
  bot: { frame: 7200, score: 2204, balls: 50, alive: true }
};

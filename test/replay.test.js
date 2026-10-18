const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const R = require('../replay.js');
const { bot } = require('./bot.js');

const SEEDS = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'];
const TELLERS = { jump: 'jumps', slide: 'slides', lane: 'lanes', shield: 'shields', magnet: 'magnets', timeout: 'timeouts', bak: 'bakken', block: 'blocks' };

// speelt een bot-run en neemt ze op; na frame 1500 reageert de bot niet meer, dus de run eindigt met een botsing.
// `pauzeAt`: tikken (klokticks) waarop de app gepauzeerd is: dan wordt er niet opgenomen en niet gestapt.
function record(seed, pauzeAt) {
  const s = G.createGame(seed);
  const rec = R.createRecorder();
  const counts = {};
  for (const k of Object.keys(TELLERS)) counts[TELLERS[k]] = 0;
  for (let tick = 0; s.alive && tick < 20000; tick++) {
    if (pauzeAt && pauzeAt(tick)) continue;
    const acts = s.frame > 1500 ? [] : bot(s);
    rec.add(s.frame, acts);
    G.step(s, acts);
    for (const e of s.events) if (TELLERS[e]) counts[TELLERS[e]]++;
  }
  assert.equal(s.alive, false, 'de run moet met een botsing eindigen');
  return { s, rec, counts };
}

test('een opgenomen bot-run geeft bij herberekening exact dezelfde afloop', () => {
  for (const seed of SEEDS) {
    const { s, rec } = record(seed);
    const r = R.replay(seed, s.frame, rec.inputs);
    assert.equal(r.ok, true, seed);
    assert.equal(r.crashed, true);
    assert.equal(r.score, G.scoreOf(s));
    assert.equal(r.dist, Math.floor(s.dist));
    assert.equal(r.balls, s.balls);
    assert.equal(r.crash, s.crashedBy);
    assert.equal(r.frame, s.frame);
  }
});

test('pauzes tellen niet: de opname hangt aan game.frame', () => {
  for (const seed of SEEDS) {
    const vol = record(seed);
    const gepauzeerd = record(seed, (tick) => tick % 7 < 3);
    assert.deepEqual(gepauzeerd.rec.inputs, vol.rec.inputs);
    const a = R.replay(seed, vol.s.frame, vol.rec.inputs);
    const b = R.replay(seed, gepauzeerd.s.frame, gepauzeerd.rec.inputs);
    assert.deepEqual(b, a);
  }
});

test('tellers kloppen met de events', () => {
  for (const seed of SEEDS) {
    const { s, rec, counts } = record(seed);
    const r = R.replay(seed, s.frame, rec.inputs);
    for (const naam of Object.values(TELLERS)) assert.equal(r[naam], counts[naam], `${seed} ${naam}`);
    assert.equal(r.balls, s.balls);
  }
});

test('geweigerd', () => {
  const seed = SEEDS[0];
  const { s, rec } = record(seed);
  const F = s.frame;
  const goed = rec.inputs;
  assert.ok(goed.length >= 2);

  const weiger = (frames, inputs, code) => {
    const r = R.replay(seed, frames, inputs);
    assert.equal(r.ok, false, code);
    assert.equal(r.error, code);
  };

  weiger(F, [[10, 'jump'], [5, 'left']], 'order');
  weiger(F, [[10, 'fly']], 'action');
  weiger(F, [[F, 'jump']], 'range');
  weiger(F, Array.from({ length: 20001 }, () => [0, 'jump']), 'inputs');
  weiger(F, [[5, 'jump', {}]], 'inputs');                              // geen extra velden
  weiger(F, [[5]], 'inputs');
  weiger(0, [], 'frames');
  weiger(108001, [], 'frames');
  weiger(F + 30, goed, 'nocrash');                                    // crash kwam eerder dan `frames`
  weiger(F - 30, goed.filter((i) => i[0] < F - 30), 'nocrash');       // op `frames` is er nog geen crash
});

test('checkInputs: geldige invoer geeft null', () => {
  assert.equal(R.checkInputs(100, []), null);
  assert.equal(R.checkInputs(100, [[0, 'left'], [0, 'jump'], [99, 'slide']]), null);
});

test('recorder laat pauze vallen', () => {
  const rec = R.createRecorder();
  rec.add(5, ['pause', 'jump']);
  assert.deepEqual(rec.inputs, [[5, 'jump']]);
});

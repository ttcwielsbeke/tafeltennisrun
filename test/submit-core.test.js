const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const R = require('../replay.js');
const { bot } = require('./bot.js');
const { createBoard } = require('../board.js');
const core = require('../supabase/functions/submit-run/core.js');

const { checkRequest, brusselsDate, tooFast, cleanName, MESSAGES } = core;
const SECRET = 'ab'.repeat(32);
const NOW = new Date('2026-10-18T12:00:00Z');

function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
}

// speelt een bot-run en neemt ze op; na frame 1500 reageert de bot niet meer, dus de run eindigt met een botsing
function record(seed) {
  const s = G.createGame(seed);
  const rec = R.createRecorder();
  for (let tick = 0; s.alive && tick < 20000; tick++) {
    const acts = s.frame > 1500 ? [] : bot(s);
    rec.add(s.frame, acts);
    G.step(s, acts);
  }
  assert.equal(s.alive, false);
  return { frames: s.frame, inputs: rec.inputs, score: G.scoreOf(s) };
}

function body(seed, over) {
  const r = record(seed);
  return Object.assign({
    seed, name: 'Jo', secret: SECRET, version: 1,
    frames: r.frames, inputs: r.inputs, claimed: r.score, kit: 'club'
  }, over);
}

test('geldige run: ok, score uit de herberekening', () => {
  const seed = brusselsDate(NOW);
  const r = record(seed);
  const res = checkRequest(body(seed), NOW);
  assert.equal(res.ok, true);
  assert.equal(res.run.result.score, r.score);
  assert.equal(res.run.seed, seed);
  assert.equal(res.run.secretHex, SECRET);
  assert.equal(res.run.kit, 'club');
});

test('oude spelversie: 426', () => {
  const res = checkRequest(body(brusselsDate(NOW), { version: 0 }), NOW);
  assert.deepEqual(res, { ok: false, status: 426, code: 'version', message: MESSAGES.version });
});

test('datumvenster in Brussel: vandaag en gisteren mogen, de rest niet', () => {
  const now = new Date('2026-10-18T22:30:00Z');   // 19 oktober in Brussel
  assert.equal(brusselsDate(now), '2026-10-19');
  assert.equal(checkRequest(body('2026-10-19'), now).ok, true);
  assert.equal(checkRequest(body('2026-10-18'), now).ok, true);
  const oud = checkRequest(body('2026-10-17'), now);
  assert.equal(oud.ok, false);
  assert.equal(oud.status, 400);
  assert.equal(oud.code, 'date');
  assert.equal(oud.message, MESSAGES.date);
  const morgen = checkRequest(body('2026-10-20'), now);
  assert.equal(morgen.ok, false);
  assert.equal(morgen.code, 'date');
});

test('gerommelde run wordt geweigerd; claimed is enkel informatief', () => {
  const seed = brusselsDate(NOW);
  const goed = body(seed);
  const fout = checkRequest(Object.assign({}, goed, { frames: goed.frames + 30 }), NOW);
  assert.equal(fout.ok, false);
  assert.equal(fout.status, 400);
  assert.equal(fout.code, 'replay');
  assert.equal(fout.message, MESSAGES.replay);
  const claimed = checkRequest(Object.assign({}, goed, { claimed: 999999 }), NOW);
  assert.equal(claimed.ok, true);
});

test('vormfouten: 400 format', () => {
  const seed = brusselsDate(NOW);
  const gevallen = [
    { secret: 'a'.repeat(63) },
    { secret: 'g'.repeat(64) },
    { name: '   ' },
    { name: 5 },
    { kit: 'piraat' },
    { inputs: 'nee' },
    { inputs: [[0, 'fly']] },
    { frames: 'veel' },
    { seed: 5 },
    { version: '1' }
  ];
  for (const over of gevallen) {
    const res = checkRequest(body(seed, over), NOW);
    assert.equal(res.ok, false, JSON.stringify(over));
    assert.equal(res.status, 400);
    assert.equal(res.code, 'format', JSON.stringify(over));
    assert.equal(res.message, MESSAGES.format);
  }
  assert.equal(checkRequest(null, NOW).code, 'format');
  assert.equal(checkRequest('x', NOW).code, 'format');
});

test('volgorde: vorm vóór versie vóór datum vóór herberekening', () => {
  assert.equal(checkRequest(body(brusselsDate(NOW), { version: 0, kit: 'piraat' }), NOW).code, 'format');
  assert.equal(checkRequest(body('2020-01-01', { version: 0 }), NOW).code, 'version');
  assert.equal(checkRequest(body('2020-01-01', { frames: 5, inputs: [] }), NOW).code, 'date');
});

test('namen worden opgeschoond', () => {
  const seed = brusselsDate(NOW);
  for (const [raw, want] of [['Jo ', 'Jo'], ['jo', 'jo'], [' JO', 'JO']]) {
    const res = checkRequest(body(seed, { name: raw }), NOW);
    assert.equal(res.ok, true);
    assert.equal(res.run.name, want);
    assert.equal(res.run.name.toLowerCase(), 'jo');
  }
});

test('tooFast: minstens 2 s, anders speelduur min 1 s', () => {
  const t = (secAgo) => new Date(NOW.getTime() - secAgo * 1000);
  assert.equal(tooFast(null, NOW, 600), false);
  assert.equal(tooFast(t(1), NOW, 600), true);
  assert.equal(tooFast(t(9.5), NOW, 600), false);
  assert.equal(tooFast(t(1.5), NOW, 60), true);
  assert.equal(tooFast(t(2.5), NOW, 60), false);
});

test('cleanName geeft hetzelfde als board.js', () => {
  const b = createBoard({ provider: 'local' }, memStorage(), null);
  for (const raw of ['  Jo  ', 'a\u0007b', 'x'.repeat(20), '', null, 'a   b', 'ab\u007fc']) {
    assert.equal(cleanName(raw), b.setName(raw), JSON.stringify(raw));
  }
});

test('meldingen hebben de vaste tekst', () => {
  assert.deepEqual(MESSAGES, {
    version: 'Herlaad de pagina om je score te bewaren.',
    date: 'Deze baan is niet meer open.',
    replay: 'Deze run klopt niet.',
    name: 'Deze naam is al in gebruik op een ander toestel.',
    rate: 'Even geduld…',
    error: 'Er ging iets mis bij het bewaren.',
    format: 'Deze run klopt niet.',
    copy: 'Deze run werd al ingestuurd.',
    origin: 'Deze site mag geen scores insturen.'
  });
});

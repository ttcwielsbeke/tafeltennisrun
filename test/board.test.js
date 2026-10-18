const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoard } = require('../board.js');

function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
}

test('aller tijden lokaal: per naam enkel de beste score, hoogste eerst', async () => {
  const b = createBoard({ provider: 'local', limit: 25 }, memStorage(), null);
  await b.submit({ name: 'Jo', score: 500, seed: '2026-10-11' });
  await b.submit({ name: 'Jo', score: 900, seed: '2026-10-12' });
  await b.submit({ name: 'An', score: 700, seed: '2026-10-12' });
  await b.submit({ name: 'jo', score: 300, seed: '2026-10-13' });   // zelfde naam, andere hoofdletters
  const { rows, source } = await b.allTime();
  assert.equal(source, 'local');
  assert.deepEqual(rows.map((r) => [r.name, r.score, r.seed]), [['Jo', 900, '2026-10-12'], ['An', 700, '2026-10-12']]);
});

test('aller tijden via Supabase: leest de view alltime_best, zonder extra rijen op te halen', async () => {
  let asked = '';
  const fetchFn = async (url) => {
    asked = url;
    return {
      ok: true,
      json: async () => [
        { name: 'Jo', score: 900, seed: '2026-10-12' },
        { name: 'An', score: 700, seed: '2026-10-12' }
      ]
    };
  };
  const b = createBoard({ provider: 'supabase', url: 'https://x.supabase.co', key: 'k', limit: 2 }, memStorage(), fetchFn);
  const { rows, source } = await b.allTime();
  assert.equal(source, 'supabase');
  assert.ok(asked.includes('/rest/v1/alltime_best?'), asked);
  assert.match(asked, /select=name,score,seed&order=score\.desc&limit=2$/);
  assert.deepEqual(rows.map((r) => r.name), ['Jo', 'An']);
});

test('aller tijden valt terug op lokaal als Supabase faalt', async () => {
  const fetchFn = async () => ({ ok: false, status: 500 });
  const b = createBoard({ provider: 'supabase', url: 'https://x.supabase.co', key: 'k' }, memStorage(), fetchFn);
  await b.submit({ name: 'Jo', score: 42, seed: '2026-10-18' });
  const { rows, source } = await b.allTime();
  assert.equal(source, 'local');
  assert.deepEqual(rows.map((r) => r.score), [42]);
});

/* ---------- submitRun en de views ---------- */
const CFG = { provider: 'supabase', url: 'https://x.supabase.co', key: 'k', limit: 25 };
const RUN = { seed: '2026-10-18', name: 'Jo', secret: 's3cret', version: 2, frames: 100, inputs: [], claimed: 321, kit: 'x' };
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('submitRun: 200 geeft de score van de server terug en post naar de Edge Function', async () => {
  let call;
  const fetchFn = async (url, init) => {
    call = { url, init };
    return jsonRes(200, { ok: true, score: 320, personalBest: 320, todayBest: 400, newBest: false });
  };
  const store = memStorage();
  const b = createBoard(CFG, store, fetchFn);
  const r = await b.submitRun(RUN);
  assert.deepEqual(r, { ok: true, score: 320, personalBest: 320, todayBest: 400, newBest: false, source: 'supabase' });
  assert.equal(call.url, 'https://x.supabase.co/functions/v1/submit-run');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.apikey, 'k');
  assert.equal(call.init.headers.Authorization, 'Bearer k');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.init.body), RUN);
  const local = await createBoard({ provider: 'local' }, store, null).top('2026-10-18');
  assert.deepEqual(local.rows.map((x) => [x.name, x.score]), [['Jo', 321]], 'eerst lokaal bewaard');
});

test('submitRun: 409 met JSON geeft code en bericht van de server door', async () => {
  const msg = 'Deze naam is al in gebruik op een ander toestel.';
  const fetchFn = async () => jsonRes(409, { ok: false, code: 'name', message: msg });
  const b = createBoard(CFG, memStorage(), fetchFn);
  const r = await b.submitRun(RUN);
  assert.deepEqual(r, { ok: false, code: 'name', message: msg, source: 'supabase' });
});

test('submitRun: netwerkfout geeft een lokaal resultaat en de score staat lokaal', async () => {
  const fetchFn = async () => { throw new TypeError('Failed to fetch'); };
  const store = memStorage();
  const b = createBoard(CFG, store, fetchFn);
  const r = await b.submitRun(RUN);
  assert.deepEqual(r, { ok: true, score: 321, source: 'local', offline: true });
  const { rows } = await createBoard({ provider: 'local' }, store, null).top('2026-10-18');
  assert.deepEqual(rows.map((x) => [x.name, x.score]), [['Jo', 321]]);
});

test('submitRun: onleesbaar antwoord of 5xx zonder JSON telt als offline', async () => {
  const bad = async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } });
  const r = await createBoard(CFG, memStorage(), bad).submitRun(RUN);
  assert.deepEqual(r, { ok: true, score: 321, source: 'local', offline: true });
  const odd = async () => jsonRes(200, 'geen object');
  const r2 = await createBoard(CFG, memStorage(), odd).submitRun(RUN);
  assert.deepEqual(r2, { ok: true, score: 321, source: 'local', offline: true });
});

test('submitRun: lokale provider doet geen netwerkaanroep', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return jsonRes(200, {}); };
  const store = memStorage();
  const b = createBoard({ provider: 'local' }, store, fetchFn);
  const r = await b.submitRun(Object.assign({}, RUN, { name: '', claimed: 55.7 }));
  assert.deepEqual(r, { ok: true, score: 55, source: 'local', offline: true });
  assert.equal(called, false);
  const { rows } = await b.top('2026-10-18');
  assert.deepEqual(rows.map((x) => [x.name, x.score]), [['Anoniem', 55]]);
});

test('top lokaal: per naam enkel de beste score (hoofdletters tellen niet)', async () => {
  const b = createBoard({ provider: 'local' }, memStorage(), null);
  await b.submit({ name: 'Jo', score: 900, seed: '2026-10-18' });
  await b.submit({ name: 'jo', score: 500, seed: '2026-10-18' });
  await b.submit({ name: 'An', score: 700, seed: '2026-10-18' });
  const { rows, source } = await b.top('2026-10-18');
  assert.equal(source, 'local');
  assert.deepEqual(rows.map((r) => [r.name, r.score]), [['Jo', 900], ['An', 700]]);
});

test('top via Supabase: leest de view daily_best', async () => {
  let asked = '';
  const fetchFn = async (url) => { asked = url; return jsonRes(200, [{ name: 'Jo', score: 9, created_at: 't' }]); };
  const b = createBoard(CFG, memStorage(), fetchFn);
  const { rows, source } = await b.top('2026-10-18');
  assert.equal(source, 'supabase');
  assert.ok(asked.includes('/rest/v1/daily_best?'), asked);
  assert.ok(asked.includes('select=name,score,created_at&seed=eq.2026-10-18&order=score.desc&limit=25'), asked);
  assert.equal(rows.length, 1);
});

test('best via Supabase: eerste rij van alltime_best', async () => {
  let asked = '';
  const fetchFn = async (url) => {
    asked = url;
    return jsonRes(200, [{ name: 'Jo', score: 9, seed: 's' }, { name: 'An', score: 8, seed: 's' }]);
  };
  const b = createBoard(CFG, memStorage(), fetchFn);
  const r = await b.best();
  assert.ok(asked.includes('/rest/v1/alltime_best?'), asked);
  assert.deepEqual(r, { row: { name: 'Jo', score: 9, seed: 's' }, source: 'supabase' });
});

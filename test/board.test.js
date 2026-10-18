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

test('aller tijden via Supabase: haalt genoeg rijen op en houdt de beste per naam', async () => {
  let asked = '';
  const fetchFn = async (url) => {
    asked = url;
    return {
      ok: true,
      json: async () => [
        { name: 'Jo', score: 900, seed: '2026-10-12' },
        { name: 'Jo', score: 800, seed: '2026-10-11' },
        { name: 'An', score: 700, seed: '2026-10-12' }
      ]
    };
  };
  const b = createBoard({ provider: 'supabase', url: 'https://x.supabase.co', key: 'k', limit: 2 }, memStorage(), fetchFn);
  const { rows, source } = await b.allTime();
  assert.equal(source, 'supabase');
  assert.match(asked, /select=name,score,seed&order=score\.desc&limit=\d+/);
  assert.ok(Number(asked.match(/limit=(\d+)/)[1]) > 2, 'meer rijen ophalen dan de top, want namen komen dubbel voor');
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

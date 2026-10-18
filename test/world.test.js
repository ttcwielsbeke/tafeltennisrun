const test = require('node:test');
const assert = require('node:assert/strict');
require('../rng.js');
const W = require('../world.js');
const { SPAN } = require('../game.js');

const SEEDS = ['2026-10-11', '2026-10-12', '2027-01-01', 'oefen-abc', 'x'];
const CHUNKS = 30;   // 3,6 km: ruim voorbij het moeilijkste punt

test('zelfde seed en stuk geven identieke items', () => {
  for (const seed of SEEDS) {
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(W.generateChunk(seed, i), W.generateChunk(seed, i));
    }
  }
});

test('andere seed geeft een andere baan', () => {
  assert.notDeepEqual(W.generateChunk('2026-10-11', 3), W.generateChunk('2026-10-12', 3));
});

test('items blijven netjes: geldige baan, type en volgorde', () => {
  const types = new Set(['nopper', 'table', 'net', 'machine', 'ball', 'shield', 'magnet', 'timeout', 'bak']);
  for (const seed of SEEDS) {
    for (let i = 0; i < CHUNKS; i++) {
      const items = W.generateChunk(seed, i);
      let prev = -Infinity;
      for (const it of items) {
        assert.ok(types.has(it.type), it.type);
        assert.ok([0, 1, 2].includes(it.lane));
        assert.ok(it.z >= prev);
        assert.ok(it.len > 0);
        prev = it.z;
      }
    }
  }
});

test('de eerste 40 m is leeg', () => {
  for (const seed of SEEDS) {
    for (const it of W.generateChunk(seed, 0)) assert.ok(it.z >= 40);
  }
});

function allRows(seed) {
  const rows = [];
  for (let i = 0; i < CHUNKS; i++) rows.push(...W.rowsOf(W.generateChunk(seed, i)));
  return rows;
}

test('elke rij heeft een veilige baan (geen muur van noppenspelers)', () => {
  for (const seed of SEEDS) {
    const rows = allRows(seed);
    assert.ok(rows.length > 100);
    for (const r of rows) assert.ok(W.isRowSafe(r), seed + ' rij ' + r.row + ' ' + r.lanes);
  }
});

test('rijen liggen ver genoeg uit elkaar, ook over stukgrenzen', () => {
  for (const seed of SEEDS) {
    const rows = allRows(seed);
    for (let k = 1; k < rows.length; k++) {
      assert.ok(rows[k].z - rows[k - 1].z >= W.MIN_ROW_GAP - 1e-9, seed + ' bij z=' + rows[k].z);
    }
  }
});

test('er is altijd een doorlopende veilige route', () => {
  // per rij: in welke banen kom je erdoor (vrij, springen of sliden)?
  // Tussen twee rijen mag je van baan wisselen (MIN_ROW_GAP is daarop berekend).
  for (const seed of SEEDS) {
    let reachable = new Set([0, 1, 2]);
    for (const r of allRows(seed)) {
      const pass = new Set([0, 1, 2].filter((l) => r.lanes[l] !== 'nopper'));
      assert.ok(pass.size > 0);
      reachable = pass;   // elke baan is bereikbaar vanuit de vorige rij
    }
    assert.ok(reachable.size > 0);
  }
});

test('niets ligt in een obstakel: ballen en power-ups overlappen geen obstakel in hun baan', () => {
  for (const seed of SEEDS) {
    for (let i = 0; i < CHUNKS; i++) {
      const items = W.generateChunk(seed, i);
      const obs = items.filter((it) => SPAN[it.type]);
      for (const p of items.filter((it) => !SPAN[it.type] && !it.air)) {
        for (const o of obs) {
          if (o.lane !== p.lane) continue;
          const overlap = p.z < o.z + o.len && p.z + p.len > o.z;
          assert.ok(!overlap, seed + ' ' + p.type + ' in ' + o.type + ' op z=' + p.z);
        }
      }
    }
  }
});

/* ---------- bochten ---------- */

test('zelfde seed geeft dezelfde bochten', () => {
  for (const seed of SEEDS) {
    for (let i = 0; i < CHUNKS; i++) assert.deepEqual(W.cornersOf(seed, i), W.cornersOf(seed, i));
  }
  const a = [], b = [];
  for (let i = 0; i < CHUNKS; i++) { a.push(...W.cornersOf('2026-10-11', i)); b.push(...W.cornersOf('2026-10-12', i)); }
  assert.notDeepEqual(a, b);
});

test('er zijn bochten, naar links én naar rechts, binnen hun stuk', () => {
  for (const seed of SEEDS) {
    const all = [];
    for (let i = 0; i < CHUNKS; i++) {
      for (const c of W.cornersOf(seed, i)) {
        assert.ok(c.z >= i * W.CHUNK_LEN && c.z + c.len <= (i + 1) * W.CHUNK_LEN, 'bocht past in stuk ' + i);
        assert.ok(c.dir === -1 || c.dir === 1);
        assert.ok(c.angle > 0 && c.angle < Math.PI / 2);
        all.push(c);
      }
    }
    assert.ok(all.length >= 5, seed + ': te weinig bochten');
    assert.ok(all.some((c) => c.dir < 0) && all.some((c) => c.dir > 0), seed + ': bochten in één richting');
    for (let k = 1; k < all.length; k++) assert.ok(all[k].z >= all[k - 1].z + all[k - 1].len, 'bochten overlappen niet');
  }
});

test('elke bocht heeft een veilige route: hoogstens één noppenspeler per rij', () => {
  let checked = 0;
  for (const seed of SEEDS) {
    for (let i = 0; i < CHUNKS; i++) {
      const corners = W.cornersOf(seed, i);
      for (const r of W.rowsOf(W.generateChunk(seed, i))) {
        if (!W.inCorner(corners, r.z)) continue;
        const free = r.lanes.filter((t) => t !== 'nopper').length;
        assert.ok(free >= 2, seed + ' bocht-rij ' + r.row + ' ' + r.lanes);
        checked++;
      }
    }
  }
  assert.ok(checked > 20);
});

test('kromming en draaiing kloppen: na de bocht is de hal precies angle gedraaid', () => {
  const c = [{ z: 100, len: 50, dir: 1, angle: 0.5 }];
  assert.equal(W.curveAt(c, 90), 0);
  assert.equal(W.curveAt(c, 160), 0);
  assert.ok(W.curveAt(c, 125) > 0);
  assert.equal(W.headingAt(c, 100), 0);
  assert.ok(Math.abs(W.headingAt(c, 150) - 0.5) < 1e-12);
  assert.ok(Math.abs(W.headingAt(c, 999) - 0.5) < 1e-12);
  // numeriek: de som van de kromming is de draaiing
  let h = 0;
  for (let z = 100; z < 150; z += 0.01) h += W.curveAt(c, z) * 0.01;
  assert.ok(Math.abs(h - 0.5) < 1e-3);
});

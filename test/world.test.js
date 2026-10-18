const test = require('node:test');
const assert = require('node:assert/strict');
require('../rng.js');
const W = require('../world.js');
const { SPAN } = require('../game.js');

const SEEDS = ['2026-10-11', '2026-10-12', '2027-01-01', 'oefen-abc', 'x'];
const CHUNKS = 30;   // 3,6 km: voorbij het einde van de eerste versnelling
const LATE = 100;    // 12 km: voorbij de topsnelheid

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
  const types = new Set(['nopper', 'chopper', 'table', 'net', 'machine', 'ball', 'shield', 'magnet', 'timeout', 'bak']);
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

/* ---------- moeilijkheid die blijft stijgen ---------- */

test('verwachte snelheid: 10 m/s bij de start, 22 na ~1,9 km, nooit boven 34', () => {
  assert.equal(W.expectedSpeed(0), 10);
  assert.ok(Math.abs(W.expectedSpeed(1920) - 22) < 0.05);     // kruissnelheid na ~2 min
  assert.ok(W.expectedSpeed(6000) > 22 && W.expectedSpeed(6000) < 30);
  assert.equal(W.expectedSpeed(30000), 34);
  for (let z = 0; z < 15000; z += 250) assert.ok(W.expectedSpeed(z + 250) >= W.expectedSpeed(z));
});

test('tussen twee rijen zit altijd minstens 0,9 s, ook bij topsnelheid', () => {
  for (const seed of SEEDS) {
    const rows = [];
    for (let i = 0; i < LATE; i++) rows.push(...W.rowsOf(W.generateChunk(seed, i)));
    for (let k = 1; k < rows.length; k++) {
      const dt = (rows[k].z - rows[k - 1].z) / W.expectedSpeed(rows[k - 1].z);
      assert.ok(dt >= 0.9 - 1e-9, seed + ' bij z=' + rows[k].z + ': ' + dt.toFixed(3) + ' s');
    }
  }
});

test('later wordt het drukker: kortere tijd tussen rijen en combinatierijen', () => {
  const meanDt = (seed, from, to) => {
    const rows = [];
    for (let i = from; i < to; i++) rows.push(...W.rowsOf(W.generateChunk(seed, i)));
    let sum = 0;
    for (let k = 1; k < rows.length; k++) sum += (rows[k].z - rows[k - 1].z) / W.expectedSpeed(rows[k - 1].z);
    return sum / (rows.length - 1);
  };
  for (const seed of SEEDS) {
    assert.ok(meanDt(seed, 1, 6) > 1.8, seed + ' begin te druk');
    assert.ok(meanDt(seed, 60, 90) < 1.1, seed + ' einde niet druk genoeg');
  }
  let combos = 0;
  for (const seed of SEEDS) {
    const rows = [];
    for (let i = 30; i < LATE; i++) rows.push(...W.rowsOf(W.generateChunk(seed, i)));
    for (let k = 1; k < rows.length; k++) {
      const a = rows[k - 1].lanes, b = rows[k].lanes;
      const full = (l, t) => l.every((x) => x === t);
      if ((full(a, 'table') && full(b, 'net')) || (full(a, 'net') && full(b, 'table'))) combos++;
    }
  }
  assert.ok(combos >= 10, 'te weinig combinatierijen: ' + combos);
});

// Een bot met vaste reactietijd maakt op een eerlijke baan nooit een fout, hoe snel ook:
// "hoe lang overleeft een mens" kunnen we niet eerlijk testen. Wel meetbaar: het spel wordt
// sneller, rijen komen vlugger na elkaar, en de rijen worden gemengder.
test('na 6 minuten: sneller, rijen dicht op elkaar en vaker moeilijk (gemengd of chopper) dan na 2 minuten', () => {
  const stats = (seed, z0, z1) => {
    const rows = [];
    for (let i = Math.floor(z0 / W.CHUNK_LEN); i <= Math.ceil(z1 / W.CHUNK_LEN); i++) rows.push(...W.rowsOf(W.generateChunk(seed, i)));
    const inRange = rows.filter((r) => r.z >= z0 && r.z < z1);
    // moeilijke rij = gemengd (meer dan één soort) of met een chopper: beide dwingen een keuze af
    const mixed = inRange.filter((r) => new Set(r.lanes.filter(Boolean)).size > 1 || r.lanes.includes('chopper')).length / inRange.length;
    return { mixed, perSecond: inRange.length / ((z1 - z0) / W.expectedSpeed((z0 + z1) / 2)) };
  };
  for (const seed of SEEDS) {
    // minuut 1-2 (0,6-1,5 km; kruissnelheid zit sinds versie 2 al op 1,9 km) tegen minuut 6-7
    const early = stats(seed, 600, 1500), late = stats(seed, 9000, 12000);
    assert.ok(W.expectedSpeed(9000) > W.expectedSpeed(2400) * 1.2, 'niet sneller');
    assert.ok(late.perSecond > early.perSecond * 1.2, seed + ' niet drukker: ' + early.perSecond.toFixed(2) + ' → ' + late.perSecond.toFixed(2));
    assert.ok(late.mixed > early.mixed + 0.1, seed + ' niet gemengder: ' + early.mixed.toFixed(2) + ' → ' + late.mixed.toFixed(2));
  }
});

// De vloer van 0,9 s is het minimum, niet de regel: laat in de run variëren de rijen nog.
test('laat in de run liggen de rijen niet allemaal op de minimale afstand', () => {
  for (const seed of SEEDS) {
    const rows = [];
    for (let i = 60; i < 90; i++) rows.push(...W.rowsOf(W.generateChunk(seed, i)));
    const dts = [];
    for (let k = 1; k < rows.length; k++) dts.push((rows[k].z - rows[k - 1].z) / W.expectedSpeed(rows[k - 1].z));
    const opDeVloer = dts.filter((dt) => dt < 0.92).length / dts.length;
    // tussen de vloer en 1,2 s: niet enkel 'op de vloer' of 'de lange sprong over een stukgrens'
    const tussen = dts.filter((dt) => dt >= 0.92 && dt <= 1.2).length / dts.length;
    assert.ok(opDeVloer < 0.45, seed + ': ' + Math.round(opDeVloer * 100) + '% van de rijen op de vloer');
    assert.ok(tussen > 0.3, seed + ': te weinig variatie, ' + Math.round(tussen * 100) + '% tussen 0,92 en 1,2 s');
  }
});

test('laat in de run is een volle rij tafels of netten nooit meer gratis: altijd een combinatie', () => {
  const lateFrom = 1920;   // vanaf ~2 minuten
  let pairs = 0;
  for (const seed of SEEDS) {
    const rows = [];
    for (let i = Math.floor(lateFrom / W.CHUNK_LEN) + 1; i < LATE; i++) rows.push(...W.rowsOf(W.generateChunk(seed, i)));
    const full = (r) => r && r.lanes[0] === r.lanes[1] && r.lanes[1] === r.lanes[2] && (r.lanes[0] === 'table' || r.lanes[0] === 'net');
    const opposite = (a, b) => full(a) && full(b) && a.lanes[0] !== b.lanes[0];
    for (let k = 1; k < rows.length - 1; k++) {
      if (!full(rows[k])) continue;
      const paired = opposite(rows[k - 1], rows[k]) || opposite(rows[k], rows[k + 1]);
      assert.ok(paired, seed + ': losse volle rij op z=' + rows[k].z);
      pairs++;
    }
  }
  assert.ok(pairs >= 20, 'te weinig combinaties: ' + pairs);
});

/* ---------- chopper en baas ---------- */

function itemsUpTo(seed, chunks) {
  const out = [];
  for (let i = 0; i < chunks; i++) out.push(...W.generateChunk(seed, i));
  return out;
}

test('chopper: pas na 2 minuten, naar een buurbaan, klaar met bewegen ≥ 1 s voor je er bent', () => {
  let total = 0;
  for (const seed of SEEDS) {
    const choppers = itemsUpTo(seed, LATE).filter((it) => it.type === 'chopper');
    for (const c of choppers) {
      // gewone rijen: pas na 2 minuten (de baas op 2 km heeft er wel een)
      if (!c.boss) assert.ok(c.z > 1920, seed + ': chopper te vroeg op z=' + c.z);
      assert.equal(Math.abs(c.from - c.lane), 1, 'enkel naar een buurbaan');
      assert.ok(c.moveLen > 0 && c.moveAt > c.moveLen, 'beweging heeft een lengte');
      assert.ok((c.moveAt - c.moveLen) / W.expectedSpeed(c.z) >= 1 - 1e-9, seed + ': te laat klaar op z=' + c.z);
    }
    total += choppers.length;
  }
  assert.ok(total >= 25, 'te weinig choppers: ' + total);
});

test('choppers komen vaker naarmate je verder loopt', () => {
  let early = 0, late = 0;
  for (const seed of SEEDS) {
    for (const c of itemsUpTo(seed, LATE).filter((it) => it.type === 'chopper' && !it.boss)) {
      if (c.z < 4400) early++;            // ~2-3 min
      else if (c.z >= 9400) late++;       // vanaf ~6 min, even lang stuk (2,5 km)
    }
  }
  assert.ok(late > early * 1.5, 'niet vaker later: ' + early + ' → ' + late);
});

test('een rij met een chopper laat altijd een veilige baan', () => {
  for (const seed of SEEDS) {
    for (const r of W.rowsOf(itemsUpTo(seed, LATE))) {
      if (!r.lanes.includes('chopper')) continue;
      assert.ok(W.isRowSafe(r), seed + ' rij ' + r.row + ' ' + r.lanes);
    }
  }
});

test('om de 1000 m een baas: 5 rijen, enkel baasrijen in dat stuk, telkens moeilijker', () => {
  const full = (l, t) => l.every((x) => x === t);
  for (const seed of SEEDS) {
    const items = itemsUpTo(seed, LATE);
    const rows = W.rowsOf(items);
    for (let k = 1; k <= 10; k++) {
      const boss = rows.filter((r) => items.some((it) => it.row === r.row && it.boss === k));
      assert.equal(boss.length, 5, seed + ' baas ' + k);
      assert.ok(boss[4].z < k * W.BOSS_EVERY, 'baasrijen liggen voor de baas');
      const first = boss[0].z;
      for (const r of rows) {
        if (r.z >= first && r.z <= k * W.BOSS_EVERY) assert.ok(boss.includes(r), seed + ' vreemde rij in baas ' + k + ' op z=' + r.z);
      }
      const hasChopper = boss.some((r) => r.lanes.includes('chopper'));
      const hasCombo = boss.some((r, i) => i > 0 && ((full(boss[i - 1].lanes, 'table') && full(r.lanes, 'net')) || (full(boss[i - 1].lanes, 'net') && full(r.lanes, 'table'))));
      if (k === 1) assert.ok(!hasChopper, 'eerste baas: opwarmer zonder chopper');
      if (k >= 2) assert.ok(hasChopper, 'baas ' + k + ' heeft een chopper');
      if (k >= 3) assert.ok(hasCombo, 'baas ' + k + ' heeft een combinatie');
      for (const r of boss) assert.ok(W.isRowSafe(r));
    }
  }
});

/* ---------- versie 4: schaarse power-ups en verlengingen na 6 minuten ---------- */

// afstand waarop je na t seconden bent (bij de verwachte snelheid)
function zAt(t) {
  let lo = 0, hi = 30000;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (W.expectedTime(m) < t) lo = m; else hi = m; }
  return lo;
}
const OVER = 140;   // stukken: ruim voorbij 9 minuten
function perMinute(seed, t0, t1, pick) {
  const z0 = zAt(t0), z1 = zAt(t1);
  let n = 0;
  for (let i = Math.floor(z0 / W.CHUNK_LEN); i <= Math.ceil(z1 / W.CHUNK_LEN); i++) {
    for (const it of W.generateChunk(seed, i)) if (it.z >= z0 && it.z < z1 && pick(it)) n++;
  }
  return n / ((t1 - t0) / 60);
}

test('power-ups worden schaarser: laat hoogstens ~4 per minuut, schilden hoogstens ~0,6', () => {
  const pu = new Set(['shield', 'magnet', 'timeout', 'bak']);
  let all = 0, shields = 0, early = 0;
  for (const seed of SEEDS) {
    all += perMinute(seed, 360, 540, (it) => pu.has(it.type));
    shields += perMinute(seed, 360, 540, (it) => it.type === 'shield');
    early += perMinute(seed, 60, 180, (it) => pu.has(it.type));
  }
  all /= SEEDS.length; shields /= SEEDS.length; early /= SEEDS.length;
  assert.ok(all <= 4, 'te veel power-ups laat: ' + all.toFixed(1) + '/min');
  assert.ok(shields <= 0.6, 'te veel schilden laat: ' + shields.toFixed(2) + '/min');
  assert.ok(early > all, 'vroeg meer power-ups dan laat');
});

test('verlengingen: tussen minuut 6 en 9 wordt het nog steeds moeilijker', () => {
  assert.ok(W.expectedSpeed(zAt(540)) > W.expectedSpeed(zAt(360)) * 1.08, 'niet sneller na 6 minuten');
  let pairs67 = 0, pairs89 = 0;
  const chopWithNopper = (seed, t0, t1) => {
    const z0 = zAt(t0), z1 = zAt(t1), rows = [];
    for (let i = Math.floor(z0 / W.CHUNK_LEN); i <= Math.ceil(z1 / W.CHUNK_LEN); i++) rows.push(...W.rowsOf(W.generateChunk(seed, i)));
    return rows.filter((r) => r.z >= z0 && r.z < z1 && r.lanes.includes('chopper') && r.lanes.includes('nopper')).length;
  };
  for (const seed of SEEDS) {
    pairs67 += chopWithNopper(seed, 360, 420);
    pairs89 += chopWithNopper(seed, 480, 540);
  }
  assert.ok(pairs89 > pairs67, 'niet meer chopper+noppenspeler-rijen: ' + pairs67 + ' → ' + pairs89);
});

test('vanaf de 7e baas: minstens twee choppers en een combinatie', () => {
  const full = (l, t) => l.every((x) => x === t);
  for (const seed of SEEDS) {
    const items = [];
    for (let i = 0; i < OVER; i++) items.push(...W.generateChunk(seed, i));
    const rows = W.rowsOf(items);
    for (let k = 7; k <= 12; k++) {
      const boss = rows.filter((r) => items.some((it) => it.row === r.row && it.boss === k));
      assert.equal(boss.length, 5, seed + ' baas ' + k);
      const choppers = items.filter((it) => it.boss === k && it.type === 'chopper').length;
      assert.ok(choppers >= 2, seed + ' baas ' + k + ': ' + choppers + ' choppers');
      assert.ok(boss.some((r, i) => i > 0 && ((full(boss[i - 1].lanes, 'table') && full(r.lanes, 'net')) || (full(boss[i - 1].lanes, 'net') && full(r.lanes, 'table')))));
    }
  }
});

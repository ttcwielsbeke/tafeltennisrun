/* ============================================================
   Tafeltennisrun — de baan
   Pure functies: seed + stuknummer → obstakels, ballen en
   power-ups. Geen DOM, geen klok, geen Math.random.
   ============================================================ */
(function (root) {
  const TTR = root.TTR = root.TTR || {};
  const makeRng = TTR.makeRng || (typeof require === 'function' && require('./rng.js').makeRng);

  const CHUNK_LEN = 120;      // meter per stuk baan
  const MIN_ROW_GAP = 16;     // twee baanwissels of een volle sprong bij topsnelheid
  const START_FREE = 40;      // de eerste 40 m is leeg: even op gang komen
  const LEN = { nopper: 0.6, table: 1.5, net: 0.2, machine: 0.8, ball: 0.3, shield: 0.5, magnet: 0.5 };

  const lerp = (a, b, t) => a + (b - a) * t;
  const round1 = (v) => Math.round(v * 10) / 10;

  // Rij-patronen: [type baan 0, baan 1, baan 2], null = vrij.
  // 'min' = vanaf welke moeilijkheid (0..1) het patroon mag komen.
  function rowPattern(rng, d) {
    const L = rng.int(3);
    const others = [0, 1, 2].filter((l) => l !== L);
    const lanes = [null, null, null];
    const options = [
      { w: 4, min: 0, make() { lanes[L] = 'nopper'; } },
      { w: 3, min: 0, make() { lanes[0] = lanes[1] = lanes[2] = 'table'; } },
      { w: 3, min: 0, make() { lanes[0] = lanes[1] = lanes[2] = 'net'; } },
      { w: 2, min: 0, make() { lanes[L] = 'machine'; } },
      { w: 4, min: 0.1, make() { lanes[others[0]] = lanes[others[1]] = 'nopper'; } },
      { w: 3, min: 0.2, make() { lanes[L] = 'nopper'; for (const o of others) lanes[o] = 'table'; } },
      { w: 3, min: 0.3, make() { lanes[L] = 'nopper'; for (const o of others) lanes[o] = 'net'; } },
      { w: 3, min: 0.4, make() {
          const kinds = ['nopper', 'table', 'net', 'machine', null];
          for (let i = 0; i < 3; i++) lanes[i] = rng.pick(kinds);
          if (lanes.every((t) => t === 'nopper')) lanes[L] = rng.pick(['table', 'net', null]);
        } }
    ].filter((o) => d >= o.min);
    let total = 0;
    for (const o of options) total += o.w;
    let r = rng.next() * total;
    for (const o of options) { r -= o.w; if (r < 0) { o.make(); break; } }
    if (lanes.every((t) => t === null)) lanes[L] = 'nopper';
    return lanes;
  }

  function generateChunk(seed, index) {
    const rng = makeRng(seed + '#' + index);
    const d = Math.min(1, index / 12);           // moeilijkheid: na ~1,4 km op het maximum
    const start = index * CHUNK_LEN;
    const end = start + CHUNK_LEN;
    const items = [];
    let n = 0;
    const add = (it) => { it.id = index + '-' + (n++); items.push(it); return it; };

    // rijen op minstens MIN_ROW_GAP van elkaar, ook over de grens tussen twee stukken
    let z = start + (index === 0 ? START_FREE : MIN_ROW_GAP / 2) + rng.next() * 6;
    while (z <= end - MIN_ROW_GAP / 2) {
      const rowZ = round1(z);
      const row = index + ':' + rowZ;
      const lanes = rowPattern(rng, d);
      lanes.forEach((type, lane) => {
        if (type) add({ type, lane, z: rowZ, len: LEN[type], row });
      });

      const gap = Math.max(MIN_ROW_GAP, lerp(30, 17, d) + rng.next() * lerp(14, 6, d));

      // een bal boven een tafel, voor wie durft te springen
      const tableLane = lanes.indexOf('table');
      if (tableLane >= 0 && rng.chance(0.5)) {
        add({ type: 'ball', lane: tableLane, z: round1(rowZ + 0.6), len: LEN.ball, air: true });
      }

      // een rij ballen na de rij, in een baan die bij deze rij vrij of springbaar is
      const ballLane = rng.int(3);
      if (rng.chance(0.7)) {
        const first = rowZ + 3;
        const count = 3 + rng.int(3);
        for (let i = 0; i < count; i++) {
          const bz = first + i * 2.2;
          if (bz + LEN.ball > rowZ + gap - 2) break;
          add({ type: 'ball', lane: ballLane, z: round1(bz), len: LEN.ball });
        }
      }

      // af en toe een power-up, midden tussen twee rijen, in een andere baan dan de ballen
      const p = rng.next();
      if (p < 0.16 && index > 0) {
        const lane = (ballLane + 1 + rng.int(2)) % 3;
        add({ type: p < 0.08 ? 'shield' : 'magnet', lane, z: round1(rowZ + gap / 2), len: LEN.shield });
      }

      z += gap;
    }

    items.sort((a, b) => a.z - b.z || a.lane - b.lane);
    return items;
  }

  // groepeer obstakels per rij: { row, z, lanes: [type|null ×3] }
  function rowsOf(items) {
    const map = new Map();
    for (const it of items) {
      if (!it.row) continue;
      let r = map.get(it.row);
      if (!r) { r = { row: it.row, z: it.z, lanes: [null, null, null] }; map.set(it.row, r); }
      r.lanes[it.lane] = it.type;
    }
    return [...map.values()].sort((a, b) => a.z - b.z);
  }

  // veilig = minstens één baan zonder noppenspeler (tafel = springen, net = sliden)
  function isRowSafe(row) {
    return row.lanes.some((t) => t !== 'nopper');
  }

  TTR.CHUNK_LEN = CHUNK_LEN;
  TTR.MIN_ROW_GAP = MIN_ROW_GAP;
  TTR.ITEM_LEN = LEN;
  TTR.generateChunk = generateChunk;
  TTR.rowsOf = rowsOf;
  TTR.isRowSafe = isRowSafe;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CHUNK_LEN, MIN_ROW_GAP, ITEM_LEN: LEN, generateChunk, rowsOf, isRowSafe };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ============================================================
   Tafeltennisrun — de baan
   Pure functies: seed + stuknummer → obstakels, ballen en
   power-ups. Geen DOM, geen klok, geen Math.random.
   ============================================================ */
(function (root) {
  const TTR = root.TTR = root.TTR || {};
  const makeRng = TTR.makeRng || (typeof require === 'function' && require('./rng.js').makeRng);

  const CHUNK_LEN = 120;      // meter per stuk baan
  const MIN_ROW_GAP = 18;     // twee baanwissels of een volle sprong bij topsnelheid
  const START_FREE = 40;      // de eerste 40 m is leeg: even op gang komen
  const LEN = { nopper: 0.6, table: 1.5, net: 0.2, machine: 0.8, ball: 0.3, shield: 0.5, magnet: 0.5, timeout: 0.5, bak: 0.5 };

  const CFG = (root.TTR_CONFIG && root.TTR_CONFIG.game) ||
    (typeof require === 'function' ? require('./config.js').game : {});
  const MIN_ROW_TIME = 0.9;   // seconden tussen twee rijen, minstens: langer dan een sprong (0,82 s)

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* ---------- verwachte snelheid op afstand z ----------
     De snelheid hangt enkel van de afstand af (een time-out maakt het alleen
     makkelijker): v² = v0² + 2·a·z, eerst met accel tot cruiseSpeed, dan met
     lateAccel tot maxSpeed. Math.sqrt is exact afgerond (IEEE 754): overal gelijk. */
  function speedPhases() {
    const v0 = CFG.startSpeed, a1 = CFG.accel, vc = CFG.cruiseSpeed, a2 = CFG.lateAccel, vm = CFG.maxSpeed;
    const z1 = (vc * vc - v0 * v0) / (2 * a1);
    const z2 = z1 + (vm * vm - vc * vc) / (2 * a2);
    return { v0, a1, vc, a2, vm, z1, z2 };
  }
  function expectedSpeed(z) {
    const p = speedPhases();
    if (z <= p.z1) return Math.sqrt(p.v0 * p.v0 + 2 * p.a1 * z);
    if (z >= p.z2) return p.vm;
    return Math.sqrt(p.vc * p.vc + 2 * p.a2 * (z - p.z1));
  }
  // seconden sinds de start, bij die verwachte snelheid
  function expectedTime(z) {
    const p = speedPhases(), v = expectedSpeed(z);
    if (z <= p.z1) return (v - p.v0) / p.a1;
    const t1 = (p.vc - p.v0) / p.a1;
    if (z < p.z2) return t1 + (v - p.vc) / p.a2;
    return t1 + (p.vm - p.vc) / p.a2 + (z - p.z2) / p.vm;
  }
  // 'laat' = 0 tot 3 minuten, dan oplopend tot 1 na 6 minuten: drukker, moeilijkere patronen, combinaties
  function lateness(z) { return clamp01((expectedTime(z) - 180) / 180); }
  // minimale afstand tussen rijen bij snelheid v (+0,15 m: afronding van z op 0,1 m)
  function minGap(v) { return Math.max(MIN_ROW_GAP, v * MIN_ROW_TIME + 0.15); }
  const round1 = (v) => Math.round(v * 10) / 10;

  // Rij-patronen: [type baan 0, baan 1, baan 2], null = vrij.
  // 'min' = vanaf welke moeilijkheid (0..1) het patroon mag komen.
  function rowPattern(rng, d, late) {
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
    // later: minder losse noppenspelers, meer gemengde rijen
    if (late > 0) for (const o of options) o.w *= o.min >= 0.2 ? 1 + 4 * late : o.min === 0 && o.w === 4 ? 1 - 0.6 * late : 1;
    let total = 0;
    for (const o of options) total += o.w;
    let r = rng.next() * total;
    for (const o of options) { r -= o.w; if (r < 0) { o.make(); break; } }
    if (lanes.every((t) => t === null)) lanes[L] = 'nopper';
    return lanes;
  }

  /* ---------- bochten ----------
     Een bocht verandert enkel de richting van de hal, niet de banen:
     links/rechts blijft baan wisselen. Per stuk hoogstens één bocht,
     volledig binnen het stuk. Eigen random-stroom, zodat bochten de
     obstakels niet door elkaar schudden.
     Corner = { z, len, dir: -1 (links) | 1 (rechts), angle: radialen }  */
  const CORNER_MARGIN = 12;   // rijen tot zoveel meter vóór de bocht tellen als 'in de bocht'

  function cornersOf(seed, index) {
    if (index === 0) return [];                  // eerst rustig rechtdoor
    const rng = makeRng(seed + '#bocht#' + index);
    if (!rng.chance(0.55)) return [];
    const len = 40 + rng.int(25);                // 40..64 m
    const start = index * CHUNK_LEN;
    const z = round1(start + 10 + rng.next() * (CHUNK_LEN - len - 20));
    const dir = rng.chance(0.5) ? -1 : 1;
    const angle = 0.35 + rng.next() * 0.35;      // 20..40 graden
    return [{ z, len, dir, angle }];
  }

  // kromming (1/m) op afstand z: zacht in, zacht uit, met als totaal precies 'angle'
  function curveAt(corners, z) {
    let k = 0;
    for (const c of corners) {
      if (z < c.z || z > c.z + c.len) continue;
      const t = (z - c.z) / c.len;
      k += c.dir * (c.angle / c.len) * (1 - Math.cos(2 * Math.PI * t));
    }
    return k;
  }

  // totale draaiing (radialen) van de start tot z: voor het achtergrond-panorama
  function headingAt(corners, z) {
    let h = 0;
    for (const c of corners) {
      if (z <= c.z) continue;
      const t = Math.min(1, (z - c.z) / c.len);
      h += c.dir * c.angle * (t - Math.sin(2 * Math.PI * t) / (2 * Math.PI));
    }
    return h;
  }

  function inCorner(corners, z) {
    return corners.some((c) => z >= c.z - CORNER_MARGIN && z <= c.z + c.len);
  }

  function generateChunk(seed, index) {
    const rng = makeRng(seed + '#' + index);
    const corners = cornersOf(seed, index);
    const d = Math.min(1, index / 12);           // moeilijkheid: na ~1,4 km op het maximum
    const start = index * CHUNK_LEN;
    const end = start + CHUNK_LEN;
    const items = [];
    let n = 0;
    const add = (it) => { it.id = index + '-' + (n++); items.push(it); return it; };

    // rijen op minstens MIN_ROW_GAP van elkaar, ook over de grens tussen twee stukken
    // aan elke stukgrens telt de helft van de minimale afstand bij de snelheid daar
    let z = start + (index === 0 ? START_FREE : minGap(expectedSpeed(start)) / 2) + rng.next() * 6;
    const endHalf = minGap(expectedSpeed(end)) / 2;
    let forced = null;                           // tweede rij van een combinatie
    while (z <= end - endHalf) {
      const rowZ = round1(z);
      const row = index + ':' + rowZ;
      const v = expectedSpeed(rowZ), late = lateness(rowZ);
      const lanes = forced ? [forced, forced, forced] : rowPattern(rng, d, late);
      const wasForced = !!forced;
      forced = null;
      // in een bocht hoogstens één noppenspeler: twee veilige banen, de bocht leest al moeilijk genoeg
      if (inCorner(corners, rowZ)) {
        let seen = 0;
        for (let l = 0; l < 3; l++) if (lanes[l] === 'nopper' && ++seen > 1) lanes[l] = null;
      }
      lanes.forEach((type, lane) => {
        if (type) add({ type, lane, z: rowZ, len: LEN[type], row });
      });

      // afstand tot de volgende rij: eerst in meter zoals altijd, later in tijd bij de verwachte snelheid
      const r = rng.next();
      let gap = Math.max(MIN_ROW_GAP, lerp(30, 19, d) + r * lerp(14, 6, d));
      if (late > 0) gap = v * lerp(1.0, 0.82, late) * (0.85 + 0.3 * r);
      // combinatie: springen en meteen sliden (of omgekeerd), op de kortste veilige afstand
      const full = lanes[0] === lanes[1] && lanes[1] === lanes[2] && (lanes[0] === 'table' || lanes[0] === 'net');
      if (late > 0 && full && !wasForced && rng.chance(0.15 + 0.6 * late)) {
        forced = lanes[0] === 'table' ? 'net' : 'table';
        gap = 0;
      }
      gap = Math.max(gap, minGap(v));

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
      if (p < 0.2 && index > 0) {
        const lane = (ballLane + 1 + rng.int(2)) % 3;
        const type = p < 0.055 ? 'shield' : p < 0.11 ? 'magnet' : p < 0.155 ? 'timeout' : 'bak';
        add({ type, lane, z: round1(rowZ + gap / 2), len: LEN[type] });
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

  TTR.cornersOf = cornersOf;
  TTR.curveAt = curveAt;
  TTR.headingAt = headingAt;
  TTR.inCorner = inCorner;
  TTR.CHUNK_LEN = CHUNK_LEN;
  TTR.MIN_ROW_GAP = MIN_ROW_GAP;
  TTR.ITEM_LEN = LEN;
  TTR.generateChunk = generateChunk;
  TTR.expectedSpeed = expectedSpeed;
  TTR.expectedTime = expectedTime;
  TTR.rowsOf = rowsOf;
  TTR.isRowSafe = isRowSafe;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CHUNK_LEN, MIN_ROW_GAP, MIN_ROW_TIME, ITEM_LEN: LEN, generateChunk, rowsOf, isRowSafe,
      cornersOf, curveAt, headingAt, inCorner, expectedSpeed, expectedTime };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

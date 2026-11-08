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
  const LEN = { nopper: 0.6, chopper: 0.6, table: 1.5, net: 0.2, machine: 0.8, ball: 0.3, shield: 0.5, magnet: 0.5, timeout: 0.5, bak: 0.5 };

  const CFG = (root.TTR_CONFIG && root.TTR_CONFIG.game) ||
    (typeof require === 'function' ? require('./config.js').game : {});
  // seconden tussen twee rijen, minstens, bij de verwachte snelheid. Langer dan een sprong (0,82 s):
  // de 0,08 s marge vangt ook op dat wie time-outs nam iets sneller loopt dan verwacht (zie hieronder).
  const MIN_ROW_TIME = 0.9;

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* ---------- verwachte snelheid op afstand z ----------
     Zonder time-outs hangt de snelheid enkel van de afstand af: v² = v0² + 2·a·z,
     eerst met accel tot cruiseSpeed, dan met lateAccel tot maxSpeed.
     De onderliggende snelheid groeit per seconde, niet per meter. Tijdens een
     time-out loop je trager maar versnelt ze gewoon door: wie time-outs nam, komt
     later op een plek z en loopt daar dus sneller dan expectedSpeed(z) (gemeten
     tot ~0,5 m/s). De rijen komen dan iets vlugger; de marge tussen MIN_ROW_TIME
     (0,9 s) en een sprong (0,82 s) vangt dat op.
     Math.sqrt is exact afgerond (IEEE 754): overal gelijk. */
  // drie fasen: tot kruissnelheid, tot lateSpeed, en de verlengingen tot maxSpeed
  function speedPhases() {
    const v0 = CFG.startSpeed, a1 = CFG.accel, vc = CFG.cruiseSpeed, a2 = CFG.lateAccel, vl = CFG.lateSpeed,
      a3 = CFG.overAccel, vm = CFG.maxSpeed;
    const z1 = (vc * vc - v0 * v0) / (2 * a1);
    const z2 = z1 + (vl * vl - vc * vc) / (2 * a2);
    const z3 = z2 + (vm * vm - vl * vl) / (2 * a3);
    return { v0, a1, vc, a2, vl, a3, vm, z1, z2, z3 };
  }
  function expectedSpeed(z) {
    const p = speedPhases();
    if (z <= p.z1) return Math.sqrt(p.v0 * p.v0 + 2 * p.a1 * z);
    if (z <= p.z2) return Math.sqrt(p.vc * p.vc + 2 * p.a2 * (z - p.z1));
    if (z >= p.z3) return p.vm;
    return Math.sqrt(p.vl * p.vl + 2 * p.a3 * (z - p.z2));
  }
  // seconden sinds de start, bij die verwachte snelheid
  function expectedTime(z) {
    const p = speedPhases(), v = expectedSpeed(z);
    if (z <= p.z1) return (v - p.v0) / p.a1;
    const t1 = (p.vc - p.v0) / p.a1;
    if (z <= p.z2) return t1 + (v - p.vc) / p.a2;
    const t2 = t1 + (p.vl - p.vc) / p.a2;
    if (z < p.z3) return t2 + (v - p.vl) / p.a3;
    return t2 + (p.vm - p.vl) / p.a3 + (z - p.z3) / p.vm;
  }
  // 'laat' = 0 tot 2 minuten, dan oplopend tot 1 na 5 minuten: drukker, moeilijkere patronen, combinaties
  function lateness(z) { return clamp01((expectedTime(z) - 120) / 180); }
  // 'verlengingen' = 0 tot 6 minuten, dan oplopend tot 1 na 9 minuten: het blijft moeilijker worden
  function overtime(z) { return clamp01((expectedTime(z) - 360) / 180); }
  // 'eindspurt' = 0 tot 8 minuten, dan oplopend tot 1 na 10 minuten: geen schilden meer en meer obstakels per rij
  const ENDGAME_FROM = 480;
  function endgame(z) { return clamp01((expectedTime(z) - ENDGAME_FROM) / 120); }
  // minimale afstand tussen rijen bij snelheid v (+0,15 m: afronding van z op 0,1 m)
  function minGap(v) { return Math.max(MIN_ROW_GAP, v * MIN_ROW_TIME + 0.15); }
  const round1 = (v) => Math.round(v * 10) / 10;

  // Rij-patronen: [type baan 0, baan 1, baan 2], null = vrij.
  // 'min' = vanaf welke moeilijkheid (0..1) het patroon mag komen.
  function rowPattern(rng, d, late, ot, eg) {
    const L = rng.int(3);
    const others = [0, 1, 2].filter((l) => l !== L);
    const lanes = [null, null, null];
    const options = [
      { w: 4, min: 0, single: true, make() { lanes[L] = 'nopper'; } },
      { w: 3, min: 0, make() { lanes[0] = lanes[1] = lanes[2] = 'table'; } },
      { w: 3, min: 0, make() { lanes[0] = lanes[1] = lanes[2] = 'net'; } },
      { w: 2, min: 0, single: true, make() { lanes[L] = 'machine'; } },
      { w: 4, min: 0.1, twoNop: true, make() { lanes[others[0]] = lanes[others[1]] = 'nopper'; } },
      { w: 3, min: 0.2, make() { lanes[L] = 'nopper'; for (const o of others) lanes[o] = 'table'; } },
      { w: 3, min: 0.3, make() { lanes[L] = 'nopper'; for (const o of others) lanes[o] = 'net'; } },
      // chopper: een verdediger die opschuift naar een buurbaan (pas na 2 minuten). De baan waar hij
      // vertrekt is vrij als je er bent; soms staat er in de derde baan nog een noppenspeler.
      { w: 0.5 + 3 * late + 2 * ot, min: 0.4, late: true, make() {    // steeds vaker naarmate je verder loopt
          const to = L === 1 ? (rng.chance(0.5) ? 0 : 2) : 1;
          lanes[to] = 'chopper';
          lanes.chopperFrom = L;
          const third = 3 - L - to;
          if (rng.chance(0.5 * late + 0.5 * ot)) lanes[third] = 'nopper';
        } },
      { w: 3, min: 0.4, make() {
          const kinds = ['nopper', 'table', 'net', 'machine', null];
          for (let i = 0; i < 3; i++) lanes[i] = rng.pick(kinds);
          if (lanes.every((t) => t === 'nopper')) lanes[L] = rng.pick(['table', 'net', null]);
        } }
    ].filter((o) => d >= o.min && (!o.late || late > 0));
    // later: minder losse noppenspelers, meer gemengde rijen
    // (twee noppenspelers en gemengde rijen dwingen een keuze af; volle rijen worden later altijd een combinatie)
    if (late > 0) for (const o of options) o.w *= o.min >= 0.1 ? 1 + 4 * late : o.w === 4 ? 1 - 0.6 * late : 1 - 0.3 * late;
    // eindspurt: nog minder rijen met één obstakel, nog meer rijen met twee of drie,
    // vooral twee noppenspelers (de vrije baan krijgt dan vaak nog een tafel of net, zie onder)
    if (eg > 0) for (const o of options) o.w *= o.single ? 1 - 0.7 * eg : o.twoNop ? 1 + 3 * eg : o.min >= 0.1 ? 1 + 1.5 * eg : 1;
    let total = 0;
    for (const o of options) total += o.w;
    let r = rng.next() * total;
    for (const o of options) { r -= o.w; if (r < 0) { o.make(); break; } }
    if (lanes.every((t) => t === null)) lanes[L] = 'nopper';
    // eindspurt: staat er in de enige veilige baan niets, dan steeds vaker een tafel of net.
    // Opzij én springen of sliden: van baan wisselen kan ook in de lucht. Niet bij een chopper,
    // die vertrekt uit die vrije baan.
    if (eg > 0 && lanes.chopperFrom === undefined) {
      const safe = [0, 1, 2].filter((l) => lanes[l] !== 'nopper');
      if (safe.length === 1 && lanes[safe[0]] === null && rng.chance(0.7 * eg)) lanes[safe[0]] = rng.pick(['table', 'net']);
    }
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

  /* ---------- chopper ----------
     Hij schuift op naar zijn eindbaan (it.lane) wanneer je nog moveAt meter weg bent; dat duurt
     moveLen meter. Klaar met bewegen minstens 1 s voor je er bent: tijd om te reageren. */
  const CHOPPER_REACT = 1.05, CHOPPER_SHUFFLE = 0.4;   // seconden
  function chopperItem(lane, from, z, row, v, extra) {
    const moveLen = round1(v * CHOPPER_SHUFFLE);
    return Object.assign({ type: 'chopper', lane, from, z, len: LEN.chopper, row,
      moveLen, moveAt: round1(v * CHOPPER_REACT + moveLen + 0.1) }, extra || {});
  }

  /* ---------- baas: de clubkampioen, om de 1000 m ----------
     Vijf vaste rijen vlak voor elke 1000 m, telkens moeilijker. Ze hangen enkel af van seed en k,
     dus elk stuk baan kan ze zelf uitrekenen. Gewone rijen blijven buiten de zone eromheen. */
  const BOSS_EVERY = CFG.bossEvery || 1000, BOSS_ROWS = 5, BOSS_LEAD = 15;
  function bossPlan(seed, k) {
    const rng = makeRng(seed + '#baas#' + k);
    const at = k * BOSS_EVERY;
    const zs = [at - BOSS_LEAD];
    while (zs.length < BOSS_ROWS) {
      const next = zs[0], v = expectedSpeed(next);
      zs.unshift(round1(next - Math.max(minGap(v), v * 1.15)));
    }
    const L = () => rng.int(3);
    const nb = (l) => (l === 1 ? (rng.chance(0.5) ? 0 : 2) : 1);
    const one = (t) => { const l = [null, null, null]; l[L()] = t; return l; };
    const two = () => { const l = ['nopper', 'nopper', 'nopper']; l[L()] = null; return l; };
    const all = (t) => [t, t, t];
    const mixed = (t) => { const l = [t, t, t]; l[L()] = 'nopper'; return l; };
    const chop = (withNopper) => {
      const from = L(), to = nb(from), l = [null, null, null];
      l[to] = 'chopper'; l.chopperFrom = from;
      if (withNopper) l[3 - from - to] = 'nopper';
      return l;
    };
    let rows;
    if (k === 1) rows = [one('nopper'), all('table'), two(), all('net'), mixed('table')];
    else if (k === 2) rows = [two(), chop(false), all('table'), mixed('net'), two()];
    else {
      const first = rng.chance(0.5) ? 'table' : 'net';
      rows = [k >= 7 ? chop(true) : two(), chop(true), all(first), all(first === 'table' ? 'net' : 'table'), k >= 5 ? chop(true) : mixed('table')];
    }
    const last = zs[BOSS_ROWS - 1];
    return { k, at, rows: rows.map((lanes, i) => ({ z: zs[i], lanes })),
      zoneStart: zs[0] - minGap(expectedSpeed(zs[0])), zoneEnd: Math.max(at + 1, last + minGap(expectedSpeed(last)) + 0.2) };
  }
  function bossesNear(seed, from, to) {
    const out = [];
    for (let k = Math.max(1, Math.floor(from / BOSS_EVERY)); k <= Math.floor(to / BOSS_EVERY) + 1; k++) out.push(bossPlan(seed, k));
    return out;
  }
  // hoogstens één noppenspeler of chopper in een bocht; noppenspelers gaan eerst weg
  function limitInCorner(lanes) {
    const count = () => lanes.filter((t) => t === 'nopper' || t === 'chopper').length;
    for (let l = 0; l < 3 && count() > 1; l++) if (lanes[l] === 'nopper') lanes[l] = null;
    for (let l = 0; l < 3 && count() > 1; l++) if (lanes[l] === 'chopper') lanes[l] = null;
  }

  /* Stukken van 120 m. Vroeg staat elk stuk op zichzelf: een halve minimale afstand van elke rand.
     Laat (na 2 minuten) gaat een stuk verder waar het vorige stopte: bij hoge snelheid duurt een stuk
     maar enkele seconden en zou een lege rand aan elke grens de baan merkbaar luchtiger maken.
     Daarvoor onthouden we per stuk waar de volgende rij zou komen (kleine cache, puur en deterministisch). */
  const memo = new Map();
  const MEMO_MAX = 400;
  // eerste rij van een stuk dat op zichzelf staat (de eerste trekking van zijn eigen random-stroom)
  function ownFirst(seed, j, r) {
    const s0 = j * CHUNK_LEN;
    return j === 0 ? START_FREE + r * 6 : s0 + minGap(expectedSpeed(s0)) / 2 + r * 6;
  }
  function chunkNextZ(seed, j) {
    const key = seed + '#' + j;
    if (!memo.has(key)) buildChunk(seed, j);
    return memo.get(key).nextZ;
  }
  function generateChunk(seed, index) {
    const key = seed + '#' + index;
    if (!memo.has(key)) buildChunk(seed, index);
    return memo.get(key).items.map((it) => Object.assign({}, it));
  }

  function buildChunk(seed, index) {
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
    // (laat geen willekeurige extra marge meer: bij hoge snelheid duurt een stuk maar enkele seconden)
    const r0 = rng.next();
    // gaat dit stuk verder waar het vorige stopte? (laat) Gaat het volgende stuk verder waar dit stopt?
    const continues = index > 0 && lateness((index - 1) * CHUNK_LEN) > 0;
    const handsOver = lateness(start) > 0;
    let z = continues ? chunkNextZ(seed, index - 1) : ownFirst(seed, index, r0);
    // rijen tot hier; bij doorgeven mag de laatste tot vlak voor de rand, anders een halve afstand ervan
    const lastZ = handsOver ? end - 1e-6 : end - minGap(expectedSpeed(end)) / 2;
    // de eerste rij van het volgende stuk (enkel als dat op zichzelf staat), voor ballen en power-ups
    const nextFirst = handsOver ? Infinity : ownFirst(seed, index + 1, makeRng(seed + '#' + (index + 1)).next());
    let forced = null;                           // tweede rij van een combinatie
    const bosses = bossesNear(seed, start, end);
    const zoneAt = (zz) => bosses.find((b) => zz > b.zoneStart && zz < b.zoneEnd);
    const nextBossRow = (zz) => {
      let best = Infinity;
      for (const b of bosses) for (const r of b.rows) if (r.z > zz && r.z < best) best = r.z;
      return best;
    };
    // de baasrijen die in dit stuk vallen
    for (const b of bosses) {
      b.rows.forEach((br, i) => {
        if (br.z < start || br.z >= end) return;
        const row = 'baas' + b.k + ':' + i, lanes = br.lanes.slice();
        lanes.chopperFrom = br.lanes.chopperFrom;
        if (inCorner(corners, br.z)) limitInCorner(lanes);
        lanes.forEach((type, lane) => {
          if (!type) return;
          if (type === 'chopper') add(chopperItem(lane, lanes.chopperFrom, br.z, row, expectedSpeed(br.z), { boss: b.k }));
          else add({ type, lane, z: br.z, len: LEN[type], row, boss: b.k });
        });
      });
    }
    if (zoneAt(z)) z = zoneAt(z).zoneEnd;
    while (z <= lastZ) {
      const rowZ = round1(z);
      const row = index + ':' + rowZ;
      const v = expectedSpeed(rowZ), late = lateness(rowZ), ot = overtime(rowZ), eg = endgame(rowZ);
      const lanes = forced ? [forced, forced, forced] : rowPattern(rng, d, late, ot, eg);
      const wasForced = !!forced;
      forced = null;
      // laat in de run is een volle rij tafels of netten nooit gratis: meteen de omgekeerde erachter
      // (combinatie). Past die tweede rij niet meer in dit stuk, dan maakt een noppenspeler in het
      // midden er een keuze van.
      let comboNext = null;
      const full = lanes[0] === lanes[1] && lanes[1] === lanes[2] && (lanes[0] === 'table' || lanes[0] === 'net');
      if (late > 0 && full && !wasForced) {
        if (z + minGap(v) <= lastZ && !zoneAt(z + minGap(v))) comboNext = lanes[0] === 'table' ? 'net' : 'table';
        else lanes[1] = 'nopper';
      }
      // in een bocht hoogstens één noppenspeler: twee veilige banen, de bocht leest al moeilijk genoeg
      if (inCorner(corners, rowZ)) limitInCorner(lanes);
      lanes.forEach((type, lane) => {
        if (type === 'chopper') add(chopperItem(lane, lanes.chopperFrom, rowZ, row, v));
        else if (type) add({ type, lane, z: rowZ, len: LEN[type], row });
      });

      // afstand tot de volgende rij: eerst in meter zoals altijd, later in tijd bij de verwachte snelheid
      const r = rng.next();
      let gap = Math.max(MIN_ROW_GAP, lerp(30, 19, d) + r * lerp(14, 6, d));
      // laat: 1,0..1,3 keer een doeltijd die van 0,93 s naar 0,83 s zakt (~0,83..1,08 s op het einde,
      // gemiddeld ~0,95 s); de vloer van 0,9 s is het minimum, niet de regel. In de verlengingen
      // (6 tot 9 minuten) zakt de doeltijd nog 5%, in de eindspurt (8 tot 10 minuten) nog eens 3%.
      if (late > 0) gap = v * lerp(0.93, 0.83, late) * lerp(1, 0.95, ot) * lerp(1, 0.97, eg) * (1.0 + 0.3 * r);
      // combinatie: springen en meteen sliden (of omgekeerd), op de kortste veilige afstand
      if (comboNext) {
        forced = comboNext;
        gap = 0;
      }
      gap = Math.max(gap, minGap(v));
      // ballen en power-ups blijven voor de eerstvolgende baasrij
      const itemGap = Math.min(gap, nextBossRow(rowZ) - rowZ - 1, nextFirst - rowZ - 1);

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
          if (bz + LEN.ball > rowZ + itemGap - 2) break;
          add({ type: 'ball', lane: ballLane, z: round1(bz), len: LEN.ball });
        }
      }

      // af en toe een power-up, midden tussen twee rijen, in een andere baan dan de ballen
      // power-ups worden schaarser: 1 op 8 rijen bij de start, 1 op 16 na 6 minuten.
      // Schilden het meest: een fout moet iets kosten. Na 8 minuten geen schilden meer: die plek blijft leeg.
      const p = rng.next();
      const tRow = expectedTime(rowZ), scarce = clamp01(tRow / 360);
      const chance = lerp(0.125, 0.0625, scarce);
      if (p < chance && index > 0) {
        const lane = (ballLane + 1 + rng.int(2)) % 3;
        const u = p / chance, sh = lerp(0.25, 0.12, scarce), rest = (1 - sh) / 3;
        const type = u < sh ? 'shield' : u < sh + rest ? 'magnet' : u < sh + 2 * rest ? 'timeout' : 'bak';
        if (type !== 'shield' || tRow < ENDGAME_FROM) add({ type, lane, z: round1(rowZ + itemGap / 2), len: LEN[type] });
      }

      z += gap;
      if (zoneAt(z)) z = zoneAt(z).zoneEnd;
    }

    items.sort((a, b) => a.z - b.z || a.lane - b.lane);
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
    memo.set(seed + '#' + index, { items, nextZ: z });
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
    return row.lanes.some((t) => t !== 'nopper' && t !== 'chopper');
  }

  TTR.cornersOf = cornersOf;
  TTR.curveAt = curveAt;
  TTR.headingAt = headingAt;
  TTR.inCorner = inCorner;
  TTR.CHUNK_LEN = CHUNK_LEN;
  TTR.MIN_ROW_GAP = MIN_ROW_GAP;
  TTR.ITEM_LEN = LEN;
  TTR.generateChunk = generateChunk;
  TTR.BOSS_EVERY = BOSS_EVERY;
  TTR.expectedSpeed = expectedSpeed;
  TTR.expectedTime = expectedTime;
  TTR.rowsOf = rowsOf;
  TTR.isRowSafe = isRowSafe;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CHUNK_LEN, MIN_ROW_GAP, MIN_ROW_TIME, ITEM_LEN: LEN, generateChunk, rowsOf, isRowSafe,
      cornersOf, curveAt, headingAt, inCorner, expectedSpeed, expectedTime, BOSS_EVERY };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

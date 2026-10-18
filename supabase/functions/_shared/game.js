/* ============================================================
   Tafeltennisrun — de simulatie
   Vaste stap van 1/60 s. Geen DOM, geen klok: zelfde seed +
   zelfde invoer per frame = altijd dezelfde score.
   ============================================================ */
(function (root) {
  const TTR = root.TTR = root.TTR || {};
  if (!TTR.generateChunk && typeof require === 'function') {
    Object.assign(TTR, require('./rng.js'), require('./world.js'));
  }
  const DEFAULT_CFG = (root.TTR_CONFIG && root.TTR_CONFIG.game) ||
    (typeof require === 'function' ? require('./config.js').game : {});

  const DT = 1 / 60;
  const VIEW_AHEAD = 90;     // zoveel meter vooruit houden we items klaar
  const KEEP_BEHIND = 4;     // en zoveel meter achter de speler
  const HALF_DEPTH = 0.25;   // de speler is 0,5 m diep
  const STAND_H = 1.7, SLIDE_H = 0.6;

  // hoogtebereik [onder, boven] in meter: waar je tegen botst
  const SPAN = {
    nopper:  [0, 2.0],      // over een speler spring je niet
    chopper: [0, 2.0],      // de verdediger: idem, maar hij schuift op
    table:   [0, 0.72],      // een tikje vergevingsgezind t.o.v. 0,76 m
    net:     [0.95, 2.4],    // hangt tot boven: eronder, niet erover
    machine: [1.05, 2.4]
  };

  function createGame(seed, cfg) {
    const c = Object.assign({}, DEFAULT_CFG, cfg || {});
    const s = {
      seed: String(seed), cfg: c,
      frame: 0, alive: true, crashedBy: null,
      dist: 0, speed: c.startSpeed, vel: c.startSpeed,
      lane: 1, x: 1, y: 0, vy: 0, sliding: 0,
      bossNext: c.bossEvery, balls: 0, points: 0, shield: false, magnet: 0, grace: 0, timeout: 0, bak: 0,
      items: [], corners: [], events: [], nextChunk: 0
    };
    fill(s);
    return s;
  }

  // nieuwe stukken baan inladen, en wat achter ons ligt weggooien
  function fill(s) {
    while (s.nextChunk * TTR.CHUNK_LEN < s.dist + VIEW_AHEAD) {
      for (const it of TTR.generateChunk(s.seed, s.nextChunk)) s.items.push(Object.assign({}, it));
      s.corners.push(...TTR.cornersOf(s.seed, s.nextChunk));   // bochten: enkel voor het beeld
      s.nextChunk++;
    }
    if (s.items.length && s.items[0].z + s.items[0].len < s.dist - KEEP_BEHIND) {
      s.items = s.items.filter((it) => it.z + it.len >= s.dist - KEEP_BEHIND);
    }
  }

  function step(s, actions) {
    s.events = [];
    if (!s.alive) return s;
    const c = s.cfg;

    for (const a of actions || []) {
      if (a === 'left' && s.lane > 0) { s.lane--; s.events.push('lane'); }
      else if (a === 'right' && s.lane < 2) { s.lane++; s.events.push('lane'); }
      else if (a === 'jump' && s.y <= 0 && s.vy <= 0) {
        s.vy = c.jumpVel; s.sliding = 0; s.events.push('jump');
      } else if (a === 'slide') {
        if (s.y > 0) s.vy = Math.min(s.vy, -12);   // in de lucht: snel naar beneden
        if (!s.sliding) s.events.push('slide');
        s.sliding = c.slideFrames;
      }
    }

    // vooruit; tijdens een time-out trager, de laatste halve seconde weer op snelheid
    // eerst snel op kruissnelheid, daarna blijft het trager versnellen: het wordt nooit 'af'
    const acc = s.speed < c.cruiseSpeed ? c.accel : s.speed < c.lateSpeed ? c.lateAccel : c.overAccel;
    s.speed = Math.min(c.maxSpeed, s.speed + acc * DT);
    const slow = s.timeout > 0 ? 1 - (1 - c.timeoutSlow) * Math.min(1, s.timeout / 30) : 1;
    s.vel = s.speed * slow;
    s.dist += s.vel * DT;
    // levend langs de clubkampioen: bonus
    while (s.dist >= s.bossNext) {
      s.points += c.bossBonus;
      s.events.push('boss');
      s.bossNext += c.bossEvery;
    }

    // opzij
    const dx = s.lane - s.x, stepX = 1 / c.laneFrames;
    s.x = Math.abs(dx) <= stepX ? s.lane : s.x + Math.sign(dx) * stepX;

    // op en neer
    if (s.y > 0 || s.vy > 0) {
      s.vy -= c.gravity * DT;
      s.y += s.vy * DT;
      if (s.y <= 0) { s.y = 0; s.vy = 0; }
    }
    if (s.sliding > 0 && s.y <= 0) s.sliding--;   // een slide telt pas af op de grond
    if (s.magnet > 0) s.magnet--;
    if (s.grace > 0) s.grace--;
    if (s.timeout > 0) s.timeout--;
    if (s.bak > 0) s.bak--;

    fill(s);
    collide(s);
    s.frame++;
    return s;
  }

  function collide(s) {
    const c = s.cfg;
    const pz0 = s.dist - HALF_DEPTH, pz1 = s.dist + HALF_DEPTH;
    const bottom = s.y, top = s.y + (s.sliding > 0 ? SLIDE_H : STAND_H);

    for (const it of s.items) {
      if (it.z > s.dist + c.magnetReach + 1) break;      // items staan gesorteerd op z
      if (it.taken || it.broken) continue;
      const inLane = Math.abs(s.x - it.lane) < 0.55;
      const overlapZ = it.z < pz1 && it.z + it.len > pz0;
      const span = SPAN[it.type];

      if (span) {
        if (!inLane || !overlapZ || !(top > span[0] && bottom < span[1])) continue;
        if (s.grace > 0) continue;
        if (s.shield) {
          s.shield = false; it.broken = true; s.grace = c.shieldGraceFrames;
          s.events.push('block');
          continue;
        }
        s.alive = false; s.crashedBy = it.type;
        s.events.push('crash');
        return;
      }

      if (it.type === 'ball') {
        const high = it.air ? 1.4 : 0.35;
        const hit = inLane && overlapZ && bottom < high + 0.3 && top > high - 0.3;
        const pulled = s.magnet > 0 && it.z + it.len > pz0 && it.z < s.dist + c.magnetReach;
        if (hit || pulled) {
          it.taken = true; it.takenAt = s.dist; s.balls++;   // takenAt: enkel voor het beeld
          s.points += c.ballPoints * (s.bak > 0 ? 2 : 1);
          s.events.push('ball');
        }
      } else if (inLane && overlapZ && bottom < 1.2) {
        it.taken = true;
        if (it.type === 'shield') s.shield = true;
        else if (it.type === 'magnet') s.magnet = c.magnetFrames;
        else if (it.type === 'timeout') s.timeout = c.timeoutFrames;
        else if (it.type === 'bak') s.bak = c.bakFrames;
        s.events.push(it.type);
      }
    }
  }

  function scoreOf(s) {
    return Math.floor(s.dist) + s.points;
  }

  // vaste-stap-lus: app.js geeft de tijd van requestAnimationFrame door
  function createLoop(opts) {
    const STEP_MS = 1000 / 60;
    let last = null, acc = 0;
    return {
      frame(now) {
        if (last === null) last = now;
        acc += Math.min(250, Math.max(0, now - last));   // na een tab-wissel niet inhalen
        last = now;
        let n = 0;
        while (acc >= STEP_MS && n < 15) { opts.update(); acc -= STEP_MS; n++; }
        if (n === 15) acc = 0;
        opts.render(acc / STEP_MS);
      },
      reset() { last = null; acc = 0; }
    };
  }

  TTR.createGame = createGame;
  TTR.step = step;
  TTR.scoreOf = scoreOf;
  TTR.createLoop = createLoop;
  TTR.SPAN = SPAN;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createGame, step, scoreOf, createLoop, SPAN, DT };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

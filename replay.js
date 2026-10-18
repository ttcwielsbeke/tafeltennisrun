/* ============================================================
   Tafeltennisrun — opnemen en herberekenen van een run
   De app neemt per spelframe de invoer op; de server rekent de
   run met dezelfde simulatie opnieuw na. Geen DOM, geen klok.
   Enkel exacte wiskunde: + − × ÷ en Math.floor/min/max/abs/...
   ============================================================ */
(function (root) {
  const TTR = root.TTR = root.TTR || {};
  if (!TTR.createGame && typeof require === 'function') Object.assign(TTR, require('./game.js'));

  const ACTIONS = ['left', 'right', 'jump', 'slide'];
  const LIMITS = { maxFrames: 108000, maxInputs: 20000 };   // 30 minuten aan 60 beelden per seconde

  // houdt per spelframe de acties bij; 'pause' en andere niet-spelacties vallen weg
  function createRecorder() {
    const inputs = [];
    return {
      inputs,
      add(frame, actions) {
        for (const a of actions || []) if (ACTIONS.includes(a)) inputs.push([frame, a]);
      }
    };
  }

  // geeft een foutcode of null: 'frames' | 'inputs' | 'order' | 'action' | 'range'
  function checkInputs(frames, inputs) {
    if (!Number.isInteger(frames) || frames < 1 || frames > LIMITS.maxFrames) return 'frames';
    if (!Array.isArray(inputs) || inputs.length > LIMITS.maxInputs) return 'inputs';
    let prev = 0;
    for (const entry of inputs) {
      if (!Array.isArray(entry) || entry.length !== 2) return 'inputs';   // precies [frame, actie], niets extra
      if (!ACTIONS.includes(entry[1])) return 'action';
      const f = entry[0];
      if (!Number.isInteger(f) || f < 0 || f >= frames) return 'range';
      if (f < prev) return 'order';
      prev = f;
    }
    return null;
  }

  function result(ok, error, state, c) {
    return {
      ok, error, crashed: !!state && !state.alive,
      frame: state ? state.frame : 0,
      score: state ? TTR.scoreOf(state) : 0,
      dist: state ? Math.floor(state.dist) : 0,
      balls: state ? state.balls : 0,
      jumps: c.jump, slides: c.slide, lanes: c.lane, shields: c.shield, magnets: c.magnet,
      timeouts: c.timeout, bakken: c.bak, blocks: c.block,
      crash: state ? state.crashedBy : null
    };
  }

  // speelt de run opnieuw en geeft de uitkomst; ok enkel als de run precies op `frames` met een botsing eindigt
  function replay(seed, frames, inputs) {
    const c = { jump: 0, slide: 0, lane: 0, shield: 0, magnet: 0, timeout: 0, bak: 0, block: 0 };
    const fout = checkInputs(frames, inputs);
    if (fout) return result(false, fout, null, c);

    const s = TTR.createGame(seed);
    let i = 0;
    while (s.alive && s.frame < frames) {
      const acts = [];
      while (i < inputs.length && inputs[i][0] === s.frame) acts.push(inputs[i++][1]);
      TTR.step(s, acts);
      for (const e of s.events) if (Object.prototype.hasOwnProperty.call(c, e)) c[e]++;   // enkel eigen tellers, nooit iets van Object.prototype
    }
    const ok = !s.alive && s.frame === frames;
    return result(ok, ok ? undefined : 'nocrash', s, c);
  }

  TTR.ACTIONS = ACTIONS;
  TTR.LIMITS = LIMITS;
  TTR.createRecorder = createRecorder;
  TTR.checkInputs = checkInputs;
  TTR.replay = replay;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createRecorder, checkInputs, replay, ACTIONS, LIMITS };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

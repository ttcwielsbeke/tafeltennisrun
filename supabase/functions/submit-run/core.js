/* ============================================================
   Tafeltennisrun — submit-run: de controles op een inzending
   Pure logica zonder HTTP of database, zodat Node ze kan testen.
   index.ts (Deno) doet enkel het netwerk- en databasewerk.
   ============================================================ */
(function (root) {
  const TTR = root.TTR = root.TTR || {};
  if (!TTR.replay && typeof require === 'function') require('../_shared/replay.js');
  if (!root.TTR_CONFIG && typeof require === 'function') require('../_shared/config.js');

  const CONFIG = root.TTR_CONFIG;

  const MESSAGES = {
    version: 'Herlaad de pagina om je score te bewaren.',
    date: 'Deze baan is niet meer open.',
    replay: 'Deze run klopt niet.',
    name: 'Deze naam is al in gebruik op een ander toestel.',
    rate: 'Even geduld…',
    error: 'Er ging iets mis bij het bewaren.',
    format: 'Deze run klopt niet.'
  };

  // identiek aan cleanName in board.js (een test bewaakt dat)
  function cleanName(raw) {
    return String(raw == null ? '' : raw)
      .split('').filter(function (c) { return c >= ' ' && c !== '\x7f'; }).join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 16)
      .trim();
  }

  // kalenderdatum (JJJJ-MM-DD) in Brussel
  function brusselsDate(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(date);
  }

  // de dag voor een JJJJ-MM-DD, puur op de kalender (geen zomertijdgedoe)
  function dayBefore(ymd) {
    const p = ymd.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] - 1)).toISOString().slice(0, 10);
  }

  function fail(status, code) {
    return { ok: false, status: status, code: code, message: MESSAGES[code] };
  }

  // volgorde: vorm, versie, datum, herberekening
  function checkRequest(body, now) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'format');
    const seed = body.seed;
    if (typeof seed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(seed)) return fail(400, 'format');
    if (typeof body.secret !== 'string' || !/^[0-9a-f]{64}$/.test(body.secret)) return fail(400, 'format');
    const name = typeof body.name === 'string' ? cleanName(body.name) : '';
    if (name.length < 1 || name.length > 16) return fail(400, 'format');
    if (typeof body.kit !== 'string' || !CONFIG.skins.some(function (s) { return s.id === body.kit; })) return fail(400, 'format');
    if (!Number.isInteger(body.version)) return fail(400, 'format');
    if (TTR.checkInputs(body.frames, body.inputs) !== null) return fail(400, 'format');

    if (body.version !== CONFIG.game.version) return fail(426, 'version');

    const today = brusselsDate(now);
    if (seed !== today && seed !== dayBefore(today)) return fail(400, 'date');

    const result = TTR.replay(seed, body.frames, body.inputs);
    if (!result.ok) return fail(400, result.error === 'nocrash' ? 'replay' : 'format');

    return {
      ok: true,
      run: {
        seed: seed,
        name: name,
        secretHex: body.secret,
        version: body.version,
        frames: body.frames,
        inputs: body.inputs,
        claimed: body.claimed,
        kit: body.kit,
        result: result
      }
    };
  }

  // te kort na de vorige run: minstens 2 s, of de speelduur min 1 s als dat langer is
  function tooFast(lastCreatedAt, now, frames) {
    if (!lastCreatedAt) return false;
    const elapsed = (now.getTime() - lastCreatedAt.getTime()) / 1000;
    return elapsed < Math.max(2, frames / 60 - 1);
  }

  const api = { cleanName, brusselsDate, checkRequest, tooFast, MESSAGES };
  TTR.submitCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

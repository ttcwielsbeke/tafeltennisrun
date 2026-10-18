/* ============================================================
   Tafeltennisrun — ranglijst
   Twee opslagplaatsen achter dezelfde deur:
     local    — localStorage, ieder op zijn eigen toestel
     supabase — één gedeelde dagranglijst voor heel de club
   Er wordt altijd eerst lokaal weggeschreven, zodat je eigen score
   niet verdwijnt als het net even niet meezit.
   ============================================================ */
(function (root) {
  'use strict';

  const SCORES_KEY = 'ttr_scores';
  const NAME_KEY = 'ttr_name';
  const KEEP = 200;          // zoveel scores bewaren we lokaal
  const TIMEOUT_MS = 5000;   // langer wachten we niet op Supabase
  const SUBMIT_TIMEOUT_MS = 15000;   // de server speelt de run na: dat mag even duren

  /* ---------- namen en scores opschonen ---------- */
  function cleanName(raw) {
    return String(raw == null ? '' : raw)
      .split('').filter(function (c) { return c >= ' ' && c !== '\x7f'; }).join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 16)
      .trim();
  }

  function cleanScore(raw) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return null;
    return Math.min(1000000, Math.max(0, n));
  }

  function createBoard(cfg, storage, fetchFn) {
    if (arguments.length < 1 || cfg === undefined) cfg = root.TTR_CONFIG && root.TTR_CONFIG.board;
    if (arguments.length < 2) {
      try { storage = root.localStorage; } catch (_) { storage = undefined; }
    }
    if (arguments.length < 3) fetchFn = root.fetch && root.fetch.bind(root);
    cfg = cfg || {};

    const limit = cfg.limit > 0 ? cfg.limit : 25;
    const remote = cfg.provider === 'supabase' && !!cfg.url && !!cfg.key &&
                   typeof fetchFn === 'function';

    /* ---------- opslag: localStorage, met geheugen als vangnet ---------- */
    const mem = {};
    function read(key) {
      try {
        if (storage && typeof storage.getItem === 'function') {
          const v = storage.getItem(key);
          return v == null ? (mem[key] == null ? null : mem[key]) : v;
        }
      } catch (_) { /* privémodus of geblokkeerd */ }
      return mem[key] == null ? null : mem[key];
    }
    function write(key, value) {
      mem[key] = value;
      try {
        if (storage && typeof storage.setItem === 'function') storage.setItem(key, value);
      } catch (_) { /* dan maar alleen in het geheugen */ }
    }

    /* ---------- lokale scores ---------- */
    function readLocal() {
      try {
        const rows = JSON.parse(read(SCORES_KEY));
        return Array.isArray(rows)
          ? rows.filter(function (r) { return r && Number.isFinite(r.score); })
          : [];
      } catch (_) { return []; }
    }
    function addLocal(entry) {
      const rows = readLocal();
      rows.push(entry);
      rows.sort(function (a, b) { return b.score - a.score; });
      write(SCORES_KEY, JSON.stringify(rows.slice(0, KEEP)));
    }
    function localTop(seed) {
      return bestPerName(readLocal()
        .filter(function (r) { return r.seed === seed; })
        .sort(function (a, b) { return b.score - a.score; }))
        .slice(0, limit)
        .map(function (r) { return { name: r.name, score: r.score, created_at: r.created_at }; });
    }
    // rijen staan al op score, hoogste eerst: per naam (hoofdletters tellen niet) de eerste houden
    function bestPerName(rows) {
      const seen = {};
      return rows.filter(function (r) {
        const k = String(r.name).toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    }
    function localAllTime() {
      return bestPerName(readLocal().sort(function (a, b) { return b.score - a.score; }))
        .slice(0, limit)
        .map(function (r) { return { name: r.name, score: r.score, seed: r.seed }; });
    }

    /* ---------- Supabase, via gewone REST ---------- */
    function baseUrl() { return String(cfg.url).replace(/\/+$/, ''); }
    function endpoint(view, query) {
      return baseUrl() + '/rest/v1/' + view + (query || '');
    }
    function headers(extra) {
      return Object.assign({
        apikey: cfg.key,
        Authorization: 'Bearer ' + cfg.key
      }, extra || {});
    }
    // fetch met time-out; gooit bij alles wat geen 2xx is,
    // behalve als opts.keepErrors gezet is: dan krijg je ook 4xx/5xx-antwoorden terug
    async function request(url, init, opts) {
      opts = opts || {};
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeout || TIMEOUT_MS) : null;
      try {
        const fetchOpts = Object.assign({}, init);
        if (ctl) fetchOpts.signal = ctl.signal;
        const res = await fetchFn(url, fetchOpts);
        if (!res) throw new Error('Geen antwoord');
        if (!res.ok && !opts.keepErrors) throw new Error('HTTP ' + res.status);
        // de body van een 4xx/5xx moet nog binnen de time-out gelezen worden
        if (opts.keepErrors) return { ok: res.ok, status: res.status, body: await res.json() };
        return res;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    async function getRows(view, query) {
      const res = await request(endpoint(view, query), { method: 'GET', headers: headers() });
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error('Onverwacht antwoord');
      return rows;
    }

    return {
      remote: remote,

      /* {rows:[{name,score,created_at}], source} */
      async top(seed) {
        seed = String(seed == null ? '' : seed);
        if (remote) {
          try {
            const rows = await getRows('daily_best',
              '?select=name,score,created_at&seed=eq.' + encodeURIComponent(seed) +
              '&order=score.desc&limit=' + limit);
            return { rows: rows, source: 'supabase' };
          } catch (_) { /* valt terug op lokaal */ }
        }
        return { rows: localTop(seed), source: 'local' };
      },

      /* {row:{name,score,seed}|null, source} — de beste van alle spelers */
      async best() {
        const r = await this.allTime();
        return { row: r.rows[0] || null, source: r.source };
      },

      /* aller tijden: per speler zijn beste score. {rows:[{name,score,seed}], source}
         De view alltime_best heeft al één rij per speler. */
      async allTime() {
        if (remote) {
          try {
            const rows = await getRows('alltime_best',
              '?select=name,score,seed&order=score.desc&limit=' + limit);
            return { rows: rows, source: 'supabase' };
          } catch (_) { /* valt terug op lokaal */ }
        }
        return { rows: localAllTime(), source: 'local' };
      },

      /* Een afgeronde run insturen: de server speelt de invoer na en bewaart de score.
         Bewaart altijd eerst lokaal.
         ok + source 'supabase'      -> {score, personalBest, todayBest, newBest} van de server
         niet ok + source 'supabase' -> {code, message}: de server weigert de run
         ok + source 'local'         -> {score, offline:true}: geen verbinding of geen Supabase */
      async submitRun(run) {
        run = run || {};
        const score = cleanScore(run.claimed);
        if (score === null) return { ok: false, source: 'local' };
        const seed = String(run.seed == null ? '' : run.seed).slice(0, 32);
        addLocal({
          name: cleanName(run.name) || 'Anoniem',
          score: score,
          seed: seed,
          created_at: new Date().toISOString()
        });
        const offline = { ok: true, score: score, source: 'local', offline: true };
        if (!remote) return offline;
        try {
          const res = await request(baseUrl() + '/functions/v1/submit-run', {
            method: 'POST',
            headers: headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              seed: run.seed, name: run.name, secret: run.secret, version: run.version,
              frames: run.frames, inputs: run.inputs, claimed: run.claimed, kit: run.kit
            })
          }, { keepErrors: true, timeout: SUBMIT_TIMEOUT_MS });
          const body = res.body;
          if (!body || typeof body !== 'object') return offline;
          if (res.ok && body.ok === true) {
            return {
              ok: true, score: body.score, personalBest: body.personalBest,
              todayBest: body.todayBest, newBest: body.newBest, source: 'supabase'
            };
          }
          if (!res.ok && body.ok === false && typeof body.code === 'string') {
            return { ok: false, code: body.code, message: body.message, source: 'supabase' };
          }
          return offline;
        } catch (_) {
          return offline;   // geen netwerk, time-out of onleesbaar antwoord
        }
      },

      getName() { return cleanName(read(NAME_KEY)); },
      setName(name) {
        const n = cleanName(name);
        write(NAME_KEY, n);
        return n;
      }
    };
  }

  root.TTR = root.TTR || {};
  root.TTR.createBoard = createBoard;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createBoard: createBoard };
})(typeof globalThis !== 'undefined' ? globalThis : this);

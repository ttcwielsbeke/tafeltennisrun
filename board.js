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
    const table = cfg.table || 'runner_scores';
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
      return readLocal()
        .filter(function (r) { return r.seed === seed; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, limit)
        .map(function (r) { return { name: r.name, score: r.score, created_at: r.created_at }; });
    }
    function localBest() {
      const rows = readLocal().sort(function (a, b) { return b.score - a.score; });
      const r = rows[0];
      return r ? { name: r.name, score: r.score, seed: r.seed } : null;
    }

    /* ---------- Supabase, via gewone REST ---------- */
    function endpoint(query) {
      return String(cfg.url).replace(/\/+$/, '') + '/rest/v1/' + table + (query || '');
    }
    function headers(extra) {
      return Object.assign({
        apikey: cfg.key,
        Authorization: 'Bearer ' + cfg.key
      }, extra || {});
    }
    // fetch met time-out; gooit bij alles wat geen 2xx is
    async function request(url, init) {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
      try {
        const opts = Object.assign({}, init);
        if (ctl) opts.signal = ctl.signal;
        const res = await fetchFn(url, opts);
        if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
        return res;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    async function getRows(query) {
      const res = await request(endpoint(query), { method: 'GET', headers: headers() });
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
            const rows = await getRows(
              '?select=name,score,created_at&seed=eq.' + encodeURIComponent(seed) +
              '&order=score.desc&limit=' + limit);
            return { rows: rows, source: 'supabase' };
          } catch (_) { /* valt terug op lokaal */ }
        }
        return { rows: localTop(seed), source: 'local' };
      },

      /* {row:{name,score,seed}|null, source} */
      async best() {
        if (remote) {
          try {
            const rows = await getRows('?select=name,score,seed&order=score.desc&limit=1');
            return { row: rows[0] || null, source: 'supabase' };
          } catch (_) { /* valt terug op lokaal */ }
        }
        return { row: localBest(), source: 'local' };
      },

      /* {ok, source, error?} — bewaart altijd eerst lokaal */
      async submit(input) {
        input = input || {};
        const score = cleanScore(input.score);
        if (score === null) return { ok: false, source: 'local' };
        const entry = {
          name: cleanName(input.name) || 'Anoniem',
          score: score,
          seed: String(input.seed == null ? '' : input.seed).slice(0, 32)
        };
        addLocal(Object.assign({ created_at: new Date().toISOString() }, entry));
        if (!remote) return { ok: true, source: 'local' };
        try {
          await request(endpoint(), {
            method: 'POST',
            headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
            body: JSON.stringify(entry)
          });
          return { ok: true, source: 'supabase' };
        } catch (e) {
          return { ok: true, source: 'local', error: String((e && e.message) || e) };
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

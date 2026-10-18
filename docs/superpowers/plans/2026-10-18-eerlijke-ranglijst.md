# Fair Leaderboard (eerlijke ranglijst) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only replay-verified daily-course runs reach the leaderboard, names belong to one device, the boards show one row per player, and every daily run's summary is stored.

**Architecture:** The browser records `[frame, action]` per daily run and posts it to a Supabase Edge Function `submit-run`, which replays the run with the same game code (`replay.js`), claims/checks the name, and writes `runs` / `best_inputs` with the service key. The public reads two views (`daily_best`, `alltime_best`); nobody can write directly. All request checking lives in a plain-JS `core.js` so Node can test it; `index.ts` only does HTTP and database calls.

**Tech Stack:** Vanilla JS (UMD-style IIFEs on `globalThis.TTR`, CommonJS export for Node tests), `node --test`, Supabase Postgres + RLS, Supabase Edge Functions (Deno, TypeScript, `@supabase/supabase-js`).

**Spec:** `docs/superpowers/specs/2026-10-18-eerlijke-ranglijst-design.md`

## Global Constraints

- No build step, no npm in the game; every browser script follows the existing IIFE pattern ending in `})(typeof globalThis !== 'undefined' ? globalThis : this);` and exports via `module.exports` when present.
- Comments and all user-facing copy are Dutch; copy strings below are verbatim from the spec.
- Simulation code may only use exact maths (`+ − × ÷`, `Math.imul/floor/round/min/max/abs/sign`); never `Math.sin/cos/exp/pow/random` in `config.js`, `rng.js`, `world.js`, `game.js`, `replay.js`.
- `GAME_VERSION` = `TTR_CONFIG.game.version` = `1`. Any later change to simulation or course generation bumps it in the same commit.
- Limits: `frames` 1–108 000; `inputs` ≤ 20 000 pairs; body ≤ 256 KB; name 1–16 chars after `cleanName`; secret = 64 hex chars; actions ∈ `left right jump slide`.
- Course date accepted: today or yesterday in `Europe/Brussels`.
- Status codes: 400 bad input / wrong date / replay mismatch, 409 name taken, 426 old version, 429 too fast, 500 unexpected.
- Practice runs are never submitted.
- Prerequisite: the difficulty ramp (separate track) should be merged before this ships, so version 1 contains it. If it lands later, it bumps `version` to 2.

## Review Focus

1. **Fast restart:** a run can end ~4.5 s after the previous one (40 m start-free at 10 m/s). The spec's flat "5 s" rule would reject legitimate runs. Decided rule (`core.js` `tooFast`): reject only if the previous run of this player was stored less than `max(2, frames / 60 − 1)` seconds ago, i.e. faster than the new run could have been played. Test in Task 3.
2. **Midnight and device clocks:** a run started before midnight and submitted after must pass (yesterday); a device clock a day ahead (tomorrow) or two days behind must get "Deze baan is niet meer open." Tests in Task 3.
3. **Same name, different spelling:** `"Jo "`, `"jo"`, `"JO"` must be one player (server applies `cleanName`, DB unique on `lower(name)`). Test in Task 3; DB rule in Task 4.
4. **No connection after a crash:** the score must still be saved locally and the game over screen must say "Score enkel op dit toestel bewaard", never hang on "Score bewaren…". Test in Task 6.
5. **Pause / tab switch mid-run:** frames only advance while running, so the recording must be keyed to `game.frame`, never wall-clock time. A recorded run with pauses must replay identically. Test in Task 1.

---

### Task 1: `replay.js` — recorder and deterministic replay

**Files:**
- Create: `replay.js`
- Modify: `config.js` (add `version: 1` as first key of `game`, comment `// spelversie: verhogen bij elke wijziging aan spellogica of baan`)
- Modify: `index.html` (script `replay.js` after `game.js`)
- Test: `test/replay.test.js`

**Interfaces:**
- Consumes: `TTR.createGame(seed)`, `TTR.step(state, actions)`, `TTR.scoreOf(state)`, `state.events`, `state.crashedBy` (game.js).
- Produces:
  - `TTR.ACTIONS = ['left', 'right', 'jump', 'slide']`
  - `TTR.LIMITS = { maxFrames: 108000, maxInputs: 20000 }`
  - `TTR.createRecorder() → { add(frame: number, actions: string[]): void, inputs: Array<[number, string]> }` — only actions in `TTR.ACTIONS` are kept (drops `pause`).
  - `TTR.checkInputs(frames, inputs) → string | null` — Dutch-free error code (`'frames'`, `'inputs'`, `'order'`, `'action'`, `'range'`) or `null`.
  - `TTR.replay(seed, frames, inputs) → { ok: boolean, error?: string, crashed: boolean, frame: number, score: number, dist: number, balls: number, jumps: number, slides: number, lanes: number, shields: number, magnets: number, timeouts: number, bakken: number, blocks: number, crash: string | null }`
  - CommonJS: `module.exports = { createRecorder, checkInputs, replay, ACTIONS, LIMITS }`.

- [ ] **Step 1: Write the failing tests** in `test/replay.test.js` (require `../replay.js`, `../game.js`, `./bot.js`):
  - `'een opgenomen bot-run geeft bij herberekening exact dezelfde afloop'`: for seeds `2026-10-11` … `2026-10-14`, play with a recorder (`rec.add(s.frame, acts)` before `G.step`) using a bot that stops reacting after frame 1500 so it crashes; then `replay(seed, s.frame, rec.inputs)` → `ok === true`, `score === G.scoreOf(s)`, `dist === Math.floor(s.dist)`, `balls === s.balls`, `crash === s.crashedBy`, `frame === s.frame`.
  - `'pauzes tellen niet: de opname hangt aan game.frame'`: record the same run but call `add` only on frames where the game steps (simulate a pause by skipping wall-clock ticks, not game steps); assert identical replay result to the uninterrupted run.
  - `'tellers kloppen met de events'`: during the recorded run count `jump/slide/lane/ball/shield/magnet/timeout/bak/block` from `s.events`; replay counts are equal.
  - `'geweigerd'`: `replay` returns `ok: false` with `error` for: frames going down (`'order'`), unknown action `'fly'` (`'action'`), frame `>= frames` (`'range'`), 20 001 inputs (`'inputs'`), `frames = 0` or `108001` (`'frames'`), a valid log with `frames` set 30 higher than the crash frame (`'nocrash'` — crash came before `frames`), and with `frames` set lower than the crash frame (`'nocrash'` — no crash at `frames`).
  - `'recorder laat pauze vallen'`: `add(5, ['pause', 'jump'])` → `inputs` equals `[[5, 'jump']]`.
- [ ] **Step 2:** Run `node --test test/replay.test.js` — expect FAIL (`Cannot find module '../replay.js'`).
- [ ] **Step 3: Implement `replay.js`.** `replay` first calls `checkInputs`; then `createGame(seed)`, walks the inputs with an index pointer, collects the actions whose frame equals `state.frame`, calls `step`, counts events, until `!state.alive` or `state.frame >= frames`. `ok` iff the game crashed and `state.frame === frames`; otherwise `error: 'nocrash'`. `dist` is `Math.floor(state.dist)`. In Node, load `config.js`, `rng.js`, `world.js`, `game.js` via `require` the same way `game.js` does (guarded by `typeof require`).
- [ ] **Step 4:** Run `node --test` — all tests pass (36 existing + new).
- [ ] **Step 5: Commit** `git add replay.js config.js index.html test/replay.test.js && git commit -m "Add input recorder and deterministic replay"`

### Task 2: Shared copies for the Edge Function

**Files:**
- Create: `scripts/sync-function.js`
- Create (generated): `supabase/functions/_shared/{config,rng,world,game,replay}.js`
- Test: `test/sync.test.js`

**Interfaces:**
- Produces: `node scripts/sync-function.js` copies the five root files byte-for-byte into `supabase/functions/_shared/`, creating the folder if needed, printing one line per file.

- [ ] **Step 1: Write the failing test** `'de kopieën voor de Edge Function zijn gelijk aan de originelen'`: for each of the five names, `fs.readFileSync` of root and `_shared` copy are `Buffer.equals`. Failure message: `'draai node scripts/sync-function.js'`.
- [ ] **Step 2:** Run `node --test test/sync.test.js` — expect FAIL (ENOENT).
- [ ] **Step 3:** Implement the script (Node `fs` only), run it.
- [ ] **Step 4:** Run `node --test` — PASS.
- [ ] **Step 5: Commit** `git add scripts supabase/functions/_shared test/sync.test.js && git commit -m "Copy game code for the Edge Function, with a drift test"`

### Task 3: `core.js` — request checks without HTTP or database

**Files:**
- Create: `supabase/functions/submit-run/core.js`
- Test: `test/submit-core.test.js`

**Interfaces:**
- Consumes: `TTR.replay`, `TTR.LIMITS`, `TTR.ACTIONS` (Task 1, via `_shared`), `TTR_CONFIG.game.version`, `TTR_CONFIG.skins`.
- Produces (on `TTR.submitCore`, and CommonJS export):
  - `cleanName(raw) → string` — identical rules to `board.js` `cleanName` (copy the function; a test asserts same outputs for a fixed list).
  - `brusselsDate(date: Date) → 'YYYY-MM-DD'` via `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' })`.
  - `checkRequest(body, now: Date) → { ok: true, run: { seed, name, secretHex, version, frames, inputs, claimed, kit, result } } | { ok: false, status, code, message }` — runs format, version, date and replay checks in the spec's order (§6.2 steps 1–4); `result` is the `replay` output. Code mapping: any shape problem or a `checkInputs` error → `code: 'format'` (400); `replay` error `'nocrash'` → `code: 'replay'` (400); version → `'version'` (426); date → `'date'` (400).
  - `tooFast(lastCreatedAt: Date | null, now: Date, frames: number) → boolean` — Review Focus 1 rule.
  - `MESSAGES` with the exact Dutch copy: `version: 'Herlaad de pagina om je score te bewaren.'`, `date: 'Deze baan is niet meer open.'`, `replay: 'Deze run klopt niet.'`, `name: 'Deze naam is al in gebruik op een ander toestel.'`, `rate: 'Even geduld…'`, `error: 'Er ging iets mis bij het bewaren.'`, plus `format: 'Deze run klopt niet.'`.

- [ ] **Step 1: Write the failing tests:**
  - valid recorded bot run (reuse Task 1's helper pattern) on `brusselsDate(now)` → `ok: true`, `run.result.score` equals the played score.
  - `version: 0` → `{ status: 426, code: 'version', message: MESSAGES.version }`.
  - seed = yesterday in Brussels → ok; seed two days ago and tomorrow → `{ status: 400, code: 'date' }`. Use `now = new Date('2026-10-18T22:30:00Z')` (already 19 Oct in Brussels) to pin the time-zone case: `2026-10-19` and `2026-10-18` pass, `2026-10-17` fails.
  - tampered run (valid log, `frames` + 30) → `{ status: 400, code: 'replay' }`; `claimed` ≠ replay score with a valid log → still `ok: true` (claimed is informational).
  - format: secret of 63 chars, name `'   '`, kit `'piraat'`, `inputs` not an array → `{ status: 400, code: 'format' }`.
  - names `'Jo '`, `'jo'`, `' JO'` → `run.name` cleaned (`'Jo'`, `'jo'`, `'JO'`) and `run.name.toLowerCase()` all `'jo'`.
  - `tooFast(null, now, 600) === false`; last run 1 s ago, frames 600 (10 s) → `true`; last run 9.5 s ago, frames 600 → `false`; last run 1.5 s ago, frames 60 → `true` (2 s floor).
  - `cleanName` matches `board.js` behaviour for `['  Jo  ', 'a\u0007b', 'x'.repeat(20), '']`.
- [ ] **Step 2:** Run `node --test test/submit-core.test.js` — FAIL (module missing).
- [ ] **Step 3:** Implement `core.js` in the same IIFE style; in Node, `require('../_shared/replay.js')` and `require('../_shared/config.js')` when `TTR.replay` is missing.
- [ ] **Step 4:** Run `node --test` — PASS.
- [ ] **Step 5: Commit** `git add supabase/functions/submit-run/core.js test/submit-core.test.js && git commit -m "Edge Function core: request checks, date window, rate rule"`

### Task 4: Database `runner_v2.sql`

**Files:**
- Create: `supabase/runner_v2.sql`
- Modify: `README.md` (section "Ranglijst instellen": replace the old SQL instructions with the v2 file and the manual checks below)

**Interfaces:**
- Produces tables `players`, `player_secrets`, `runs`, `best_inputs` and views `daily_best`, `alltime_best` exactly as spec §5 (column names, types, checks, indexes, RLS). Case-insensitive uniqueness is a generated column on `players`: `name_key text generated always as (lower(name)) stored unique` (Task 5 looks players up with `eq('name_key', name.toLowerCase())`). Views use `with (security_invoker = true)`; `daily_best` columns `seed, name, score, dist, balls, created_at` with ties → earliest run; `alltime_best` columns `name, score, seed, created_at`.

- [ ] **Step 1:** Write the SQL, idempotent (`create table if not exists`, `create or replace view`, `drop policy if exists`). Grants: `select` to `anon, authenticated` on `players, runs, best_inputs, daily_best, alltime_best`; nothing on `player_secrets`; `revoke insert on runner_scores from anon, authenticated`.
- [ ] **Step 2:** Add to README a short "Moderatie" note (delete a player in the Table Editor; `on delete cascade` removes their runs; the views update) and the manual checks, as SQL snippets to run in the SQL Editor with `set role anon;`: insert into `runs` fails, `select * from player_secrets` fails, `select * from daily_best` works; then `reset role;`.
- [ ] **Step 3:** Self-check: every column in spec §5.1 exists, every check constraint from §5.1 is present, `dist <= frames * 40 / 60 + 1` uses 40.
- [ ] **Step 4: Commit** `git add supabase/runner_v2.sql README.md && git commit -m "Database v2: players, runs, best inputs, best-per-player views, RLS"`

### Task 5: Edge Function `submit-run/index.ts`

**Files:**
- Create: `supabase/functions/submit-run/index.ts`
- Create: `supabase/config.toml` only if the CLI needs it for `functions serve` (minimal: `[functions.submit-run] verify_jwt = true`)
- Modify: `README.md` (section "Edge Function": install CLI, `supabase login`, `supabase link --project-ref aqaikstibteqcdgxtuiw`, `supabase functions deploy submit-run`, `supabase secrets set ALLOWED_ORIGIN=https://boermansjo.github.io`, plus three `curl` checks: a real run (from `TTR.debug` in the browser), a tampered score, a taken name)

**Interfaces:**
- Consumes: `TTR.submitCore.checkRequest`, `tooFast`, `MESSAGES` (Task 3); imports in this order: `../_shared/config.js`, `../_shared/rng.js`, `../_shared/world.js`, `../_shared/game.js`, `../_shared/replay.js`, `./core.js`, then `createClient` from `npm:@supabase/supabase-js@2`.
- Produces: `POST` handler per spec §6; `OPTIONS` preflight; reply `{ ok: true, score, personalBest, todayBest, newBest }` or `{ ok: false, code, message }`. `newBest` = this score is higher than the player's best before this run (additive to the spec's reply).

- [ ] **Step 1:** Implement: CORS (`ALLOWED_ORIGIN` list + `http://localhost:*`, `http://127.0.0.1:*`); reject bodies > 256 KB (413 → treat as 400 `format`); `checkRequest`; SHA-256 of the secret via `crypto.subtle.digest`; find player with `eq('name_key', name.toLowerCase())`; read the previous personal best before inserting (for `newBest`); claim on miss (insert player + secret; on unique violation `23505` → 409); compare hash on hit; `tooFast` with the player's latest `runs.created_at`; insert run; upsert `best_inputs` when score beats the stored one for `(player_id, seed)`; compute `personalBest` and `todayBest` with two `max(score)` reads; `console.warn` when `claimed !== result.score`.
- [ ] **Step 2:** Type-check where possible: `deno check supabase/functions/submit-run/index.ts` if Deno is installed; otherwise note in the task report that it was verified by deploy (Task 7).
- [ ] **Step 3: Commit** `git add supabase/functions/submit-run/index.ts supabase/config.toml README.md && git commit -m "Edge Function submit-run: replay, name claim, rate rule, store"`

### Task 6: Client — `board.js` submit and views

**Files:**
- Modify: `board.js`
- Test: `test/board.test.js`

**Interfaces:**
- Produces:
  - `board.submitRun({ seed, name, secret, version, frames, inputs, claimed, kit }) → Promise<{ ok: true, score, personalBest, todayBest, newBest, source: 'supabase' } | { ok: false, code, message, source: 'supabase' } | { ok: true, score: claimed, source: 'local', offline: true }>` — always saves locally first (`addLocal`), then posts to `<url>/functions/v1/submit-run` with `apikey` + `Authorization` headers; network error/timeout → local result. HTTP 4xx/5xx with a JSON body → `{ ok: false, code, message }`.
  - `top(seed)` reads `daily_best?select=name,score,created_at&seed=eq.<seed>&order=score.desc&limit=<limit>`; `allTime()` reads `alltime_best?select=name,score,seed&order=score.desc&limit=<limit>`; `best()` = first row of `allTime()` mapped to `{ row, source }`. Local fallbacks unchanged, except local `top(seed)` now keeps one row per name (case-insensitive), best first.
  - Remove `submit()`; keep `getName/setName`.

- [ ] **Step 1: Write the failing tests:** `submitRun` with fetch stub returning 200 JSON → returns server score; returning 409 JSON → `{ ok: false, code: 'name', message: 'Deze naam is al in gebruik op een ander toestel.' }`; fetch throwing → `{ ok: true, source: 'local', offline: true }` and the score is in local storage; `top` local with `Jo 900`, `jo 500`, `An 700` on one seed → two rows `[Jo 900, An 700]`; `top` remote asks for `daily_best` (assert URL contains `/rest/v1/daily_best?`).
- [ ] **Step 2:** Run `node --test test/board.test.js` — FAIL.
- [ ] **Step 3:** Implement in `board.js`.
- [ ] **Step 4:** Run `node --test` — PASS (update the existing all-time test's expected URL to `alltime_best`).
- [ ] **Step 5: Commit** `git add board.js test/board.test.js && git commit -m "Board: submit runs to the Edge Function, read best-per-player views"`

### Task 7: Client — recording, device secret, game over flow

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `TTR.createRecorder` (Task 1), `board.submitRun` (Task 6), `TTR_CONFIG.game.version`.
- Produces: game over copy (exact): `'Score bewaren…'`, `'Score geverifieerd ✓'`, `'Score geverifieerd ✓ — nieuw persoonlijk record!'` (when `newBest`), server `message` on `ok: false`, `'Score enkel op dit toestel bewaard'` when `offline`; name-taken form label `'Deze naam is al in gebruik, kies een andere.'`.

- [ ] **Step 1:** In `start()`: `recorder = practice ? null : TTR.createRecorder()`. In `update()` before `TTR.step`: `if (recorder) recorder.add(game.frame, acts)`.
- [ ] **Step 2:** `deviceSecret()`: read `ttr_secret` from `localStorage`; if missing, 32 bytes from `crypto.getRandomValues`, hex, save; return `null` when `crypto.getRandomValues` is unavailable (then submit is skipped and the local-only copy is shown).
- [ ] **Step 3:** Replace `submit(name, score, seed)` with `submitRun(name)`: builds the payload (`frames: game.frame`, `inputs: recorder.inputs`, `claimed: TTR.scoreOf(game)`, `kit: skin`, `version: TTR_CONFIG.game.version`), shows the copy above, on success `board.setName(name)` then `loadBoard(seed, { name, score })` with the verified score; on `code === 'name'` reopen `#name-form` with the label copy and do **not** save the name; the name form's submit handler calls `submitRun` with the typed name (no `setName` before success).
- [ ] **Step 4: Verify in the browser** (cache-reloaded `http://localhost:8123`):
  - `?lokaal`, daily run, crash → game over shows `'Score enkel op dit toestel bewaard'`; Ranglijst → Vandaag shows the score once.
  - Without `?lokaal`, in the console replace `window.fetch` with a stub that answers the `submit-run` URL once with status 409 and `{ ok: false, code: 'name', message: 'Deze naam is al in gebruik op een ander toestel.' }`; crash → the name form reopens with the taken-name label and `localStorage.ttr_name` is unchanged. Stub a 200 `{ ok: true, score: 123, personalBest: 123, todayBest: 123, newBest: true }` → `'Score geverifieerd ✓ — nieuw persoonlijk record!'`.
  - Practice run → the stub sees no `submit-run` call.
- [ ] **Step 5:** Run `node --test` — PASS.
- [ ] **Step 6: Commit** `git add app.js && git commit -m "Record daily runs and submit them for verification"`

### Task 8: Deploy and end-to-end check (with Jo)

**Files:**
- Modify: `README.md` only if a step turned out different in practice.

- [ ] **Step 1:** Jo runs the one-time setup (spec §11) and `supabase/runner_v2.sql`.
- [ ] **Step 2:** Run the README's manual SQL checks (Task 4) and `curl` checks (Task 5); expected: real run → `ok: true`; tampered `frames` → 400 `replay`; second device secret with same name → 409.
- [ ] **Step 3:** Play one real daily run on the GitHub Pages build: game over shows "Score geverifieerd ✓"; Ranglijst → Vandaag shows the name once; a second, lower run does not add a row.
- [ ] **Step 4:** Check Supabase function logs: no `claimed ≠ score` warnings for these runs.
- [ ] **Step 5: Commit** any README corrections: `git commit -am "README: deploy notes from the first real deploy"`

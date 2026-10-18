# Tafeltennisrun — eerlijke ranglijst (ontwerp)

Status: ontwerp, besproken met Jo op 2026-10-18; wacht op review van deze tekst.
Hoort bij: [ontwerp v1](2026-10-11-tafeltennisrun-design.md).

## 1. Doel

De ranglijst moet te vertrouwen zijn wanneer het spel publiek staat (publieke GitHub-repo, GitHub Pages).
Vandaag stuurt de browser een score rechtstreeks naar Supabase met de publieke sleutel: iedereen kan in één
verzoek 999 999 punten onder eender welke naam zetten. Dat moet stoppen, zonder eigen server en zonder kosten.

Succes =
- een score komt enkel op de ranglijst als ze echt gespeeld is op de baan van die dag;
- een naam hoort bij één toestel;
- de ranglijsten tonen per speler enkel zijn beste score, nooit dubbels;
- van elke run op de dagbaan bewaren we een samenvatting (voor weekstatistieken en badges later), en van
  de beste run van de dag per speler ook de invoer (voor een spookloper later);
- alles draait op het gratis Supabase-plan: database + één Edge Function.

## 2. Beslissingen

| Vraag | Keuze |
|---|---|
| Anti-cheat | Herberekening in een Supabase Edge Function, met regels in de database als extra laag |
| Namen | Geclaimd per toestel met een lokaal geheim; geen overdrachtscode in v1 |
| Wat bewaren | Samenvatting van elke run op de dagbaan + invoer van de beste run per speler per dag |
| Oefenrondes | Worden niet ingestuurd en niet bewaard |
| Oude tabel `runner_scores` | Blijft staan, wordt voor het publiek alleen-lezen; de nieuwe ranglijst begint leeg |

## 3. Waarom herberekenen kan

De simulatie is deterministisch: zelfde seed + zelfde acties per frame = zelfde afloop (vaste stap van 1/60 s,
eigen random generator). De spellogica (`config.js`, `rng.js`, `world.js`, `game.js`) gebruikt enkel
bewerkingen die in elke JavaScript-engine exact hetzelfde uitkomen (`+ − × ÷`, `Math.imul`, `floor`, `round`,
`min`, `max`, `abs`, `sign`). `Math.sin`/`Math.cos` zitten alleen in `curveAt`/`headingAt` (bochten), en die
dienen enkel voor het beeld. Chrome, Safari en de Edge Function (Deno) komen dus op dezelfde score uit.

## 4. Architectuur en gegevensstroom

```
browser (app.js)                 Supabase Edge Function            Postgres
-----------------                ----------------------            --------
speelt de dagbaan,
noteert [frame, actie]
bij een botsing ──POST──────▶  submit-run
                                 1. vorm + versie + datum
                                 2. replay(seed, frames, inputs)
                                 3. naam ↔ geheim
                                 4. tempolimiet
                                 5. bewaren ─────────────────────▶ runs, best_inputs
        ◀──────── { ok, score, personalBest, todayBest }
ranglijst lezen ──GET (anon)─────────────────────────────────────▶ views daily_best, alltime_best
```

- De browser toont de score meteen en bewaart ze ook lokaal (zoals nu); het insturen loopt erachter.
- De **herberekende** score is de waarheid. Wijkt ze af van wat de browser zag, dan bewaren we de
  herberekende en loggen we het verschil (dan is er een determinismefout om te vinden).
- Enkel de Edge Function schrijft, met de service-sleutel die Supabase haar zelf geeft. Die sleutel staat
  nergens in de repo.

## 5. Database (`supabase/runner_v2.sql`)

Eén SQL-bestand, in de SQL Editor te plakken, opnieuw draaien mag (idempotent: `if not exists`,
`create or replace`, `drop policy if exists`).

### 5.1 Tabellen

**`players`** — publiek leesbaar
- `id uuid primary key default gen_random_uuid()`
- `name text not null check (char_length(name) between 1 and 16)`
- `created_at timestamptz not null default now()`
- unieke index op `lower(name)`: "Jo" en "jo" zijn dezelfde naam

**`player_secrets`** — door niemand leesbaar behalve de Edge Function
- `player_id uuid primary key references players(id) on delete cascade`
- `secret_hash text not null` (SHA-256 van het toestelgeheim, hex; het geheim zelf wordt nooit bewaard)

**`runs`** — publiek leesbaar, één rij per geverifieerde run op de dagbaan
- `id bigint generated always as identity primary key`
- `player_id uuid not null references players(id) on delete cascade`
- `seed text not null check (seed ~ '^\d{4}-\d{2}-\d{2}$')`
- `game_version int not null`
- `score int not null`, `dist int not null`, `balls int not null`
- `jumps int not null`, `slides int not null`, `lanes int not null`
- `shields int not null`, `magnets int not null`, `timeouts int not null`, `bakken int not null`, `blocks int not null`
- `crash text not null` (`nopper` | `table` | `net` | `machine`)
- `frames int not null` (lengte van de run in 1/60 s)
- `kit text not null`
- `created_at timestamptz not null default now()`
- checks (extra laag; de Edge Function rekent al juist, dit vangt fouten op):
  - alle tellers `>= 0`, `score between 0 and 1000000`, `frames between 1 and 108000` (30 min)
  - `score <= dist + balls * 20` (meer kan niet: 10 per bal, ×2 met de ballenbak)
  - `dist <= frames * 40 / 60 + 1` (40 m/s is een ruime bovengrens; de topsnelheid moet daar onder blijven,
    ook na de moeilijkheidsopbouw)
- indexen: `(seed, score desc)`, `(player_id, created_at desc)` (tempolimiet), `(score desc)`

**`best_inputs`** — publiek leesbaar (spookloper later)
- `player_id uuid references players(id) on delete cascade`, `seed text`, primary key `(player_id, seed)`
- `score int not null`, `game_version int not null`, `frames int not null`
- `inputs jsonb not null` (`[[frame, actie], …]`)
- `updated_at timestamptz not null default now()`

### 5.2 Views

Gewone views met `security_invoker = true` (geen "security definer view"):

- **`daily_best`**: per `seed` per speler de beste run → `seed, name, score, dist, balls, created_at`.
  Gelijke score: de vroegste run telt. (`distinct on (seed, player_id) … order by seed, player_id, score desc, created_at`)
- **`alltime_best`**: per speler de beste run ooit → `name, score, seed, created_at`.

De ranglijst sorteert daarna op `score desc` en neemt de top 25.

### 5.3 Toegang (RLS)

- RLS aan op alle vier de tabellen.
- `anon` en `authenticated`: `select` op `players`, `runs`, `best_inputs` en de twee views. Geen `insert`,
  `update` of `delete` op wat dan ook. Op `player_secrets`: geen enkel recht.
- De service-rol (Edge Function) omzeilt RLS zoals altijd in Supabase.
- `runner_scores`: `revoke insert` voor `anon` en `authenticated`, de lees-policy blijft.

## 6. Edge Function `submit-run`

Map: `supabase/functions/submit-run/` met `index.ts` (dun: HTTP, checks, database) en een kopie van de
gedeelde bestanden in `supabase/functions/_shared/` (`config.js`, `rng.js`, `world.js`, `game.js`, `replay.js`).

### 6.1 Verzoek

`POST /functions/v1/submit-run`, met de publieke anon-sleutel als `Authorization` (standaard Supabase).

```json
{ "seed": "2026-10-18", "name": "Jo", "secret": "<64 hex>", "version": 1,
  "frames": 2913, "inputs": [[312, "jump"], [340, "left"]], "claimed": 1840, "kit": "club" }
```

CORS: enkel de oorsprong uit het geheim `ALLOWED_ORIGIN` (komma-gescheiden lijst) plus `http://localhost:*`
en `http://127.0.0.1:*` voor ontwikkelen. CORS is geen beveiliging (een script trekt er zich niets van aan);
de herberekening is dat wel.

### 6.2 Controles, in volgorde

1. **Vorm.** Body ≤ 256 KB. `name` opgeschoond zoals `board.js` (`cleanName`), 1–16 tekens.
   `secret` = 64 hex-tekens. `version` geheel getal. `frames` geheel getal, 1–108 000.
   `inputs` = array van ≤ 20 000 paren `[frame, actie]`, `frame` geheel getal `0 <= frame < frames`,
   niet dalend, `actie` ∈ `left right jump slide`. `kit` ∈ de id's uit `config.skins` (cosmetisch;
   of het tenue echt vrijgespeeld is, kunnen we niet nagaan en dat hoeft niet).
   Fout → 400.
2. **Versie.** `version === GAME_VERSION` uit `config.js`. Fout → 426, "Herlaad de pagina om je score te bewaren."
3. **Datum.** `seed` is vandaag of gisteren in `Europe/Brussels`. Fout → 400, "Deze baan is niet meer open."
4. **Herberekening.** `replay(seed, frames, inputs)`: moet eindigen in een botsing op exact `frames`.
   Anders → 400, "Deze run klopt niet." Levert score en tellers.
5. **Naam.** SHA-256 van `secret`. Naam onbekend → `players` + `player_secrets` aanmaken (claim).
   Naam bekend → hash vergelijken; anders → 409, "Deze naam is al in gebruik op een ander toestel."
   Twee claims tegelijk: de unieke index beslist; wie verliest, krijgt dezelfde 409.
6. **Tempo.** Laatste run van deze speler minder dan 5 s geleden → 429, "Even geduld…"
7. **Bewaren.** Rij in `runs`. Is dit de beste score van de speler op deze `seed`, dan `best_inputs` upserten.

### 6.3 Antwoord

- Gelukt: `200 { ok: true, score, personalBest, todayBest }` — `score` = herberekend; `personalBest` = beste
  ooit van deze speler (na deze run); `todayBest` = beste van vandaag van deze speler.
- Fout: `{ ok: false, code, message }` met de statuscode hierboven; `message` is Nederlands en mag zo op
  het scherm. Onverwachte fout → 500, "Er ging iets mis bij het bewaren."
- Afwijking tussen `claimed` en herberekende score → `console.warn` met seed, versie en beide scores.

## 7. Spel (browser)

### 7.1 `replay.js` (nieuw, gedeeld)

Pure functie, geen DOM, geen netwerk, werkt in browser, Node en Deno:

```
TTR.replay(seed, frames, inputs) →
  { ok, crashed, frame, score, dist, balls, jumps, slides, lanes,
    shields, magnets, timeouts, bakken, blocks, crash, error? }
```

- valideert de invoer (zelfde regels als 6.2 punt 1, behalve naam/geheim/kit);
- maakt `createGame(seed)`, past per frame de acties van dat frame toe in hun volgorde, stapt tot de botsing
  of tot `frames`; `ok` = botsing op exact `frames`;
- telt uit `game.events`: `jump`, `slide`, `lane`, `ball`, `shield`, `magnet`, `timeout`, `bak`, `block`.

### 7.2 `config.js`

`game.version: 1` (`GAME_VERSION`). Elke wijziging aan de spellogica of de baangeneratie verhoogt dit getal,
in dezelfde commit. De eerste versie die we zo vastleggen, bevat al de moeilijkheidsopbouw (zie §10).

### 7.3 `app.js`

- **Invoer noteren**: bij een run op de dagbaan, in `update()`, vóór `TTR.step`: per actie `[game.frame, actie]`
  achteraan een lijst. Oefenrondes noteren niets.
- **Toestelgeheim**: eenmalig 32 willekeurige bytes via `crypto.getRandomValues`, hex, in `localStorage`
  onder `ttr_secret`. Geen geheim te maken (heel oude browser) → score enkel lokaal.
- **Na een botsing**: `board.submitRun(...)`. Het eindscherm toont eerst "Score bewaren…", daarna één van:
  "Score geverifieerd ✓", "Score geverifieerd ✓ — nieuw persoonlijk record!", de foutmelding van de server,
  of "Score enkel op dit toestel bewaard" (geen verbinding).
- **Naam bezet (409)**: het naamformulier gaat weer open met "Deze naam is al in gebruik, kies een andere."
  Een naam wordt pas onthouden als de server hem aanvaardt.
- **Eerste keer**: zoals nu vraagt het spel na de eerste run de naam; daarna gaat alles vanzelf.

### 7.4 `board.js`

- `submitRun({ seed, name, secret, version, frames, inputs, claimed, kit })` → `POST` naar
  `<url>/functions/v1/submit-run`; geeft `{ ok, score, personalBest, todayBest, source }` of
  `{ ok: false, code, message, source }`. Slaat altijd eerst lokaal op (zoals `submit` nu).
- `top(seed)` leest `daily_best`, `allTime()` leest `alltime_best`, `best()` = eerste rij van `alltime_best`.
- Zonder Supabase (`?lokaal`, geen url/key, of geen verbinding): lokaal zoals nu, en ook de lokale lijst van
  vandaag toont per speler één rij.
- `submit()` (oud, rechtstreeks naar `runner_scores`) verdwijnt.

## 8. Wat dit wel en niet tegenhoudt

**Wel**: verzonnen scores, aangepaste scores, scores op een andere dag dan vandaag/gisteren, scores onder
andermans naam, honderden inzendingen na elkaar.

**Niet**: iemand die een **bot** schrijft. De code en de baan zijn publiek; wie een programma maakt dat de
dagbaan foutloos speelt, levert een echte, geldige invoerlijst. Dat is veel moeilijker dan een getal sturen,
maar niet onmogelijk. Twee dingen beperken het:
- de moeilijkheidsopbouw (§10) maakt lange runs zwaar, ook voor wie de baan op voorhand bestudeert;
- **moderatie**: in het Supabase-dashboard kan Jo de runs van een speler wissen (of de speler zelf; `on delete
  cascade` ruimt alles op). De views passen zich vanzelf aan.

## 9. Testen

- **`test/replay.test.js`** (Node):
  - bot-runs, opgenomen met dezelfde notatie als `app.js`, geven bij herberekening exact dezelfde score,
    afstand, ballen en botsing;
  - geweigerd: dalende frames, onbekende actie, frame buiten bereik, te veel invoer, geen botsing op `frames`,
    botsing vóór `frames`;
  - de tellers kloppen met de events van het spel.
- **`test/sync.test.js`**: de bestanden in `supabase/functions/_shared/` zijn byte voor byte gelijk aan die in
  de repo-root; `node scripts/sync-function.js` werkt ze bij.
- **`test/board.test.js`**: `submitRun` met een nagemaakte `fetch` (gelukt, 409, 426, geen verbinding);
  lokale daglijst zonder dubbels.
- **Edge Function**: lokaal te draaien met `supabase functions serve submit-run`; README beschrijft een
  handmatige proef met `curl` (een echte run, een aangepaste score, een bezette naam).
- **SQL**: README beschrijft de handmatige controles: insert als anon faalt, `player_secrets` lezen als anon
  faalt, de views geven één rij per speler.

## 10. Volgorde van het werk

1. **Moeilijkheidsopbouw** (spoor A): de spellogica verandert, dus eerst, vóór `GAME_VERSION` 1 vastligt.
2. **Eerlijke ranglijst** (dit ontwerp).
3. **Eerste-run-hint, minder beweging, trillen** (spoor A, klein).
4. Daarna de leuke dingen (spoor C): dagmodifier, nieuwe obstakels, statistieken en badges.

## 11. Eenmalige installatie (komt in de README)

1. Supabase CLI installeren.
2. `supabase login` en `supabase link --project-ref aqaikstibteqcdgxtuiw`.
3. `supabase/runner_v2.sql` plakken in de SQL Editor en draaien.
4. `supabase functions deploy submit-run`.
5. `supabase secrets set ALLOWED_ORIGIN=https://boermansjo.github.io`.

Supabase geeft de functie zelf `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY`.

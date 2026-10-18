# TAFELTENNISRUN — TTC Wielsbeke-Spotit

Clubshirt op, benen los. Een eindeloze runner door de sporthal van TTC Wielsbeke-Spotit:
ontwijk de noppenspelers van PIPS OUT!, spring over de tafels, slide onder netten en
ballenmachines door, en raap onderweg zoveel mogelijk balletjes op. De hal draait af en toe
een bocht naar links of rechts.

Iedereen krijgt op dezelfde dag dezelfde baan (de seed is de datum, bv. `2026-10-11`),
dus de dagranglijst is eerlijk. Ga niet door de noppen!

## Spelen

Open `index.html` of speel online (GitHub Pages, zie onder).

| wat | telefoon | pc |
|---|---|---|
| van baan wisselen | veeg links / rechts | ← → of A / D |
| springen | veeg omhoog of tik | ↑, W of spatie |
| sliden | veeg omlaag | ↓ of S |
| pauze | knop rechtsboven | P of Esc |

- **Noppenspeler** (rood, PIPS OUT!) → wissel van baan. Over een speler spring je niet.
- **Tafel** → spring erover. **Net** of **ballenmachine** → slide eronderdoor.
- **Balletje** = 10 punten, elke meter = 1 punt.
- **Schild-bat** (blauw): je overleeft één botsing. **Magneet** (goud): 6 seconden lang komen de ballen naar jou.
- **Time-out** (wit T-kaartje): 5 seconden trager lopen. **Ballenbak** (blauwe bak): 10 seconden dubbele punten per bal.
- **Tenues**: met je beste score op dit toestel speel je nieuwe tenues vrij (Jeugdtrainer 300, Linkshandige 750,
  Groene noppen 1500, Clubkampioen 3000; dag- en oefenrondes tellen allebei). Kiezen doe je op het titelscherm
  met de pijltjes (of ←/→). Puur voor het oog: geen voordeel in het spel. De drempels staan in `config.js`.
- Het wordt steeds moeilijker, zoals in Subway Surfers: de eerste 3 minuten versnel je van 10 naar 22 m/s, daarna
  blijft het trager versnellen tot 30 m/s (~8 min). Na 3 minuten komen de rijen vlugger na elkaar, worden ze
  gemengder, en komen er combinaties (springen en meteen sliden). Tussen twee rijen zit altijd minstens 0,9 s.
  Na een botsing: één tik op **Opnieuw**.
- **Oefenen** gebruikt een willekeurige baan en telt niet mee voor de ranglijst.
- Geluid staat standaard uit (knop rechtsboven); je keuze wordt onthouden. Alles is gesynthetiseerd: sneakerpiep
  bij een slide, een echte "pok" per bal (na elkaar gepakt klimt de toon), het fluitje van de scheidsrechter bij
  een time-out, publiek dat juicht om de 500 m, en zacht geroezemoes met rally's aan tafels verderop.

Bij je eerste score vraagt het spel je naam (max. 16 tekens); die wordt onthouden op je toestel.
Daarna gaat elke score van de dagbaan vanzelf naar de ranglijst: de top 25 van vandaag, plus
"beste ooit" op het titelscherm.
De knop **Ranglijst** (op het titelscherm en na een run) toont twee lijsten: **Vandaag** (de top 25
van de dagbaan) en **Aller tijden** (per speler zijn beste score ooit, met de datum).

## Lokaal draaien

```bash
python -m http.server 8132
```

Dan naar <http://localhost:8132>. Met <http://localhost:8132/?lokaal> praat het spel niet met
Supabase en blijft de ranglijst op je eigen toestel (handig om te testen).

## Tests

Geen installatie nodig, enkel Node 18 of nieuwer:

```bash
node --test
```

- `test/rng.test.js`: zelfde seed geeft dezelfde reeks, de dagseed.
- `test/world.test.js`: zelfde seed geeft dezelfde baan en bochten, elke rij en elke bocht heeft een veilige route, rijen liggen ver genoeg uit elkaar.
- `test/game.test.js`: een vaste seed met een vast invoerscript en een autopiloot (`test/bot.js`) geven altijd dezelfde score; schild, magneet, time-out, ballenbak, besturing en de vaste-stap-lus.
- `test/skins.test.js`: welke tenues bij welke beste score horen, en dat elk tenue een tekening heeft.
- `test/board.test.js`: de ranglijst aller tijden houdt per speler de beste score, ook via Supabase, met terugval op lokaal.
- `test/audio.test.js`: zonder Web Audio loopt het spel gewoon (geluid doet dan niets), en elke gebeurtenis heeft een geluid.

Pas je `config.js` of `world.js` aan, dan veranderen de "gouden" scores in `test/game.test.js`. Dat is de bedoeling: bereken ze opnieuw en pas ze bewust aan.

## Clubranking aanzetten (Supabase)

De ranglijst gebruikt hetzelfde Supabase-project als PIPS OUT!, met een eigen tabel `runner_scores`.

1. Open het Supabase-project en ga naar **SQL Editor**.
2. Plak de inhoud van [`supabase/runner_scores.sql`](supabase/runner_scores.sql) en klik op **Run**.
   Je mag het gerust opnieuw draaien, er gaat niets stuk.
3. Klaar: de url en de publieke key staan al in `config.js`.

Zolang de tabel niet bestaat, of als Supabase even niet antwoordt, valt het spel stil terug op
een lijst op het eigen toestel. Elke score wordt ook altijd lokaal bewaard. Laat je `url` of `key`
leeg (of zet `provider: 'local'`), dan blijft alles lokaal.

<details>
<summary>De SQL (zelfde als in <code>supabase/runner_scores.sql</code>)</summary>

```sql
-- ============================================================
-- Tafeltennisrun — ranglijst voor heel de club
-- Plak dit hele bestand in Supabase -> SQL Editor -> Run.
-- Je mag het gerust opnieuw draaien, er gaat niets stuk.
-- ============================================================

create table if not exists public.runner_scores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 16),
  score      int  not null check (score between 0 and 1000000),
  seed       text not null check (char_length(seed) between 1 and 32),
  created_at timestamptz not null default now()
);

create index if not exists runner_scores_seed_score_idx
  on public.runner_scores (seed, score desc);
create index if not exists runner_scores_score_idx
  on public.runner_scores (score desc);

-- Iedereen mag lezen en toevoegen; wijzigen of wissen mag niet.
alter table public.runner_scores enable row level security;

drop policy if exists "runner_scores lezen" on public.runner_scores;
create policy "runner_scores lezen" on public.runner_scores
  for select to anon, authenticated using (true);

drop policy if exists "runner_scores toevoegen" on public.runner_scores;
create policy "runner_scores toevoegen" on public.runner_scores
  for insert to anon, authenticated with check (true);

grant select, insert on public.runner_scores to anon, authenticated;
```

</details>

Iedereen mag lezen en toevoegen, niemand mag wijzigen of wissen. De database weigert namen langer
dan 16 tekens en scores buiten 0 – 1 000 000.

## Hosten op GitHub Pages

Repo: <https://github.com/boermansjo/tafeltennisrun>. Eenmalig aanzetten:
**Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**
(<https://github.com/boermansjo/tafeltennisrun/settings/pages>).

Een minuutje later staat het spel op **<https://boermansjo.github.io/tafeltennisrun/>**.
Het lege bestand `.nojekyll` zorgt dat GitHub de bestanden ongewijzigd serveert.

## Bestanden

| bestand | inhoud |
|---|---|
| `index.html` | pagina, canvas, knoppen, naamvraag, ranglijstpaneel |
| `style.css` | clubkleuren en het pixel-lettertype |
| `config.js` | Supabase-sleutels, snelheden, sprong, power-ups |
| `rng.js` | seedbare random generator en de dagseed |
| `world.js` | de baan uit de seed: obstakels, ballen, power-ups, bochten |
| `game.js` | de simulatie met vaste stap van 1/60 s |
| `skins.js` | welke tenues je met je beste score vrijspeelt |
| `input.js` | vegen, tikken en toetsen → `left` `right` `jump` `slide` `pause` |
| `audio.js` | alle geluiden, gesynthetiseerd met Web Audio, en de sfeer in de hal |
| `render.js` | tekent de hal, de speler, de obstakels en de HUD |
| `board.js` | ranglijst: Supabase, met `localStorage` als vangnet |
| `app.js` | schermen, knoppen, geluid en de animatielus |
| `supabase/runner_scores.sql` | de tabel en de rechten |
| `test/` | de tests (`node --test`) |
| `docs/superpowers/specs/` | het ontwerp |

## Architectuur

Geen build, geen framework, geen npm. Elk script hangt zijn deel aan één globale namespace
`TTR` (in de browser `window.TTR`, in Node `globalThis.TTR`) en exporteert het ook via
`module.exports`, zodat de tests het met `require()` kunnen laden. Volgorde in `index.html`:
`config.js`, `rng.js`, `world.js`, `game.js`, `skins.js`, `input.js`, `audio.js`, `render.js`, `board.js`, `app.js`.

### Contract tussen de modules

Eenheden: afstand in meter, tijd in frames van 1/60 s. Banen zijn `0` (links), `1` (midden), `2` (rechts).

**`config.js`** zet `globalThis.TTR_CONFIG`:

```js
TTR_CONFIG = {
  board: { provider: 'supabase' | 'local', url, key, table: 'runner_scores', limit: 25 },
  game:  { startSpeed, accel, cruiseSpeed, lateAccel, maxSpeed, jumpVel, gravity, slideFrames, laneFrames,
           ballPoints, magnetFrames, magnetReach, shieldGraceFrames,
           timeoutFrames, timeoutSlow, bakFrames },
  skins: [{ id, name, at }]   // tenues en de beste score waarmee je ze vrijspeelt
}
```

**`rng.js`**
- `TTR.makeRng(seed: string) → { next(): number in [0,1), int(n): 0..n-1, pick(array), chance(p): bool }`
  — deterministisch (cyrb53-hash + mulberry32), geen `Math.random`.
- `TTR.dailySeed(date = new Date()) → 'YYYY-MM-DD'` (lokale datum).
- `TTR.randomSeed() → 'oefen-xxxxxx'` (enkel voor de oefenmodus, gebruikt wel `Math.random`).

**`world.js`** (pure functies, geen DOM, geen tijd)
- `TTR.CHUNK_LEN` — lengte van één stuk baan in meter.
- `TTR.generateChunk(seed: string, index: int) → Item[]`, gesorteerd op `z`.
  Zelfde `(seed, index)` → identieke uitvoer. Chunk 0 begint rustig (eerste 40 m leeg).
- `Item = { id: string, type, lane: 0|1|2, z: number (meter vanaf de start), len: number }`
  - obstakels: `type` ∈ `'nopper'` (wissel van baan), `'table'` (springen), `'net'` (sliden),
    `'machine'` (hangende ballenmachine, sliden). Een tafel of net over meerdere banen is
    één item per baan met dezelfde `row`.
  - verzamelbaar: `'ball'`, `'shield'`, `'magnet'`, `'timeout'`, `'bak'`; optioneel `air: true` (hangt boven een tafel).
  - obstakels hebben ook `row: string` (id van de rij).
- `TTR.rowsOf(items) → Row[]` met `Row = { row, z, lanes: [type|null, type|null, type|null] }`.
- `TTR.isRowSafe(row) → bool` — minstens één baan zonder `nopper`.
- `TTR.MIN_ROW_GAP` (18 m) en `MIN_ROW_TIME` (0,9 s): twee rijen liggen minstens zoveel uit elkaar, de tijd gemeten
  bij de verwachte snelheid. Ook over de grens tussen twee stukken.
- `TTR.expectedSpeed(z)` en `TTR.expectedTime(z)` — de snelheid en de tijd sinds de start op afstand `z`, uit
  `config.js` (`v² = v0² + 2·a·z`, in twee fasen). De baan wordt daarmee na 3 minuten in tijd ingedeeld.
- Bochten (enkel beeld, de banen blijven banen): `TTR.cornersOf(seed, index) → Corner[]` met
  `Corner = { z, len, dir: -1 | 1, angle }` (radialen), hoogstens één per stuk en volledig erbinnen.
  `TTR.curveAt(corners, z)` geeft de kromming (1/m), `TTR.headingAt(corners, z)` de totale draaiing.
  `TTR.inCorner(corners, z)`: in en vlak vóór een bocht staat hoogstens één noppenspeler per rij.

**`game.js`** (geen DOM, geen klok)
- `TTR.createGame(seed: string, cfg = TTR_CONFIG.game) → State`
- `TTR.step(state, actions: string[])` — één frame van 1/60 s. Acties: `'left' | 'right' | 'jump' | 'slide'`.
  (`'pause'` regelt `app.js`, niet de simulatie.)
- `TTR.scoreOf(state) → int` = `floor(afstand) + points`; `points` telt `ballPoints` per bal, dubbel tijdens de ballenbak.
- `TTR.createLoop({ update(), render(alpha) }) → { frame(nowMs), reset() }` — vaste-stap-accumulator;
  `app.js` voedt hem met `requestAnimationFrame`-tijden.
- `State` (alleen-lezen voor render/app): `{ seed, frame, alive, dist, speed, vel, lane, x, y, sliding,
  balls, points, shield, magnet, grace, timeout, bak, items, corners, events }`.
  - `speed`: de onderliggende snelheid, `vel`: wat je echt loopt (trager tijdens een time-out).
  - `x`: continue baanpositie (0..2), `y`: hoogte in meter (0 = grond), `sliding`: resterende frames.
  - `items`: de items in het zichtbare venster, met extra `taken` / `broken` vlaggen.
  - `events`: lijst van wat er dit frame gebeurde (`'jump' | 'slide' | 'lane' | 'ball' | 'shield' |
    'magnet' | 'timeout' | 'bak' | 'block' | 'crash'`), voor geluid en effecten. Wordt elke stap geleegd.

**`input.js`**
- `TTR.createInput(target: HTMLElement, onAction: (action) => void) → { destroy() }`
- Toetsen: ←/A links, →/D rechts, ↑/W/spatie springen, ↓/S sliden, P/Esc pauze.
- Telefoon: veeg links/rechts/omhoog/omlaag; een korte tik = springen.

**`render.js`**
- `TTR.createRenderer(canvas) → { resize(), draw(state), setSkin(id) }`; `TTR.KITS` = de tenues per id — tekent hal (parket met
  lampspiegelingen, zijlijnen, scorebord), aankleding langs de baan (reservetafels, trainersbank, ballenbak,
  scheidsrechterstafel, supporters), speler met bat, noppenspelers, tafels, netten en ballenmachines (met een
  geel-zwarte strook eronder: hier sliden), ballen, schild, magneet, time-out, ballenbak en de HUD (score, ballen,
  een balk per lopende power-up). Past zich aan de canvasgrootte aan; in landschap hangt de camera hoger, zodat de
  speler niet voor de obstakels in zijn baan staat.
  Bochten: vloer, lijnen en items schuiven opzij volgens `curveAt` (twee keer geïntegreerd vanaf
  de speler), het muurpanorama (2,4 × de schermbreedte, naadloos) schuift mee met `headingAt`.
  De speler loopt met een animatie die volgt uit de state; enkel landen en een bal pakken onthoudt de
  renderer even (squash, forehand).

**`board.js`**
- `TTR.createBoard(cfg = TTR_CONFIG.board, storage = localStorage, fetchFn = fetch) → Board`
- `board.top(seed) → Promise<{ rows: {name, score, created_at}[], source: 'supabase'|'local' }>` (top 25)
- `board.best() → Promise<{ row: {name, score, seed} | null, source }>` (beste ooit)
- `board.allTime() → Promise<{ rows: {name, score, seed}[], source }>` — aller tijden, per speler (naam zonder hoofdletters) enkel de beste score, top 25.
- `board.submit({ name, score, seed }) → Promise<{ ok: bool, source }>` — bewaart altijd ook lokaal.
- `board.getName() / board.setName(name)` — onthouden in `localStorage`.
- Valt stil terug op `localStorage` als url/key leeg zijn of Supabase niet antwoordt.

**`app.js`** — de enige lijm met de DOM: schermen, knoppen (pauze, geluid), naamvraag,
ranglijstpaneel, geluid aan/uit (via `audio.js`) en de `requestAnimationFrame`-lus.

**`audio.js`**
- `TTR.createAudio({ context? }) → { on, setOn(bool), wake(), play(name, opts?, when?), startAmbience(), stopAmbience(), names }`
  — `name` is een spelgebeurtenis (`jump`, `slide`, `lane` met `{dir}`, `ball` met `{double}`, `shield`, `magnet`,
  `timeout`, `bak`, `block`, `crash`) of `land` / `cheer`. Zonder Web Audio doet alles niets. Een `OfflineAudioContext`
  meegeven kan, om geluiden te renderen en te meten.

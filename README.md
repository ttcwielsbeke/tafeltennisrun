# Tafeltennisrun

Een eindeloze runner in de sporthal: ontwijk noppenspelers, spring over tafels en slide onder netten door.
Iedereen krijgt op dezelfde dag dezelfde baan, dus de dagranglijst is eerlijk.

(Deze README wordt aan het einde van de bouw aangevuld.)

## Architectuur

Geen build, geen framework, geen npm. Elk script hangt zijn deel aan één globale namespace
`TTR` (in de browser `window.TTR`, in Node `globalThis.TTR`) en exporteert het ook via
`module.exports`, zodat de tests het met `require()` kunnen laden. Volgorde in `index.html`:
`config.js`, `rng.js`, `world.js`, `game.js`, `input.js`, `render.js`, `board.js`, `app.js`.

### Contract tussen de modules

Eenheden: afstand in meter, tijd in frames van 1/60 s. Banen zijn `0` (links), `1` (midden), `2` (rechts).

**`config.js`** zet `globalThis.TTR_CONFIG`:

```js
TTR_CONFIG = {
  board: { provider: 'supabase' | 'local', url, key, table: 'runner_scores', limit: 25 },
  game:  { startSpeed, maxSpeed, accel, jumpVel, gravity, slideFrames, laneFrames,
           ballPoints, magnetFrames, magnetReach, shieldGraceFrames, ... }
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
  - verzamelbaar: `'ball'`, `'shield'`, `'magnet'`; optioneel `air: true` (hangt boven een tafel).
  - obstakels hebben ook `row: string` (id van de rij).
- `TTR.rowsOf(items) → Row[]` met `Row = { row, z, lanes: [type|null, type|null, type|null] }`.
- `TTR.isRowSafe(row) → bool` — minstens één baan zonder `nopper`.
- `TTR.MIN_ROW_GAP` — minimale afstand tussen twee rijen, groot genoeg om twee keer van baan
  te wisselen bij topsnelheid.

**`game.js`** (geen DOM, geen klok)
- `TTR.createGame(seed: string, cfg = TTR_CONFIG.game) → State`
- `TTR.step(state, actions: string[])` — één frame van 1/60 s. Acties: `'left' | 'right' | 'jump' | 'slide'`.
  (`'pause'` regelt `app.js`, niet de simulatie.)
- `TTR.scoreOf(state) → int` = `floor(afstand) + ballen × ballPoints`.
- `TTR.createLoop({ update(), render(alpha) }) → { frame(nowMs), reset() }` — vaste-stap-accumulator;
  `app.js` voedt hem met `requestAnimationFrame`-tijden.
- `State` (alleen-lezen voor render/app): `{ seed, frame, alive, dist, speed, lane, x, y, sliding,
  balls, shield, magnet, grace, items, events }`.
  - `x`: continue baanpositie (0..2), `y`: hoogte in meter (0 = grond), `sliding`: resterende frames.
  - `items`: de items in het zichtbare venster, met extra `taken` / `broken` vlaggen.
  - `events`: lijst van wat er dit frame gebeurde (`'jump' | 'slide' | 'lane' | 'ball' | 'shield' |
    'magnet' | 'block' | 'crash'`), voor geluid en effecten. Wordt elke stap geleegd.

**`input.js`**
- `TTR.createInput(target: HTMLElement, onAction: (action) => void) → { destroy() }`
- Toetsen: ←/A links, →/D rechts, ↑/W/spatie springen, ↓/S sliden, P/Esc pauze.
- Telefoon: veeg links/rechts/omhoog/omlaag; een korte tik = springen.

**`render.js`**
- `TTR.createRenderer(canvas) → { resize(), draw(state) }` — tekent hal (parket, zijlijnen,
  tafels in de verte, scorebord), speler met bat, noppenspelers, tafels, netten, ballen,
  schild, magneet en de HUD (score, ballen, power-uptijd). Past zich aan de canvasgrootte aan.

**`board.js`**
- `TTR.createBoard(cfg = TTR_CONFIG.board, storage = localStorage, fetchFn = fetch) → Board`
- `board.top(seed) → Promise<{ rows: {name, score, created_at}[], source: 'supabase'|'local' }>` (top 25)
- `board.best() → Promise<{ row: {name, score, seed} | null, source }>` (beste ooit)
- `board.submit({ name, score, seed }) → Promise<{ ok: bool, source }>` — bewaart altijd ook lokaal.
- `board.getName() / board.setName(name)` — onthouden in `localStorage`.
- Valt stil terug op `localStorage` als url/key leeg zijn of Supabase niet antwoordt.

**`app.js`** — de enige lijm met de DOM: schermen, knoppen (pauze, geluid), naamvraag,
ranglijstpaneel, WebAudio-piepjes (standaard uit) en de `requestAnimationFrame`-lus.

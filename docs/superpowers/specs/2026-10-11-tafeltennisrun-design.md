# Tafeltennisrun — ontwerp v1

Status: goedgekeurd door Jo op 2026-10-11.
Naam: **Tafeltennisrun** (ook de repo-naam: `tafeltennisrun`).

## 1. Doel

Een eenvoudig, snel spelletje in de stijl van Subway Surfers / Temple Run, maar in de wereld van tafeltennis: je rent door een eindeloze sporthal en ontwijkt noppenspelers, tafels en andere obstakels. Het moet voor iedereen in de club meteen speelbaar zijn, op telefoon én pc, en een eigen dagelijkse ranglijst hebben.

Succes = een nieuwe speler begrijpt het in 10 seconden, een run duurt 30–90 seconden, en de dagelijkse ranglijst wordt door de club gespeeld.

## 2. Scope van v1

**Wel:**
- Eén pagina (`index.html`), geen build-stap, zoals het huidige PIPS OUT!-project. Canvas + vanilla JavaScript.
- Drie banen: links, midden, rechts. Speler rent automatisch vooruit.
- Besturing:
  - Telefoon: swipe links/rechts = van baan wisselen, swipe omhoog = springen, swipe omlaag = sliden. Tikken = springen (eenvoudige modus).
  - Pc: pijltjestoetsen, spatie = springen, pijl omlaag = sliden. Ook A/D/W/S.
- Obstakels:
  - **Noppenspeler** staat in een baan → wissel van baan.
  - **Tafel** ligt over de banen → spring eroverheen.
  - **Net / hangende ballenmachine** → slide eronderdoor.
  - Obstakels komen in patronen, altijd met minstens één veilige route.
- Verzamelbaar: **ballen** (punten). Enkele ballen ligger op de grond in de baan.
- Power-ups (klein en optioneel, maar in v1):
  - **Schild-bat**: één botsing overleven.
  - **Magneet**: ballen in de buurt komen vanzelf naar je toe, een paar seconden.
- Snelheid neemt langzaam toe. Een nieuwe speler moet 30 seconden kunnen overleven.
- Score = afstand + verzamelde ballen. Einde bij botsing, daarna meteen opnieuw starten (één tik).
- Pauze-knop en geluid aan/uit.
- **Dagelijkse seed**: iedereen krijgt op dezelfde dag dezelfde baanvolgorde. Dat maakt de ranglijst eerlijk. De seed is de datum (bijv. `2026-10-11`). Een "oefen"-modus met willekeurige seed is er ook, maar telt niet mee voor de ranglijst.
- **Ranglijst in Supabase**: een nieuwe tabel `runner_scores` in hetzelfde Supabase-project als PIPS OUT! (geen nieuwe dienst). Top 25 per dag, plus "beste ooit". Naam invullen bij de eerste score (onthouden in localStorage).
- Lokale fallback: als Supabase niet bereikbaar is, werkt het spel gewoon, en wordt de score lokaal bewaard.
- Responsief: werkt op een telefoon van 360 px breed, zonder horizontaal scrollen.
- Nederlands als taal van de interface, zoals het huidige spel.

**Niet in v1:**
- Accounts, inloggen, of wachtwoorden. Alleen een naam.
- Multiplayer, live-tegenstanders, of chat.
- Meerdere werelden of levels. Eén hal, één thema.
- Echte sprites of geluidsbestanden: v1 gebruikt eenvoudige vormen en synthesizer-geluiden. Art komt later.
- Eigen level-editor, achievements, of skins.
- Monetisatie of advertenties.

## 3. Techniek

- Stack: HTML, CSS, vanilla JavaScript, één canvas. Geen framework, geen build, geen npm. Hosting: GitHub Pages (zoals het huidige project), met `.nojekyll`.
- Structuur (klein houden, één verantwoordelijkheid per bestand):
  - `index.html` — pagina, canvas, knoppen, naamvraag, ranglijst-paneel
  - `style.css` — layout en thema (kleuren als variabelen)
  - `config.js` — Supabase url/key/tabelnaam (zelfde vorm als PIPS OUT!), snelheden, kansen
  - `rng.js` — seedbare random generator (deterministisch voor de dagelijkse seed)
  - `world.js` — genereert het baanpatroon uit de seed (pure functie, geen DOM)
  - `game.js` — hoofdlus, beweging, botsingen, power-ups (geen DOM buiten de canvas)
  - `input.js` — swipe, tik, toetsenbord; vertaalt alles naar acties: `left`, `right`, `jump`, `slide`, `pause`
  - `render.js` — tekent de hal, speler, obstakels, ballen, HUD
  - `board.js` — ranglijst: lezen/schrijven naar Supabase, met lokale fallback
- Tijd: vaste stap van 1/60 s (fixed timestep), zodat dezelfde seed en invoer altijd hetzelfde resultaat geven. Dat maakt testen mogelijk.
- Supabase-tabel `runner_scores`:
  - `id` (uuid, pk), `name` (text, max 16 tekens), `score` (int), `seed` (text, bv. `2026-10-11`), `created_at` (timestamptz default now())
  - Row-level security: iedereen mag lezen en toevoegen, niemand mag wijzigen of verwijderen. Score-plafond (bijv. 1 000 000) in de database-check, zodat er geen onzinnige scores komen.
  - Ranglijst: `select` op `seed = vandaag`, geordend op score, limit 25.
  - Het SQL-script komt in de README, zoals bij PIPS OUT!.
- Data-privacy: alleen naam, score, seed en tijd. Geen IP-logging in de app zelf, geen cookies.

## 4. Thema en elementen

- Hal: parketvloer, de zijlijnen, de tafels in de verte, een scorebord, een ventilator, de trainersbank.
- Speler: een simpele figuur met een bat in de hand, kleur uit het bestaande PIPS OUT!-palet voor herkenning.
- Noppenspelers: staan achter tafels, met rode en zwarte noppen (duidelijk herkenbaar), één per baan of als groep.
- Tafels: groene tafel met witte lijn, plat genoeg om over te springen.
- Ballen: witte tafeltennisballen, gouden bij de magneet.
- Schild-bat: blauwe glow om de speler.
- Woordspeling in de tekst: "Tafeltennisrun", "Eindeloos Smashen", "Ga niet door de noppen!"

## 5. Bouwen (aanpak)

Eén Opus-orchestrator leidt de bouw, met subagents per onderdeel. De orchestrator:
1. Maakt een implementatieplan (writing-plans) uit deze spec, met taken per onderdeel.
2. Bouwt eerst een werkend skelet (canvas, banen, speler, springen/sliden) en test dat.
3. Splitst daarna in parallelle subagents: `world.js` + `rng.js` (patronen en seed), `input.js` (besturing, telefoon en pc), `render.js` (tekenen), `board.js` + SQL (ranglijst).
4. Integreert, en controleert in de browser-preview: desktop, telefoonbreedte, en de ranglijst met en zonder Supabase.
5. Eindverslag met wat er klaar is, wat niet, en wat Jo moet beslissen.

Testen: unit-tests op `world.js` en `rng.js` (zelfde seed → zelfde patroon), en een headless check van de hoofdlus met vaste invoer. Visueel controleren in de preview.

## 6. Open vragen (beantwoord door Jo)

1. **Naam van de repo** (en het spel): `tafeltennisrun`.
2. **Seed**: dagelijks (de datum, bv. `2026-10-11`).
3. **Power-ups** (schild-bat, magneet): in v1.
4. **Lokale fallback** voor de ranglijst: ja.

## 7. Stappen na goedkeuring

1. Jo maakt de repo op GitHub (persoonlijk account) met de gekozen naam.
2. Ik zet de bestanden in die repo, commit met Jo's gegevens, en push pas na Jo's akkoord.
3. Ik draai de SQL voor `runner_scores` in het bestaande Supabase-project — alleen na Jo's akkoord, omdat dat een wijziging in een gedeelde database is.

/* ============================================================
   Tafeltennisrun — de lijm met de pagina
   Schermen, knoppen, naam, ranglijst, geluid en de
   requestAnimationFrame-lus. De spelregels zitten in game.js.
   ============================================================ */
(function () {
  const TTR = window.TTR;
  const $ = (id) => document.getElementById(id);

  const canvas = $('game');
  const renderer = TTR.createRenderer(canvas);
  // ?lokaal in de url = ranglijst enkel op dit toestel (handig om te testen)
  const boardCfg = Object.assign({}, window.TTR_CONFIG.board);
  if (/[?&]lokaal(&|=|$)/.test(location.search)) boardCfg.provider = 'local';
  const board = TTR.createBoard(boardCfg);

  const screens = { start: $('screen-start'), pause: $('screen-pause'), over: $('screen-over'),
                    board: $('screen-board') };
  let mode = 'start';          // 'start' | 'run' | 'pause' | 'over' | 'board'
  let practice = false;
  let game = TTR.createGame(TTR.dailySeed());
  let queue = [];
  let overAt = 0;
  let milestone = 0;          // hoeveel keer 500 m we al gelopen hebben
  let recorder = null;        // legt de invoer van een dagrun vast (null bij een oefenronde)
  let pendingRun = null;      // de afgeronde dagrun, klaar om (met een naam erbij) in te sturen
  let lastRun = null;         // het laatst verstuurde pakket, voor TTR.debug.lastRun
  let overToken = 0;          // telt de game-overs: een laat antwoord op een oude run telt niet meer

  const NAME_LABEL = 'Je naam voor de ranglijst';
  const CRASH = {
    nopper: 'Door de noppen gegaan!',
    table: 'Tegen de clubtafel geknald!',
    net: 'In het net blijven hangen!',
    machine: 'Kopbal tegen de ballenmachine!'
  };

  /* ---------- tenues: vrijgespeeld met de beste score op dit toestel ---------- */
  const SKINS = window.TTR_CONFIG.skins;
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, String(v)); } catch (e) { /* privévenster */ } }
  let deviceBest = Number(load('ttr.best')) || 0;
  let skin = load('ttr.skin') || 'club';
  if (!TTR.unlockedSkins(deviceBest, SKINS).some((k) => k.id === skin)) skin = 'club';
  let browse = skin;          // het tenue dat nu in de kiezer staat

  function showSkin() {
    const k = SKINS.find((x) => x.id === browse) || SKINS[0];
    const open = deviceBest >= k.at;
    const kit = TTR.KITS[k.id];
    $('skin-name').textContent = k.name;
    $('skin-swatch').style.background = 'linear-gradient(' + kit.shirt + ' 0 40%,' +
      kit.stripes.map((c, i) => c + ' ' + (40 + i * 10) + '% ' + (48 + i * 10) + '%').join(',') +
      ',' + kit.shirt + ' 68% 100%)';
    $('skin-picker').classList.toggle('locked', !open);
    $('skin-lock').textContent = open ? '' : 'Vrij vanaf ' + k.at + ' punten';
    if (open) { skin = browse; save('ttr.skin', skin); renderer.setSkin(skin); }
  }
  function nextSkin(dir) { browse = TTR.cycleSkin(browse, dir, SKINS); showSkin(); }

  // na een run: beste score bijwerken en melden wat er vrijkwam
  function recordBest(score) {
    if (score <= deviceBest) return [];
    const fresh = TTR.newSkins(deviceBest, score, SKINS);
    deviceBest = score;
    save('ttr.best', score);
    return fresh;
  }

  /* ---------- geluid: standaard uit, je keuze wordt onthouden (audio.js) ---------- */
  const audio = TTR.createAudio();
  function setSound(on) {
    const now = audio.setOn(on);
    save('ttr.sound', now ? 1 : 0);
    if (now && mode === 'run') audio.startAmbience();
    const b = $('btn-sound');
    b.innerHTML = now ? '&#128266;' : '&#128263;';
    b.setAttribute('aria-pressed', String(now));
    b.setAttribute('aria-label', now ? 'Geluid uitzetten' : 'Geluid aanzetten');
  }
  // browsers starten geluid pas na een klik of toets: bij de eerste de context wekken
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, () => audio.wake(), true);

  /* ---------- schermen ---------- */
  function show(name) {
    for (const k in screens) screens[k].hidden = k !== name;
    $('btn-pause').hidden = name !== null && name !== 'pause' ? true : false;
  }

  function start(asPractice) {
    practice = !!asPractice;
    game = TTR.createGame(practice ? TTR.randomSeed() : TTR.dailySeed());
    queue = [];
    loop.reset();
    mode = 'run';
    milestone = 0;
    recorder = practice ? null : TTR.createRecorder();
    pendingRun = null;
    show(null);
    audio.startAmbience();
    canvas.focus && canvas.focus();
  }

  function pause() {
    if (mode !== 'run') return;
    mode = 'pause';
    audio.stopAmbience();
    show('pause');
    $('btn-resume').focus();
  }
  function resume() {
    if (mode !== 'pause') return;
    mode = 'run';
    queue = [];
    loop.reset();
    show(null);
    audio.startAmbience();
  }

  function gameOver() {
    mode = 'over';
    audio.stopAmbience();
    overAt = performance.now();
    const score = TTR.scoreOf(game);
    $('over-title').textContent = CRASH[game.crashedBy] || 'Gebotst!';
    $('over-score').textContent = score;
    $('over-detail').textContent = Math.floor(game.dist) + ' m gelopen · ' + game.balls +
      (game.balls === 1 ? ' bal' : ' ballen') + (practice ? ' · oefenronde' : '');
    $('submit-note').textContent = '';
    $('name-form').hidden = true;
    const fresh = recordBest(score);
    $('unlock-note').hidden = !fresh.length;
    $('unlock-note').textContent = fresh.length
      ? 'Nieuw tenue: ' + fresh.map((k) => k.name).join(' en ') + '! Kies het bij de start.' : '';
    show('over');

    const seed = game.seed;
    overToken++;
    $('name-label').textContent = NAME_LABEL;
    if (practice) {
      pendingRun = null;
      $('submit-note').textContent = 'Oefenronde: telt niet mee voor de ranglijst.';
      loadBoard(TTR.dailySeed(), null);
    } else {
      // het pakket voor de server: de run zelf, nog zonder naam
      const secret = deviceSecret();
      pendingRun = {
        seed, secret: secret || '', version: window.TTR_CONFIG.game.version,
        frames: game.frame, inputs: recorder.inputs, claimed: score, kit: skin
      };
      pendingRun.noSecret = secret === null;
      if (board.getName()) {
        submitRun(board.getName());
      } else {
        $('name-form').hidden = false;
        $('name-input').value = '';
        loadBoard(seed, null);
      }
    }
  }

  /* ---------- apparaatgeheim: bewijst dat een naam altijd van hetzelfde toestel komt ---------- */
  let secretMem = null;
  function deviceSecret() {
    if (secretMem) return secretMem;
    const stored = load('ttr_secret');
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return (secretMem = stored);
    const c = window.crypto;
    if (!c || typeof c.getRandomValues !== 'function') return null;
    const bytes = new Uint8Array(32);
    c.getRandomValues(bytes);
    secretMem = Array.from(bytes, (b) => (b < 16 ? '0' : '') + b.toString(16)).join('');
    save('ttr_secret', secretMem);
    return secretMem;
  }

  // zonder crypto kan de server de run niet koppelen aan een toestel: dan enkel lokaal bewaren
  let localOnlyBoard = null;

  // stuurt de afgeronde dagrun in met deze naam; de naam wordt pas onthouden als de server hem aanvaardt
  async function submitRun(rawName) {
    const run = pendingRun;
    if (!run) return;
    const token = overToken;
    const name = board.cleanName(rawName);
    const payload = Object.assign({ name }, run);
    delete payload.noSecret;
    lastRun = payload;
    $('submit-note').textContent = 'Score bewaren…';
    let res;
    if (run.noSecret) {
      localOnlyBoard = localOnlyBoard || TTR.createBoard({ provider: 'local' });
      res = await localOnlyBoard.submitRun(payload);
    } else {
      res = await board.submitRun(payload);
    }
    // geen verdict van de server (offline), of door hem aanvaard: dan onthouden we de naam
    if (res.ok) board.setName(name);
    if (token !== overToken) return;     // intussen is er al een nieuwe run
    const note = $('submit-note');
    if (res.ok && res.source === 'supabase') {
      note.textContent = res.newBest ? 'Score geverifieerd ✓ — nieuw persoonlijk record!' : 'Score geverifieerd ✓';
      loadBoard(run.seed, { name, score: res.score });
    } else if (res.ok) {
      note.textContent = 'Score enkel op dit toestel bewaard';
      loadBoard(run.seed, { name, score: res.score });
    } else if (res.code === 'name') {
      note.textContent = '';
      $('name-label').textContent = 'Deze naam is al in gebruik, kies een andere.';
      $('name-form').hidden = false;
      $('name-input').value = '';
      $('name-input').focus();
      loadBoard(run.seed, null);
    } else {
      note.textContent = res.message || 'Score kon niet bewaard worden.';
      loadBoard(run.seed, null);
    }
  }

  // rijen in een <ol>; is(r) zegt welke rij van jou is (enkel de eerste wordt gemarkeerd)
  function fillList(list, rows, is, empty, withSeed) {
    list.textContent = '';
    let marked = false;
    for (const r of rows) {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = r.name;
      const s = document.createElement('span'); s.className = 's'; s.textContent = r.score;
      li.append(n);
      if (withSeed) { const d = document.createElement('span'); d.className = 'd'; d.textContent = r.seed; li.append(d); }
      li.append(s);
      if (!marked && is(r)) { li.className = 'me'; marked = true; }
      list.append(li);
    }
    if (!rows.length) {
      const li = document.createElement('li'); li.className = 'empty';
      li.textContent = empty;
      list.append(li);
    }
  }
  function sourceNote(source, n) {
    return source === 'supabase' ? 'Clubranking: top ' + n
      : 'Lijst van dit toestel (geen verbinding met de clubranking).';
  }

  async function loadBoard(seed, mine) {
    $('board-title').textContent = 'Ranglijst TTC Wielsbeke-Spotit · ' + seed;
    $('board-note').textContent = 'Laden…';
    const { rows, source } = await board.top(seed);
    fillList($('board-list'), rows, (r) => !!mine && String(r.name).toLowerCase() === mine.name.toLowerCase() && r.score === mine.score,
      'Nog niemand van de club vandaag. Jij eerst!', false);
    $('board-note').textContent = sourceNote(source, rows.length);
    showBest();
  }

  /* ---------- ranglijst-scherm: vandaag en aller tijden ---------- */
  let boardFrom = 'start', boardTab = 'day', boardReq = 0;
  function openBoard(tab) {
    boardFrom = mode === 'over' ? 'over' : 'start';
    mode = 'board';
    show('board');
    showTab(tab);
    $(tab === 'all' ? 'tab-all' : 'tab-day').focus();
  }
  function closeBoard() {
    if (mode !== 'board') return;
    mode = boardFrom;
    show(boardFrom);
    if (boardFrom === 'start') showBest();
    $(boardFrom === 'over' ? 'btn-board-over' : 'btn-board').focus();
  }
  async function showTab(tab) {
    boardTab = tab;
    const req = ++boardReq;     // trager antwoord van de vorige tab mag niets overschrijven
    $('tab-day').setAttribute('aria-selected', String(tab === 'day'));
    $('tab-all').setAttribute('aria-selected', String(tab === 'all'));
    const today = TTR.dailySeed();
    $('rank-title').textContent = tab === 'day' ? 'Baan van vandaag · ' + today : 'Beste score per speler, ooit';
    $('rank-note').textContent = 'Laden…';
    $('rank-list').textContent = '';
    let res;
    try {
      res = tab === 'day' ? await board.top(today) : await board.allTime();
    } catch (e) {
      // bv. een oude board.js uit de cache van de browser, vlak na een update
      if (req === boardReq) $('rank-note').textContent = 'Kon de ranglijst niet laden. Herlaad de pagina even.';
      return;
    }
    if (req !== boardReq || mode !== 'board') return;
    const me = board.getName().toLowerCase();
    fillList($('rank-list'), res.rows, (r) => !!me && String(r.name).toLowerCase() === me,
      tab === 'day' ? 'Nog niemand van de club vandaag. Jij eerst!' : 'Nog geen scores.', tab === 'all');
    $('rank-note').textContent = sourceNote(res.source, res.rows.length);
  }

  async function showBest() {
    const { row } = await board.best();
    $('best-ever').textContent = row ? 'Beste ooit: ' + row.name + ' met ' + row.score + ' (' + row.seed + ')' : '';
  }

  /* ---------- invoer ---------- */
  function onAction(a) {
    if (mode === 'run') {
      if (a === 'pause') pause();
      else queue.push(a);
    } else if (mode === 'pause') {
      if (a === 'pause' || a === 'jump') resume();
    } else if (mode === 'over') {
      if (a === 'jump' && performance.now() - overAt > 400) start(practice);
    } else if (mode === 'board') {
      if (a === 'pause') closeBoard();
      else if (a === 'left' || a === 'right') showTab(a === 'left' ? 'day' : 'all');
    } else if (mode === 'start') {
      if (a === 'jump') start(false);
      else if (a === 'left' || a === 'right') nextSkin(a === 'left' ? -1 : 1);
    }
  }
  TTR.createInput($('app'), onAction);

  $('btn-start').addEventListener('click', () => start(false));
  $('btn-practice').addEventListener('click', () => start(true));
  $('btn-again').addEventListener('click', () => start(practice));
  $('btn-resume').addEventListener('click', resume);
  $('btn-pause').addEventListener('click', () => (mode === 'run' ? pause() : resume()));
  function home() { mode = 'start'; browse = skin; showSkin(); show('start'); showBest(); }
  $('btn-quit').addEventListener('click', home);
  $('btn-board').addEventListener('click', () => openBoard('day'));
  $('btn-board-over').addEventListener('click', () => openBoard('all'));
  $('btn-board-back').addEventListener('click', closeBoard);
  $('tab-day').addEventListener('click', () => showTab('day'));
  $('tab-all').addEventListener('click', () => showTab('all'));
  $('btn-home').addEventListener('click', home);
  $('skin-prev').addEventListener('click', (e) => { nextSkin(-1); e.currentTarget.blur(); });
  $('skin-next').addEventListener('click', (e) => { nextSkin(1); e.currentTarget.blur(); });
  $('btn-sound').addEventListener('click', (e) => { setSound(!audio.on); e.currentTarget.blur(); });
  $('name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = board.cleanName($('name-input').value);
    if (!name) { $('name-input').focus(); return; }
    $('name-form').hidden = true;
    submitRun(name);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  /* ---------- de lus ---------- */
  const loop = TTR.createLoop({
    update() {
      if (mode !== 'run') return;
      const acts = queue; queue = [];
      const lane0 = game.lane, air0 = game.y > 0;
      if (recorder) recorder.add(game.frame, acts);
      TTR.step(game, acts);
      for (const ev of game.events) {
        if (ev === 'lane') audio.play('lane', { dir: Math.sign(game.lane - lane0) });
        else if (ev === 'ball') audio.play('ball', { double: game.bak > 0 });
        else audio.play(ev);
      }
      if (air0 && game.y <= 0 && game.alive) audio.play('land');
      // om de 500 m juicht het publiek
      const m = Math.floor(game.dist / 500);
      if (m > milestone) { milestone = m; audio.play('cheer'); }
      if (!game.alive) gameOver();
    },
    render() { renderer.draw(game); }
  });

  function tick(now) {
    if (mode === 'run') loop.frame(now);
    else renderer.draw(game);
    requestAnimationFrame(tick);
  }

  $('seed-today').textContent = TTR.dailySeed();
  setSound(load('ttr.sound') === '1');
  renderer.setSkin(skin);
  showSkin();
  show('start');
  showBest();
  requestAnimationFrame(tick);

  // voor de browsertest en wie wil spieken: de huidige toestand
  window.TTR.debug = { board, audio, get game() { return game; }, get mode() { return mode; },
                      get lastRun() { return lastRun; } };
})();

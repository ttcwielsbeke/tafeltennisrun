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

  const screens = { start: $('screen-start'), pause: $('screen-pause'), over: $('screen-over') };
  let mode = 'start';          // 'start' | 'run' | 'pause' | 'over'
  let practice = false;
  let game = TTR.createGame(TTR.dailySeed());
  let queue = [];
  let overAt = 0;

  const CRASH = {
    nopper: 'Door de noppen gegaan!',
    table: 'Tegen de clubtafel geknald!',
    net: 'In het net blijven hangen!',
    machine: 'Kopbal tegen de ballenmachine!'
  };

  /* ---------- geluid: standaard uit ---------- */
  let soundOn = false;
  let ac = null;
  function beep(freq, dur, type, vol, slideTo) {
    if (!soundOn || !ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const SOUNDS = {
    jump:   () => beep(420, 0.15, 'square', 0.05, 760),
    slide:  () => beep(300, 0.15, 'triangle', 0.07, 140),
    lane:   () => beep(520, 0.05, 'triangle', 0.04),
    ball:   () => { beep(1320, 0.06, 'sine', 0.06); beep(1760, 0.08, 'sine', 0.04); },
    shield: () => { beep(523, 0.08, 'square', 0.05); beep(784, 0.12, 'square', 0.05); },
    magnet: () => { beep(660, 0.08, 'square', 0.05); beep(990, 0.12, 'square', 0.05); },
    block:  () => beep(200, 0.2, 'sawtooth', 0.07, 90),
    crash:  () => beep(160, 0.45, 'sawtooth', 0.09, 50)
  };
  function setSound(on) {
    soundOn = on;
    if (on && !ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { soundOn = false; }
    }
    if (ac && ac.state === 'suspended' && on) ac.resume();
    const b = $('btn-sound');
    b.innerHTML = soundOn ? '&#128266;' : '&#128263;';
    b.setAttribute('aria-pressed', String(soundOn));
    b.setAttribute('aria-label', soundOn ? 'Geluid uitzetten' : 'Geluid aanzetten');
  }

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
    show(null);
    canvas.focus && canvas.focus();
  }

  function pause() {
    if (mode !== 'run') return;
    mode = 'pause';
    show('pause');
    $('btn-resume').focus();
  }
  function resume() {
    if (mode !== 'pause') return;
    mode = 'run';
    queue = [];
    loop.reset();
    show(null);
  }

  function gameOver() {
    mode = 'over';
    overAt = performance.now();
    const score = TTR.scoreOf(game);
    $('over-title').textContent = CRASH[game.crashedBy] || 'Gebotst!';
    $('over-score').textContent = score;
    $('over-detail').textContent = Math.floor(game.dist) + ' m gelopen · ' + game.balls +
      (game.balls === 1 ? ' bal' : ' ballen') + (practice ? ' · oefenronde' : '');
    $('submit-note').textContent = '';
    $('name-form').hidden = true;
    show('over');

    const seed = game.seed;
    if (practice) {
      $('submit-note').textContent = 'Oefenronde: telt niet mee voor de ranglijst.';
      loadBoard(TTR.dailySeed(), null);
    } else if (board.getName()) {
      submit(board.getName(), score, seed);
    } else {
      $('name-form').hidden = false;
      $('name-input').value = '';
      loadBoard(seed, null);
    }
  }

  async function submit(name, score, seed) {
    $('submit-note').textContent = 'Score bewaren…';
    const res = await board.submit({ name, score, seed });
    $('submit-note').textContent = !res.ok ? 'Score kon niet bewaard worden.'
      : 'Score bewaard als ' + name + (res.source === 'supabase' ? '.' : ', op dit toestel.');
    loadBoard(seed, { name, score });
  }

  async function loadBoard(seed, mine) {
    const list = $('board-list');
    $('board-title').textContent = 'Ranglijst TTC Wielsbeke-Spotit · ' + seed;
    $('board-note').textContent = 'Laden…';
    const { rows, source } = await board.top(seed);
    list.textContent = '';
    let marked = false;
    for (const r of rows) {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = r.name;
      const s = document.createElement('span'); s.className = 's'; s.textContent = r.score;
      li.append(n, s);
      if (mine && !marked && r.name === mine.name && r.score === mine.score) { li.className = 'me'; marked = true; }
      list.append(li);
    }
    if (!rows.length) {
      const li = document.createElement('li'); li.className = 'empty';
      li.textContent = 'Nog niemand van de club vandaag. Jij eerst!';
      list.append(li);
    }
    $('board-note').textContent = source === 'supabase' ? 'Clubranking: top ' + rows.length
      : 'Lijst van dit toestel (geen verbinding met de clubranking).';
    showBest();
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
    } else if (mode === 'start') {
      if (a === 'jump') start(false);
    }
  }
  TTR.createInput($('app'), onAction);

  $('btn-start').addEventListener('click', () => start(false));
  $('btn-practice').addEventListener('click', () => start(true));
  $('btn-again').addEventListener('click', () => start(practice));
  $('btn-resume').addEventListener('click', resume);
  $('btn-pause').addEventListener('click', () => (mode === 'run' ? pause() : resume()));
  $('btn-quit').addEventListener('click', () => { mode = 'start'; show('start'); showBest(); });
  $('btn-home').addEventListener('click', () => { mode = 'start'; show('start'); showBest(); });
  $('btn-sound').addEventListener('click', (e) => { setSound(!soundOn); e.currentTarget.blur(); });
  $('name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = board.setName($('name-input').value);
    $('name-form').hidden = true;
    submit(name, TTR.scoreOf(game), game.seed);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  /* ---------- de lus ---------- */
  const loop = TTR.createLoop({
    update() {
      if (mode !== 'run') return;
      const acts = queue; queue = [];
      TTR.step(game, acts);
      for (const ev of game.events) if (SOUNDS[ev]) SOUNDS[ev]();
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
  setSound(false);
  show('start');
  showBest();
  requestAnimationFrame(tick);

  // voor de browsertest en wie wil spieken: de huidige toestand
  window.TTR.debug = { board, get game() { return game; }, get mode() { return mode; } };
})();

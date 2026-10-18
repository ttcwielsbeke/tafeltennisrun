/* ============================================================
   Tafeltennisrun — tekenen
   Eén canvas, enkel vormen. Pseudo-3D pinhole-camera achter en
   boven de speler. Tekent puur uit de state: geen timers, geen
   Math.random. Statische hal zit in een offscreen-cache.
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------- camera / wereld (meter) ---------- */
  const LANE_W = 1.6;          // breedte van een baan
  const CAM_BACK = 5;          // camera staat zoveel meter achter de speler
  const CAM_FOLLOW = 0.5;      // camera volgt de zijwaartse positie voor de helft
  const FEET_FRAC = 0.84;      // voeten van de speler op 84% van de hoogte
  const HORIZON_FRAC = 0.32;   // gewenste horizon (32% van boven)
  const LANE_FRAC_W = 0.28;    // baanbreedte bij de speler, als deel van de breedte (portret)
  const LANE_FRAC_H = 0.24;    // ... maar nooit meer dan dit deel van de hoogte (landschap)
  /* Een lage camera zet de speler voor de obstakels in zijn eigen baan: op hoogte h
     zie je de vloer pas vanaf 5·h/(h − 1,85) m achter de camera. Bij 3,8 m is dat
     ~10 m: wat 5 m voor je staat, zie je boven het hoofd van de speler. */
  const CAM_H_MIN = 3.8, CAM_H_MAX = 5.5;
  const VIEW_AHEAD = 72;       // zo ver vooruit tekenen
  const VIEW_BEHIND = 2;       // zo ver achter de speler nog tekenen
  const FADE_FROM = 55;        // vanaf deze diepte vervagen items
  const NEAR = 0.5;            // near clip

  const COURT_X = 2.5;         // witte zijlijn van het speelveld
  const BARRIER_X = 3.3;       // omheining langs de baan
  const BAND = 1.2;            // parketvak in de lengte
  const PLANK = 0.5;           // parketplank in de breedte

  /* bochten */
  const OFF_N = 84;            // zijwaartse verschuiving tot zoveel meter voor de speler (stap 1 m)
  const OFF_CLAMP = 0.6;       // verschuiving op het scherm maximaal ±0.6 × breedte
  const BG_PAN = 0.6;          // panorama: W × BG_PAN pixels per radiaal draaiing
  const STRIP_STEPS = 18;      // segmenten per gebogen lijn op de vloer

  /* clubkleuren (TTC Wielsbeke-Spotit / PIPS OUT!) */
  const C = {
    ink: '#02132b', blueD: '#0b3a75', blueDD: '#062a56', blueM: '#1a5ca8', blue: '#2f7fd4',
    red: '#c8242a', gold: '#ffd23f', chrome: '#9ed4ff',
    table: '#1f4fa3', tableD: '#163a7a', legs: '#2a2f36',
    skin: '#f0c39a', hair: '#3a2618', white: '#f4f4f4',
    floor: '#c7652c', floorD: '#a4501d', line: '#f5e9c8'
  };
  /* tenues, zoals in ULTRA SMASH! */
  const CLUB = { shirt: '#161616', trim: '#f4f4f4', hem: '#0a0a0a', shorts: '#111111',
                 stripes: ['#e4474c', '#c6a743', '#2eb1c2'] };
  const PIPS = { shirt: '#c8242a', trim: '#8d1519', hem: '#8d1519', shorts: '#1c2430',
                 pips: ['#f0716a', '#d94a44', '#8b1a1f'], bat: '#c8242a' };
  /* vrij te spelen tenues van de speler (drempels in config.js) */
  /* Elk tenue verschilt ook van achteren gezien, want zo zie je de speler:
     naam op de rug, sokken, schoenen, zweetbanden. */
  const KITS = {
    club:     Object.assign({}, CLUB, { bat: C.red, backName: 'WIELSBEKE' }),
    trainer:  { shirt: '#0b3a75', trim: '#9ed4ff', hem: '#062a56', shorts: '#111111',
                stripes: CLUB.stripes, bat: C.red, longSleeves: true, backName: 'TRAINER',
                socks: '#0b3a75' },
    links:    Object.assign({}, CLUB, { bat: C.red, mirror: true, backName: 'LINKS',
                headband: C.red, wristband: C.red }),
    groen:    Object.assign({}, CLUB, { bat: '#2fa84f', batPips: ['#9cf0a8', '#2fa84f', '#14602a'],
                backName: 'NOPPEN', socks: '#2fa84f', wristband: '#2fa84f' }),
    kampioen: { shirt: '#e0b520', trim: '#fff6c8', hem: '#a88410', shorts: '#111111',
                stripes: ['#e4474c', '#161616', '#2eb1c2'], bat: C.red, backName: 'KAMPIOEN',
                shoes: C.gold, headband: '#161616' }
  };
  const OUTLINE = '#0a1424';   // donkere rand rond figuren
  const HUD_FONT = '"Press Start 2P", monospace';

  function hash(n) {
    const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, cssW = -1, cssH = -1;
    // camera
    let f = 1, camH = 3, cx = 0, hy = 0;
    let fogGrad = null, floorGrad = null, vignette = null;
    let bg = null, bgKey = '', fontKey = 0;
    // het pixellettertype komt later binnen: dan het panorama opnieuw schilderen
    try {
      const doc = canvas.ownerDocument;
      if (doc && doc.fonts && doc.fonts.ready) {
        doc.fonts.ready.then(() => { fontKey++; });
        if (doc.fonts.addEventListener) doc.fonts.addEventListener('loadingdone', () => { fontKey++; });
      }
    } catch (e) { /* geen fonts-api */ }
    let kit = KITS.club;    // tenue van de speler
    const list = [];        // hergebruikte tekenlijst
    const tableRows = {};   // row -> bitmasker van banen met tafel

    function layout() {
      const laneW = Math.min(W * LANE_FRAC_W, H * LANE_FRAC_H);
      const feetY = H * FEET_FRAC;
      const want = feetY - H * HORIZON_FRAC;
      camH = clamp(LANE_W * want / laneW, CAM_H_MIN, CAM_H_MAX);
      f = laneW * CAM_BACK / LANE_W;
      hy = feetY - camH * f / CAM_BACK;
      cx = W / 2;
      fogGrad = ctx.createLinearGradient(0, hy, 0, hy + (H - hy) * 0.22);
      fogGrad.addColorStop(0, 'rgba(26,60,110,0.6)');
      fogGrad.addColorStop(1, 'rgba(26,60,110,0)');
      floorGrad = ctx.createLinearGradient(0, hy, 0, H);
      floorGrad.addColorStop(0, C.floorD);
      floorGrad.addColorStop(1, C.floor);
      vignette = ctx.createRadialGradient(cx, H * 0.55, Math.min(W, H) * 0.35, cx, H * 0.55, Math.hypot(W, H) * 0.62);
      vignette.addColorStop(0, 'rgba(2,19,43,0)');
      vignette.addColorStop(1, 'rgba(2,19,43,0.38)');
    }

    function resize() {
      cssW = canvas.clientWidth || canvas.width || 360;
      cssH = canvas.clientHeight || canvas.height || 640;
      const winDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      dpr = Math.min(2, winDpr);
      W = cssW; H = cssH;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout();
    }

    /* ---------- statische achtergrond ---------- */
    function makeCanvas(w, h) {
      try {
        const doc = canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (doc && doc.createElement) {
          const c = doc.createElement('canvas'); c.width = w; c.height = h; return c;
        }
        if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
      } catch (e) { /* geen cache mogelijk */ }
      return null;
    }

    /* Panorama van de hal: plafond en muur, P pixels breed (P > W) zodat elk
       herkenningspunt maar één keer voorkomt. Alles wat over de volle breedte
       loopt, is periodiek met P: de naad valt nooit op. Wat op de vloer staat,
       hoort hier niet: dat zou in een bocht over de baan schuiven. */
    function paintHall(g, P) {
      const ceil = hy * 0.22;
      // plafond met vakwerkspanten
      const cg = g.createLinearGradient(0, 0, 0, ceil);
      cg.addColorStop(0, '#010a18');
      cg.addColorStop(1, C.ink);
      g.fillStyle = cg;
      g.fillRect(0, 0, P, ceil);
      const nt = Math.max(8, Math.round(P / 56)), tw = P / nt;
      g.strokeStyle = 'rgba(158,212,255,0.09)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, ceil * 0.3); g.lineTo(P, ceil * 0.3);
      for (let i = 0; i < nt; i++) {
        const x = i * tw;
        g.moveTo(x, ceil); g.lineTo(x + tw / 2, ceil * 0.3); g.lineTo(x + tw, ceil);
      }
      g.stroke();

      // muur in clubblauw
      const wall = g.createLinearGradient(0, ceil, 0, hy);
      wall.addColorStop(0, C.blueDD);
      wall.addColorStop(1, C.blueD);
      g.fillStyle = wall;
      g.fillRect(0, ceil, P, hy - ceil);

      // hoge ramen: daglicht, in een band net onder het plafond
      const winH = Math.max(4, hy * 0.075), winY = ceil + hy * 0.03;
      const nw = Math.max(4, Math.round(P / 150)), ww = P / nw;
      const wg = g.createLinearGradient(0, winY, 0, winY + winH);
      wg.addColorStop(0, 'rgba(200,232,255,0.55)');
      wg.addColorStop(1, 'rgba(120,180,240,0.25)');
      for (let i = 0; i < nw; i++) {
        const x = i * ww + ww * 0.12;
        g.fillStyle = wg;
        g.fillRect(x, winY, ww * 0.76, winH);
        g.fillStyle = 'rgba(6,42,86,0.9)';
        for (let k = 1; k < 4; k++) g.fillRect(x + ww * 0.76 * k / 4 - 0.5, winY, 1, winH);
      }

      // muurpanelen
      g.strokeStyle = 'rgba(158,212,255,0.10)';
      g.lineWidth = 1;
      g.beginPath();
      const np = Math.max(6, Math.round(P / 90));
      for (let i = 0; i < np; i++) { const x = Math.round(i * P / np) + 0.5; g.moveTo(x, winY + winH + 3); g.lineTo(x, hy); }
      g.stroke();
      // plint met gouden bies
      const plTop = hy - hy * 0.09;
      g.fillStyle = C.blueM;
      g.fillRect(0, plTop, P, hy * 0.09);
      g.fillStyle = C.gold;
      g.fillRect(0, plTop, P, Math.max(1, hy * 0.012));
      // reclameborden op de plint, periodiek
      const na = Math.max(4, Math.round(P / 110)), aw = P / na;
      for (let i = 0; i < na; i++) {
        g.fillStyle = i % 2 ? 'rgba(200,36,42,0.55)' : 'rgba(2,19,43,0.45)';
        g.fillRect(i * aw + aw * 0.08, plTop + hy * 0.025, aw * 0.84, hy * 0.05);
      }

      // ---- herkenningspunten, elk één keer ----
      const midY = ceil + (plTop - ceil) * 0.5;
      g.textAlign = 'center';
      g.textBaseline = 'middle';

      // scorebord (LED-cijfers in het pixellettertype van de HUD)
      // op maat van de muur, niet van de breedte: in landschap is de muur laag
      const wallH = plTop - winY - winH;
      const sw = clamp(Math.min(W * 0.3, wallH * 1.15), 60, 260), sh = sw * 0.42;
      const sx0 = W * 0.5 - sw / 2, sy0 = winY + winH + wallH * 0.36 - sh / 2;
      g.fillStyle = C.chrome;
      g.fillRect(sx0 - 3, sy0 - 3, sw + 6, sh + 6);
      g.fillStyle = C.ink;
      g.fillRect(sx0, sy0, sw, sh);
      g.font = 'bold ' + Math.round(sh * 0.17) + 'px system-ui, sans-serif';
      g.fillStyle = C.chrome;
      g.fillText('THUIS', sx0 + sw * 0.25, sy0 + sh * 0.2);
      g.fillText('GAST', sx0 + sw * 0.75, sy0 + sh * 0.2);
      g.font = Math.round(sh * 0.36) + 'px ' + HUD_FONT;
      g.fillStyle = C.gold;
      g.fillText('11', sx0 + sw * 0.25, sy0 + sh * 0.64);
      g.fillStyle = '#ff4a3d';
      g.fillText('9', sx0 + sw * 0.75, sy0 + sh * 0.64);
      g.fillStyle = C.gold;
      g.fillText(':', sx0 + sw * 0.5, sy0 + sh * 0.62);

      // clubbanner onder het scorebord
      banner(g, W * 0.5, sy0 + sh + 3, plTop, W * 0.5, 'TTC WIELSBEKE-SPOTIT', C.ink, C.gold, C.white);

      // ventilator
      const fr = clamp(Math.min(hy * 0.13, wallH * 0.3), 8, 46);
      fan(g, W * 0.88, winY + winH + fr * 1.3, fr);

      // clubvlag: zwart met de drie strepen
      flag(g, W * 0.1, midY, clamp(Math.min(W * 0.12, wallH * 0.9), 26, 120));

      // klok
      const kr = clamp(Math.min(hy * 0.1, wallH * 0.22), 7, 36);
      clock(g, W * 1.18, winY + winH + kr * 1.6, kr);

      // tweede banner
      banner(g, W * 1.55, midY - hy * 0.08, plTop, W * 0.55, 'EINDELOOS SMASHEN', C.red, C.white, C.white);

      // vlaggetjeslijn in de clubstrepen
      const gx0 = W * 1.92, gx1 = Math.min(P - 6, W * 2.34), gy = winY + winH + hy * 0.05;
      const sag = hy * 0.05, nflag = Math.max(5, Math.round((gx1 - gx0) / 16));
      g.strokeStyle = 'rgba(244,244,244,0.7)'; g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, x = gx0 + (gx1 - gx0) * t, y = gy + sag * 4 * t * (1 - t);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
      const fs = (gx1 - gx0) / nflag;
      for (let i = 0; i < nflag; i++) {
        const t = (i + 0.5) / nflag, x = gx0 + (gx1 - gx0) * t, y = gy + sag * 4 * t * (1 - t);
        g.fillStyle = i % 4 === 3 ? C.white : CLUB.stripes[i % 4];
        g.beginPath(); g.moveTo(x - fs * 0.38, y); g.lineTo(x + fs * 0.38, y); g.lineTo(x, y + fs * 0.9); g.closePath(); g.fill();
      }
      // tweede vlag: de PIPS OUT!-noppen
      const bw = clamp(Math.min(W * 0.1, wallH * 0.8), 24, 100), bh = bw * 0.5, bx = W * 2.05, by = midY + hy * 0.06;
      g.fillStyle = PIPS.shirt; g.fillRect(bx, by, bw, bh);
      g.fillStyle = PIPS.pips[0];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
        g.beginPath(); g.arc(bx + bw * (c + 0.5 + (r % 2) * 0.5) / 6.5, by + bh * (r + 0.5) / 3, bh * 0.08, 0, Math.PI * 2); g.fill();
      }
    }

    function banner(g, mx, top, bottom, w, text, bgc, rule, ink) {
      const avail = bottom - top;
      const fs = Math.min(w / (text.length * 0.66), avail * 0.45);
      if (fs < 7) return;
      const h = fs * 1.7, y = top + (avail - h) / 2;
      g.fillStyle = bgc;
      g.fillRect(mx - w / 2, y, w, h);
      g.fillStyle = rule;
      g.fillRect(mx - w / 2, y, w, Math.max(1, h * 0.08));
      g.fillRect(mx - w / 2, y + h * 0.92, w, Math.max(1, h * 0.08));
      g.font = 'bold ' + Math.floor(fs) + 'px system-ui, sans-serif';
      g.fillStyle = ink;
      g.fillText(text, mx, y + h * 0.53, w * 0.94);
    }

    function fan(g, fx, fy, fr) {
      g.fillStyle = '#26364f';
      g.beginPath(); g.arc(fx, fy, fr, 0, Math.PI * 2); g.fill();
      g.fillStyle = C.chrome;
      for (let b = 0; b < 3; b++) {
        const a = b * Math.PI * 2 / 3 + 0.3;
        g.beginPath();
        g.ellipse(fx + Math.cos(a) * fr * 0.45, fy + Math.sin(a) * fr * 0.45, fr * 0.45, fr * 0.2, a, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = C.ink; g.lineWidth = Math.max(1, fr * 0.08);
      g.beginPath(); g.arc(fx, fy, fr, 0, Math.PI * 2); g.stroke();
      g.fillStyle = C.ink;
      g.beginPath(); g.arc(fx, fy, fr * 0.15, 0, Math.PI * 2); g.fill();
    }

    function flag(g, bx, by, bw) {
      const bh = bw * 0.5;
      g.fillStyle = CLUB.shirt; g.fillRect(bx, by, bw, bh);
      for (let i = 0; i < 3; i++) {
        g.fillStyle = CLUB.stripes[i];
        g.fillRect(bx, by + bh * (0.3 + i * 0.16), bw, bh * 0.11);
      }
      g.fillStyle = C.white; g.fillRect(bx, by, bw, Math.max(1, bh * 0.06));
    }

    function clock(g, x, y, r) {
      g.fillStyle = C.ink;
      g.beginPath(); g.arc(x, y, r * 1.12, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f4f4f4';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.ink; g.lineCap = 'round';
      g.lineWidth = Math.max(1, r * 0.09);
      g.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        g.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78);
        g.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
      }
      g.stroke();
      g.lineWidth = Math.max(1, r * 0.12);
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x - r * 0.42, y - r * 0.3);   // tien over tien
      g.moveTo(x, y); g.lineTo(x + r * 0.5, y - r * 0.5);
      g.stroke();
      g.fillStyle = C.red;
      g.beginPath(); g.arc(x, y, r * 0.08, 0, Math.PI * 2); g.fill();
      g.lineCap = 'butt';
    }

    let panoW = 0, panoH = 0;
    function drawBackground() {
      const key = W + 'x' + H + 'x' + dpr + 'x' + fontKey;
      if (bgKey !== key) {
        bgKey = key;
        panoW = Math.round(W * 2.4);
        panoH = Math.ceil(hy) + 1;
        bg = makeCanvas(Math.round(panoW * dpr), Math.round(panoH * dpr));
        if (bg) {
          const g = bg.getContext('2d');
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          paintHall(g, panoW);
        }
      }
      // vloer: oranje clubhout (horizontaal overal gelijk, dus niet in het panorama)
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, hy, W, H - hy);
      // panorama: schuift met de draaiing van de hal, rond met periode panoW
      const P = panoW;
      let x = ((bgShift % P) + P) % P;
      while (x > 0) x -= P;
      for (; x < W; x += P) {
        if (bg) ctx.drawImage(bg, x, 0, P, panoH);
        else { ctx.save(); ctx.translate(x, 0); ctx.beginPath(); ctx.rect(0, 0, P, hy); ctx.clip(); paintHall(ctx, P); ctx.restore(); }
      }
    }

    /* ---------- projectie ---------- */
    let camX = 0, camZ = 0, bgShift = 0;
    function sx(x, d) { return cx + (x + offAt(d) - camX) * f / d; }
    function sy(y, d) { return hy + (camH - y) * f / d; }

    /* ---------- bochten ----------
       Klassieke pseudo-3D-bocht t.o.v. de huidige looprichting van de speler:
       kromming twee keer integreren vanaf de speler (stap 1 m), elke x op
       diepte d schuift op met off(d). Achter de speler: 0. */
    const offTab = new Float64Array(OFF_N + 1);
    const nearCorners = [];
    let offOn = false;

    function buildOff(state, dist) {
      offOn = false;
      const T = root.TTR, cs = state.corners;
      if (!cs || !cs.length || !T || typeof T.curveAt !== 'function') return;
      nearCorners.length = 0;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (c.z + c.len >= dist && c.z <= dist + OFF_N) nearCorners.push(c);
      }
      if (!nearCorners.length) return;
      offOn = true;
      let h = 0, o = 0;
      offTab[0] = 0;
      for (let i = 1; i <= OFF_N; i++) {
        h += T.curveAt(nearCorners, dist + i - 0.5);
        o += h;
        offTab[i] = o;
      }
    }

    function offAt(d) {
      if (!offOn) return 0;
      const dd = d - CAM_BACK;
      if (dd <= 0) return 0;
      let o;
      if (dd >= OFF_N) o = offTab[OFF_N];
      else { const i = dd | 0, t = dd - i; o = offTab[i] + (offTab[i + 1] - offTab[i]) * t; }
      const lim = OFF_CLAMP * W * d / f;   // op het scherm nooit meer dan ±OFF_CLAMP·W opzij
      return o > lim ? lim : o < -lim ? -lim : o;
    }

    // dieptes voor gebogen lijnen op de vloer (geometrisch verdeeld)
    const steps = [];
    function depthSteps(dA, dB, n) {
      steps.length = 0;
      const r = dB / dA;
      for (let i = 0; i <= n; i++) steps.push(dA * Math.pow(r, i / n));
      return steps;
    }

    // band op de vloer tussen x0..x1, van diepte dA tot dB, volgt de bocht
    function stripFloor(x0, x1, dA, dB) {
      if (!offOn) { quadFloor(x0, x1, dA, dB); return; }
      depthSteps(dA, dB, STRIP_STEPS);
      ctx.moveTo(sx(x0, steps[0]), sy(0, steps[0]));
      for (let i = 1; i < steps.length; i++) ctx.lineTo(sx(x0, steps[i]), sy(0, steps[i]));
      for (let i = steps.length - 1; i >= 0; i--) ctx.lineTo(sx(x1, steps[i]), sy(0, steps[i]));
      ctx.closePath();
    }

    function quadFloor(x0, x1, d0, d1) {   // vlak op y=0 tussen x0..x1 en dieptes d0..d1
      ctx.moveTo(sx(x0, d0), sy(0, d0));
      ctx.lineTo(sx(x1, d0), sy(0, d0));
      ctx.lineTo(sx(x1, d1), sy(0, d1));
      ctx.lineTo(sx(x0, d1), sy(0, d1));
      ctx.closePath();
    }

    function drawFloor(dist) {
      const dNear = Math.max(NEAR, camH * f / (H - hy) * 0.9);
      const dFar = VIEW_AHEAD + CAM_BACK + 10;
      // dwarse parketbanden
      const z0 = Math.floor((camZ + dNear) / BAND);
      const z1 = Math.ceil((camZ + dFar) / BAND);
      ctx.fillStyle = 'rgba(90,35,8,0.13)';
      ctx.beginPath();
      for (let i = z0; i <= z1; i++) {
        if (hash(i) < 0.4) {
          const da = Math.max(i * BAND - camZ, dNear), db = (i + 1) * BAND - camZ;
          const ya = sy(0, da), yb = sy(0, db);
          if (ya - yb < 0.6) break;
          ctx.rect(0, yb, W, ya - yb);
        }
      }
      ctx.fill();
      ctx.fillStyle = 'rgba(255,190,140,0.10)';
      ctx.beginPath();
      for (let i = z0; i <= z1; i++) {
        if (hash(i) > 0.7) {
          const da = Math.max(i * BAND - camZ, dNear), db = (i + 1) * BAND - camZ;
          const ya = sy(0, da), yb = sy(0, db);
          if (ya - yb < 0.6) break;
          ctx.rect(0, yb, W, ya - yb);
        }
      }
      ctx.fill();
      // naden
      ctx.strokeStyle = 'rgba(80,30,5,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = z0; i <= z1; i++) {
        const d = i * BAND - camZ;
        if (d < dNear) continue;
        const y = sy(0, d), y2 = sy(0, d + BAND);
        if (y - y2 < 3) break;
        ctx.moveTo(0, y); ctx.lineTo(W, y);
      }
      // planken in de lengte
      const xMax = (W / 2) * dNear / f + Math.abs(camX) + PLANK;
      // in een bocht: extra planken aan de kant waar de baan naartoe draait
      const offFar = offOn ? clamp(offAt(dFar), -12, 12) : 0;
      const k0 = Math.ceil((-xMax + Math.min(0, offFar)) / PLANK), k1 = Math.floor((xMax + Math.max(0, offFar)) / PLANK);
      if (offOn) depthSteps(dNear, dFar, STRIP_STEPS);
      for (let k = k0; k <= k1; k++) {
        const x = k * PLANK;
        ctx.moveTo(sx(x, dNear), sy(0, dNear));
        if (offOn) for (let i = 1; i < steps.length; i++) ctx.lineTo(sx(x, steps[i]), sy(0, steps[i]));
        else ctx.lineTo(sx(x, dFar), sy(0, dFar));
      }
      ctx.stroke();

      // zijlijnen van het speelveld (taps, volgen de bocht)
      ctx.fillStyle = C.line;
      ctx.beginPath();
      stripFloor(-COURT_X - 0.05, -COURT_X + 0.05, dNear, dFar);
      stripFloor(COURT_X - 0.05, COURT_X + 0.05, dNear, dFar);
      ctx.fill();
      // baanscheiding: subtiele streepjes die meeschuiven
      ctx.fillStyle = 'rgba(245,233,200,0.32)';
      ctx.beginPath();
      const dash = 3, on = 1.5;
      const j0 = Math.floor((camZ + dNear) / dash), j1 = Math.ceil((camZ + 50) / dash);
      for (let j = j0; j <= j1; j++) {
        const da = Math.max(j * dash - camZ, dNear), db = j * dash + on - camZ;
        if (db <= da) continue;
        quadFloor(-LANE_W / 2 - 0.03, -LANE_W / 2 + 0.03, da, db);
        quadFloor(LANE_W / 2 - 0.03, LANE_W / 2 + 0.03, da, db);
      }
      ctx.fill();

      drawReflections();

      // omheining langs de baan (rood/blauw), schuift mee
      const seg = 2.5, blen = 2.2, bh = 0.6;
      const b0 = Math.floor((camZ + 1) / seg), b1 = Math.ceil((camZ + 55) / seg);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? C.red : C.blueM;
        ctx.beginPath();
        for (let b = b1; b >= b0; b--) {
          if ((hash(b * 3.1) > 0.45 ? 1 : 0) !== pass) continue;
          const da = Math.max(b * seg - camZ, 1), db = b * seg + blen - camZ;
          if (db <= da) continue;
          for (let side = -1; side <= 1; side += 2) {
            const x = side * BARRIER_X;
            ctx.moveTo(sx(x, da), sy(0, da));
            ctx.lineTo(sx(x, db), sy(0, db));
            ctx.lineTo(sx(x, db), sy(bh, db));
            ctx.lineTo(sx(x, da), sy(bh, da));
            ctx.closePath();
          }
        }
        ctx.fill();
      }
      // witte bovenrand van de omheining
      ctx.strokeStyle = 'rgba(255,210,63,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let side = -1; side <= 1; side += 2) {
        const x = side * BARRIER_X;
        for (let b = b0; b <= b1; b++) {
          const da = Math.max(b * seg - camZ, 1), db = b * seg + blen - camZ;
          if (db <= da) continue;
          ctx.moveTo(sx(x, da), sy(bh, da));
          ctx.lineTo(sx(x, db), sy(bh, db));
        }
      }
      ctx.stroke();

      // nevel bij de horizon
      ctx.fillStyle = fogGrad;
      ctx.fillRect(0, hy, W, (H - hy) * 0.22);
    }

    /* ---------- licht ----------
       De lampen hangen in twee rijen boven de baan, buiten beeld. Je ziet ze
       in de glanzende sportvloer: spiegelingen die meeschuiven. (De lampen
       zelf zouden over de achterwand vallen: die staat op oneindig.) */
    const LAMP_Y = 7.5, LAMP_X = 2.4, LAMP_SEG = 9, LAMP_LEN = 1.6;

    function lampRange() {
      return [Math.floor((camZ + 1) / LAMP_SEG), Math.ceil((camZ + VIEW_AHEAD) / LAMP_SEG)];
    }

    function drawReflections() {
      const [k0, k1] = lampRange();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // een glanzende vloer rekt de spiegeling uit in de diepte: brede, zwakke veeg + smalle kern
      const layers = [[0.5, 1.6, 0.035], [0.22, 0.7, 0.05]];
      for (const [hw, ext, a] of layers) {
        ctx.fillStyle = 'rgba(255,220,180,' + a + ')';
        ctx.beginPath();
        for (let k = k0; k <= k1; k++) {
          const za = k * LAMP_SEG - ext - camZ, zb = k * LAMP_SEG + LAMP_LEN + ext - camZ;
          if (za < 2) continue;
          for (let side = -1; side <= 1; side += 2) {
            const x = side * LAMP_X, ya = sy(-LAMP_Y, za), yb = sy(-LAMP_Y, zb);
            if (ya < hy) continue;
            const xa = sx(x, za), xb = sx(x, zb), wa = hw * f / za, wb = hw * f / zb;
            ctx.moveTo(xa - wa, ya); ctx.lineTo(xa + wa, ya);
            ctx.lineTo(xb + wb, yb); ctx.lineTo(xb - wb, yb);
            ctx.closePath();
          }
        }
        ctx.fill();
      }
      ctx.restore();
    }

    // horizontaal vlak op hoogte y tussen x0..x1 en dieptes d0..d1
    function quadAt(x0, x1, d0, d1, y) {
      ctx.moveTo(sx(x0, d0), sy(y, d0));
      ctx.lineTo(sx(x1, d0), sy(y, d0));
      ctx.lineTo(sx(x1, d1), sy(y, d1));
      ctx.lineTo(sx(x0, d1), sy(y, d1));
      ctx.closePath();
    }

    /* ---------- aankleding langs de baan ----------
       Om de SIDE_SEG meter, links en rechts buiten de omheining: reservetafels,
       de trainersbank, een ballenbak, een scheidsrechterstafel, supporters.
       Vast per plaats (hash): niets flikkert, en alles schuift echt voorbij. */
    const SIDE_SEG = 7, SIDE_X = 4.7;
    const SIDE_KINDS = ['table', 'table', 'bench', 'basket', 'umpire', 'fan', 'fan'];
    const FAN_SHIRTS = [CLUB.shirt, '#c8242a', '#1a5ca8', '#e0b520', '#2fa84f', '#f4f4f4'];

    function addSideProps() {
      const k0 = Math.floor((camZ + 2) / SIDE_SEG), k1 = Math.ceil((camZ + VIEW_AHEAD) / SIDE_SEG);
      for (let k = k0; k <= k1; k++) {
        for (let side = -1; side <= 1; side += 2) {
          const h = hash(k * 7.13 + side * 31.7);
          if (h < 0.3) continue;
          const kind = SIDE_KINDS[Math.floor(hash(k * 3.71 + side * 5.3) * SIDE_KINDS.length)];
          const z = k * SIDE_SEG + hash(k * 1.37 - side) * 3;
          const len = kind === 'table' ? 2.74 : kind === 'bench' ? 3 : 0.6;
          const key = z + len / 2 - camZ;
          if (z - camZ < 2.5) continue;   // dichterbij valt het toch buiten beeld
          const x = side * (SIDE_X + (kind === 'table' ? 0.5 : 0) + hash(k * 2.9 + side) * 0.8);
          list.push({ key, it: null, side: { kind, x, z, len, seed: k * 2 + (side > 0 ? 1 : 0) } });
        }
      }
    }

    function drawSide(p, frame) {
      const d0 = Math.max(NEAR, p.z - camZ), d1 = p.z + p.len - camZ;
      if (p.kind === 'table') { drawSideTable(p.x, d0, d1); return; }
      if (p.kind === 'bench') { drawBench(p, d0, d1, frame); return; }
      const d = (d0 + d1) / 2, s = f / d;
      ctx.save();
      ctx.translate(sx(p.x, d), sy(0, d));
      ctx.scale(s, s);
      shadow(0.45);
      if (p.kind === 'basket') {
        ctx.fillStyle = C.legs;
        ctx.fillRect(-0.3, -0.55, 0.04, 0.55); ctx.fillRect(0.26, -0.55, 0.04, 0.55);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
          const bx = -0.24 + (i % 5) * 0.12 + (i > 4 ? 0.06 : 0), by = i > 4 ? -0.98 : -0.9;
          ctx.moveTo(bx + 0.06, by); ctx.arc(bx, by, 0.06, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.fillStyle = C.blueM;
        ctx.fillRect(-0.34, -0.88, 0.68, 0.36);
        ctx.fillStyle = C.gold;
        ctx.fillRect(-0.34, -0.88, 0.68, 0.05);
      } else if (p.kind === 'umpire') {
        ctx.fillStyle = C.legs;
        ctx.fillRect(-0.35, -0.72, 0.04, 0.72); ctx.fillRect(0.31, -0.72, 0.04, 0.72);
        ctx.fillStyle = '#0d2c57';
        ctx.fillRect(-0.4, -0.76, 0.8, 0.08);
        // telbord
        ctx.fillStyle = '#111';
        ctx.fillRect(-0.3, -1.12, 0.6, 0.36);
        ctx.fillStyle = '#f4f4f4';
        ctx.fillRect(-0.27, -1.08, 0.25, 0.28);
        ctx.fillRect(0.02, -1.08, 0.25, 0.28);
        ctx.fillStyle = '#111';
        ctx.scale(0.01, 0.01);           // tekst in honderdsten: geen piepkleine lettergrootte
        ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(3 + (p.seed % 8)), -14.5, -93);
        ctx.fillText(String(1 + (p.seed % 9)), 14.5, -93);
      } else {
        drawFan(p, frame);
      }
      ctx.restore();
    }

    function shadow(r) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    }

    // supporter: springt en klapt af en toe
    function drawFan(p, frame) {
      const shirt = FAN_SHIRTS[p.seed % FAN_SHIRTS.length];
      const hair = ['#3a2618', '#111', '#a0622d', '#e2c27a'][p.seed % 4];
      const ph = frame * 0.18 + p.seed * 1.7;
      const cheer = Math.sin(ph * 0.25) > 0.3;
      const hop = cheer ? Math.max(0, Math.sin(ph)) * 0.08 : 0;
      ctx.translate(0, -hop);
      limb(-0.1, -0.85, -0.1, -0.05, 0.12, C.skin);
      limb(0.1, -0.85, 0.1, -0.05, 0.12, C.skin);
      ctx.fillStyle = '#1c2430';
      ctx.fillRect(-0.2, -0.98, 0.4, 0.26);
      const up = cheer ? -0.62 + Math.sin(ph) * 0.12 : 0;
      limb(-0.22, -1.38, -0.32, cheer ? -1.85 - up * 0.2 : -0.98, 0.09, C.skin);
      limb(0.22, -1.38, 0.32, cheer ? -1.85 + up * 0.2 : -0.98, 0.09, C.skin);
      ctx.fillStyle = shirt;
      roundRect(-0.25, -1.45, 0.5, 0.52, 0.08); ctx.fill();
      ctx.fillStyle = C.skin;
      ctx.beginPath(); ctx.arc(0, -1.6, 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hair;
      ctx.beginPath(); ctx.arc(0, -1.64, 0.14, Math.PI, Math.PI * 2); ctx.fill();
    }

    function drawSideTable(xm, d0, d1) {
      const x0 = xm - 0.76, x1 = xm + 0.76, top = 0.76;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath(); quadFloor(x0 + 0.05, x1 - 0.05, d0 + 0.1, d1 - 0.1); ctx.fill();
      ctx.strokeStyle = C.legs;
      ctx.lineWidth = Math.max(1, 0.05 * f / d0);
      ctx.beginPath();
      for (const d of [d0 + 0.3, d1 - 0.3]) {
        for (const x of [x0 + 0.15, x1 - 0.15]) { ctx.moveTo(sx(x, d), sy(0, d)); ctx.lineTo(sx(x, d), sy(top, d)); }
      }
      ctx.stroke();
      // zijkant naar de camera
      const xs = xm > camX ? x0 : x1;
      ctx.fillStyle = C.tableD;
      ctx.beginPath();
      ctx.moveTo(sx(xs, d0), sy(top, d0)); ctx.lineTo(sx(xs, d1), sy(top, d1));
      ctx.lineTo(sx(xs, d1), sy(top - 0.05, d1)); ctx.lineTo(sx(xs, d0), sy(top - 0.05, d0));
      ctx.closePath(); ctx.fill();
      ctx.fillRect(sx(x0, d0), sy(top, d0), sx(x1, d0) - sx(x0, d0), 0.05 * f / d0 + 1);
      ctx.fillStyle = C.table;
      ctx.beginPath(); quadAt(x0, x1, d0, d1, top); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(0.6, 0.02 * f / d0);
      ctx.beginPath(); quadAt(x0 + 0.02, x1 - 0.02, d0 + 0.02, d1 - 0.02, top); ctx.stroke();
      // net dwars over het midden
      const dm = (d0 + d1) / 2;
      ctx.fillStyle = 'rgba(240,240,240,0.75)';
      ctx.beginPath();
      ctx.moveTo(sx(x0 - 0.1, dm), sy(top, dm)); ctx.lineTo(sx(x1 + 0.1, dm), sy(top, dm));
      ctx.lineTo(sx(x1 + 0.1, dm), sy(top + 0.15, dm)); ctx.lineTo(sx(x0 - 0.1, dm), sy(top + 0.15, dm));
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    function drawBench(p, d0, d1, frame) {
      const x0 = p.x - 0.22, x1 = p.x + 0.22, seat = 0.45;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath(); quadFloor(x0, x1, d0, d1); ctx.fill();
      const xs = p.x > camX ? x0 : x1;
      ctx.fillStyle = '#3e230f';
      ctx.beginPath();
      ctx.moveTo(sx(xs, d0), sy(seat, d0)); ctx.lineTo(sx(xs, d1), sy(seat, d1));
      ctx.lineTo(sx(xs, d1), sy(0, d1)); ctx.lineTo(sx(xs, d0), sy(0, d0));
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6b3f1d';
      ctx.beginPath(); quadAt(x0, x1, d0, d1, seat); ctx.fill();
      // de trainer en zijn sporttas
      const d = d0 + 0.8, s = f / d;
      ctx.translate(sx(p.x, d), sy(seat, d));
      ctx.scale(s, s);
      const nod = Math.sin(frame * 0.05 + p.seed) * 0.02;
      ctx.fillStyle = '#111';
      ctx.fillRect(-0.2, -0.12, 0.4, 0.14);
      ctx.fillStyle = C.blueD;
      roundRect(-0.25, -0.75, 0.5, 0.66, 0.08); ctx.fill();
      ctx.fillStyle = C.chrome;
      ctx.fillRect(-0.25, -0.75, 0.5, 0.04);
      ctx.fillStyle = C.skin;
      ctx.beginPath(); ctx.arc(nod, -0.9, 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a8f96';
      ctx.beginPath(); ctx.arc(nod, -0.94, 0.14, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.blueM;
      roundRect(0.35, -0.3, 0.5, 0.3, 0.06); ctx.fill();
      ctx.fillStyle = C.gold;
      ctx.fillRect(0.35, -0.22, 0.5, 0.04);
      ctx.restore();
    }

    // ledemaat: afgeronde lijn met een donkere rand
    function limb(x0, y0, x1, y1, w, col) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = w + 0.04;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /* ---------- figuren (in meter, y omhoog = negatief) ---------- */
    /* een vlak vol noppen (rubber met korte noppen naar buiten), in meter.
       s = pixels per meter: een nop wordt nooit kleiner dan 4 px, dan blijft het goedkoop.
       Per kleur één pad, dus drie fills per vlak. */
    function drawPips(x, y, w, h, cell, col, s) {
      const c = Math.max(cell, 4 / s), r = c * 0.3;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      const layers = c * s >= 6 ? 3 : 2;
      for (let k = 0; k < layers; k++) {
        const ox = k === 0 ? r * 0.25 : k === 2 ? -r * 0.3 : 0;
        const oy = k === 0 ? r * 0.35 : k === 2 ? -r * 0.3 : 0;
        const rr = k === 2 ? r * 0.4 : r;
        ctx.fillStyle = col[2 - k];
        ctx.beginPath();
        let j = 0;
        for (let py = y + c / 2; py < y + h + c; py += c * 0.87, j++) {
          for (let px = x + (j % 2 ? c / 2 : 0); px < x + w + c; px += c) {
            ctx.moveTo(px + ox + rr, py + oy);
            ctx.arc(px + ox, py + oy, rr, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      }
      ctx.restore();
    }

    /* noppenspeler in PIPS OUT!-tenue, kijkt naar de speler en wacht in
       klaarstand: door de knieën, wippend op de voorvoeten */
    function drawNopper(item, d, frame) {
      const s = f / d;
      const x = (item.lane - 1) * LANE_W;
      ctx.save();
      ctx.translate(sx(x, d), sy(0, d));
      ctx.scale(s, s);
      if (item.broken) { ctx.globalAlpha *= 0.35; ctx.rotate(0.6); }
      shadow(0.42);
      const seed = item.z * 1.7 + item.lane;
      const bounce = Math.abs(Math.sin(frame * 0.16 + seed)) * 0.05;
      const sway = Math.sin(frame * 0.08 + seed) * 0.03;
      ctx.translate(0, -bounce);
      // benen in klaarstand: knieën naar buiten
      for (const side of [-1, 1]) {
        limb(side * 0.12, -0.84, side * 0.2, -0.45, 0.15, C.skin);
        limb(side * 0.2, -0.45, side * 0.15, -0.12 + bounce, 0.12, C.skin);
        limb(side * 0.15, -0.16 + bounce, side * 0.15, -0.06 + bounce, 0.13, C.white);
        ctx.fillStyle = OUTLINE;
        roundRect(side * 0.15 - 0.1, -0.08 + bounce, 0.2, 0.11, 0.04); ctx.fill();
        ctx.fillStyle = '#e8e8e8';
        roundRect(side * 0.15 - 0.085, -0.07 + bounce, 0.17, 0.08, 0.03); ctx.fill();
      }
      // short
      ctx.fillStyle = PIPS.shorts;
      roundRect(-0.26, -1.0, 0.52, 0.3, 0.05); ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.03; ctx.stroke();
      // vrije arm voor het lijf, klaar om te blokken
      limb(-0.3, -1.42, -0.42, -1.12, 0.11, C.skin);
      limb(-0.42, -1.12, -0.24, -1.02, 0.1, C.skin);
      // shirt: rood rubber met noppen
      ctx.save();
      roundRect(-0.29, -1.52, 0.58, 0.6, 0.07);
      ctx.fillStyle = PIPS.shirt; ctx.fill();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.03; ctx.stroke();
      ctx.restore();
      drawPips(-0.27, -1.5, 0.54, 0.56, 0.075, PIPS.pips, s);
      ctx.fillStyle = PIPS.trim;
      ctx.fillRect(-0.14, -1.52, 0.28, 0.04);       // boord
      ctx.fillRect(-0.29, -0.97, 0.58, 0.05);       // zoom
      // mouwen
      ctx.fillStyle = PIPS.shirt;
      roundRect(-0.4, -1.5, 0.14, 0.16, 0.04); ctx.fill();
      roundRect(0.26, -1.5, 0.14, 0.16, 0.04); ctx.fill();
      // hoofd
      const hx = sway;
      ctx.fillStyle = C.skin;
      ctx.fillRect(hx - 0.05, -1.6, 0.1, 0.1);
      ctx.fillStyle = OUTLINE;
      ctx.beginPath(); ctx.arc(hx, -1.68, 0.165, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.skin;
      ctx.beginPath(); ctx.arc(hx, -1.68, 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(hx, -1.72, 0.15, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(hx - 0.15, -1.73, 0.3, 0.03);
      // ogen + boze wenkbrauwen + grimas
      ctx.fillStyle = '#111';
      ctx.fillRect(hx - 0.075, -1.67, 0.035, 0.04);
      ctx.fillRect(hx + 0.04, -1.67, 0.035, 0.04);
      ctx.save();
      ctx.translate(hx - 0.06, -1.7); ctx.rotate(0.35); ctx.fillRect(-0.045, -0.01, 0.09, 0.02); ctx.restore();
      ctx.save();
      ctx.translate(hx + 0.06, -1.7); ctx.rotate(-0.35); ctx.fillRect(-0.045, -0.01, 0.09, 0.02); ctx.restore();
      ctx.fillRect(hx - 0.04, -1.59, 0.08, 0.015);
      // batarm omhoog met noppenrubber
      const lift = Math.sin(frame * 0.08 + seed) * 0.08;
      limb(0.3, -1.42, 0.44, -1.2, 0.11, C.skin);
      limb(0.44, -1.2, 0.4, -1.42 - lift, 0.1, C.skin);
      ctx.save();
      ctx.translate(0.4, -1.42 - lift);
      ctx.rotate(0.2 + sway * 2);
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(-0.045, -0.24, 0.09, 0.24);
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(-0.035, -0.23, 0.07, 0.22);
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.ellipse(0, -0.48, 0.25, 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PIPS.bat;
      ctx.beginPath(); ctx.ellipse(0, -0.48, 0.225, 0.255, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.ellipse(0, -0.48, 0.225, 0.255, 0, 0, Math.PI * 2); ctx.clip();
      drawPips(-0.23, -0.74, 0.46, 0.52, 0.055, PIPS.pips, s);
      ctx.restore();
      ctx.restore();
      ctx.restore();
    }

    /* gevarenstrook op de vloer onder alles waar je onderdoor moet:
       geel-zwart, dezelfde taal voor het net en de ballenmachine */
    function hazardStrip(xm, d0, d1) {
      const hw = LANE_W / 2 - 0.12, n = 6;
      const a = Math.max(NEAR, d0 - 0.9), b = d1 + 0.3, step = (b - a) / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(17,17,17,0.55)' : 'rgba(255,210,63,0.8)';
        ctx.beginPath(); quadFloor(xm - hw, xm + hw, a + i * step, a + (i + 1) * step); ctx.fill();
      }
    }

    function drawTable(item, d0, d1) {
      const xm = (item.lane - 1) * LANE_W;
      const x0 = xm - LANE_W / 2, x1 = xm + LANE_W / 2;
      const top = 0.76, th = 0.05;
      ctx.save();
      if (item.broken) ctx.globalAlpha *= 0.3;
      // schaduw op de vloer
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); quadFloor(x0 + 0.05, x1 - 0.05, d0 + 0.1, d1 - 0.1); ctx.fill();
      // poten
      const lw = Math.max(1, 0.05 * f / d0);
      ctx.strokeStyle = C.legs;
      ctx.lineWidth = lw;
      ctx.beginPath();
      const lz = [d1 - 0.2, d0 + 0.2];
      for (let i = 0; i < 2; i++) {
        const d = lz[i];
        for (let k = 0; k < 2; k++) {
          const x = k ? x1 - 0.15 : x0 + 0.15;
          ctx.moveTo(sx(x, d), sy(0, d)); ctx.lineTo(sx(x, d), sy(top - th, d));
        }
      }
      ctx.stroke();
      // voorkant
      ctx.fillStyle = C.tableD;
      ctx.fillRect(sx(x0, d0), sy(top, d0), sx(x1, d0) - sx(x0, d0), th * f / d0 + 1);
      // blad, met een lichtglans naar achteren
      ctx.fillStyle = C.table;
      ctx.beginPath(); quadAt(x0, x1, d0, d1, top); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); quadAt(x0, x1, d0 + (d1 - d0) * 0.55, d1, top); ctx.fill();
      // witte randen
      const mask = item.row != null ? (tableRows[item.row] || 0) : 0;
      const hasL = item.lane > 0 && (mask & (1 << (item.lane - 1)));
      const hasR = item.lane < 2 && (mask & (1 << (item.lane + 1)));
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, 0.03 * f / d0);
      ctx.beginPath();
      ctx.moveTo(sx(x0, d0), sy(top, d0)); ctx.lineTo(sx(x1, d0), sy(top, d0));
      ctx.moveTo(sx(x0, d1), sy(top, d1)); ctx.lineTo(sx(x1, d1), sy(top, d1));
      if (!hasL) { ctx.moveTo(sx(x0 + 0.02, d0), sy(top, d0)); ctx.lineTo(sx(x0 + 0.02, d1), sy(top, d1)); }
      if (!hasR) { ctx.moveTo(sx(x1 - 0.02, d0), sy(top, d0)); ctx.lineTo(sx(x1 - 0.02, d1), sy(top, d1)); }
      ctx.stroke();
      ctx.lineWidth = Math.max(0.6, 0.012 * f / d0);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.moveTo(sx(xm, d0), sy(top, d0)); ctx.lineTo(sx(xm, d1), sy(top, d1));
      ctx.stroke();
      // netje dwars over het midden: zo is het meteen een tafeltennistafel
      const dm = (d0 + d1) / 2, nh = 0.15;
      ctx.fillStyle = 'rgba(20,24,30,0.55)';
      ctx.beginPath();
      ctx.moveTo(sx(x0, dm), sy(top, dm)); ctx.lineTo(sx(x1, dm), sy(top, dm));
      ctx.lineTo(sx(x1, dm), sy(top + nh, dm)); ctx.lineTo(sx(x0, dm), sy(top + nh, dm));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, 0.02 * f / dm);
      ctx.beginPath(); ctx.moveTo(sx(x0, dm), sy(top + nh, dm)); ctx.lineTo(sx(x1, dm), sy(top + nh, dm)); ctx.stroke();
      ctx.restore();
    }

    /* hangend net: aan kabels uit het plafond, met een gat eronder */
    function drawNet(item, d) {
      const s = f / d;
      const xm = (item.lane - 1) * LANE_W;
      ctx.save();
      if (item.broken) ctx.globalAlpha *= 0.3;
      if (!item.broken) hazardStrip(xm, d - 0.1, d + 0.1);
      // schaduw van het net, wat verder op de vloer
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.beginPath(); quadFloor(xm - LANE_W / 2 + 0.06, xm + LANE_W / 2 - 0.06, d + 0.25, d + 0.6); ctx.fill();
      ctx.translate(sx(xm, d), sy(0, d));
      ctx.scale(s, s);
      if (item.broken) ctx.rotate(0.2);
      const hw = LANE_W / 2 - 0.04, yb = -0.95, yt = -2.4, ceilY = -(camH + 6);
      // kabels naar het plafond
      ctx.strokeStyle = 'rgba(30,38,52,0.9)';
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(-hw + 0.05, yt); ctx.lineTo(-hw * 0.7, ceilY);
      ctx.moveTo(hw - 0.05, yt); ctx.lineTo(hw * 0.7, ceilY);
      ctx.stroke();
      // net
      ctx.fillStyle = 'rgba(15,25,45,0.5)';
      ctx.fillRect(-hw, yt, hw * 2, yb - yt);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 0.014;
      ctx.beginPath();
      for (let x = -hw; x <= hw + 0.001; x += 0.1) { ctx.moveTo(x, yt); ctx.lineTo(x, yb); }
      for (let y = yt; y <= yb + 0.001; y += 0.1) { ctx.moveTo(-hw, y); ctx.lineTo(hw, y); }
      ctx.stroke();
      // witte band boven, verzwaarde stang onder
      ctx.fillStyle = '#fff';
      ctx.fillRect(-hw, yt, hw * 2, 0.09);
      ctx.fillStyle = OUTLINE;
      roundRect(-hw - 0.03, yb - 0.07, hw * 2 + 0.06, 0.1, 0.05); ctx.fill();
      ctx.fillStyle = C.blueM;
      roundRect(-hw - 0.02, yb - 0.06, hw * 2 + 0.04, 0.08, 0.04); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-hw, yb - 0.05, hw * 2, 0.015);
      ctx.restore();
    }

    function drawMachine(item, d0, d1, frame) {
      const xm = (item.lane - 1) * LANE_W;
      const hw = 0.55, yb = 1.05, yt = 2.1;
      const x0 = xm - hw, x1 = xm + hw;
      ctx.save();
      if (item.broken) ctx.globalAlpha *= 0.3;
      const dm = (d0 + d1) / 2;
      if (!item.broken) hazardStrip(xm, d0, d1);
      // stang naar het plafond
      ctx.strokeStyle = '#444b55';
      ctx.lineWidth = Math.max(1, 0.06 * f / dm);
      ctx.beginPath();
      ctx.moveTo(sx(xm, dm), sy(yt, dm));
      ctx.lineTo(sx(xm, dm), sy(camH + 6, dm));
      ctx.stroke();
      // schaduw
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath(); quadFloor(x0, x1, d0, d1); ctx.fill();
      // bovenkant
      ctx.fillStyle = '#e0484d';
      ctx.beginPath(); quadAt(x0, x1, d0, d1, yt); ctx.fill();
      // zijkant (de kant naar de camera)
      const xs = xm > camX ? x0 : x1;
      if (Math.abs(xm - camX) > hw) {
        ctx.fillStyle = '#8d1519';
        ctx.beginPath();
        ctx.moveTo(sx(xs, d0), sy(yt, d0)); ctx.lineTo(sx(xs, d1), sy(yt, d1));
        ctx.lineTo(sx(xs, d1), sy(yb, d1)); ctx.lineTo(sx(xs, d0), sy(yb, d0));
        ctx.closePath(); ctx.fill();
      }
      // voorkant in meter
      const s = f / d0;
      ctx.translate(sx(xm, d0), sy(0, d0));
      ctx.scale(s, s);
      ctx.fillStyle = OUTLINE;
      roundRect(-hw - 0.02, -yt - 0.02, hw * 2 + 0.04, yt - yb + 0.04, 0.06); ctx.fill();
      ctx.fillStyle = C.red;
      roundRect(-hw, -yt, hw * 2, yt - yb, 0.05); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(-hw + 0.04, -yt + 0.04, hw * 2 - 0.08, 0.08);
      ctx.fillStyle = C.chrome;
      ctx.fillRect(-hw, -yb - 0.07, hw * 2, 0.05);
      ctx.fillStyle = C.gold;
      ctx.fillRect(-hw, -yb - 0.03, hw * 2, 0.03);
      // venster met ballen
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(-0.45, -1.58, 0.66, 0.41);
      ctx.fillStyle = '#cfe3f5';
      ctx.fillRect(-0.42, -1.55, 0.6, 0.35);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const bx = -0.36 + (i % 4) * 0.15 + (i > 3 ? 0.07 : 0), by = i > 3 ? -1.42 : -1.28;
        ctx.moveTo(bx + 0.06, by); ctx.arc(bx, by, 0.06, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillStyle = '#ff8a1e';
      ctx.beginPath(); ctx.arc(-0.21, -1.42, 0.06, 0, Math.PI * 2); ctx.fill();
      // uitwerpmond
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(0.36, -1.32, 0.11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.chrome; ctx.lineWidth = 0.025;
      ctx.beginPath(); ctx.arc(0.36, -1.32, 0.11, 0, Math.PI * 2); ctx.stroke();
      // zwaailicht met gloed: al van ver te zien
      const on = (frame >> 4) & 1;
      if (on) {
        ctx.fillStyle = 'rgba(255,80,60,0.28)';
        ctx.beginPath(); ctx.arc(0.36, -1.62, 0.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = on ? '#ff3b30' : '#5a1210';
      ctx.beginPath(); ctx.arc(0.36, -1.62, 0.055, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    /* sterretje + punten bij het pakken: puur uit hoe ver je al voorbij het item bent */
    const BURST_M = 1.8;
    const BURST_COL = { ball: C.gold, shield: C.chrome, magnet: C.gold, timeout: C.chrome, bak: C.gold };
    function drawBurst(it, state) {
      const t = clamp((state.dist - it.z) / BURST_M, 0, 1);
      const d = CAM_BACK, s = f / d;
      const x = ((state.x == null ? 1 : state.x) - 1) * LANE_W;
      const y = it.type === 'ball' ? (typeof it.y === 'number' ? it.y : (it.air ? 1.4 : 0.35)) : 0.6;
      const px = sx(x, d), py = sy(Math.max(y, (state.y || 0) + 0.9), d);
      const col = BURST_COL[it.type] || C.gold;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, 0.05 * s * (1 - t));
      ctx.beginPath(); ctx.arc(px, py, (0.15 + t * 0.55) * s, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + 0.3, r0 = (0.25 + t * 0.5) * s, r1 = r0 + 0.18 * s * (1 - t);
        ctx.moveTo(px + Math.cos(a) * r0, py + Math.sin(a) * r0);
        ctx.lineTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1);
      }
      ctx.stroke();
      if (it.type === 'ball') {
        const cfg = (root.TTR_CONFIG && root.TTR_CONFIG.game) || {};
        const pts = (cfg.ballPoints || 10) * (state.bak > 0 ? 2 : 1);
        const fs = Math.round(clamp(0.22 * s, 10, 22));
        ctx.font = fs + 'px ' + HUD_FONT;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(3, fs * 0.35);
        ctx.strokeStyle = C.ink;
        const ty = py - (0.5 + t * 0.6) * s;
        ctx.strokeText('+' + pts, px + 0.5 * s, ty);
        ctx.fillStyle = pts > (cfg.ballPoints || 10) ? C.gold : '#fff';
        ctx.fillText('+' + pts, px + 0.5 * s, ty);
      }
      ctx.restore();
    }

    /* snelheidsstrepen aan de randen, vanaf ~13 m/s: hoe sneller, hoe meer */
    function drawSpeed(state) {
      const v = state.vel || 0;
      const k = clamp((v - 13) / 9, 0, 1);
      if (k <= 0 || state.alive === false) return;
      const R = Math.hypot(W, H - hy);
      const t0 = (state.dist || 0) * 0.045;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.24 * k).toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const side = i % 2 ? 1 : -1;
        const a = side * (0.55 + hash(i * 3.3) * 0.9) + (side < 0 ? Math.PI : 0);   // schuin naar de zijkanten
        const ph = (t0 + hash(i * 7.7)) % 1;
        const r0 = R * (0.35 + ph * 0.75), r1 = r0 + R * (0.06 + 0.1 * k);
        const ca = Math.cos(a), sa = Math.abs(Math.sin(a));
        ctx.moveTo(cx + ca * r0, hy + sa * r0);
        ctx.lineTo(cx + ca * r1, hy + sa * r1);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawPickup(item, d, state) {
      const s = f / d;
      const x = typeof item.x === 'number' ? (item.x - 1) * LANE_W : (item.lane - 1) * LANE_W;
      const bob = Math.sin(state.frame * 0.1 + item.z * 0.7) * 0.06;
      let y;
      if (item.type === 'ball') y = typeof item.y === 'number' ? item.y : (item.air ? 1.4 : 0.35);
      else y = 0.6;
      y += bob;
      // schaduw
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(sx(x, d), sy(0, d), 0.2 * s, 0.06 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(sx(x, d), sy(y, d));
      ctx.scale(s, s);
      if (item.type === 'ball') {
        const gold = state.magnet > 0;
        ctx.fillStyle = gold ? '#c99a12' : '#c8ccd2';
        ctx.beginPath(); ctx.arc(0, 0, 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = gold ? C.gold : '#ffffff';
        ctx.beginPath(); ctx.arc(-0.025, -0.025, 0.17, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(-0.07, -0.07, 0.05, 0, Math.PI * 2); ctx.fill();
      } else if (item.type === 'shield') {
        ctx.fillStyle = 'rgba(80,170,255,0.25)';
        ctx.beginPath(); ctx.arc(0, 0, 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(120,200,255,0.9)'; ctx.lineWidth = 0.04;
        ctx.beginPath(); ctx.arc(0, 0, 0.36, 0, Math.PI * 2); ctx.stroke();
        drawBatIcon(ctx, 0, 0, 0.26, -0.5, C.blue);
      } else if (item.type === 'magnet') {
        ctx.fillStyle = 'rgba(255,210,63,0.22)';
        ctx.beginPath(); ctx.arc(0, 0, 0.4, 0, Math.PI * 2); ctx.fill();
        drawMagnetIcon(ctx, 0, 0.04, 0.28);
      } else if (item.type === 'timeout') {
        ctx.fillStyle = 'rgba(158,212,255,0.25)';
        ctx.beginPath(); ctx.arc(0, 0, 0.42, 0, Math.PI * 2); ctx.fill();
        drawTimeoutIcon(ctx, 0, 0, 0.3);
      } else if (item.type === 'bak') {
        ctx.fillStyle = 'rgba(255,210,63,0.22)';
        ctx.beginPath(); ctx.arc(0, 0, 0.42, 0, Math.PI * 2); ctx.fill();
        drawBakIcon(ctx, 0, 0.02, 0.3);
      }
      ctx.restore();
    }

    /* time-out: het witte T-kaartje van de scheidsrechter */
    function drawTimeoutIcon(g, x, y, r) {
      g.save();
      g.translate(x, y);
      g.fillStyle = C.ink;
      g.fillRect(-r * 0.72, -r * 0.92, r * 1.44, r * 1.84);
      g.fillStyle = '#ffffff';
      g.fillRect(-r * 0.62, -r * 0.82, r * 1.24, r * 1.64);
      g.fillStyle = C.blueD;
      g.fillRect(-r * 0.42, -r * 0.55, r * 0.84, r * 0.26);
      g.fillRect(-r * 0.13, -r * 0.55, r * 0.26, r * 1.1);
      g.restore();
    }

    /* ballenbak: een blauwe bak vol witte ballen, x2 */
    function drawBakIcon(g, x, y, r) {
      g.save();
      g.translate(x, y);
      g.fillStyle = '#ffffff';
      for (const [bx, by] of [[-0.42, -0.3], [0, -0.38], [0.42, -0.3], [-0.2, -0.5], [0.22, -0.52]]) {
        g.beginPath(); g.arc(bx * r, by * r, r * 0.24, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = C.ink;
      g.fillRect(-r * 0.82, -r * 0.32, r * 1.64, r * 1.02);
      g.fillStyle = C.table;
      g.fillRect(-r * 0.74, -r * 0.24, r * 1.48, r * 0.86);
      g.fillStyle = C.gold;
      g.fillRect(-r * 0.74, -r * 0.24, r * 1.48, r * 0.14);
      g.restore();
    }

    function drawBatIcon(g, x, y, r, rot, color) {
      g.save();
      g.translate(x, y); g.rotate(rot);
      g.fillStyle = '#8a5a2b';
      g.fillRect(-r * 0.18, r * 0.55, r * 0.36, r * 0.9);
      g.fillStyle = '#111';
      g.beginPath(); g.ellipse(0, 0, r * 0.8, r * 0.9, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = color;
      g.beginPath(); g.ellipse(0, 0, r * 0.72, r * 0.82, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    function drawMagnetIcon(g, x, y, r) {
      g.save();
      g.translate(x, y);
      g.lineWidth = r * 0.42;
      g.lineCap = 'butt';
      g.strokeStyle = C.red;
      g.beginPath();
      g.moveTo(-r * 0.6, -r * 0.1);
      g.lineTo(-r * 0.6, r * 0.1);
      g.arc(0, r * 0.1, r * 0.6, Math.PI, 0, true);
      g.lineTo(r * 0.6, -r * 0.1);
      g.stroke();
      g.strokeStyle = '#d7dde4';
      g.beginPath();
      g.moveTo(-r * 0.6, -r * 0.1); g.lineTo(-r * 0.6, -r * 0.45);
      g.moveTo(r * 0.6, -r * 0.1); g.lineTo(r * 0.6, -r * 0.45);
      g.stroke();
      g.restore();
    }

    /* speler in het clubshirt van TTC Wielsbeke, van achteren gezien.
       Alles in meter, voeten op (0, 0), y omhoog = negatief. De pose volgt
       uit de state; enkel landen en een bal pakken onthouden we even. */
    let prevY = 0, landAt = -99, prevBalls = 0, swingAt = -99, prevFrame = -1;

    function groundUnder(state) {
      // staat er een tafel onder de speler? dan valt de schaduw op het blad
      const lane = Math.round(state.x == null ? 1 : state.x);
      const items = state.items || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type !== 'table' || it.broken || it.lane !== lane) continue;
        if (it.z - 0.2 < state.dist && it.z + it.len + 0.2 > state.dist) return 0.76;
      }
      return 0;
    }

    function drawPlayer(state) {
      const d = CAM_BACK;
      const s = f / d;
      const x = (state.x - 1) * LANE_W;
      const y = Math.max(0, state.y || 0);
      const frame = state.frame || 0;
      const sliding = state.sliding > 0 && y <= 0.05;
      const dead = state.alive === false;

      // korte herinneringen: landen (squash) en een bal pakken (forehand)
      if (frame < prevFrame) { landAt = -99; swingAt = -99; prevBalls = state.balls || 0; }
      if (frame !== prevFrame) {
        if (prevY > 0.05 && y <= 0.05) landAt = frame;
        if ((state.balls || 0) > prevBalls) swingAt = frame;
        prevY = y; prevBalls = state.balls || 0; prevFrame = frame;
      }

      // schaduw: op de vloer, of op het tafelblad als je erover springt
      const gy = y > 0.7 ? groundUnder(state) : 0;
      const sh = 1 / (1 + Math.max(0, y - gy) * 0.8);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.32 * sh).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(sx(x, d), sy(gy, d), 0.4 * s * sh, 0.12 * s * sh, 0, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.translate(sx(x, d), sy(y, d));
      ctx.scale(s, s);
      if (!dead && state.grace > 0) ctx.globalAlpha *= 0.55 + 0.35 * Math.cos(frame * 0.5);

      // aura's
      if (state.magnet > 0) {
        ctx.fillStyle = 'rgba(255,210,63,0.16)';
        ctx.beginPath(); ctx.ellipse(0, sliding ? -0.35 : -0.9, 0.75, sliding ? 0.5 : 1.1, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (state.shield) {
        const pulse = 0.04 * Math.sin(frame * 0.2);
        const ry = sliding ? 0.55 : 1.15;
        ctx.fillStyle = 'rgba(70,160,255,0.16)';
        ctx.beginPath(); ctx.ellipse(0, sliding ? -0.35 : -0.9, 0.7 + pulse, ry + pulse, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(158,212,255,0.95)';
        ctx.lineWidth = 0.05;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(70,160,255,0.35)';
        ctx.lineWidth = 0.14;
        ctx.stroke();
      }

      if (dead) {
        ctx.rotate(1.35);
        ctx.translate(0.2, 0.25);
      } else {
        // overhellen bij een baanwissel, rond de voeten
        const dx = clamp((state.lane == null ? state.x : state.lane) - state.x, -1, 1);
        ctx.rotate(dx * 0.22);
        // rekken bij het opspringen, squash bij het landen
        const up = y > 0.05 ? clamp((state.vy || 0) / 9, -1, 1) : 0;
        const land = Math.max(0, 1 - (frame - landAt) / 8);
        const st = 1 + 0.1 * Math.max(0, up) - 0.16 * land;
        ctx.scale(1 / Math.sqrt(st), st);
      }
      // linkshandige: de hele speler gespiegeld, de tekst op de rug niet
      const mir = kit.mirror ? -1 : 1;
      if (kit.mirror) ctx.scale(-1, 1);
      const armCol = kit.longSleeves ? kit.shirt : C.skin;
      const swingT = (frame - swingAt) / 12;
      const flick = swingT >= 0 && swingT < 1 ? Math.sin(swingT * Math.PI) : 0;

      if (sliding && !dead) {
        // voeten vooruit, romp achterover: laag en breed
        dust(frame);
        leg(-0.12, -0.24, -0.16, -0.4, -0.15, -0.5, 1);
        leg(0.12, -0.24, 0.16, -0.4, 0.15, -0.5, 1);
        shorts(-0.23, -0.34, 0.46, 0.2);
        arm(-0.26, -0.58, -0.48, -0.32, -0.6, -0.04, true);       // steunt op de vloer
        torso(-0.6, 0.42, 0.3, 0.26);
        armWithBat(0.26, -0.58, 0.5, -0.66, 0.66, -0.84, -1.6 + flick);
        head(0, -0.74, 0.92);
      } else if (y > 0.05 && !dead) {
        // in de lucht: knieën op, armen omhoog
        const tuck = clamp(y / 0.9, 0, 1);
        leg(-0.12, -0.86, -0.18, -0.62 - tuck * 0.1, -0.12, -0.36 - tuck * 0.12, 1);
        leg(0.12, -0.86, 0.18, -0.64 - tuck * 0.1, 0.12, -0.4 - tuck * 0.12, 1);
        shorts(-0.25, -1.02, 0.5, 0.3);
        arm(-0.28, -1.42, -0.5, -1.6, -0.56, -1.86, false);
        torso(-1.5, 0.56, 0.3, 0.25);
        armWithBat(0.28, -1.42, 0.5, -1.6, 0.58, -1.84, -2.6 + flick);
        head(0, -1.7, 1);
      } else {
        // lopen: heupen en schouders draaien tegen elkaar in, het lijf veert
        const ph = dead ? 0 : (state.dist || 0) * 2.4;
        const a = Math.sin(ph);
        const bob = dead ? 0 : 0.05 * Math.abs(a);
        ctx.translate(0, -bob);
        const liftL = Math.max(0, a), liftR = Math.max(0, -a);
        leg(-0.12, -0.86, -0.13, -0.46 - liftL * 0.1, -0.12, -0.06 - liftL * 0.4 + bob, liftL);
        leg(0.12, -0.86, 0.13, -0.46 - liftR * 0.1, 0.12, -0.06 - liftR * 0.4 + bob, liftR);
        shorts(-0.25, -1.02, 0.5, 0.3);
        // de arm die naar voren zwaait, verdwijnt deels achter de romp
        const fl = a, fr = -a;
        const elbow = (side, fw) => [side * (0.41 + 0.05 * Math.max(0, -fw)), -1.18 - 0.08 * Math.max(0, -fw)];
        const hand = (side, fw) => [side * (0.37 - 0.12 * fw), -0.98 - 0.22 * Math.max(0, fw) + 0.06 * Math.max(0, -fw)];
        const [elx, ely] = elbow(-1, fl), [hlx, hly] = hand(-1, fl);
        const [erx, ery] = elbow(1, fr), [hrx, hry] = hand(1, fr);
        const twist = 0.02 * a;
        if (fl > 0) arm(-0.29, -1.43, elx, ely, hlx, hly, false);
        if (fr > 0) armWithBat(0.29, -1.43, erx, ery, hrx, hry, 0.5 - fr * 0.4 - flick * 1.8);
        ctx.save(); ctx.translate(twist, 0);
        torso(-1.5, 0.56, 0.3, 0.25);
        ctx.restore();
        if (fl <= 0) arm(-0.29, -1.43, elx, ely, hlx, hly, false);
        if (fr <= 0) armWithBat(0.29, -1.43, erx, ery, hrx, hry, 0.5 - fr * 0.4 - flick * 1.8);
        head(twist * 0.5, -1.7, 1);
      }
      ctx.restore();

      // been: heup → knie → voet; lift 0..1 = hiel omhoog, je ziet de zool
      function leg(hx, hy0, kx, ky, fx, fy, lift) {
        limb(hx, hy0, kx, ky, 0.15, C.skin);
        limb(kx, ky, fx, fy - 0.1, 0.12, C.skin);
        limb(fx, fy - 0.16, fx, fy - 0.05, 0.13, kit.socks || C.white);
        // schoen van achteren: witte hiel, grijze zool die meer toont als de hiel omhoog gaat
        ctx.fillStyle = OUTLINE;
        roundRect(fx - 0.1, fy - 0.07, 0.2, 0.12, 0.04); ctx.fill();
        ctx.fillStyle = kit.shoes || '#f2f2f2';
        roundRect(fx - 0.085, fy - 0.06, 0.17, 0.09, 0.03); ctx.fill();
        ctx.fillStyle = '#9aa3ad';
        ctx.fillRect(fx - 0.085, fy + 0.015 - lift * 0.03, 0.17, 0.015 + lift * 0.03);
      }
      function shorts(x0, y0, w, h) {
        ctx.fillStyle = kit.shorts;
        roundRect(x0, y0, w, h, 0.05); ctx.fill();
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.03; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(x0 + w / 2 - 0.006, y0 + h * 0.35, 0.012, h * 0.65);
      }
      // romp: iets breder bij de schouders, strepen erover, naam op de rug
      function torso(top, h, hwTop, hwBot) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(-hwTop + 0.04, top);
        ctx.lineTo(hwTop - 0.04, top);
        ctx.quadraticCurveTo(hwTop, top, hwTop, top + 0.06);
        ctx.lineTo(hwBot, top + h);
        ctx.lineTo(-hwBot, top + h);
        ctx.lineTo(-hwTop, top + 0.06);
        ctx.quadraticCurveTo(-hwTop, top, -hwTop + 0.04, top);
        ctx.closePath();
        ctx.fillStyle = kit.shirt;
        ctx.fill();
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.03; ctx.stroke();
        ctx.clip();
        const th = h * 0.105, gap = h * 0.045;
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = kit.stripes[i];
          ctx.fillRect(-hwTop, top + h * 0.4 + i * (th + gap), hwTop * 2, th);
        }
        // licht van boven, schaduw onderaan
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(-hwTop, top, hwTop * 2, h * 0.18);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(-hwTop, top + h * 0.88, hwTop * 2, h * 0.12);
        ctx.fillStyle = kit.hem;
        ctx.fillRect(-hwTop, top + h - 0.04, hwTop * 2, 0.04);
        ctx.fillStyle = kit.trim;
        ctx.fillRect(-0.12, top, 0.24, 0.04);
        if (kit.backName && h > 0.4) {
          ctx.save();
          ctx.scale(mir * 0.01, 0.01);   // tekst in honderdsten, nooit gespiegeld
          ctx.font = 'bold 9px system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = kit.trim;
          ctx.fillText(kit.backName, 0, (top + h * 0.24) * 100, 38);
          ctx.restore();
        }
        ctx.restore();
      }
      // arm: schouder → elleboog → hand, met een mouwtje
      function arm(sx0, sy0, ex, ey, hx, hy0, flat) {
        limb(sx0, sy0, ex, ey, 0.11, armCol);
        limb(ex, ey, hx, hy0, 0.1, armCol);
        sleeveOn(sx0, sy0, ex, ey);
        if (kit.wristband) limb(hx + (ex - hx) * 0.25, hy0 + (ey - hy0) * 0.25, hx + (ex - hx) * 0.1, hy0 + (ey - hy0) * 0.1, 0.12, kit.wristband);
        ctx.fillStyle = C.skin;
        ctx.beginPath(); ctx.arc(hx, hy0, flat ? 0.06 : 0.055, 0, Math.PI * 2); ctx.fill();
      }
      function armWithBat(sx0, sy0, ex, ey, hx, hy0, rot) {
        arm(sx0, sy0, ex, ey, hx, hy0, false);
        drawHeldBat(hx, hy0, rot);
      }
      function sleeveOn(x0, y0, x1, y1) {
        const t = kit.longSleeves ? 0 : 0.42;
        if (!t) return;
        const mx = x0 + (x1 - x0) * t, my = y0 + (y1 - y0) * t;
        limb(x0, y0, mx, my, 0.16, kit.shirt);
        const tx = x0 + (x1 - x0) * (t - 0.06), ty = y0 + (y1 - y0) * (t - 0.06);
        ctx.strokeStyle = kit.trim; ctx.lineWidth = 0.16; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(mx, my); ctx.stroke();
      }
      // hoofd van achteren: haar, oortjes, nek, eventueel een zweetband
      function head(hx, hy0, k) {
        ctx.fillStyle = C.skin;
        ctx.fillRect(hx - 0.05, hy0 + 0.1 * k, 0.1, 0.1 * k);
        ctx.fillStyle = OUTLINE;
        ctx.beginPath(); ctx.arc(hx, hy0, 0.165, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.skin;
        ctx.beginPath(); ctx.arc(hx - 0.15, hy0 + 0.01, 0.04, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(hx + 0.15, hy0 + 0.01, 0.04, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.hair;
        ctx.beginPath(); ctx.arc(hx, hy0, 0.15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.skin;   // nek-haarlijn
        ctx.beginPath(); ctx.ellipse(hx, hy0 + 0.14, 0.07, 0.035, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.025; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(hx, hy0, 0.11, -2.6, -1.6); ctx.stroke();
        if (kit.headband) {
          ctx.fillStyle = kit.headband;
          ctx.beginPath(); ctx.ellipse(hx, hy0 - 0.03, 0.155, 0.04, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(hx - 0.02, hy0 - 0.02, 0.05, 0.14);   // knoop met lintjes
        }
      }
      // stofwolkjes bij een slide, puur uit het frame
      function dust(fr) {
        for (let i = 0; i < 6; i++) {
          const t = (fr * 0.07 + i / 6) % 1;
          const side = i % 2 ? 1 : -1;
          ctx.fillStyle = 'rgba(245,225,200,' + (0.45 * (1 - t)).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(side * (0.3 + t * 0.35), -0.04 - t * 0.2, 0.05 + t * 0.09, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      function drawHeldBat(bx, by, rot) {
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(rot);
        ctx.fillStyle = OUTLINE;
        ctx.fillRect(-0.04, -0.03, 0.08, 0.18);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(-0.03, -0.02, 0.06, 0.16);
        ctx.fillStyle = '#111';          // zwarte kant + rand
        ctx.beginPath(); ctx.ellipse(0, 0.3, 0.155, 0.175, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = kit.bat;         // rubber naar de camera
        ctx.beginPath(); ctx.ellipse(0.015, 0.3, 0.125, 0.145, 0, 0, Math.PI * 2); ctx.fill();
        if (kit.batPips) {               // lange noppen: een raster bolletjes op het rubber
          ctx.clip();
          for (let py = 0.17; py < 0.45; py += 0.055) {
            for (let px = -0.11; px < 0.14; px += 0.055) {
              ctx.fillStyle = kit.batPips[2];
              ctx.beginPath(); ctx.arc(px + 0.006, py + 0.006, 0.018, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = kit.batPips[0];
              ctx.beginPath(); ctx.arc(px, py, 0.016, 0, Math.PI * 2); ctx.fill();
            }
          }
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.beginPath(); ctx.ellipse(-0.03, 0.24, 0.05, 0.03, -0.6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }

    /* ---------- HUD ---------- */
    function textW(text, size) {
      const m = ctx.measureText(text);
      return m && typeof m.width === 'number' && m.width > 0 ? m.width : text.length * size;
    }

    function hudText(text, x, y, size, color) {
      ctx.font = size + 'px ' + HUD_FONT;
      ctx.lineWidth = Math.max(3, size * 0.4);
      ctx.strokeStyle = C.ink;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color || '#fff';
      ctx.fillText(text, x, y);
      return textW(text, size);
    }

    function drawHud(state) {
      // Press Start 2P is breed: ~1 em per teken. 360 px: 14 / 10 px.
      const fs = Math.round(clamp(Math.min(W, H * 1.2) * 0.04, 13, 24));
      const small = Math.round(clamp(fs * 0.72, 10, 16));
      const pad = Math.round(clamp(W * 0.03, 10, 18));
      const T = root.TTR;
      const score = T && typeof T.scoreOf === 'function'
        ? T.scoreOf(state)
        : Math.floor(state.dist || 0) + (state.points || 0);
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      // donkere plaat achter de HUD: de achtergrond schuift mee in bochten
      const cfg = (root.TTR_CONFIG && root.TTR_CONFIG.game) || {};
      // lopende power-ups met een klok: magneet, time-out, ballenbak
      const timers = [];
      if (state.magnet > 0) timers.push({ left: state.magnet, full: cfg.magnetFrames || 360, color: C.gold,
        icon: (x, y, r) => drawMagnetIcon(ctx, x, y + r * 0.1, r) });
      if (state.timeout > 0) timers.push({ left: state.timeout, full: cfg.timeoutFrames || 300, color: C.chrome,
        icon: (x, y, r) => drawTimeoutIcon(ctx, x, y, r * 0.55) });
      if (state.bak > 0) timers.push({ left: state.bak, full: cfg.bakFrames || 600, color: C.gold, label: 'x2',
        icon: (x, y, r) => drawBakIcon(ctx, x, y + r * 0.1, r * 0.55) });
      const line = Math.round(small * 1.9);
      const rows = Math.round(small * 1.5) + Math.round(fs * 1.6) + line +
        timers.length * line + (state.shield ? line : 0);
      const ballsW = (String(state.balls || 0).length + String(Math.floor(state.dist || 0)).length + 3) * small;
      const boxW = Math.max(String(score).length * fs, ballsW, (timers.length ? small * 12 : 0), small * 7) + pad * 0.8;
      ctx.fillStyle = 'rgba(2,19,43,0.55)';
      ctx.fillRect(pad * 0.5, pad * 0.5, boxW, rows + pad * 0.2);
      let y = pad;
      hudText('SCORE', pad, y, small, C.gold);
      y += Math.round(small * 1.5);
      hudText(String(score), pad, y, fs);
      y += Math.round(fs * 1.6);
      // ballen + afstand
      const r = small * 0.45;
      ctx.fillStyle = state.magnet > 0 ? C.gold : '#fff';
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pad + r, y + small / 2, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const wb = hudText(String(state.balls || 0), pad + r * 2 + 6, y, small);
      hudText(Math.floor(state.dist || 0) + 'm', pad + r * 2 + 6 + wb + small * 1.2, y, small, C.chrome);
      y += Math.round(small * 1.9);
      // power-ups
      for (const t of timers) {
        const frac = clamp(t.left / t.full, 0, 1);
        const bw = small * 6, bh = Math.max(6, small * 0.6);
        t.icon(pad + small * 0.5, y + small * 0.45, small * 0.9);
        const bx = pad + small * 1.4, by = y + (small - bh) / 2;
        ctx.fillStyle = 'rgba(2,19,43,0.7)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = t.color;
        ctx.fillRect(bx, by, bw * frac, bh);
        const w = hudText(Math.ceil(t.left / 60) + 's', bx + bw + 6, y, small);
        if (t.label) hudText(t.label, bx + bw + 6 + w + small * 0.6, y, small, C.gold);
        y += line;
      }
      if (state.shield) {
        drawBatIcon(ctx, pad + small * 0.5, y + small * 0.4, small * 0.55, -0.5, C.blue);
        hudText('SCHILD', pad + small * 1.4, y, small, C.chrome);
        y += line;
      }
      ctx.restore();
    }

    /* ---------- frame ---------- */
    function draw(state) {
      const cw = canvas.clientWidth || cssW, ch = canvas.clientHeight || cssH;
      if (cw !== cssW || ch !== cssH || W === 0) resize();
      if (W <= 0 || H <= 0) return;

      const dist = state.dist || 0;
      const px = ((state.x == null ? 1 : state.x) - 1) * LANE_W;
      camX = px * CAM_FOLLOW;
      camZ = dist - CAM_BACK;
      const frame = state.frame || 0;

      // bochten: verschuivingstabel en panorama
      buildOff(state, dist);
      const T = root.TTR;
      const heading = state.corners && T && typeof T.headingAt === 'function' ? T.headingAt(state.corners, dist) : 0;
      const dEnd = VIEW_AHEAD + CAM_BACK;
      bgShift = -heading * W * BG_PAN + offAt(dEnd) * f / dEnd;

      ctx.save();
      drawBackground();
      drawFloor(dist);

      // tekenlijst opbouwen
      list.length = 0;
      for (const k in tableRows) delete tableRows[k];
      const items = state.items || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.taken) {
          // net gepakt: nog even een sterretje en de punten bij de speler
          const ago = dist - it.z;
          if (ago >= 0 && ago < BURST_M) list.push({ key: CAM_BACK - 0.05, it: null, burst: it });
          continue;
        }
        const len = it.len || 0;
        if (it.z + len < dist - VIEW_BEHIND || it.z > dist + VIEW_AHEAD) continue;
        if (it.z + len - camZ < NEAR) continue;
        let key = it.z + len * 0.5 - camZ;
        if (it.type === 'table') {
          if (it.row != null) tableRows[it.row] = (tableRows[it.row] || 0) | (1 << it.lane);
          // speler boven de tafel: tafel eerst tekenen
          if ((state.y || 0) > 0.5 && it.z - 0.5 < dist && it.z + len + 0.5 > dist) key = Math.max(key, CAM_BACK + 0.01);
        }
        list.push({ key, it });
      }
      addSideProps();
      list.push({ key: CAM_BACK, it: null });
      list.sort((a, b) => b.key - a.key);

      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const it = e.it;
        if (e.burst) { ctx.globalAlpha = 1; drawBurst(e.burst, state); continue; }
        if (e.side) {
          const fd = clamp((VIEW_AHEAD + CAM_BACK - e.key) / (VIEW_AHEAD + CAM_BACK - FADE_FROM), 0, 1);
          if (fd <= 0) continue;
          ctx.globalAlpha = fd;
          drawSide(e.side, frame);
          continue;
        }
        if (!it) { ctx.globalAlpha = 1; drawPlayer(state); continue; }
        const d0 = Math.max(NEAR, it.z - camZ), d1 = Math.max(d0 + 0.01, it.z + (it.len || 0) - camZ);
        const fade = clamp((VIEW_AHEAD + CAM_BACK - d0) / (VIEW_AHEAD + CAM_BACK - FADE_FROM), 0, 1);
        if (fade <= 0) continue;
        ctx.globalAlpha = fade;
        switch (it.type) {
          case 'nopper': drawNopper(it, d0, frame); break;
          case 'table': drawTable(it, d0, d1); break;
          case 'net': drawNet(it, (d0 + d1) / 2); break;
          case 'machine': drawMachine(it, d0, d1, frame); break;
          case 'ball': case 'shield': case 'magnet': case 'timeout': case 'bak':
            drawPickup(it, (d0 + d1) / 2, state); break;
          default: break;
        }
      }
      ctx.globalAlpha = 1;

      drawSpeed(state);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);

      if (state.alive === false) {
        ctx.fillStyle = 'rgba(200,36,42,0.28)';
        ctx.fillRect(0, 0, W, H);
      }
      drawHud(state);
      ctx.restore();
    }

    function setSkin(id) { kit = KITS[id] || KITS.club; }

    resize();
    return { resize, draw, setSkin };
  }

  root.TTR = root.TTR || {};
  root.TTR.createRenderer = createRenderer;
  root.TTR.KITS = KITS;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createRenderer };
})(typeof globalThis !== 'undefined' ? globalThis : this);

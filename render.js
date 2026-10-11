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
  const LANE_FRAC_H = 0.36;    // ... maar nooit meer dan dit deel van de hoogte (landschap)
  const CAM_H_MIN = 2.2, CAM_H_MAX = 5.5;
  const VIEW_AHEAD = 72;       // zo ver vooruit tekenen
  const VIEW_BEHIND = 2;       // zo ver achter de speler nog tekenen
  const FADE_FROM = 55;        // vanaf deze diepte vervagen items
  const NEAR = 0.5;            // near clip

  const COURT_X = 2.5;         // witte zijlijn van het speelveld
  const BARRIER_X = 3.3;       // omheining langs de baan
  const BAND = 1.2;            // parketvak in de lengte
  const PLANK = 0.5;           // parketplank in de breedte

  const C = {
    blueD: '#0b3a75', blue: '#2f7fd4', red: '#c8242a', gold: '#ffd23f',
    green: '#1f7a4c', greenD: '#15583a', skin: '#e8b48a', hair: '#4a2e1c',
    wood: '#c98d4f', woodD: '#a9703a'
  };

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
    let fogGrad = null;
    let bg = null, bgKey = '';
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
      fogGrad.addColorStop(0, 'rgba(196,206,218,0.85)');
      fogGrad.addColorStop(1, 'rgba(196,206,218,0)');
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

    function paintHall(g) {
      // plafond
      const ceil = hy * 0.22;
      g.fillStyle = '#39414f';
      g.fillRect(0, 0, W, ceil);
      g.fillStyle = 'rgba(255,250,225,0.9)';
      const nl = Math.max(3, Math.round(W / 140));
      for (let i = 0; i < nl; i++) {
        const lx = (i + 0.5) * W / nl;
        g.fillRect(lx - W * 0.035, ceil * 0.45, W * 0.07, Math.max(3, ceil * 0.18));
      }
      // muur
      const wall = g.createLinearGradient(0, ceil, 0, hy);
      wall.addColorStop(0, '#d9dfe7');
      wall.addColorStop(1, '#b6c1ce');
      g.fillStyle = wall;
      g.fillRect(0, ceil, W, hy - ceil);
      // muurpanelen
      g.strokeStyle = 'rgba(80,95,115,0.18)';
      g.lineWidth = 1;
      g.beginPath();
      const np = Math.max(4, Math.round(W / 90));
      for (let i = 1; i < np; i++) { const x = Math.round(i * W / np) + 0.5; g.moveTo(x, ceil); g.lineTo(x, hy); }
      g.stroke();
      // blauwe plint van de hal
      g.fillStyle = C.blueD;
      g.fillRect(0, hy - hy * 0.09, W, hy * 0.09);

      // scorebord
      const sw = clamp(W * 0.3, 90, 260), sh = sw * 0.42;
      const sx = W * 0.5 - sw / 2, sy = ceil + (hy * 0.91 - ceil) * 0.42 - sh / 2;
      g.fillStyle = '#222';
      g.fillRect(sx - 3, sy - 3, sw + 6, sh + 6);
      g.fillStyle = '#0d0f12';
      g.fillRect(sx, sy, sw, sh);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'bold ' + Math.round(sh * 0.2) + 'px system-ui, sans-serif';
      g.fillStyle = '#9fb4c8';
      g.fillText('THUIS', sx + sw * 0.25, sy + sh * 0.2);
      g.fillText('GAST', sx + sw * 0.75, sy + sh * 0.2);
      g.font = 'bold ' + Math.round(sh * 0.48) + 'px ui-monospace, monospace';
      g.fillStyle = '#ff4a3d';
      g.fillText('11', sx + sw * 0.25, sy + sh * 0.62);
      g.fillStyle = C.gold;
      g.fillText('9', sx + sw * 0.75, sy + sh * 0.62);
      g.fillStyle = '#ff4a3d';
      g.fillText(':', sx + sw * 0.5, sy + sh * 0.6);

      // ventilator rechts aan de muur
      const fr = clamp(hy * 0.13, 10, 46);
      const fx = W * 0.88, fy = ceil + fr * 1.6;
      g.fillStyle = '#5b6573';
      g.beginPath(); g.arc(fx, fy, fr, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c3cbd6';
      for (let b = 0; b < 3; b++) {
        const a = b * Math.PI * 2 / 3 + 0.3;
        g.beginPath();
        g.ellipse(fx + Math.cos(a) * fr * 0.45, fy + Math.sin(a) * fr * 0.45, fr * 0.45, fr * 0.2, a, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = '#2b313a'; g.lineWidth = Math.max(1, fr * 0.08);
      g.beginPath(); g.arc(fx, fy, fr, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#2b313a';
      g.beginPath(); g.arc(fx, fy, fr * 0.15, 0, Math.PI * 2); g.fill();

      // clubvlag links
      const bw = clamp(W * 0.12, 30, 120), bh = bw * 0.5;
      const bx = W * 0.1, by = ceil + (hy - ceil) * 0.18;
      g.fillStyle = C.blue; g.fillRect(bx, by, bw, bh);
      g.fillStyle = C.red; g.fillRect(bx, by + bh * 0.4, bw, bh * 0.2);
      g.fillStyle = C.gold; g.fillRect(bx, by + bh * 0.85, bw, bh * 0.15);

      // vloer (basis parket)
      const fl = g.createLinearGradient(0, hy, 0, H);
      fl.addColorStop(0, '#b98451');
      fl.addColorStop(1, C.wood);
      g.fillStyle = fl;
      g.fillRect(0, hy, W, H - hy);

      // tafels in de verte, net onder de horizon
      const fs = clamp(H * 0.012, 2, 10);
      const ty = hy + fs * 1.4;
      const spots = [0.04, 0.16, 0.8, 0.92];
      for (let i = 0; i < spots.length; i++) {
        const tx = W * spots[i], tw = fs * 7;
        g.fillStyle = '#333'; g.fillRect(tx + tw * 0.1, ty, fs * 0.4, fs * 1.4); g.fillRect(tx + tw * 0.85, ty, fs * 0.4, fs * 1.4);
        g.fillStyle = C.green; g.fillRect(tx, ty - fs * 0.5, tw, fs * 0.7);
        g.fillStyle = '#fff'; g.fillRect(tx + tw / 2 - 0.5, ty - fs * 1.1, 1, fs * 0.7);
      }
      // omheining in de verte
      g.fillStyle = C.red;
      for (let i = 0; i < 6; i++) {
        const x = W * (0.25 + i * 0.1);
        g.fillStyle = i % 2 ? C.red : C.blueD;
        g.fillRect(x, hy - fs * 0.2, W * 0.09, fs * 1.0);
      }
      // trainersbank links
      const bnx = W * 0.02, bny = hy + fs * 4;
      g.fillStyle = '#6b4a2b'; g.fillRect(bnx, bny, fs * 10, fs * 0.8);
      g.fillStyle = '#3a2a1a'; g.fillRect(bnx + fs, bny + fs * 0.8, fs * 0.5, fs * 1.3); g.fillRect(bnx + fs * 8.5, bny + fs * 0.8, fs * 0.5, fs * 1.3);
      g.fillStyle = C.blueD; g.fillRect(bnx + fs * 2, bny - fs * 2.2, fs * 1.6, fs * 2.2);
      g.fillStyle = C.skin; g.beginPath(); g.arc(bnx + fs * 2.8, bny - fs * 2.8, fs * 0.7, 0, Math.PI * 2); g.fill();
      g.fillStyle = C.red; g.fillRect(bnx + fs * 5.5, bny - fs * 1.2, fs * 2.4, fs * 1.2); // sporttas
    }

    function drawBackground() {
      const key = W + 'x' + H + 'x' + dpr;
      if (bgKey !== key) {
        bg = makeCanvas(Math.round(W * dpr), Math.round(H * dpr));
        bgKey = key;
        if (bg) {
          const g = bg.getContext('2d');
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          paintHall(g);
        }
      }
      if (bg) ctx.drawImage(bg, 0, 0, W, H);
      else paintHall(ctx);
    }

    /* ---------- projectie ---------- */
    let camX = 0, camZ = 0;
    function sx(x, d) { return cx + (x - camX) * f / d; }
    function sy(y, d) { return hy + (camH - y) * f / d; }

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
      ctx.fillStyle = 'rgba(70,35,10,0.10)';
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
      ctx.fillStyle = 'rgba(255,230,190,0.10)';
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
      ctx.strokeStyle = 'rgba(60,30,10,0.18)';
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
      const k0 = Math.ceil(-xMax / PLANK), k1 = Math.floor(xMax / PLANK);
      for (let k = k0; k <= k1; k++) {
        const x = k * PLANK;
        ctx.moveTo(sx(x, dNear), sy(0, dNear));
        ctx.lineTo(sx(x, dFar), sy(0, dFar));
      }
      ctx.stroke();

      // zijlijnen van het speelveld (taps)
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      quadFloor(-COURT_X - 0.05, -COURT_X + 0.05, dNear, dFar);
      quadFloor(COURT_X - 0.05, COURT_X + 0.05, dNear, dFar);
      ctx.fill();
      // baanscheiding: subtiele streepjes die meeschuiven
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
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

      // omheining langs de baan (rood/blauw), schuift mee
      const seg = 2.5, blen = 2.2, bh = 0.6;
      const b0 = Math.floor((camZ + 1) / seg), b1 = Math.ceil((camZ + 55) / seg);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? C.red : C.blueD;
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
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
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

    /* ---------- figuren (in meter, y omhoog = negatief) ---------- */
    function dotsPath(x0, y0, x1, y1, step, r) {
      ctx.beginPath();
      let row = 0;
      for (let y = y0 + step / 2; y < y1; y += step, row++) {
        for (let x = x0 + (row % 2 ? step : step / 2); x < x1; x += step) {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
    }

    function drawNopper(item, d, frame) {
      const s = f / d;
      const x = (item.lane - 1) * LANE_W;
      ctx.save();
      ctx.translate(sx(x, d), sy(0, d));
      ctx.scale(s, s);
      if (item.broken) { ctx.globalAlpha *= 0.35; ctx.rotate(0.6); }
      // schaduw
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(0, 0, 0.4, 0.1, 0, 0, Math.PI * 2); ctx.fill();
      const sway = Math.sin(frame * 0.12 + item.z) * 0.03;
      // benen
      ctx.fillStyle = C.skin;
      ctx.fillRect(-0.2, -0.8, 0.13, 0.8);
      ctx.fillRect(0.07, -0.8, 0.13, 0.8);
      ctx.fillStyle = '#111';
      ctx.fillRect(-0.22, -0.06, 0.17, 0.06);
      ctx.fillRect(0.05, -0.06, 0.17, 0.06);
      // broek
      ctx.fillRect(-0.25, -0.95, 0.5, 0.25);
      // shirt: zwart met rode noppen
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(-0.28, -1.48, 0.56, 0.56);
      ctx.fillStyle = C.red;
      dotsPath(-0.28, -1.48, 0.28, -0.92, 0.11, 0.032);
      ctx.fill();
      // armen
      ctx.fillStyle = C.skin;
      ctx.fillRect(-0.38, -1.45, 0.1, 0.45);
      // hoofd
      ctx.beginPath(); ctx.arc(sway, -1.64, 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(sway, -1.69, 0.15, Math.PI, Math.PI * 2); ctx.fill();
      // ogen + boze wenkbrauwen
      ctx.fillStyle = '#111';
      ctx.fillRect(sway - 0.07, -1.65, 0.035, 0.035);
      ctx.fillRect(sway + 0.035, -1.65, 0.035, 0.035);
      ctx.fillRect(sway - 0.09, -1.69, 0.07, 0.015);
      ctx.fillRect(sway + 0.02, -1.69, 0.07, 0.015);
      // grote bat omhoog met rode rubber en zwarte noppen
      ctx.save();
      ctx.translate(0.33, -1.25);
      ctx.rotate(0.25 + sway);
      ctx.fillStyle = C.skin;
      ctx.fillRect(-0.06, -0.05, 0.1, 0.3);
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(-0.035, -0.22, 0.07, 0.2);
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.ellipse(0, -0.46, 0.25, 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.red;
      ctx.beginPath(); ctx.ellipse(0, -0.46, 0.225, 0.255, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.ellipse(0, -0.46, 0.225, 0.255, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#111';
      dotsPath(-0.24, -0.73, 0.24, -0.19, 0.08, 0.026);
      ctx.fill();
      ctx.restore();
      ctx.restore();
      ctx.restore();
    }

    function drawTable(item, d0, d1) {
      const xm = (item.lane - 1) * LANE_W;
      const x0 = xm - LANE_W / 2, x1 = xm + LANE_W / 2;
      const top = 0.76, th = 0.05;
      ctx.save();
      if (item.broken) ctx.globalAlpha *= 0.3;
      // schaduw op de vloer
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); quadFloor(x0 + 0.05, x1 - 0.05, d0 + 0.1, d1 - 0.1); ctx.fill();
      // poten
      const lw = Math.max(1, 0.05 * f / d0);
      ctx.strokeStyle = '#2a2a2a';
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
      ctx.fillStyle = C.greenD;
      ctx.fillRect(sx(x0, d0), sy(top, d0), sx(x1, d0) - sx(x0, d0), th * f / d0 + 1);
      // blad
      ctx.fillStyle = C.green;
      ctx.beginPath();
      ctx.moveTo(sx(x0, d0), sy(top, d0));
      ctx.lineTo(sx(x1, d0), sy(top, d0));
      ctx.lineTo(sx(x1, d1), sy(top, d1));
      ctx.lineTo(sx(x0, d1), sy(top, d1));
      ctx.closePath();
      ctx.fill();
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
      ctx.restore();
    }

    function drawNet(item, d) {
      const s = f / d;
      const xm = (item.lane - 1) * LANE_W;
      ctx.save();
      ctx.translate(sx(xm, d), sy(0, d));
      ctx.scale(s, s);
      if (item.broken) { ctx.globalAlpha *= 0.3; ctx.rotate(0.2); }
      const hw = LANE_W / 2 - 0.04, yb = -0.95, yt = -2.4;   // hoog net: eronder, niet erover
      // palen
      ctx.fillStyle = '#9aa3ad';
      ctx.fillRect(-hw - 0.03, yt - 0.04, 0.06, -yt + 0.04);
      ctx.fillRect(hw - 0.03, yt - 0.04, 0.06, -yt + 0.04);
      ctx.fillStyle = '#4a525c';
      ctx.fillRect(-hw - 0.07, -0.04, 0.14, 0.04);
      ctx.fillRect(hw - 0.07, -0.04, 0.14, 0.04);
      // net
      ctx.fillStyle = 'rgba(15,25,45,0.55)';
      ctx.fillRect(-hw, yt, hw * 2, yb - yt);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 0.014;
      ctx.beginPath();
      for (let x = -hw; x <= hw + 0.001; x += 0.1) { ctx.moveTo(x, yt); ctx.lineTo(x, yb); }
      for (let y = yt; y <= yb + 0.001; y += 0.1) { ctx.moveTo(-hw, y); ctx.lineTo(hw, y); }
      ctx.stroke();
      // witte band boven en onder
      ctx.fillStyle = '#fff';
      ctx.fillRect(-hw, yt, hw * 2, 0.07);
      ctx.fillStyle = C.blueD;
      ctx.fillRect(-hw, yb - 0.035, hw * 2, 0.035);
      ctx.restore();
    }

    function drawMachine(item, d0, d1, frame) {
      const xm = (item.lane - 1) * LANE_W;
      const hw = 0.55, yb = 1.05, yt = 2.1;
      const x0 = xm - hw, x1 = xm + hw;
      ctx.save();
      if (item.broken) ctx.globalAlpha *= 0.3;
      const dm = (d0 + d1) / 2;
      // stang naar het plafond
      ctx.strokeStyle = '#444b55';
      ctx.lineWidth = Math.max(1, 0.06 * f / dm);
      ctx.beginPath();
      ctx.moveTo(sx(xm, dm), sy(yt, dm));
      ctx.lineTo(sx(xm, dm), sy(camH + 6, dm));
      ctx.stroke();
      // schaduw
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath(); quadFloor(x0, x1, d0, d1); ctx.fill();
      // bovenkant
      ctx.fillStyle = '#5a6270';
      ctx.beginPath();
      ctx.moveTo(sx(x0, d0), sy(yt, d0)); ctx.lineTo(sx(x1, d0), sy(yt, d0));
      ctx.lineTo(sx(x1, d1), sy(yt, d1)); ctx.lineTo(sx(x0, d1), sy(yt, d1));
      ctx.closePath(); ctx.fill();
      // zijkant (de kant naar de camera)
      const xs = xm > camX ? x0 : x1;
      if (Math.abs(xm - camX) > hw) {
        ctx.fillStyle = '#2a3039';
        ctx.beginPath();
        ctx.moveTo(sx(xs, d0), sy(yt, d0)); ctx.lineTo(sx(xs, d1), sy(yt, d1));
        ctx.lineTo(sx(xs, d1), sy(yb, d1)); ctx.lineTo(sx(xs, d0), sy(yb, d0));
        ctx.closePath(); ctx.fill();
      }
      // voorkant in meter
      const s = f / d0;
      ctx.translate(sx(xm, d0), sy(0, d0));
      ctx.scale(s, s);
      ctx.fillStyle = '#383f4a';
      ctx.fillRect(-hw, -yt, hw * 2, yt - yb);
      ctx.fillStyle = C.red;
      ctx.fillRect(-hw, -yt, hw * 2, 0.1);
      ctx.fillStyle = C.gold;
      ctx.fillRect(-hw, -yb - 0.06, hw * 2, 0.06);
      // venster met ballen
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
      // uitwerpmond met knipperlampje
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(0.36, -1.32, 0.11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = (frame >> 4) & 1 ? '#ff3b30' : '#5a1210';
      ctx.beginPath(); ctx.arc(0.36, -1.58, 0.04, 0, Math.PI * 2); ctx.fill();
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
      }
      ctx.restore();
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

    /* speler, van achteren gezien */
    function drawPlayer(state) {
      const d = CAM_BACK;
      const s = f / d;
      const x = (state.x - 1) * LANE_W;
      const y = Math.max(0, state.y || 0);
      const frame = state.frame || 0;
      const sliding = state.sliding > 0;
      const dead = state.alive === false;

      // schaduw
      const sh = 1 / (1 + y * 0.8);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.3 * sh).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(sx(x, d), sy(0, d), 0.38 * s * sh, 0.11 * s * sh, 0, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.translate(sx(x, d), sy(y, d));
      ctx.scale(s, s);
      if (!dead && state.grace > 0 && (frame >> 2) & 1) ctx.globalAlpha *= 0.35;

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
        ctx.strokeStyle = 'rgba(120,200,255,0.9)';
        ctx.lineWidth = 0.05;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(70,160,255,0.35)';
        ctx.lineWidth = 0.14;
        ctx.stroke();
      }

      if (dead) {
        ctx.rotate(1.35);
        ctx.translate(0.2, 0.25);
      }

      const run = dead ? 0 : Math.sin((state.dist || 0) * 2.4);
      if (sliding && !dead) {
        // laag en achterover: benen vooruit, romp achterover, armen opzij
        ctx.fillStyle = C.blueD;
        ctx.beginPath(); ctx.ellipse(0, -0.18, 0.3, 0.17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.blue;
        ctx.beginPath(); ctx.ellipse(0, -0.34, 0.26, 0.18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.red;
        ctx.fillRect(-0.24, -0.42, 0.48, 0.06);
        ctx.fillStyle = C.skin;
        ctx.fillRect(-0.48, -0.32, 0.22, 0.08);
        ctx.fillRect(0.26, -0.32, 0.18, 0.08);
        ctx.fillStyle = C.hair;
        ctx.beginPath(); ctx.arc(0, -0.5, 0.13, 0, Math.PI * 2); ctx.fill();
        drawHeldBat(0.5, -0.3, 1.2);
      } else {
        const tuck = y > 0.05 && !dead;
        // benen
        const legL = tuck ? 0.45 : 0.8, liftA = tuck ? 0.25 : Math.max(0, run) * 0.22, liftB = tuck ? 0.15 : Math.max(0, -run) * 0.22;
        ctx.fillStyle = C.skin;
        ctx.fillRect(-0.19, -0.85, 0.13, legL - liftA + 0.05);
        ctx.fillRect(0.06, -0.85, 0.13, legL - liftB + 0.05);
        ctx.fillStyle = '#f2f2f2';
        ctx.fillRect(-0.21, -0.85 + legL - liftA, 0.17, 0.1);
        ctx.fillRect(0.04, -0.85 + legL - liftB, 0.17, 0.1);
        ctx.fillStyle = C.red;
        ctx.fillRect(-0.21, -0.85 + legL - liftA + 0.07, 0.17, 0.03);
        ctx.fillRect(0.04, -0.85 + legL - liftB + 0.07, 0.17, 0.03);
        // broek
        ctx.fillStyle = C.blueD;
        ctx.fillRect(-0.24, -1.0, 0.48, 0.24);
        // shirt
        ctx.fillStyle = C.blue;
        ctx.fillRect(-0.27, -1.5, 0.54, 0.54);
        ctx.fillStyle = C.blueD;
        ctx.fillRect(-0.27, -1.5, 0.08, 0.54);
        ctx.fillRect(0.19, -1.5, 0.08, 0.54);
        ctx.fillStyle = C.red;
        ctx.fillRect(-0.27, -1.47, 0.54, 0.08);
        ctx.fillStyle = C.gold;
        ctx.fillRect(-0.09, -1.32, 0.18, 0.26);
        ctx.fillStyle = C.blueD;
        ctx.fillRect(-0.04, -1.28, 0.08, 0.18);
        // linkerarm zwaait
        ctx.fillStyle = C.skin;
        ctx.save();
        ctx.translate(-0.3, -1.45);
        ctx.rotate(tuck ? 2.4 : 0.15 + run * 0.35);
        ctx.fillRect(-0.05, 0, 0.1, 0.45);
        ctx.restore();
        // rechterarm met bat
        ctx.save();
        ctx.translate(0.3, -1.45);
        const swing = tuck ? -2.2 : -0.5 - run * 0.25;
        ctx.rotate(swing);
        ctx.fillRect(-0.05, 0, 0.1, 0.42);
        ctx.restore();
        const hx = 0.3 + Math.sin(-swing) * 0.42, hy2 = -1.45 + Math.cos(-swing) * 0.42;
        drawHeldBat(hx, hy2, -swing * 0.6 + 0.4);
        // nek + hoofd (achterkant: haar)
        ctx.fillStyle = C.skin;
        ctx.fillRect(-0.05, -1.58, 0.1, 0.1);
        ctx.beginPath(); ctx.arc(0, -1.7, 0.15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.hair;
        ctx.beginPath(); ctx.arc(0, -1.73, 0.15, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
        ctx.fillRect(-0.15, -1.74, 0.3, 0.07);
      }
      ctx.restore();

      function drawHeldBat(bx, by, rot) {
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(rot);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(-0.03, -0.02, 0.06, 0.16);
        ctx.fillStyle = '#111';          // zwarte kant + rand
        ctx.beginPath(); ctx.ellipse(0, 0.3, 0.15, 0.17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.red;           // rode rubber naar de camera
        ctx.beginPath(); ctx.ellipse(0.015, 0.3, 0.125, 0.145, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    /* ---------- HUD ---------- */
    function hudText(text, x, y, size) {
      ctx.font = 'bold ' + size + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.lineWidth = Math.max(3, size * 0.2);
      ctx.strokeStyle = 'rgba(10,15,30,0.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x, y);
    }

    function drawHud(state) {
      const fs = Math.round(clamp(Math.min(W, H * 1.2) * 0.06, 18, 34));
      const small = Math.round(fs * 0.55);
      const pad = Math.round(clamp(W * 0.03, 10, 18));
      const T = root.TTR;
      const score = T && typeof T.scoreOf === 'function'
        ? T.scoreOf(state)
        : Math.floor(state.dist || 0) + (state.balls || 0) * 10;
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      let y = pad;
      hudText('Score', pad, y, small);
      y += small + 1;
      hudText(String(score), pad, y, fs);
      y += fs + 6;
      // ballen + afstand
      const r = small * 0.45;
      ctx.fillStyle = state.magnet > 0 ? C.gold : '#fff';
      ctx.strokeStyle = 'rgba(10,15,30,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pad + r, y + small / 2, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const ballTxt = String(state.balls || 0);
      hudText(ballTxt, pad + r * 2 + 6, y, small);
      hudText(Math.floor(state.dist || 0) + ' m', pad + r * 2 + 12 + small * (0.62 * ballTxt.length + 1.2), y, small);
      y += small + 8;
      // power-ups
      const cfg = (root.TTR_CONFIG && root.TTR_CONFIG.game) || {};
      if (state.magnet > 0) {
        const full = cfg.magnetFrames || 360;
        const frac = clamp(state.magnet / full, 0, 1);
        const bw = fs * 3.2, bh = Math.max(6, small * 0.5);
        drawMagnetIcon(ctx, pad + small * 0.5, y + small * 0.55, small * 0.8);
        const bx = pad + small * 1.3, by = y + (small - bh) / 2;
        ctx.fillStyle = 'rgba(10,15,30,0.6)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = C.gold;
        ctx.fillRect(bx, by, bw * frac, bh);
        hudText(Math.ceil(state.magnet / 60) + 's', bx + bw + 6, y, small);
        y += small + 8;
      }
      if (state.shield) {
        drawBatIcon(ctx, pad + small * 0.5, y + small * 0.4, small * 0.5, -0.5, C.blue);
        hudText('Schild', pad + small * 1.3, y, small);
        y += small + 8;
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

      ctx.save();
      drawBackground();
      drawFloor(dist);

      // tekenlijst opbouwen
      list.length = 0;
      for (const k in tableRows) delete tableRows[k];
      const items = state.items || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.taken) continue;
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
      list.push({ key: CAM_BACK, it: null });
      list.sort((a, b) => b.key - a.key);

      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const it = e.it;
        if (!it) { drawPlayer(state); continue; }
        const d0 = Math.max(NEAR, it.z - camZ), d1 = Math.max(d0 + 0.01, it.z + (it.len || 0) - camZ);
        const fade = clamp((VIEW_AHEAD + CAM_BACK - d0) / (VIEW_AHEAD + CAM_BACK - FADE_FROM), 0, 1);
        if (fade <= 0) continue;
        ctx.globalAlpha = fade;
        switch (it.type) {
          case 'nopper': drawNopper(it, d0, frame); break;
          case 'table': drawTable(it, d0, d1); break;
          case 'net': drawNet(it, (d0 + d1) / 2); break;
          case 'machine': drawMachine(it, d0, d1, frame); break;
          case 'ball': case 'shield': case 'magnet': drawPickup(it, (d0 + d1) / 2, state); break;
          default: break;
        }
      }
      ctx.globalAlpha = 1;

      if (state.alive === false) {
        ctx.fillStyle = 'rgba(200,36,42,0.28)';
        ctx.fillRect(0, 0, W, H);
      }
      drawHud(state);
      ctx.restore();
    }

    resize();
    return { resize, draw };
  }

  root.TTR = root.TTR || {};
  root.TTR.createRenderer = createRenderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createRenderer };
})(typeof globalThis !== 'undefined' ? globalThis : this);

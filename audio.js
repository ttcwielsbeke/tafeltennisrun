/* ============================================================
   Tafeltennisrun — geluid
   Alles gesynthetiseerd met Web Audio: geen geluidsbestanden.
   Ruis door filters voor schuiven, wind en publiek; korte
   resonante tikken voor het balletje; een fluitje voor de
   time-out. Werkt ook zonder Web Audio: dan doet alles niets.
   ============================================================ */
(function (root) {
  'use strict';

  /* toonladder voor ballen na elkaar: pentatonisch, klinkt altijd goed */
  const COMBO = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2, 3, 10 / 3];
  const COMBO_GAP = 0.9;       // seconden: binnen deze tijd telt de volgende bal als reeks

  function createAudio(opts) {
    opts = opts || {};
    let ac = opts.context || null;        // een OfflineAudioContext mag ook (tests)
    let out = null, noise = null;
    let on = false;
    let lastBall = -1e9, combo = 0;
    let amb = null;                        // { nodes, timer }
    let rng = 12345;                       // eigen random: geen Math.random nodig

    function rand() { rng = (rng * 16807) % 2147483647; return rng / 2147483647; }

    function ensure() {
      if (!ac) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return false;
        try { ac = new AC(); } catch (e) { return false; }
      }
      if (!out) {
        // alles via een zachte compressor: niets klipt als veel tegelijk klinkt
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
        comp.attack.value = 0.003; comp.release.value = 0.2;
        out = ac.createGain();
        out.gain.value = 0.85;
        out.connect(comp);
        comp.connect(ac.destination);
        noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
      }
      return true;
    }

    // een geschorste context weer laten spelen; een weigering (bv. offline context) is geen fout
    function resume() {
      if (!ac || ac.state !== 'suspended' || !ac.resume) return;
      if (root.OfflineAudioContext && ac instanceof root.OfflineAudioContext) return;
      try { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* laat maar */ }
    }

    /* ---------- bouwstenen ---------- */
    // omhullende: in 'a' seconden naar 'peak', dan exponentieel weg in 'd'
    function env(g, t, a, peak, d) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    function pan(dest, p) {
      if (!p || !ac.createStereoPanner) return dest;
      const sp = ac.createStereoPanner();
      sp.pan.value = Math.max(-1, Math.min(1, p));
      sp.connect(dest);
      return sp;
    }
    function tone(t, type, f0, f1, a, d, vol, dest) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
      env(g, t, a, vol, d);
      o.connect(g); g.connect(dest || out);
      o.start(t); o.stop(t + a + d + 0.05);
      return o;
    }
    // gefilterde ruis; filter zwiept van f0 naar f1
    function hiss(t, kind, f0, f1, q, a, d, vol, dest) {
      const src = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noise;
      src.loop = true;
      src.loopStart = 0; src.loopEnd = noise.duration;
      fl.type = kind;
      fl.Q.value = q;
      fl.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) fl.frequency.exponentialRampToValueAtTime(f1, t + a + d);
      env(g, t, a, vol, d);
      src.connect(fl); fl.connect(g); g.connect(dest || out);
      const off = rand() * 0.8;   // elke keer een ander stuk ruis
      src.start(t, off); src.stop(t + a + d + 0.05);
    }
    // het balletje: een korte, holle 'pok' (resonante tik + heel kort toontje)
    function pok(t, f, vol, dest) {
      hiss(t, 'bandpass', f * 1.6, f * 1.6, 9, 0.001, 0.025, vol * 0.9, dest);
      tone(t, 'sine', f, f * 0.94, 0.001, 0.05, vol * 0.55, dest);
    }

    /* ---------- de geluiden ---------- */
    const SOUNDS = {
      // sliden: sneakerpiep op de sportvloer, schuivende wrijving, plof op de grond
      slide(t) {
        const sq = ac.createOscillator(), vib = ac.createOscillator(), vg = ac.createGain();
        const bp = ac.createBiquadFilter(), g = ac.createGain();
        sq.type = 'triangle';
        sq.frequency.setValueAtTime(1750, t);
        sq.frequency.exponentialRampToValueAtTime(2350, t + 0.1);
        sq.frequency.exponentialRampToValueAtTime(2050, t + 0.17);
        vib.frequency.value = 42; vg.gain.value = 140;          // het gekartelde van een piep
        vib.connect(vg); vg.connect(sq.frequency);
        bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 2.5;
        env(g, t, 0.012, 0.22, 0.17);
        sq.connect(bp); bp.connect(g); g.connect(out);
        sq.start(t); vib.start(t); sq.stop(t + 0.25); vib.stop(t + 0.25);
        hiss(t + 0.03, 'bandpass', 2600, 480, 0.9, 0.07, 0.52, 0.75);  // schuiven over het parket, zwelt aan
        hiss(t + 0.05, 'lowpass', 900, 280, 0.7, 0.12, 0.36, 0.12);   // zacht gerommel eronder
        tone(t + 0.06, 'sine', 110, 50, 0.03, 0.16, 0.045);              // romp raakt zacht de vloer
      },
      // springen: wind omhoog en een veerkrachtig toontje
      jump(t) {
        hiss(t, 'bandpass', 500, 2400, 1.2, 0.04, 0.22, 0.45);
        tone(t, 'sine', 300, 640, 0.01, 0.14, 0.12);
        tone(t, 'triangle', 2400, 2600, 0.003, 0.04, 0.05);             // korte piep van de zool
      },
      // landen: doffe plof
      land(t) {
        tone(t, 'sine', 120, 50, 0.004, 0.13, 0.32);
        hiss(t, 'lowpass', 500, 200, 0.7, 0.004, 0.07, 0.22);
      },
      // van baan wisselen: korte zwiep, naar de kant waar je heen gaat
      lane(t, o) {
        const p = pan(out, (o && o.dir) ? o.dir * 0.6 : 0);
        hiss(t, 'bandpass', 1800, 800, 1.2, 0.015, 0.14, 0.6, p);
        tone(t, 'triangle', 2700, 2900, 0.002, 0.03, 0.025, p);
      },
      // bal: pok! Na elkaar gepakt klimt de toon; met de ballenbak een extra glinster
      ball(t, o) {
        combo = t - lastBall < COMBO_GAP ? Math.min(COMBO.length - 1, combo + 1) : 0;
        lastBall = t;
        const f = 1150 * COMBO[combo];
        pok(t, f, 0.5);
        pok(t + 0.055, f * 1.5, 0.28);                                 // tik op het bat
        if (o && o.double) tone(t + 0.04, 'sine', f * 3, f * 3, 0.002, 0.18, 0.08);
      },
      // schild-bat: een heldere chime omhoog
      shield(t) {
        [784, 988, 1175, 1568].forEach((f, i) => {
          tone(t + i * 0.06, 'sine', f, f, 0.004, 0.32, 0.16);
          tone(t + i * 0.06, 'triangle', f * 2, f * 2, 0.004, 0.12, 0.04);
        });
      },
      // magneet: zoemende wobble die aanzwelt
      magnet(t) {
        const o = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain();
        const lp = ac.createBiquadFilter(), g = ac.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.45);
        lfo.frequency.setValueAtTime(7, t); lfo.frequency.linearRampToValueAtTime(16, t + 0.45);
        lg.gain.value = 900;
        lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 7;
        lfo.connect(lg); lg.connect(lp.frequency);
        env(g, t, 0.06, 0.2, 0.42);
        o.connect(lp); lp.connect(g); g.connect(out);
        o.start(t); lfo.start(t); o.stop(t + 0.55); lfo.stop(t + 0.55);
        [660, 880, 1320].forEach((f, i) => tone(t + 0.12 + i * 0.07, 'sine', f, f, 0.004, 0.16, 0.08));
      },
      // time-out: het fluitje van de scheidsrechter (met de rolletjes-triller)
      timeout(t) {
        const o = ac.createOscillator(), trill = ac.createOscillator(), tg = ac.createGain(), g = ac.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(2750, t);
        trill.frequency.value = 26; tg.gain.value = 170;
        trill.connect(tg); tg.connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.08, t + 0.02);
        g.gain.setValueAtTime(0.08, t + 0.16);
        g.gain.linearRampToValueAtTime(0.012, t + 0.2);              // twee stoten: tuut-tuuut
        g.gain.linearRampToValueAtTime(0.09, t + 0.25);
        g.gain.setValueAtTime(0.09, t + 0.55);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.68);
        o.connect(g); g.connect(out);
        o.start(t); trill.start(t); o.stop(t + 0.72); trill.stop(t + 0.72);
        hiss(t, 'bandpass', 2750, 2750, 3, 0.02, 0.62, 0.05);         // adem
      },
      // ballenbak: een cascade ballen die in de bak rollen
      bak(t) {
        for (let i = 0; i < 12; i++) {
          const dt = i * 0.028 + rand() * 0.02;
          pok(t + dt, 900 + rand() * 900, 0.32 * (1 - i / 16), pan(out, rand() * 1.2 - 0.6));
        }
        [523, 659, 784, 1047].forEach((f, i) => tone(t + 0.1 + i * 0.05, 'square', f, f, 0.003, 0.08, 0.035));
      },
      // het schild vangt een botsing op: metalige klang
      block(t) {
        [523, 1287, 2011, 2953].forEach((f, i) => tone(t, 'sine', f, f * 0.99, 0.002, 0.45 - i * 0.08, 0.16 - i * 0.03));
        hiss(t, 'highpass', 3000, 3000, 0.7, 0.002, 0.06, 0.2);
        tone(t, 'sine', 180, 70, 0.003, 0.15, 0.25);
      },
      // botsing: harde plof, rammelend en een treurig dalend toontje
      crash(t) {
        tone(t, 'sine', 95, 38, 0.004, 0.42, 0.6);
        hiss(t, 'lowpass', 1800, 250, 0.8, 0.004, 0.32, 0.45);
        const o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(330, t + 0.12);
        o.frequency.exponentialRampToValueAtTime(82, t + 0.75);
        lp.type = 'lowpass'; lp.frequency.value = 900;
        env(g, t + 0.12, 0.02, 0.12, 0.6);
        o.connect(lp); lp.connect(g); g.connect(out);
        o.start(t + 0.12); o.stop(t + 0.8);
      },
      // mijlpaal: het publiek juicht en klapt
      cheer(t) {
        const g = ac.createGain(), bp = ac.createBiquadFilter(), src = ac.createBufferSource();
        src.buffer = noise; src.loop = true;
        bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.6;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.25);
        g.gain.setValueAtTime(0.16, t + 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        src.connect(bp); bp.connect(g); g.connect(out);
        src.start(t, rand() * 0.5); src.stop(t + 1.65);
        for (let i = 0; i < 16; i++) {
          hiss(t + 0.08 + rand() * 1.1, 'bandpass', 1500 + rand() * 1500, 0, 1.5, 0.001, 0.035, 0.14 + rand() * 0.1,
            pan(out, rand() * 1.6 - 0.8));
        }
      }
    };

    /* ---------- sfeer in de hal ----------
       Geroezemoes van publiek, en af en toe een rally aan een tafel verderop:
       pok... pok... pok, zacht en links of rechts. */
    function startAmbience() {
      if (!on || amb || !ensure() || !root.setInterval) return;
      const t = ac.currentTime;
      const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), g = ac.createGain();
      const lfo = ac.createOscillator(), lg = ac.createGain();
      src.buffer = noise; src.loop = true;
      lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.5;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 1.2);
      lfo.frequency.value = 0.17; lg.gain.value = 0.018;           // het golft een beetje
      lfo.connect(lg); lg.connect(g.gain);
      src.connect(lp); lp.connect(g); g.connect(out);
      src.start(t); lfo.start(t);
      let rally = 0, side = 0, next = 0;
      const timer = root.setInterval(() => {
        if (!on || !ac || ac.state !== 'running') return;
        const now = ac.currentTime;
        if (rally > 0) {
          if (now < next) return;
          pok(now, 1250 + rand() * 150, 0.05, pan(out, side));
          rally--;
          next = now + 0.38 + rand() * 0.12;
        } else if (rand() < 0.06) {
          rally = 3 + Math.floor(rand() * 7);
          side = (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.5);
          next = now;
        }
      }, 60);
      amb = { src, lfo, g, timer };
    }
    function stopAmbience() {
      if (!amb) return;
      const t = ac.currentTime;
      amb.g.gain.cancelScheduledValues(t);
      amb.g.gain.setValueAtTime(Math.max(0.0001, amb.g.gain.value), t);
      amb.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      amb.src.stop(t + 0.45); amb.lfo.stop(t + 0.45);
      if (root.clearInterval) root.clearInterval(amb.timer);
      amb = null;
    }

    return {
      get on() { return on; },
      // aan/uit; aanzetten moet vanuit een klik of toets (autoplay-regels)
      setOn(v) {
        on = !!v && ensure();
        if (on) resume();
        if (!on) stopAmbience();
        return on;
      },
      // na een gebruikersactie: een geschorste context weer laten spelen
      wake() { if (on) resume(); },
      play(name, o, when) {
        if (!on || !SOUNDS[name] || !ensure()) return false;
        try { SOUNDS[name](when == null ? ac.currentTime : when, o); } catch (e) { return false; }
        return true;
      },
      startAmbience, stopAmbience,
      names: Object.keys(SOUNDS)
    };
  }

  root.TTR = root.TTR || {};
  root.TTR.createAudio = createAudio;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createAudio };
})(typeof globalThis !== 'undefined' ? globalThis : this);

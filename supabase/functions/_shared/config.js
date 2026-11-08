/* ============================================================
   Tafeltennisrun — instellingen
   Het enige bestand dat je moet aanraken om de ranglijst van
   dit-toestel-alleen naar heel-de-club om te schakelen, of om
   aan de snelheden te draaien.
   ============================================================ */
(function (root) {
  const TTR_CONFIG = {

    board: {

      /* 'local'    = ieder zijn eigen lijst, op zijn eigen toestel.
         'supabase' = één gedeelde dagranglijst voor heel de club.

         Zolang url en key leeg zijn, of de tabellen nog niet bestaan,
         valt het spel gewoon terug op 'local'. De SQL voor de tabellen
         staat in supabase/runner_v2.sql (zie README.md).              */
      provider: 'supabase',

      url: 'https://aqaikstibteqcdgxtuiw.supabase.co',      // Project URL (zelfde project als PIPS OUT!)
      key: 'sb_publishable_yt1HRtTr-Z8WCiZv3_uCkQ_on2j5ZJ4',  // de anon public key (die hoort publiek te zijn)

      limit: 25     // hoeveel spelers in de dagranglijst
    },

    game: {
      version: 5,            // spelversie: verhogen bij elke wijziging aan spellogica of baan

      /* snelheid in meter per seconde */
      startSpeed: 10,
      accel: 0.1,            // m/s erbij per seconde lopen, tot cruiseSpeed (~2 min)
      cruiseSpeed: 22,
      lateAccel: 0.0333,     // daarna trager verder versnellen ...
      lateSpeed: 30,         // ... tot hier (~6 min) ...
      overAccel: 0.0222,     // ... en in de verlengingen nog wat verder ...
      maxSpeed: 34,          // ... tot hier (~9 min). Onder de 40 m/s van de ranglijst-check blijven!

      /* springen en sliden */
      jumpVel: 9,            // m/s omhoog bij de sprong (0,8 s in de lucht)
      gravity: 22,           // m/s² naar beneden
      slideFrames: 38,       // hoelang een slide duurt (frames van 1/60 s)
      laneFrames: 8,         // hoelang een baanwissel duurt

      /* punten en power-ups */
      bossEvery: 1000,       // om de zoveel meter wacht de clubkampioen ...
      bossBonus: 250,        // ... en wie er levend voorbij komt, krijgt deze bonus
      ballPoints: 5,         // punten per bal: afstand blijft de hoofdzaak
      magnetFrames: 360,     // magneet: 6 seconden
      magnetReach: 9,        // magneet trekt ballen tot zoveel meter voor je
      shieldGraceFrames: 60, // na een schild-botsing 1 s onkwetsbaar
      timeoutFrames: 300,    // time-out: 5 seconden trager
      timeoutSlow: 0.6,      // ... aan zoveel keer de gewone snelheid
      bakFrames: 600         // ballenbak: 10 seconden dubbele punten per bal
    },

    /* tenues: vrij te spelen met je beste score op dit toestel
       (daguitdaging en oefenen tellen allebei). Puur voor het oog. */
    skins: [
      { id: 'club',      name: 'Clubshirt',     at: 0 },
      { id: 'trainer',   name: 'Jeugdtrainer',  at: 300 },
      { id: 'links',     name: 'Linkshandige',  at: 750 },
      { id: 'groen',     name: 'Groene noppen', at: 1500 },
      { id: 'kampioen',  name: 'Clubkampioen',  at: 3000 }
    ]
  };

  root.TTR_CONFIG = TTR_CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = TTR_CONFIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);

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

         Zolang url en key leeg zijn, of de tabel nog niet bestaat,
         valt het spel gewoon terug op 'local'. De SQL voor de tabel
         staat in supabase/runner_scores.sql en in README.md.          */
      provider: 'supabase',

      url: 'https://aqaikstibteqcdgxtuiw.supabase.co',      // Project URL (zelfde project als PIPS OUT!)
      key: 'sb_publishable_yt1HRtTr-Z8WCiZv3_uCkQ_on2j5ZJ4',  // de anon public key (die hoort publiek te zijn)
      table: 'runner_scores',

      limit: 25     // hoeveel spelers in de dagranglijst
    },

    game: {
      /* snelheid in meter per seconde */
      startSpeed: 10,
      maxSpeed: 22,
      accel: 0.07,           // m/s erbij per seconde lopen

      /* springen en sliden */
      jumpVel: 9,            // m/s omhoog bij de sprong (0,8 s in de lucht)
      gravity: 22,           // m/s² naar beneden
      slideFrames: 38,       // hoelang een slide duurt (frames van 1/60 s)
      laneFrames: 8,         // hoelang een baanwissel duurt

      /* punten en power-ups */
      ballPoints: 10,        // punten per bal
      magnetFrames: 360,     // magneet: 6 seconden
      magnetReach: 9,        // magneet trekt ballen tot zoveel meter voor je
      shieldGraceFrames: 60  // na een schild-botsing 1 s onkwetsbaar
    }
  };

  root.TTR_CONFIG = TTR_CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = TTR_CONFIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);

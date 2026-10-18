/* ============================================================
   Tafeltennisrun — tips voor nieuwe spelers
   Puur rekenwerk, geen DOM: welke tip hoort er nu bij de speler,
   en wanneer heeft hij een soort obstakel geleerd. Enkel beeld:
   de spellogica (en dus de herberekening op de server) blijft gelijk.
   ============================================================ */
(function (root) {
  const TTR = root.TTR = root.TTR || {};

  const AHEAD_S = 1.5;        // zoveel seconden voor het obstakel komt de tip

  // het pixellettertype heeft geen pijltjes: woorden dus
  const TIPS = {
    lane:  { touch: 'Veeg opzij!',          keys: 'Pijltje links of rechts: opzij!' },
    jump:  { touch: 'Veeg omhoog: spring!', keys: 'Pijltje omhoog of spatie: spring!' },
    slide: { touch: 'Veeg omlaag: slide!',  keys: 'Pijltje omlaag: slide!' }
  };
  const KIND = { nopper: 'lane', chopper: 'lane', table: 'jump', net: 'slide', machine: 'slide' };

  // het dichtstbijzijnde obstakel in je baan, binnen AHEAD_S, waarvan je de soort nog niet kent
  function hintFor(state, learned, touch) {
    if (!state || state.alive === false) return null;
    const reach = (state.vel || 0) * AHEAD_S;
    let best = null;
    for (const it of state.items || []) {
      const kind = KIND[it.type];
      if (!kind || it.taken || it.broken || it.lane !== state.lane) continue;
      if (it.z + it.len <= state.dist || it.z - state.dist > reach) continue;
      if (!best || it.z < best.z) best = it;
    }
    if (!best) return null;
    const kind = KIND[best.type];
    if (learned && learned[kind]) return null;
    return { kind, id: best.id, text: touch ? TIPS[kind].touch : TIPS[kind].keys };
  }

  // levend voorbij het getipte obstakel = die soort ken je nu
  function learnFrom(state, hint, learned) {
    const next = Object.assign({}, learned);
    if (!hint || !state || state.alive === false) return next;
    const it = (state.items || []).find((i) => i.id === hint.id);
    if (it && it.z + it.len < state.dist) next[hint.kind] = true;
    return next;
  }

  TTR.hintFor = hintFor;
  TTR.learnFrom = learnFrom;
  TTR.TIPS = TIPS;
  if (typeof module !== 'undefined' && module.exports) module.exports = { hintFor, learnFrom, TIPS };
})(typeof globalThis !== 'undefined' ? globalThis : this);

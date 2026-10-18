/* ============================================================
   Tafeltennisrun — tenues vrijspelen
   Puur rekenwerk, geen DOM: welke tenues horen bij een beste
   score. De lijst met drempels staat in config.js (skins).
   ============================================================ */
(function (root) {
  const TTR = root.TTR = root.TTR || {};

  // alle tenues die je met deze beste score mag dragen
  function unlockedSkins(best, skins) {
    return skins.filter((k) => (best || 0) >= k.at);
  }

  // tenues die er net bij kwamen toen de beste score van prev naar best ging
  function newSkins(prev, best, skins) {
    return skins.filter((k) => (prev || 0) < k.at && (best || 0) >= k.at);
  }

  // volgende of vorige tenue in de lijst (dir = 1 of -1), rond
  function cycleSkin(id, dir, skins) {
    const i = Math.max(0, skins.findIndex((k) => k.id === id));
    return skins[(i + dir + skins.length) % skins.length].id;
  }

  TTR.unlockedSkins = unlockedSkins;
  TTR.newSkins = newSkins;
  TTR.cycleSkin = cycleSkin;
  if (typeof module !== 'undefined' && module.exports) module.exports = { unlockedSkins, newSkins, cycleSkin };
})(typeof globalThis !== 'undefined' ? globalThis : this);

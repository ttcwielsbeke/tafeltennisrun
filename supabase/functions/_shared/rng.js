/* ============================================================
   Tafeltennisrun — seedbare random generator
   Zelfde seed → altijd dezelfde reeks. Geen Math.random,
   behalve in randomSeed() voor de oefenmodus.
   ============================================================ */
(function (root) {
  const TTR = root.TTR = root.TTR || {};

  // cyrb53: hasht een tekst naar een getal van 53 bits
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  // mulberry32: klein, snel en goed genoeg voor een spel
  function makeRng(seed) {
    let a = hash(String(seed)) >>> 0;
    function next() {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next,
      int(n) { return Math.floor(next() * n); },
      pick(arr) { return arr[Math.floor(next() * arr.length)]; },
      chance(p) { return next() < p; }
    };
  }

  // de dagelijkse seed: de lokale datum, bv. '2026-10-11'
  function dailySeed(date) {
    const d = date || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function randomSeed() {
    return 'oefen-' + Math.floor(Math.random() * 1e9).toString(36);
  }

  TTR.hash = hash;
  TTR.makeRng = makeRng;
  TTR.dailySeed = dailySeed;
  TTR.randomSeed = randomSeed;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { hash, makeRng, dailySeed, randomSeed };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

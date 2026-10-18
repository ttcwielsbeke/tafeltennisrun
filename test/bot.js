// Een eenvoudige, deterministische autopiloot voor de tests.
// Kijkt vooruit in de eigen baan en kiest: opzij, springen of sliden.
const G = require('../game.js');

function bot(s) {
  const reach = s.vel * 0.45;
  const near = s.items
    .filter((i) => !i.taken && !i.broken && G.SPAN[i.type] && i.z + i.len > s.dist && i.z < s.dist + reach && i.lane === s.lane);
  if (!near.length) return [];
  const it = near[0];
  if (it.type === 'nopper') {
    const blocked = new Set(s.items.filter((i) => i.type === 'nopper' && i.row === it.row).map((i) => i.lane));
    const free = [0, 1, 2].filter((l) => !blocked.has(l))
      .sort((a, b) => Math.abs(a - s.lane) - Math.abs(b - s.lane))[0];
    if (free < s.lane) return ['left'];
    if (free > s.lane) return ['right'];
    return [];
  }
  if (it.type === 'table') return it.z - s.dist < s.vel * 0.25 ? ['jump'] : [];
  return s.sliding ? [] : ['slide'];
}

module.exports = { bot };

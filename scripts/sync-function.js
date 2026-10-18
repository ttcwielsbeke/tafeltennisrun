// Kopieert de spelcode byte voor byte naar de Edge Function, zodat de replay
// exact dezelfde code draait als de browser. Draai met: node scripts/sync-function.js
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'supabase', 'functions', '_shared');
const names = ['config', 'rng', 'world', 'game', 'replay'];

fs.mkdirSync(dest, { recursive: true });
for (const name of names) {
  const file = `${name}.js`;
  fs.copyFileSync(path.join(root, file), path.join(dest, file));
  console.log(`gekopieerd: ${file} -> supabase/functions/_shared/${file}`);
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shared = path.join(root, 'supabase', 'functions', '_shared');
const names = ['config', 'rng', 'world', 'game', 'replay'];

// Regeleinden tellen niet: git zet ze op Windows bij een checkout soms om (CRLF),
// maar enkel voor bestanden die veranderd zijn. De inhoud moet gelijk zijn.
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('de kopieën voor de Edge Function zijn gelijk aan de originelen', () => {
  for (const name of names) {
    const original = read(path.join(root, `${name}.js`));
    const copy = read(path.join(shared, `${name}.js`));
    assert.ok(original === copy, `${name}.js verschilt; draai node scripts/sync-function.js`);
  }
});

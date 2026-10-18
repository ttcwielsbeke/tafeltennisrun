const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shared = path.join(root, 'supabase', 'functions', '_shared');
const names = ['config', 'rng', 'world', 'game', 'replay'];

test('de kopieën voor de Edge Function zijn gelijk aan de originelen', () => {
  for (const name of names) {
    const original = fs.readFileSync(path.join(root, `${name}.js`));
    const copy = fs.readFileSync(path.join(shared, `${name}.js`));
    assert.ok(original.equals(copy), `${name}.js verschilt; draai node scripts/sync-function.js`);
  }
});

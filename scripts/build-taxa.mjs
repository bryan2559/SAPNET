#!/usr/bin/env node
/**
 * Regenerate BOTH copies of the taxon reference from the master CSV.
 *
 *   npm run taxa -- SAPNET_taxon_reference_v2.csv
 *
 * Writes netlify/functions/lib/taxon-reference.json (read by the retrospective adapter)
 * and public/data/taxa.json (read by the browser). Always regenerate both together:
 * a code present in one but not the other resolves without a name, or names without
 * resolving.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: npm run taxa -- <SAPNET_taxon_reference_v2.csv>');
  process.exit(1);
}

const rows = parseCsv(readFileSync(file, 'utf8'))
  .filter(r => (r.status || 'active').trim() === 'active');

const taxa = rows.map(r => ({
  code: Number(r.taxon_code),
  sci: r.scientific_name.trim(),
  common: (r.common_name || '').trim(),
  category: Number(r.category_code)
})).sort((a, b) => a.code - b.code);

const bad = taxa.filter(t => !Number.isFinite(t.code) || !t.sci);
if (bad.length) {
  console.error(`${bad.length} row(s) have no code or no scientific name. Fix the CSV first.`);
  process.exit(1);
}
const dupes = taxa.map(t => t.code).filter((c, i, a) => a.indexOf(c) !== i);
if (dupes.length) {
  console.error(`Duplicate taxon codes: ${[...new Set(dupes)].join(', ')}`);
  process.exit(1);
}

const payload = { version: '2.0', generatedAt: new Date().toISOString(), taxa };
const a = join(HERE, '..', 'netlify', 'functions', 'lib', 'taxon-reference.json');
const b = join(HERE, '..', 'public', 'data', 'taxa.json');
writeFileSync(a, JSON.stringify(payload));
writeFileSync(b, JSON.stringify(payload));

console.log(`Wrote ${taxa.length} active taxa to both copies:`);
console.log(`  ${a}`);
console.log(`  ${b}`);

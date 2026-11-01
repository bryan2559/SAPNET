#!/usr/bin/env node
/**
 * Generate netlify/functions/lib/grid-schema.json from the prospective REDCap
 * data dictionary (the weekly_pollen_count_grid instrument).
 *
 *   npm run grid-map -- SAPNETPollenCountProspective_DataDictionary.csv
 *
 * Run this whenever the instrument changes — more rows, more taxa, a new site.
 * The adapter is driven entirely by this file, so nothing else needs editing.
 * The legacy taxon crosswalk is preserved; new codes are reported, not guessed.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'netlify', 'functions', 'lib', 'grid-schema.json');
const LEGACY = join(HERE, '..', 'netlify', 'functions', 'lib', 'legacy-schema.json');

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
  const head = rows.shift().map(h => h.trim());
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const parseChoices = s => Object.fromEntries(
  String(s).split('|').map(p => p.trim()).filter(p => p.includes(','))
    .map(p => { const i = p.indexOf(','); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: npm run grid-map -- <data-dictionary.csv>');
  process.exit(1);
}

const rows = parseCsv(readFileSync(file, 'utf8'));
const NAME = 'Variable / Field Name', CH = 'Choices, Calculations, OR Slider Labels';
const byName = new Map(rows.map(r => [r[NAME], r]));
const names = new Set(byName.keys());

const grid = rows.filter(r => r['Form Name'] === 'weekly_pollen_count_grid');
if (!grid.length) {
  console.error('No weekly_pollen_count_grid instrument found. Is this the prospective dictionary?');
  process.exit(1);
}

// Discover the grid dimensions rather than assuming 50 x 7.
const rowNums = [...names].map(n => /^wk_cat(\d+)$/.exec(n)).filter(Boolean)
  .map(m => Number(m[1])).sort((a, b) => a - b);
const dayNums = [...new Set([...names].map(n => /^wk_d(\d+)r\d+$/.exec(n)).filter(Boolean)
  .map(m => Number(m[1])))].sort((a, b) => a - b);

if (!rowNums.length || !dayNums.length) {
  console.error('Could not find wk_cat<r> / wk_d<d>r<r> fields.');
  process.exit(1);
}

// Conversion factor as written into the instrument, for comparison only. The dashboard
// derives from raw counts using its own configured factor.
const calcs = grid.filter(r => r['Field Type'] === 'calc').map(r => r[CH]);
const factors = [...new Set(calcs.map(c => /\*\s*([0-9.]+)/.exec(c || '')?.[1]).filter(Boolean))];

const CAT_TAXON = { 1: 'wk_fung', 2: 'wk_grass', 3: 'wk_tree', 4: 'wk_weed' };
const CAT_KEY = { 1: 'fungal', 2: 'grass', 3: 'tree', 4: 'weed' };

const gridRows = rowNums.map(r => ({
  n: r,
  category: `wk_cat${r}`,
  taxon: Object.fromEntries(Object.entries(CAT_TAXON)
    .map(([c, stem]) => [c, names.has(`${stem}${r}`) ? `${stem}${r}` : null])),
  daysFound: names.has(`wk_days${r}`) ? `wk_days${r}` : null,
  note: names.has(`wk_note${r}`) ? `wk_note${r}` : null,
  raw: Object.fromEntries(dayNums.map(d => [d, `wk_d${d}r${r}`])),
  converted: Object.fromEntries(dayNums.map(d => [d, `wk_d${d}c${r}`]))
}));

const days = dayNums.map(d => ({
  n: d,
  // Day 1 has no date field of its own; it is the week start.
  date: d === 1 ? 'wk_startdate' : (names.has(`wk_date${d}`) ? `wk_date${d}` : null),
  sampled: names.has(`wk_d${d}_sampled`) ? `wk_d${d}_sampled` : null,
  noSampleReason: names.has(`wk_d${d}_nosample`) ? `wk_d${d}_nosample` : null
}));

// Taxon labels, and the crosswalk to v2 codes carried over from the legacy map.
const legacy = existsSync(LEGACY) ? JSON.parse(readFileSync(LEGACY, 'utf8')) : {};
const legacyTaxonToV2 = { ...(legacy.legacyTaxonToV2 || {}) };
const taxonLabels = {};
const added = [];
for (const [catCode, stem] of Object.entries(CAT_TAXON)) {
  const first = byName.get(`${stem}${rowNums[0]}`);
  if (!first) continue;
  for (const [code, label] of Object.entries(parseChoices(first[CH]))) {
    const key = `${CAT_KEY[catCode]}:${code}`;
    taxonLabels[key] = label;
    if (!legacyTaxonToV2[key]) added.push({ key, label });
  }
}

const payload = {
  generatedFrom: file.split(/[\\/]/).pop(),
  generatedAt: new Date().toISOString(),
  note: 'Field map for the weekly_pollen_count_grid instrument. Regenerate with ' +
        'scripts/build-grid-map.mjs if the REDCap dictionary changes.',
  instrument: 'weekly_pollen_count_grid',
  instrumentFactor: factors.length === 1 ? Number(factors[0]) : factors.map(Number),
  dimensions: { rows: rowNums.length, days: dayNums.length },
  header: {
    site: 'wk_site', weekNumber: 'wk_weeknumber', startDate: 'wk_startdate',
    notes: 'wk_notes', capturedBy: 'wk_capturedby', dateCaptured: 'wk_datecaptured',
    qcBy: 'wk_qcby', qcDate: 'wk_qcdate'
  },
  siteChoices: parseChoices(byName.get('wk_site')?.[CH] ?? ''),
  categoryChoices: parseChoices(byName.get(`wk_cat${rowNums[0]}`)?.[CH] ?? ''),
  noSampleChoices: parseChoices(byName.get(`wk_d${dayNums[0]}_nosample`)?.[CH] ?? ''),
  categoryTaxonField: CAT_TAXON,
  categoryKey: CAT_KEY,
  days,
  rows: gridRows,
  legacyTaxonToV2,
  taxonLabels
};

writeFileSync(OUT, JSON.stringify(payload, null, 1));

console.log(`Wrote ${OUT}`);
console.log(`  instrument: ${payload.instrument}`);
console.log(`  grid: ${payload.dimensions.rows} rows x ${payload.dimensions.days} days ` +
            `(${payload.dimensions.rows * payload.dimensions.days} count cells)`);
console.log(`  sites: ${Object.keys(payload.siteChoices).length}, ` +
            `taxa: ${Object.keys(taxonLabels).length}`);
console.log(`  factor written into the instrument: ${JSON.stringify(payload.instrumentFactor)}`);
if (added.length) {
  console.warn(`\n  ${added.length} taxon code(s) have no v2 mapping and will be SKIPPED:`);
  for (const a of added) console.warn(`    ${a.key}  ${a.label}`);
  console.warn('  Add them to legacyTaxonToV2 here and to SAPNET_taxon_reference_v2.csv.');
} else {
  console.log('  every taxon code resolves to a v2 code.');
}

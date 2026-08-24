#!/usr/bin/env node
/**
 * Regenerate netlify/functions/lib/legacy-schema.json from a REDCap data dictionary.
 *
 *   node scripts/build-legacy-map.mjs SAPNETPollenCountProspective_DataDictionary.csv
 *
 * Run this whenever the live instrument changes — adding a taxon, adding a site,
 * adding a slot. The adapter is driven entirely by this file, so nothing else needs
 * editing. No npm dependencies; the CSV parser is below.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'netlify', 'functions', 'lib', 'legacy-schema.json');

/* ---------------- minimal RFC 4180 CSV parser ---------------- */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length > 1).map(r =>
    Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const parseChoices = s => Object.fromEntries(
  String(s).split('|').map(p => p.trim()).filter(p => p.includes(','))
    .map(p => { const i = p.indexOf(','); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));

/* ---------------- build ---------------- */
const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: node scripts/build-legacy-map.mjs <data-dictionary.csv>');
  process.exit(1);
}

const rows = parseCsv(readFileSync(file, 'utf8'));
const NAME = 'Variable / Field Name', FORM = 'Form Name';
const CHOICES = 'Choices, Calculations, OR Slider Labels';

const CAT_STEM = { 1: 'fungalspores', 2: 'grass', 3: 'trees', 4: 'weeds' };
const CAT_KEY = { fungalspores: 'fungal', grass: 'grass', trees: 'tree', weeds: 'weed' };

const forms = [...new Set(rows.map(r => r[FORM]))]
  .filter(f => /_day_\d+$/.test(f))
  .sort((a, b) => Number(a.match(/(\d+)$/)[1]) - Number(b.match(/(\d+)$/)[1]));

if (!forms.length) { console.error('No *_day_N instruments found in that dictionary.'); process.exit(1); }

const days = forms.map(form => {
  const names = rows.filter(r => r[FORM] === form).map(r => r[NAME]);
  const find = stem => {
    const re = new RegExp(`^${stem}(_v\\d+|_\\d+)*$`);
    const hits = names.filter(n => re.test(n)).sort((a, b) => a.length - b.length);
    return hits[0] ?? null;
  };
  const slots = [];
  for (let k = 1; k <= 40; k++) {
    const cat = find(`category${k}`);
    if (!cat) continue;
    slots.push({
      n: k, category: cat, count: find(`count${k}`), ccount: find(`ccount${k}`),
      taxon: Object.fromEntries(
        Object.entries(CAT_STEM).map(([c, stem]) => [c, find(`${stem}${k}`)]))
    });
  }
  return {
    day: Number(form.match(/(\d+)$/)[1]),
    site: find('site1'), date: find('date1'), week: find('weeknumber1'),
    collected: find('pollenyesno1'), reason: find('nopollendatareason1'),
    comments: find('comments_v2'), capturedBy: find('capturedby2_v2'), qcBy: find('qcby2_v2'),
    slots
  };
});

const day1 = rows.filter(r => r[FORM] === forms[0]);
const pick = v => day1.find(r => r[NAME] === v);

const siteChoices = parseChoices(pick('site1')?.[CHOICES] ?? '');
const categoryChoices = parseChoices(pick('category1')?.[CHOICES] ?? '');

// Preserve the existing legacy -> v2 crosswalk; only add codes that are new.
let previous = { legacyTaxonToV2: {} };
if (existsSync(OUT)) previous = JSON.parse(readFileSync(OUT, 'utf8'));

const legacyTaxonLabels = {}, legacyTaxonToV2 = { ...previous.legacyTaxonToV2 };
const added = [];
for (const [catCode, stem] of Object.entries(CAT_STEM)) {
  const choices = parseChoices(pick(`${stem}1`)?.[CHOICES] ?? '');
  for (const [code, label] of Object.entries(choices)) {
    const key = `${CAT_KEY[stem]}:${code}`;
    legacyTaxonLabels[key] = label;
    if (!legacyTaxonToV2[key]) added.push({ key, label });
  }
}

const payload = {
  generatedFrom: file.split(/[\\/]/).pop(),
  generatedAt: new Date().toISOString(),
  note: 'Field map for the legacy seven-day SAPNET instrument. Regenerate with ' +
        'scripts/build-legacy-map.mjs if the REDCap dictionary changes.',
  fixedConversionFactor: previous.fixedConversionFactor ?? 0.72,
  categoryFieldStems: CAT_STEM,
  siteChoices, categoryChoices, legacyTaxonToV2, legacyTaxonLabels, days
};

writeFileSync(OUT, JSON.stringify(payload, null, 1));

console.log(`Wrote ${OUT}`);
console.log(`  ${days.length} day forms, ${days[0].slots.length} slots each`);
console.log(`  ${Object.keys(siteChoices).length} sites, ${Object.keys(legacyTaxonLabels).length} legacy taxon codes`);
if (added.length) {
  console.warn(`\n  ${added.length} taxon code(s) have no v2 mapping and will be SKIPPED:`);
  for (const a of added) console.warn(`    ${a.key}  ${a.label}`);
  console.warn('  Add them to legacyTaxonToV2 in the generated file, and to SAPNET_taxon_reference_v2.csv.');
}

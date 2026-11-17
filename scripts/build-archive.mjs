#!/usr/bin/env node
/**
 * Build the historical archive that the dashboard merges with live data.
 *
 *   npm run archive -- retro-export.json [prospective-export.json ...]
 *
 * Writes public/data/archive.json. Commit it; the dashboard loads it as a static
 * file alongside whatever the API returns.
 *
 * Why this exists. The retrospective project holds one record per observation across
 * several years — far more than REDCap can export inside a serverless function's few
 * seconds, which is what a 502 after twenty-odd seconds means. Those counts are also
 * finished: they do not change. Exporting them once and publishing the result lets
 * the live API carry only the current project, which is small enough to be genuinely
 * live and refreshable.
 *
 * Export from REDCap: Data Exports -> All data -> JSON (or CSV), raw values.
 * Re-run it when the archive itself changes, which should be rarely.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FN = join(HERE, '..', 'netlify', 'functions');

const { parseCsv } = require(join(FN, 'lib', 'csv.js'));
const { transformRetrospective, looksRetrospective } = require(join(FN, 'lib', 'retrospective-adapter.js'));
const { transformGrid, looksGrid } = require(join(FN, 'lib', 'grid-adapter.js'));
const { transformLegacy, looksLegacy } = require(join(FN, 'lib', 'legacy-adapter.js'));

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: npm run archive -- <export.json|csv> [more exports ...]');
  console.error('Export from REDCap: Data Exports -> All data -> JSON or CSV, raw values.');
  process.exit(1);
}

const LABELS = {
  retrospective: 'Retrospective archive',
  grid: 'Prospective',
  legacy: 'Prospective (legacy instrument)'
};

const all = [];
const datasets = [];
const taxa = new Map();

for (const file of files) {
  if (!existsSync(file)) { console.error(`Not found: ${file}`); process.exit(1); }
  const text = readFileSync(file, 'utf8');

  let records;
  if (text.trimStart().startsWith('[')) records = JSON.parse(text);
  else records = parseCsv(text);

  if (!Array.isArray(records) || !records.length) {
    console.error(`${file}: no records.`);
    process.exit(1);
  }

  const schema = looksRetrospective(records) ? 'retrospective'
    : looksGrid(records) ? 'grid'
    : looksLegacy(records) ? 'legacy' : null;

  if (!schema) {
    console.error(`${file}: could not recognise the instrument from its field names.`);
    process.exit(1);
  }

  const dataset = schema === 'retrospective' ? 'retrospective' : 'prospective';
  const datasetLabel = LABELS[schema];
  const common = { dataset, datasetLabel };

  const { payload, diagnostics } = schema === 'retrospective'
    ? transformRetrospective(records, { ...common, countKind: process.env.COUNT_KIND })
    : schema === 'grid'
      ? transformGrid(records, common)
      : transformLegacy(records, common);

  all.push(...payload.observations);
  for (const t of payload.taxa) if (!taxa.has(t.code)) taxa.set(t.code, t);
  if (!datasets.some(d => d.dataset === dataset)) {
    datasets.push({
      dataset, label: datasetLabel, schema,
      completenessKnown: payload.completenessKnown !== false,
      conversionFactor: payload.conversionFactor ?? null
    });
  }

  const file_short = file.split(/[\\/]/).pop();
  console.log(`${file_short}: ${schema} · ${records.length.toLocaleString()} records ` +
    `-> ${payload.observations.length.toLocaleString()} site-days · ` +
    `${payload.taxa.length} taxa`);

  const unmatched = diagnostics.unmatchedTaxa || [];
  const unmapped = diagnostics.unmappedTaxonCodes || [];
  if (unmatched.length) {
    console.warn(`  ${unmatched.length} taxon name(s) did not resolve and were SKIPPED. ` +
      `Run npm run audit-retro to list them.`);
  }
  if (unmapped.length) {
    console.warn(`  ${unmapped.length} taxon code(s) have no v2 mapping: ${unmapped.join(', ')}`);
  }
}

// Last writer wins on a duplicate site-day, matching the dashboard's own merge.
const byKey = new Map();
for (const o of all) byKey.set(`${o.site}|${o.date}`, o);
const observations = [...byKey.values()]
  .sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));

const dates = observations.map(o => o.date);
const factors = [...new Set(datasets.map(d => d.conversionFactor).filter(Boolean))];

const payload = {
  source: 'archive',
  schema: datasets.length === 1 ? datasets[0].schema : 'mixed',
  generatedAt: new Date().toISOString(),
  conversionFactor: factors.length === 1 ? factors[0] : null,
  conversionFactorsInUse: factors,
  conversionBasis: factors.length === 1
    ? `All values are converted counts, derived as raw count x ${factors[0]}.`
    : `Warning: sources use different conversion factors (${factors.join(', ')}).`,
  provisional: true,
  datasets,
  sites: [...new Set(observations.map(o => o.site))].sort(),
  taxa: [...taxa.values()].sort((a, b) => a.code - b.code),
  observations
};

const OUT_DIR = join(HERE, '..', 'public', 'data');
mkdirSync(OUT_DIR, { recursive: true });
const OUT = join(OUT_DIR, 'archive.json');
writeFileSync(OUT, JSON.stringify(payload));

const kb = (JSON.stringify(payload).length / 1024).toFixed(0);
console.log(`\nWrote ${OUT}`);
console.log(`  ${observations.length.toLocaleString()} site-days · ${payload.sites.length} sites · ` +
  `${dates[0]} to ${dates[dates.length - 1]} · ${kb} KB`);
console.log('  Commit this file. The dashboard loads it as a static file and merges');
console.log('  the live API on top, so the API only has to carry the current project.');

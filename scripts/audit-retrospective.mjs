#!/usr/bin/env node
/**
 * Audit the retrospective archive's free-text columns and print crosswalk entries
 * you can paste straight into netlify/functions/lib/retrospective-map.json.
 *
 *   node scripts/audit-retrospective.mjs retro-export.json
 *
 * Export from REDCap: Data Exports -> All data -> JSON, raw values.
 *
 * Run this BEFORE connecting the archive to the dashboard. Anything it lists as
 * unresolved is data that would otherwise be skipped, and anything it lists as a
 * genus match is data that would silently lose infra-generic detail.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformRetrospective } = require('../netlify/functions/lib/retrospective-adapter.js');

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: node scripts/audit-retrospective.mjs <retro-export.json>');
  process.exit(1);
}

const records = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(records)) {
  console.error('Expected a JSON array of REDCap records.');
  process.exit(1);
}

const { payload, diagnostics: d } = transformRetrospective(records, {
  countKind: process.env.COUNT_KIND || 'raw'
});

const pct = (n, total) => total ? `${(100 * n / total).toFixed(1)}%` : '—';
const totalMatched = Object.entries(d.matchTiers)
  .filter(([k]) => k !== 'unresolved' && k !== 'categoryDisagreement')
  .reduce((a, [, v]) => a + v, 0) + d.matchTiers.unresolved;

console.log('\n=== RETROSPECTIVE ARCHIVE AUDIT ===\n');
console.log(`records read        ${d.recordsSeen}`);
console.log(`rows used           ${d.rowsUsed}`);
console.log(`site-days produced  ${d.siteDaysProduced}`);
console.log(`sites               ${payload.sites.join(', ')}`);
console.log(`taxa resolved       ${payload.taxa.length}`);
console.log(`count treated as    ${d.countKind} (factor ${d.conversionFactorUsed})`);
console.log(`calendar span       ${d.calendarSpanDays} days, ${d.calendarGapDays} with no data`);

console.log('\n--- taxon match tiers ---');
for (const [tier, n] of Object.entries(d.matchTiers)) {
  if (tier === 'categoryDisagreement') continue;
  console.log(`  ${tier.padEnd(12)} ${String(n).padStart(7)}  ${pct(n, totalMatched)}`);
}
if (d.matchTiers.categoryDisagreement) {
  console.log(`\n  ${d.matchTiers.categoryDisagreement} rows where the archive's group ` +
    `disagrees with the taxon reference (reference wins).`);
}

if (d.rowsMissingDate || d.rowsMissingCount || d.rowsMissingSite) {
  console.log('\n--- rows skipped ---');
  if (d.rowsMissingDate) console.log(`  missing or unparseable date  ${d.rowsMissingDate}`);
  if (d.rowsMissingCount) console.log(`  missing or non-numeric count ${d.rowsMissingCount}`);
  if (d.rowsMissingSite) console.log(`  missing site                 ${d.rowsMissingSite}`);
}
if (d.dateMismatchWithDayNumber) {
  console.log(`\n  ${d.dateMismatchWithDayNumber} rows where day_number disagrees with the ` +
    `weekday of day_date. Worth investigating in the source spreadsheets.`);
}

if (d.unmatchedSites.length) {
  console.log('\n--- SITES not in the alias map ---');
  console.log('    (used as-is; add any that should merge into an existing site)\n');
  for (const s of d.unmatchedSites) {
    console.log(`  ${String(s.rows).padStart(7)} rows  "${s.value}"  ->  currently "${s.usedAs}"`);
  }
  console.log('\n  Paste into "siteAliases":');
  for (const s of d.unmatchedSites) {
    console.log(`    ${JSON.stringify(s.value.toLowerCase())}: "${s.usedAs}",`);
  }
}

if (d.fuzzyMatches.length) {
  console.log('\n--- GENUS matches (infra-generic detail discarded) ---\n');
  for (const f of d.fuzzyMatches) {
    console.log(`  ${String(f.rows).padStart(7)} rows  "${f.archiveValue}"  ->  ${f.matchedTo} (${f.code})`);
  }
}

if (d.duplicateTaxonSameDay.length) {
  console.log('\n--- SAME TAXON TWICE IN ONE SITE-DAY (pooled, not overwritten) ---\n');
  for (const x of d.duplicateTaxonSameDay.slice(0, 20)) {
    console.log(`  ${x.site}  ${x.date}  ${x.taxon}`);
  }
  console.log('\n  Often a genus match collapsing two archive rows (e.g. "Quercus" and');
  console.log('  "Quercus robur") onto one code. Confirm that pooling is what you want.');
}

if (d.unmatchedTaxa.length) {
  console.log('\n--- TAXA that could not be resolved (these rows are SKIPPED) ---\n');
  for (const t of d.unmatchedTaxa) {
    console.log(`  ${String(t.rows).padStart(7)} rows  classification="${t.classification}"` +
      `  common="${t.commonName}"  group="${t.newGroup}"`);
  }
  console.log('\n  Paste into "taxonOverrides" and fill in the correct v2 code:');
  for (const t of d.unmatchedTaxa) {
    const k = (t.classification || t.commonName).toLowerCase();
    console.log(`    ${JSON.stringify(k)}: 0,   // ${t.rows} rows — ${t.commonName || t.newGroup}`);
  }
  console.log('\n  Codes are in SAPNET_taxon_reference_v2.csv. If a taxon is genuinely new,');
  console.log('  add it to that file first, then regenerate lib/taxon-reference.json.');
} else {
  console.log('\nEvery taxon resolved. Nothing to add to the crosswalk.');
}

console.log('');

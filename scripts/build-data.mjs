#!/usr/bin/env node
/**
 * Offline ETL — for deployments that do not use the serverless function.
 *
 *   node scripts/build-data.mjs redcap-export.json > public/data/observations.json
 *
 * Export from REDCap with: Data Exports > "All data" > JSON, labels for choice fields.
 * Commit the result and the dashboard will pick it up at /data/observations.json.
 *
 * Use this path when the network prefers a published snapshot over a live API
 * connection, or when the REDCap server is not reachable from Netlify.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transform } = require('../netlify/functions/observations.js');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/build-data.mjs <redcap-export.json> [minReleaseStatus]');
  process.exit(1);
}

const records = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(records)) {
  console.error('Expected a JSON array of REDCap records.');
  process.exit(1);
}

const payload = transform(records, {
  minRelease: Number(process.argv[3] || 2),
  includeFailed: false
});
payload.source = 'file';

process.stdout.write(JSON.stringify(payload));
console.error(
  `Wrote ${payload.observations.length} site-days across ${payload.sites.length} sites, ` +
  `${payload.taxa.length} taxa.`
);

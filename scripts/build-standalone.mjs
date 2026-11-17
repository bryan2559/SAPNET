#!/usr/bin/env node
/**
 * Build a single self-contained HTML file.
 *
 *   npm run standalone
 *
 * Produces SAPNET-dashboard-standalone.html at the repository root: the whole
 * dashboard in one file, with the CSS, all three scripts and the taxon names inlined.
 *
 * Why this exists. The normal build is five separate files loaded as ES modules, and
 * that is the right shape for a deployed site. But it means the page depends on a
 * deploy publishing every file, on no stale copy being cached, and on being served
 * over http — browsers refuse to load ES modules over file://. Any one of those going
 * wrong produces the same symptom: a page that sits on its loading spinner.
 *
 * This file depends on none of it. It opens by double-clicking, and it also deploys
 * as a one-file drag-and-drop. It carries the demo dataset and cannot reach REDCap,
 * so it is for proving the dashboard itself works and for offline use, never for
 * live reporting.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, '..', 'public');
const read = p => readFileSync(join(PUB, p), 'utf8');

/**
 * Turn an ES module into plain script text.
 *
 * The three modules become one scope in source order, so every import between them
 * resolves to a name already declared above. Imports are removed rather than
 * rewritten, and `export` is only ever a prefix here, never `export default` or
 * `export { ... }`, so stripping the keyword is enough.
 */
function flatten(src, label) {
  let out = src
    .replace(/^\s*import\s+[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/gm, '')
    .replace(/^export\s+/gm, '');

  if (/\bimport\s*[{(]/.test(out.replace(/import\(/g, 'dynimport('))) {
    throw new Error(`${label}: an import survived flattening — check the pattern.`);
  }
  if (/^export/m.test(out)) {
    throw new Error(`${label}: an export survived flattening.`);
  }
  return `/* ===== ${label} ===== */\n${out}`;
}

const taxa = JSON.parse(read('data/taxa.json'));

let data = flatten(read('assets/data.js'), 'data.js');

// The standalone file has no server, so the taxon-name fetch is replaced by the data
// itself. Everything else in the data layer is untouched, including the fallbacks.
data = data.replace(
  /async function taxonReference\(\)[\s\S]*?\n}/,
  `const TAXA_INLINE = ${JSON.stringify(taxa.taxa)};
async function taxonReference() {
  // Inlined for the standalone build: no network, so nothing to wait for.
  return new Map(TAXA_INLINE.map(t => [Number(t.code), t]));
}`);

const charts = flatten(read('assets/charts.js'), 'charts.js');
const app = flatten(read('assets/app.js'), 'app.js');

const css = read('assets/styles.css');

// Strip the module script, the boot guard and the stylesheet link; everything is inline.
let html = read('index.html')
  .replace(/<link rel="stylesheet" href="\/assets\/styles\.css[^"]*">/, '<style>\n' + css + '\n</style>')
  .replace(/<script src="\/assets\/boot\.js"><\/script>\s*/, '')
  .replace(/<script type="module" src="\/assets\/app\.js[^"]*"><\/script>/,
    '<script>\n(function(){\n"use strict";\n' + data + '\n' + charts + '\n' + app + '\n})();\n</script>')
  // The connection check needs the deployed site; it cannot work from one file.
  .replace(/<span style="margin-left:10px"><a href="\/check\.html"[^<]*<\/a><\/span>/, '')
  .replace(/<title>[^<]*<\/title>/, '<title>SAPNET — aerobiology reporting (standalone)</title>');

// A visible, honest label: this build can never show live data.
html = html.replace('<div class="tagline">',
  '<div class="tagline" data-standalone="1">Standalone single-file build &middot; demo data only &middot; ');

const OUT = join(HERE, '..', 'SAPNET-dashboard-standalone.html');
writeFileSync(OUT, html);

const kb = (html.length / 1024).toFixed(0);
console.log(`Wrote ${OUT}`);
console.log(`  ${kb} KB, one file, no dependencies`);
console.log('  Opens by double-clicking; also deploys as a drag-and-drop one-file site.');
console.log('  Demo data only — it cannot reach REDCap.');

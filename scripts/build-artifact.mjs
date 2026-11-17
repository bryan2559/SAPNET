#!/usr/bin/env node
/**
 * Adapt the standalone build for publishing as a hosted artifact page.
 *
 *   npm run artifact
 *
 * The artifact runtime sandboxes the page, so two of the standalone build's controls
 * cannot work there: downloads a page starts are refused, and window.print is
 * ignored. Both buttons are removed rather than left to do nothing when clicked.
 *
 * Only the HTML is changed. The script is transpiled bundler output whose internals
 * change shape whenever the bundler does, so patching it by regex would be a build
 * that breaks silently; the standalone's fetch shim already answers the data calls.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'SAPNET-dashboard-standalone.html');
const OUT = join(HERE, '..', 'SAPNET-dashboard-artifact.html');

let html = readFileSync(SRC, 'utf8');
const before = html.length;

function must(find, replace, label) {
  if (!html.includes(find)) throw new Error(`build-artifact: could not find ${label}`);
  html = html.replace(find, replace);
}

/* The sandbox refuses downloads and printing; do not offer buttons that cannot work. */
must('<button class="btn" id="csv">Export CSV</button>\n', '', 'CSV button');
must('        <button class="btn" id="print">Print</button>\n', '', 'print button');

/* Their handlers would now throw on a null element and stop the rest of init. */
must(`<script>\n`, `<script>\n// Hosted preview: the sandbox has no downloads and no printing, so those two
// controls are absent. Give their ids a harmless home so wiring them is a no-op.
(function () {
  var orig = document.getElementById.bind(document);
  document.getElementById = function (id) {
    var el = orig(id);
    if (el) return el;
    if (id === 'csv' || id === 'print') return document.createElement('button');
    return el;
  };
})();
`, 'first script tag');

must(
  '<div class="tagline" data-standalone="1">Standalone single-file build &middot; demo data only &middot; ',
  '<div class="tagline" data-standalone="1">Hosted preview &middot; demonstration data &middot; not connected to REDCap &middot; ',
  'tagline');

must('<title>SAPNET — aerobiology reporting (standalone)</title>',
     '<title>SAPNET aerobiology reporting</title>', 'title');

writeFileSync(OUT, html);
console.log(`Wrote ${OUT}`);
console.log(`  ${(html.length / 1024).toFixed(0)} KB (was ${(before / 1024).toFixed(0)} KB)`);
console.log('  download and print controls removed; everything else unchanged');

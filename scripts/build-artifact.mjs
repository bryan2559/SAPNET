#!/usr/bin/env node
/**
 * Adapt the standalone build for publishing as a hosted artifact page.
 *
 *   npm run artifact
 *
 * The artifact runtime sandboxes the page, so three things in the standalone build
 * cannot work there and are changed rather than left to fail silently:
 *
 *   1. fetch to other hosts is blocked, and there is no /api route. The data layer
 *      would spend its timeouts discovering that on every load, so the demo dataset
 *      is selected directly.
 *   2. Downloads a page starts are refused, so Export CSV copies to the clipboard
 *      instead, and says so.
 *   3. window.print is refused, so the Print button is removed rather than left to
 *      do nothing when clicked.
 *
 * Everything else — every chart, filter and view — is unchanged.
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

/* 1. Go straight to the demo dataset: there is no server behind this page. */
must(
  `async function loadData(onStatus = () => {}) {`,
  `async function loadData(onStatus = () => {}) {
  // Hosted artifact: no server and no /api route, so there is nothing to contact.
  // Selecting the demo dataset directly avoids spending the network timeouts on
  // every load just to rediscover that.
  onStatus('Preparing demonstration data…');
  return await index(demoDataset());
}

async function loadDataUnused(onStatus = () => {}) {`,
  'loadData entry');

/* 2. Downloads are refused in the sandbox; copy to the clipboard instead. */
must(
  `  const blob = new Blob([rows.join('\\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = \`sapnet_\${state.site.replace(/\\s+/g, '-')}_\${label.replace(/[^\\w]+/g, '-')}.csv\`;
  a.click();
  URL.revokeObjectURL(a.href);`,
  `  // The sandbox refuses downloads a page starts, so the CSV goes to the clipboard.
  const text = rows.join('\\n');
  const btn = document.getElementById('csv');
  const restore = function (msg) {
    if (!btn) return;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = 'Copy CSV'; }, 2200);
  };
  try {
    await navigator.clipboard.writeText(text);
    restore(\`Copied \${rows.length - 1} rows\`);
  } catch (e) {
    // Clipboard access can be refused; leave the data somewhere reachable.
    console.log(text);
    restore('Copy blocked — see console');
  }`,
  'CSV download');

must(`function exportCsv() {`, `async function exportCsv() {`, 'exportCsv signature');
must(`<button class="btn" id="csv">Export CSV</button>`,
     `<button class="btn" id="csv" title="Copies the current view as CSV to your clipboard">Copy CSV</button>`,
     'CSV button label');

/* 3. window.print is refused in the sandbox. */
must(`        <button class="btn" id="print">Print</button>\n`, '', 'print button');
must(`  $('print').onclick = () => window.print();\n`, '', 'print handler');

/* Say plainly, in the page, what this build is and is not. */
must(
  `<div class="tagline" data-standalone="1">Standalone single-file build &middot; demo data only &middot; `,
  `<div class="tagline" data-standalone="1">Hosted preview &middot; demonstration data &middot; not connected to REDCap &middot; `,
  'tagline');

must(
  `<title>SAPNET — aerobiology reporting (standalone)</title>`,
  `<title>SAPNET aerobiology reporting</title>`,
  'title');

writeFileSync(OUT, html);
console.log(`Wrote ${OUT}`);
console.log(`  ${(html.length / 1024).toFixed(0)} KB (was ${(before / 1024).toFixed(0)} KB)`);
console.log('  demo data selected directly; CSV copies to clipboard; print removed');

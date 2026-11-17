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

const taxa = JSON.parse(read('data/taxa.json'));
const js = read('assets/bundle.js');
const css = read('assets/styles.css');

/**
 * A shim in front of fetch, rather than surgery on the bundle.
 *
 * The bundle is transpiled output: its internals change shape whenever the bundler
 * does, so rewriting them by regex is a build that breaks silently. Intercepting the
 * two URLs the page asks for is stable, and it also makes the single file answer
 * instantly instead of spending its network timeouts discovering there is no server.
 */
const shim = `(function () {
  var TAXA = ${JSON.stringify(taxa)};
  var real = window.fetch ? window.fetch.bind(window) : null;
  function reply(body, status, type) {
    return Promise.resolve(new Response(body, {
      status: status, headers: { 'Content-Type': type }
    }));
  }
  window.fetch = function (url) {
    var u = String(url && url.url ? url.url : url);
    if (u.indexOf('/data/taxa.json') !== -1) {
      return reply(JSON.stringify(TAXA), 200, 'application/json');
    }
    // No server in a single file: answer at once rather than waiting to time out.
    if (u.indexOf('/api/') !== -1 || u.indexOf('/data/') !== -1) {
      return reply('', 404, 'text/plain');
    }
    return real ? real.apply(null, arguments)
                : Promise.reject(new Error('fetch unavailable'));
  };
})();`;

let html = read('index.html')
  .replace(/<link rel="stylesheet" href="\/assets\/styles\.css[^"]*">/, '<style>\n' + css + '\n</style>')
  .replace(/<script src="\/assets\/boot\.js"><\/script>\s*/, '')
  .replace(/<script src="\/assets\/bundle\.js[^"]*"><\/script>/,
    '<script>\n' + shim + '\n</script>\n<script>\n' + js + '\n</script>')
  .replace(/<span style="margin-left:10px"><a href="\/check\.html"[^<]*<\/a><\/span>/, '')
  .replace(/<title>[^<]*<\/title>/, '<title>SAPNET — aerobiology reporting (standalone)</title>');

if (html.includes('/assets/bundle.js')) {
  throw new Error('build-standalone: the bundle script tag was not replaced.');
}

html = html.replace('<div class="tagline">',
  '<div class="tagline" data-standalone="1">Standalone single-file build &middot; demo data only &middot; ');

const OUT = join(HERE, '..', 'SAPNET-dashboard-standalone.html');
writeFileSync(OUT, html);

const kb = (html.length / 1024).toFixed(0);
console.log(`Wrote ${OUT}`);
console.log(`  ${kb} KB, one file, no dependencies`);
console.log('  Opens by double-clicking; also deploys as a drag-and-drop one-file site.');
console.log('  Demo data only — it cannot reach REDCap.');

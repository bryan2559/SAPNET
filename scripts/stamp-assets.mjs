#!/usr/bin/env node
/**
 * Stamp a build version onto the asset URLs in public/index.html.
 *
 * Runs as part of `npm run build`, which Netlify executes on every deploy, so the
 * stamp changes whenever the site is rebuilt and no browser can serve a stale
 * styles.css or app.js after a release.
 *
 * This is belt and braces. The real protection is the Cache-Control header in
 * netlify.toml: assets are `max-age=0, must-revalidate` because their filenames are
 * stable rather than content-hashed. Marking unhashed files `immutable` means a
 * browser that fetched them once will keep serving the old copy for as long as the
 * max-age says, no matter how many times the site is redeployed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', 'public', 'index.html');

// Netlify exposes the commit SHA; fall back to a timestamp for local builds.
const stamp = (process.env.COMMIT_REF || '').slice(0, 8) ||
  new Date().toISOString().replace(/\D/g, '').slice(0, 12);

let html = readFileSync(FILE, 'utf8');
const before = html;
html = html.replace(/(\/assets\/(?:styles\.css|app\.js))(\?v=[^"']*)?/g, `$1?v=${stamp}`);

if (html !== before) {
  writeFileSync(FILE, html);
  console.log(`Stamped assets with v=${stamp}`);
} else {
  console.log(`Assets already at v=${stamp}`);
}

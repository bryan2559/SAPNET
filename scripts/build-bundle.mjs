#!/usr/bin/env node
/**
 * Bundle the ES modules into one classic script: public/assets/bundle.js
 *
 * Two reasons this is not optional.
 *
 * 1. Browser reach. The source uses `??` and `?.`, which are SYNTAX — a browser that
 *    does not know them cannot parse the file at all, so the module never executes
 *    and the page dies before any of its own error handling runs. Targeting es2015
 *    removes that whole class of failure.
 *
 * 2. Fragility. A module graph needs every file to be published and served with a
 *    JavaScript content type. One file does not.
 *
 * bundle.js is committed, so the site still works if a host does not run builds
 * (Netlify's drag-and-drop does not). This script keeps it in step when one does.
 * esbuild is optional: without it the committed bundle is kept and the build says so.
 */
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, '..', 'public', 'assets', 'app.js');
const OUT = join(HERE, '..', 'public', 'assets', 'bundle.js');

function esbuildAvailable() {
  for (const cmd of ['npx', 'esbuild']) {
    try {
      execFileSync(cmd, cmd === 'npx' ? ['--no-install', 'esbuild', '--version'] : ['--version'],
        { stdio: 'ignore' });
      return cmd;
    } catch { /* try the next */ }
  }
  return null;
}

const cmd = esbuildAvailable();
if (!cmd) {
  if (!existsSync(OUT)) {
    console.error('bundle.js is missing and esbuild is not available to rebuild it.');
    console.error('Run: npm i -D esbuild && npm run build');
    process.exit(1);
  }
  console.log(`esbuild not available; keeping the committed bundle.js ` +
    `(${(statSync(OUT).size / 1024).toFixed(0)} KB).`);
  console.log('If you changed anything under public/assets, rebuild it before deploying.');
  process.exit(0);
}

const args = [ENTRY, '--bundle', '--format=iife', '--target=es2015',
  `--outfile=${OUT}`, '--legal-comments=none'];
execFileSync(cmd, cmd === 'npx' ? ['--no-install', 'esbuild', ...args] : args,
  { stdio: 'inherit' });

console.log(`Bundled to ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB, es2015).`);

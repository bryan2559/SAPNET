/**
 * Probe module, used by /check.html.
 *
 * It imports the dashboard's real data module. If this evaluates, the dashboard's
 * own code parses and runs in this browser, and any remaining problem is in the
 * data rather than the code. Kept as its own file because the site's CSP is
 * script-src 'self' and inline module text is blocked.
 */
import('/assets/data.js')
  .then(m => { window.__modOk = typeof m.loadData === 'function'; })
  .catch(e => { window.__modErr = e.message || String(e); });

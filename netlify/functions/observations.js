/**
 * GET /api/observations
 *
 * Pulls the SAPNET REDCap project and returns the tidy fact table the dashboard
 * consumes. Works against BOTH schemas:
 *
 *   legacy — the seven copied day-forms with twenty fixed slots (the live project today)
 *   v2     — the repeating-instrument redesign
 *
 * The schema is detected from the exported field names. Set REDCAP_SCHEMA to
 * "legacy" or "v2" to force one.
 *
 * The REDCap API token stays in a Netlify environment variable. It is never sent to
 * the browser and never appears in the client bundle.
 *
 * Environment variables
 *   REDCAP_URL              required, e.g. https://redcap.uct.ac.za/api/
 *   REDCAP_TOKEN            required, Export permission is sufficient
 *   REDCAP_SCHEMA           optional, "auto" (default) | "legacy" | "v2"
 *   CONVERSION_FACTOR       optional, overrides the legacy 0.72
 *   MIN_RELEASE_STATUS      optional, v2 only. 1 provisional, 2 verified, 3 final. Default 2.
 *   INCLUDE_FAILED_QC       optional, v2 only. "true" to include qc_status = 3.
 *   CACHE_TTL_SECONDS       optional, default 300
 *
 * Query parameters
 *   ?refresh=1              bypass the cache
 *   ?diagnostics=1          append a parse report (see /api/diagnostics)
 *
 * With no REDCap variables set the function returns 501 and the dashboard falls back
 * to its built-in demo dataset, so a fresh deploy still renders.
 */

const { transformLegacy, looksLegacy } = require('./lib/legacy-adapter.js');

const CATEGORY = {
  1: 'Tree pollen', 2: 'Grass pollen', 3: 'Weed and herb pollen',
  4: 'Fungal spore', 5: 'Other biological particle', 9: 'Unidentified'
};

/**
 * Site codes in the v2 dictionary, preserved EXACTLY from the legacy instrument.
 * Do not renumber: codes 1 and 2 are Cape Town and Bloemfontein, not alphabetical.
 * Renumbering a live codelist silently swaps entire time series between sites.
 */
const V2_SITES = {
  1: 'Cape Town', 2: 'Bloemfontein', 3: 'Durban', 4: 'George',
  5: 'Gqeberha', 6: 'Johannesburg Central', 7: 'Kimberley', 8: 'Pretoria'
};

let cache = { at: 0, payload: null, diagnostics: null };

async function redcapExport(url, token, extra = {}) {
  const body = new URLSearchParams({
    token,
    content: 'record',
    format: 'json',
    type: 'flat',
    returnFormat: 'json',
    rawOrLabel: 'raw',
    rawOrLabelHeaders: 'raw',
    exportCheckboxLabel: 'false',
    exportSurveyFields: 'false',
    exportDataAccessGroups: 'true',
    ...extra
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`REDCap responded ${res.status}: ${text.slice(0, 300)}`);
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error(`REDCap returned non-JSON: ${text.slice(0, 200)}`); }
    if (json && json.error) throw new Error(`REDCap error: ${json.error}`);
    if (!Array.isArray(json)) throw new Error('REDCap did not return a record array.');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- v2 schema */
function transformV2(records, opts) {
  const { minRelease, includeFailed } = opts;
  const diagnostics = {
    schema: 'v2', recordsSeen: 0, dayInstances: 0, taxonInstances: 0,
    withheldByReleaseStatus: 0, withheldByFailedQc: 0, rowsMissingDate: 0
  };

  const meta = new Map();
  for (const r of records) {
    if (r.redcap_repeat_instrument) continue;
    diagnostics.recordsSeen++;
    const m = meta.get(r.record_id) || {};
    if (r.site) m.site = V2_SITES[Number(r.site)] || String(r.site);
    if (r.trap_id) m.trapId = r.trap_id;
    if (r.conversion_factor) m.conversionFactor = Number(r.conversion_factor);
    if (r.method_version) m.methodVersion = String(r.method_version);
    if (r.qc_status) m.qcStatus = Number(r.qc_status);
    if (r.release_status) m.releaseStatus = Number(r.release_status);
    meta.set(r.record_id, m);
  }

  const days = new Map();
  for (const r of records) {
    if (r.redcap_repeat_instrument !== 'daily_sample_status' || !r.day_date) continue;
    diagnostics.dayInstances++;
    days.set(`${r.record_id}|${r.day_date}`, {
      status: Number(r.day_status || 1),
      validHours: r.valid_hours === '' || r.valid_hours == null ? 24 : Number(r.valid_hours),
      reason: r.day_reason ? Number(r.day_reason) : null
    });
  }

  const out = new Map();
  const taxaSeen = new Map();

  const ensure = (site, date, day, m) => {
    const key = `${site}|${date}`;
    if (!out.has(key)) {
      out.set(key, {
        site, date,
        status: day.status, validHours: day.validHours, reason: day.reason ?? null,
        methodVersion: m.methodVersion ?? null, qcStatus: m.qcStatus ?? null,
        releaseStatus: m.releaseStatus ?? null, counts: {}
      });
    }
    return out.get(key);
  };

  for (const r of records) {
    if (r.redcap_repeat_instrument !== 'taxon_count') continue;
    diagnostics.taxonInstances++;
    const m = meta.get(r.record_id) || {};
    if (m.releaseStatus && m.releaseStatus < minRelease) { diagnostics.withheldByReleaseStatus++; continue; }
    if (!includeFailed && m.qcStatus === 3) { diagnostics.withheldByFailedQc++; continue; }
    if (!r.tc_date || !r.tc_taxon) { diagnostics.rowsMissingDate++; continue; }

    const site = m.site || 'Unknown';
    const day = days.get(`${r.record_id}|${r.tc_date}`) || { status: 1, validHours: 24, reason: null };
    const obs = ensure(site, r.tc_date, day, m);

    const code = Number(r.tc_taxon);
    const conc = r.tc_concentration !== '' && r.tc_concentration != null
      ? Number(r.tc_concentration)
      : Number(r.tc_raw_count || 0) * (m.conversionFactor || 0) * (24 / Math.max(1, day.validHours));

    obs.counts[code] = (obs.counts[code] || 0) + (Number.isFinite(conc) ? conc : 0);
    if (!taxaSeen.has(code)) {
      taxaSeen.set(code, { code, sci: String(code), common: '', category: Math.floor(code / 1000) });
    }
  }

  // Sampled days with no taxon rows still belong in the series.
  for (const [k, d] of days) {
    const [recordId, date] = k.split('|');
    const m = meta.get(recordId) || {};
    if (m.releaseStatus && m.releaseStatus < minRelease) continue;
    ensure(m.site || 'Unknown', date, d, m);
  }

  const observations = [...out.values()]
    .sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));
  diagnostics.siteDaysProduced = observations.length;

  return {
    payload: {
      source: 'redcap', schema: 'v2', generatedAt: new Date().toISOString(),
      minReleaseStatus: minRelease, provisional: minRelease < 2,
      sites: [...new Set(observations.map(o => o.site))].sort(),
      categories: CATEGORY,
      taxa: [...taxaSeen.values()].sort((a, b) => a.code - b.code),
      observations
    },
    diagnostics
  };
}

/* ---------------------------------------------------------------- entry */
async function build() {
  const url = process.env.REDCAP_URL;
  const token = process.env.REDCAP_TOKEN;
  if (!url || !token) {
    const err = new Error(
      'REDCAP_URL and REDCAP_TOKEN are not set. The dashboard will use its built-in ' +
      'demo dataset. Add both under Site configuration > Environment variables, then redeploy.');
    err.code = 'not_configured';
    throw err;
  }

  const records = await redcapExport(url, token);

  const forced = String(process.env.REDCAP_SCHEMA || 'auto').toLowerCase();
  const useLegacy = forced === 'legacy' || (forced !== 'v2' && looksLegacy(records));

  const result = useLegacy
    ? transformLegacy(records, { conversionFactor: process.env.CONVERSION_FACTOR })
    : transformV2(records, {
        minRelease: Number(process.env.MIN_RELEASE_STATUS || 2),
        includeFailed: String(process.env.INCLUDE_FAILED_QC || 'false') === 'true'
      });

  result.diagnostics.schemaForced = forced !== 'auto' ? forced : null;
  result.diagnostics.rawRecordsReturned = records.length;
  return result;
}

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
  if (process.env.ALLOWED_ORIGIN) headers['Access-Control-Allow-Origin'] = process.env.ALLOWED_ORIGIN;

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const q = event.queryStringParameters || {};
  const ttl = Number(process.env.CACHE_TTL_SECONDS || 300) * 1000;

  try {
    if (!cache.payload || Date.now() - cache.at > ttl || q.refresh === '1') {
      const { payload, diagnostics } = await build();
      cache = { at: Date.now(), payload, diagnostics };
    }
    const body = q.diagnostics === '1'
      ? { ...cache.payload, diagnostics: cache.diagnostics }
      : cache.payload;
    return { statusCode: 200, headers, body: JSON.stringify(body) };
  } catch (err) {
    const notConfigured = err.code === 'not_configured';
    return {
      statusCode: notConfigured ? 501 : 502,
      headers,
      body: JSON.stringify({
        error: notConfigured ? 'not_configured' : 'redcap_unavailable',
        message: String(err.message || err)
      })
    };
  }
};

exports.build = build;
exports.transformV2 = transformV2;
exports.transform = transformV2;   // kept for scripts/build-data.mjs

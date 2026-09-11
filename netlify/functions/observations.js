/**
 * GET /api/observations
 *
 * Pulls one or more SAPNET REDCap projects and returns a single tidy fact table.
 *
 * MULTIPLE PROJECTS ON ONE INSTANCE
 * Each REDCap project has its own API token, so a prospective and a retrospective
 * project are two tokens against the same REDCAP_URL. List them in REDCAP_SOURCES
 * and the function fetches both, detects each one's schema independently, tags every
 * observation with the dataset it came from, and merges them into one series.
 *
 *   REDCAP_SOURCES = PROSPECTIVE,RETROSPECTIVE
 *
 *   REDCAP_TOKEN_PROSPECTIVE    = <token>
 *   REDCAP_LABEL_PROSPECTIVE    = Prospective            (optional, display name)
 *   REDCAP_SCHEMA_PROSPECTIVE   = auto|legacy|v2|retrospective  (optional)
 *   REDCAP_PRIORITY_PROSPECTIVE = 100                    (optional, higher wins a clash)
 *   REDCAP_FACTOR_PROSPECTIVE   = 0.72                   (optional, legacy/retro only)
 *   REDCAP_COUNTKIND_PROSPECTIVE= raw|concentration       (optional, retrospective only)
 *   REDCAP_URL_PROSPECTIVE      = <url>                  (optional, if not the same instance)
 *
 *   ...and the same set suffixed _RETROSPECTIVE.
 *
 * Where the same site and date appear in more than one project, the higher-priority
 * dataset wins and the clash is reported in /api/diagnostics. Values are never summed
 * across datasets — that would double-count a day recorded in both.
 *
 * Single-project setups still work unchanged: set REDCAP_TOKEN and omit REDCAP_SOURCES.
 *
 * Tokens live only in Netlify environment variables. They are never sent to the
 * browser and never appear in any response.
 *
 * Other environment variables
 *   REDCAP_URL              required, shared by all sources unless overridden
 *   MIN_RELEASE_STATUS      v2 only. 1 provisional, 2 verified, 3 final. Default 2.
 *   INCLUDE_FAILED_QC       v2 only. "true" to include qc_status = 3.
 *   CACHE_TTL_SECONDS       default 300
 *
 * Query parameters
 *   ?refresh=1              bypass the cache
 *   ?diagnostics=1          append the parse report
 */

const { transformLegacy, looksLegacy } = require('./lib/legacy-adapter.js');
const { transformRetrospective, looksRetrospective } = require('./lib/retrospective-adapter.js');
const { conversionFactor, toConcentration, methodLabel } = require('./lib/conversion.js');

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

/* ---------------------------------------------------------------- config */
function readSources() {
  const list = String(process.env.REDCAP_SOURCES || '').split(',')
    .map(s => s.trim()).filter(Boolean);

  // Back-compatible single-project setup.
  if (!list.length) {
    if (!process.env.REDCAP_TOKEN) return [];
    return [{
      key: 'PRIMARY',
      label: process.env.REDCAP_LABEL || 'SAPNET',
      dataset: 'primary',
      url: process.env.REDCAP_URL,
      token: process.env.REDCAP_TOKEN,
      schema: String(process.env.REDCAP_SCHEMA || 'auto').toLowerCase(),
      priority: 100,
      factor: process.env.CONVERSION_FACTOR,
      countKind: process.env.COUNT_KIND
    }];
  }

  return list.map((key, i) => {
    const K = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return {
      key: K,
      label: process.env[`REDCAP_LABEL_${K}`] ||
        K.charAt(0) + K.slice(1).toLowerCase(),
      dataset: K.toLowerCase(),
      url: process.env[`REDCAP_URL_${K}`] || process.env.REDCAP_URL,
      token: process.env[`REDCAP_TOKEN_${K}`],
      schema: String(process.env[`REDCAP_SCHEMA_${K}`] ||
        process.env.REDCAP_SCHEMA || 'auto').toLowerCase(),
      // Later entries in REDCAP_SOURCES lose a clash unless told otherwise, so the
      // order you list them in is a sensible default precedence.
      priority: Number(process.env[`REDCAP_PRIORITY_${K}`] ?? (100 - i)),
      factor: process.env[`REDCAP_FACTOR_${K}`] || process.env.CONVERSION_FACTOR,
      countKind: process.env[`REDCAP_COUNTKIND_${K}`] || process.env.COUNT_KIND
    };
  });
}

/* ---------------------------------------------------------------- fetch */
async function redcapExport(url, token) {
  const body = new URLSearchParams({
    token, content: 'record', format: 'json', type: 'flat', returnFormat: 'json',
    rawOrLabel: 'raw', rawOrLabelHeaders: 'raw', exportCheckboxLabel: 'false',
    exportSurveyFields: 'false', exportDataAccessGroups: 'true'
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body, signal: controller.signal
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
  const uniform = opts.uniform !== false;
  const factor = conversionFactor(opts.conversionFactor);
  const dataset = opts.dataset || 'primary';
  const datasetLabel = opts.datasetLabel || dataset;
  const diagnostics = {
    dataset, datasetLabel, schema: 'v2', recordsSeen: 0, dayInstances: 0,
    taxonInstances: 0, withheldByReleaseStatus: 0, withheldByFailedQc: 0, rowsMissingDate: 0,
    uniformConversion: uniform, conversionFactorUsed: uniform ? factor : null,
    projectFactorsSeen: {}
  };

  const meta = new Map();
  for (const r of records) {
    if (r.redcap_repeat_instrument) continue;
    diagnostics.recordsSeen++;
    const m = meta.get(r.record_id) || {};
    if (r.site) m.site = V2_SITES[Number(r.site)] || String(r.site);
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
        site, date, dataset, datasetLabel,
        status: day.status, validHours: day.validHours, reason: day.reason ?? null,
        methodVersion: uniform ? methodLabel('prospective v2', factor) : (m.methodVersion ?? null),
        conversionFactor: uniform ? factor : (m.conversionFactor ?? null),
        qcStatus: m.qcStatus ?? null,
        releaseStatus: m.releaseStatus ?? null, counts: {}, raw: {}
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

    const day = days.get(`${r.record_id}|${r.tc_date}`) || { status: 1, validHours: 24, reason: null };
    const obs = ensure(m.site || 'Unknown', r.tc_date, day, m);
    const code = Number(r.tc_taxon);
    const rawCount = Number(r.tc_raw_count || 0);

    // Uniform basis: every source reports raw count x the network factor, so a v2 day
    // and an archive day sit on one scale. The project's own measured factor is kept in
    // diagnostics for comparison, and this can be switched off once v2 carries real
    // flow-rate data everywhere and the network decides to report on that basis instead.
    const conc = uniform
      ? toConcentration(rawCount, factor)
      : (r.tc_concentration !== '' && r.tc_concentration != null
          ? Number(r.tc_concentration)
          : rawCount * (m.conversionFactor || 0) * (24 / Math.max(1, day.validHours)));

    if (uniform && m.conversionFactor) {
      diagnostics.projectFactorsSeen[m.conversionFactor] =
        (diagnostics.projectFactorsSeen[m.conversionFactor] || 0) + 1;
    }

    obs.counts[code] = (obs.counts[code] || 0) + (Number.isFinite(conc) ? conc : 0);
    obs.raw[code] = (obs.raw[code] || 0) + (Number.isFinite(rawCount) ? rawCount : 0);
    if (!taxaSeen.has(code)) {
      taxaSeen.set(code, { code, sci: String(code), common: '', category: Math.floor(code / 1000) });
    }
  }

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
      source: 'redcap', dataset, datasetLabel, schema: 'v2',
      generatedAt: new Date().toISOString(),
      minReleaseStatus: minRelease, provisional: minRelease < 2,
      conversionFactor: uniform ? factor : null,
      sites: [...new Set(observations.map(o => o.site))].sort(),
      categories: CATEGORY,
      taxa: [...taxaSeen.values()].sort((a, b) => a.code - b.code),
      observations
    },
    diagnostics
  };
}

/* ---------------------------------------------------------------- merge */
/**
 * Combine the per-source fact tables. Values are never summed across datasets: a
 * site-day present in two projects is one physical day of sampling, and adding the
 * two would double it. Highest priority wins; the clash is reported.
 */
function mergeSources(results) {
  const byKey = new Map();
  const conflicts = [];
  const taxa = new Map();

  for (const { payload, config } of results) {
    for (const t of payload.taxa) if (!taxa.has(t.code)) taxa.set(t.code, t);

    for (const o of payload.observations) {
      const key = `${o.site}|${o.date}`;
      const held = byKey.get(key);
      if (!held) { byKey.set(key, { obs: o, priority: config.priority }); continue; }

      conflicts.push({
        site: o.site, date: o.date,
        datasets: [held.obs.datasetLabel, o.datasetLabel],
        kept: held.priority >= config.priority ? held.obs.datasetLabel : o.datasetLabel,
        taxaInKept: Object.keys(held.priority >= config.priority ? held.obs.counts : o.counts).length,
        taxaInDropped: Object.keys(held.priority >= config.priority ? o.counts : held.obs.counts).length
      });

      if (config.priority > held.priority) byKey.set(key, { obs: o, priority: config.priority });
    }
  }

  const observations = [...byKey.values()].map(v => v.obs)
    .sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));

  // Where one site's series is assembled from more than one project, the join is a
  // potential step change in method. Surface it rather than letting it look continuous.
  const boundaries = [];
  const bySite = new Map();
  for (const o of observations) {
    if (!bySite.has(o.site)) bySite.set(o.site, []);
    bySite.get(o.site).push(o);
  }
  for (const [site, arr] of bySite) {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].dataset !== arr[i - 1].dataset) {
        boundaries.push({
          site, date: arr[i].date,
          from: arr[i - 1].datasetLabel, to: arr[i].datasetLabel,
          fromMethod: arr[i - 1].methodVersion, toMethod: arr[i].methodVersion
        });
      }
    }
  }

  const datasets = results.map(r => ({
    dataset: r.payload.dataset,
    label: r.payload.datasetLabel,
    schema: r.payload.schema,
    priority: r.config.priority,
    siteDays: r.payload.observations.length,
    conversionFactor: r.payload.conversionFactor ?? null,
    provisional: Boolean(r.payload.provisional),
    completenessKnown: r.payload.completenessKnown !== false,
    provisionalReason: r.payload.provisionalReason || null
  }));

  const anyProvisional = results.some(r => r.payload.provisional);
  const factors = [...new Set(results.map(r => r.payload.conversionFactor).filter(Boolean))];

  return {
    source: 'redcap',
    schema: results.length === 1 ? results[0].payload.schema : 'mixed',
    generatedAt: new Date().toISOString(),
    // One basis across every source: converted count = raw count x factor.
    conversionFactor: factors.length === 1 ? factors[0] : null,
    conversionFactorsInUse: factors,
    conversionBasis: factors.length === 1
      ? `All values are converted counts, derived as raw count x ${factors[0]}.`
      : `Warning: sources are using different conversion factors (${factors.join(', ')}). ` +
        `Values are not comparable until this is reconciled.`,
    datasets,
    boundaries,
    provisional: anyProvisional,
    provisionalReason: anyProvisional
      ? results.filter(r => r.payload.provisional)
          .map(r => `${r.payload.datasetLabel}: ${r.payload.provisionalReason ||
            'method details unavailable, treat concentrations as provisional.'}`)
          .join(' ')
      : null,
    sites: [...new Set(observations.map(o => o.site))].sort(),
    categories: CATEGORY,
    taxa: [...taxa.values()].sort((a, b) => a.code - b.code),
    observations,
    _conflicts: conflicts
  };
}

/* ---------------------------------------------------------------- entry */
async function build() {
  const sources = readSources();
  if (!sources.length || !sources[0].url) {
    const err = new Error(
      'No REDCap source configured. Set REDCAP_URL and REDCAP_TOKEN, or set ' +
      'REDCAP_SOURCES plus a REDCAP_TOKEN_<KEY> for each project. The dashboard ' +
      'will use its built-in demo dataset until then.');
    err.code = 'not_configured';
    throw err;
  }

  const missing = sources.filter(s => !s.token || !s.url).map(s => s.key);
  if (missing.length) {
    const err = new Error(
      `REDCAP_SOURCES lists ${missing.join(', ')} but no token or URL was found for ` +
      `${missing.length > 1 ? 'those' : 'that'} key. Expected REDCAP_TOKEN_${missing[0]}.`);
    err.code = 'not_configured';
    throw err;
  }

  const perSource = [];
  const sourceDiagnostics = [];

  // Sequential rather than parallel: two REDCap exports at once on a shared
  // institutional server is a good way to get rate-limited.
  for (const config of sources) {
    let records;
    try {
      records = await redcapExport(config.url, config.token);
    } catch (e) {
      // One project failing must not take out the whole dashboard.
      sourceDiagnostics.push({
        dataset: config.dataset, datasetLabel: config.label,
        error: String(e.message || e), siteDaysProduced: 0
      });
      continue;
    }

    // Three shapes now: the retrospective archive, the legacy seven-day grid, and v2.
    let detected = config.schema;
    if (detected === 'auto') {
      detected = looksRetrospective(records) ? 'retrospective'
        : looksLegacy(records) ? 'legacy' : 'v2';
    }

    const common = { dataset: config.dataset, datasetLabel: config.label };
    const result =
      detected === 'retrospective'
        ? transformRetrospective(records, {
            ...common, countKind: config.countKind, conversionFactor: config.factor })
      : detected === 'legacy'
        ? transformLegacy(records, { ...common, conversionFactor: config.factor })
        : transformV2(records, {
            ...common,
            conversionFactor: config.factor,
            uniform: String(process.env.UNIFORM_CONVERSION || 'true') !== 'false',
            minRelease: Number(process.env.MIN_RELEASE_STATUS || 2),
            includeFailed: String(process.env.INCLUDE_FAILED_QC || 'false') === 'true'
          });

    result.diagnostics.schemaForced = config.schema !== 'auto' ? config.schema : null;
    result.diagnostics.rawRecordsReturned = records.length;
    result.diagnostics.priority = config.priority;
    sourceDiagnostics.push(result.diagnostics);
    perSource.push({ payload: result.payload, config });
  }

  if (!perSource.length) {
    const err = new Error('Every configured REDCap source failed. See /api/diagnostics.');
    err.code = 'redcap_unavailable';
    throw err;
  }

  const merged = mergeSources(perSource);
  const conflicts = merged._conflicts;
  delete merged._conflicts;

  return {
    payload: merged,
    diagnostics: {
      sourcesConfigured: sources.length,
      sourcesRead: perSource.length,
      sources: sourceDiagnostics,
      mergedSiteDays: merged.observations.length,
      overlappingSiteDays: conflicts.length,
      overlapExamples: conflicts.slice(0, 25),
      datasetBoundaries: merged.boundaries
    }
  };
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
exports.readSources = readSources;
exports.mergeSources = mergeSources;
exports.transformV2 = transformV2;
exports.transform = transformV2;   // kept for scripts/build-data.mjs

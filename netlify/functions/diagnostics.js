/**
 * GET /api/diagnostics
 *
 * Parse report for the live REDCap connection. Use this when wiring the dashboard
 * to the real project: it tells you which schema was detected, how many day-forms
 * and slots were read, and which rows were skipped and why.
 *
 * Returns counts and field names only — never any record values, and never the token.
 */

const { build } = require('./observations.js');

exports.handler = async function () {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };

  const { readSources } = require('./observations.js');
  const sources = readSources();
  if (!sources.length || !sources[0].url || !sources[0].token) {
    return {
      statusCode: 501, headers,
      body: JSON.stringify({
        redcapConfigured: false, dataSource: 'demo',
        message: 'Set REDCAP_URL and REDCAP_TOKEN, or REDCAP_SOURCES plus a ' +
                 'REDCAP_TOKEN_<KEY> per project, then redeploy.'
      })
    };
  }

  try {
    const { payload, diagnostics } = await build();
    const valid = payload.observations.filter(o => o.status !== 3);
    const dates = payload.observations.map(o => o.date).sort();

    // Per-dataset coverage, so you can see what each project actually contributed.
    const perDataset = {};
    for (const o of payload.observations) {
      const d = perDataset[o.datasetLabel] ||= { siteDays: 0, validDays: 0, first: null, last: null, sites: new Set() };
      d.siteDays++;
      if (o.status !== 3) d.validDays++;
      d.sites.add(o.site);
      if (!d.first || o.date < d.first) d.first = o.date;
      if (!d.last || o.date > d.last) d.last = o.date;
    }
    for (const k of Object.keys(perDataset)) {
      perDataset[k].sites = [...perDataset[k].sites].sort();
      perDataset[k].completenessPct = perDataset[k].siteDays
        ? Math.round(1000 * perDataset[k].validDays / perDataset[k].siteDays) / 10 : null;
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        redcapConfigured: true,
        redcapUrlHosts: [...new Set(sources.map(s => { try { return new URL(s.url).host; } catch { return 'invalid-url'; } }))],
        datasets: payload.datasets,
        schemaDetected: payload.schema,
        conversion: {
          basis: payload.conversionBasis || null,
          factor: payload.conversionFactor ?? null,
          factorsInUse: payload.conversionFactorsInUse || [],
          uniform: (payload.conversionFactorsInUse || []).length <= 1
        },
        provisional: Boolean(payload.provisional),
        provisionalReason: payload.provisionalReason || null,
        coverage: {
          sites: payload.sites,
          taxaFound: payload.taxa.length,
          siteDays: payload.observations.length,
          validDays: valid.length,
          completenessPct: payload.observations.length
            ? Math.round(1000 * valid.length / payload.observations.length) / 10 : null,
          firstDate: dates[0] || null,
          lastDate: dates.at(-1) || null,
          byDataset: perDataset
        },
        parse: diagnostics,
        checkedAt: new Date().toISOString()
      }, null, 2)
    };
  } catch (err) {
    return {
      statusCode: err.code === 'not_configured' ? 501 : 502, headers,
      body: JSON.stringify({ error: err.code || 'redcap_unavailable', message: String(err.message || err) })
    };
  }
};

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

  const configured = Boolean(process.env.REDCAP_URL && process.env.REDCAP_TOKEN);
  if (!configured) {
    return {
      statusCode: 501,
      headers,
      body: JSON.stringify({
        redcapConfigured: false,
        dataSource: 'demo',
        message: 'Set REDCAP_URL and REDCAP_TOKEN, then redeploy.'
      })
    };
  }

  try {
    const { payload, diagnostics } = await build();

    const valid = payload.observations.filter(o => o.status !== 3);
    const dates = payload.observations.map(o => o.date).sort();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        redcapConfigured: true,
        redcapUrlHost: new URL(process.env.REDCAP_URL).host,
        schemaDetected: payload.schema,
        provisional: Boolean(payload.provisional),
        provisionalReason: payload.provisionalReason || null,
        coverage: {
          sites: payload.sites,
          taxaFound: payload.taxa.length,
          siteDays: payload.observations.length,
          validDays: valid.length,
          completenessPct: payload.observations.length
            ? Math.round(1000 * valid.length / payload.observations.length) / 10
            : null,
          firstDate: dates[0] || null,
          lastDate: dates.at(-1) || null
        },
        parse: diagnostics,
        checkedAt: new Date().toISOString()
      }, null, 2)
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'redcap_unavailable', message: String(err.message || err) })
    };
  }
};

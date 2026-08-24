/** GET /api/health — configuration check that never echoes secret values. */
exports.handler = async function () {
  const configured = Boolean(process.env.REDCAP_URL && process.env.REDCAP_TOKEN);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ok: true,
      redcapConfigured: configured,
      dataSource: configured ? 'redcap' : 'demo',
      minReleaseStatus: Number(process.env.MIN_RELEASE_STATUS || 2),
      time: new Date().toISOString()
    })
  };
};

/**
 * Data layer.
 *
 * Resolution order, first success wins:
 *   1. /api/observations        — live REDCap via the Netlify function
 *   2. /data/observations.json  — a snapshot committed to the repo
 *   3. built-in demo generator  — so a fresh deploy always renders
 *
 * Every source returns the same shape:
 *   { source, schema, generatedAt, conversionFactor, conversionBasis, datasets[],
 *     sites[], taxa[{code,sci,common,category}],
 *     observations[{ site, date, dataset, datasetLabel, status, validHours,
 *                    reason, reasonLabel, pendingRead, methodVersion,
 *                    conversionFactor, raw{}, counts{} }] }
 *
 * status: 1 complete · 2 partial · 3 not collected · 4 invalidated
 */

/** Placeholder risk bands — replace with values signed off by the clinical advisory group. */
export const BANDS = {
  1: [15, 90, 1500], 2: [10, 30, 100], 3: [10, 50, 500],
  4: [500, 3000, 15000], pollen: [20, 100, 1000], all: [500, 3000, 15000]
};
export const BANDNAME = ['Low', 'Moderate', 'High', 'Very high'];

export const bandOf = (v, key) => {
  const t = BANDS[key] || BANDS.pollen;
  return v < t[0] ? 0 : v < t[1] ? 1 : v < t[2] ? 2 : 3;
};

/**
 * Every network call on this page goes through here.
 *
 * A bare `await fetch(...)` never settles if the other end accepts the connection
 * and then goes quiet — no error, no rejection, nothing in the console. The page
 * simply waits on its loading spinner for as long as the tab is open. A serverless
 * function killed mid-request does exactly that, and so can a proxy or a captive
 * portal. Nothing here is allowed to wait without a deadline.
 */
async function fetchWithTimeout(url, ms, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Names for taxon codes, shipped with the site so any schema renders readable labels. */
async function taxonReference() {
  try {
    // Static file on the same origin, so it should be instant. It still gets a
    // deadline: this runs on every path, including the demo fallback, so a hang
    // here would freeze the page even when the live request timed out correctly.
    const r = await fetchWithTimeout('/data/taxa.json', 5000);
    if (r.ok) { const d = await r.json(); return new Map(d.taxa.map(t => [Number(t.code), t])); }
  } catch (e) { console.warn('taxa.json unavailable:', e.message); }
  return new Map();
}

/**
 * Deadlines, chosen so that the three of them in sequence still finish inside the
 * watchdog in app.js. The graceful fallback should always win that race; the
 * watchdog is there for bugs, not for slow networks.
 *
 *   live 15s + snapshot 5s + taxa 5s = 25s worst case, against a 30s watchdog.
 *
 * The function aborts its own REDCap call at 8.5s, so a healthy API answers well
 * inside 15s whatever REDCap is doing.
 */
const LIVE_TIMEOUT_MS = 15000;

export async function loadData(onStatus = () => {}) {
  onStatus('Contacting REDCap…');
  const started = Date.now();
  let liveError = null;

  const slow = setTimeout(
    () => onStatus('REDCap is taking a while — a full export of a wide instrument is slow…'),
    6000);

  let live = null;
  try {
    const r = await fetchWithTimeout('/api/observations', LIVE_TIMEOUT_MS,
      { headers: { Accept: 'application/json' } });
    if (r.ok) {
      onStatus('Reading response…');
      const d = await r.json();
      if (d.observations && d.observations.length) live = d;
      else liveError = 'REDCap returned no observations.';
    } else if (r.status === 501) {
      liveError = null;                         // simply not configured yet
    } else {
      const e = await r.json().catch(() => ({}));
      liveError = e.message || `API returned ${r.status}`;
    }
  } catch (e) {
    liveError = e.name === 'AbortError'
      ? `No response from /api/observations within ${LIVE_TIMEOUT_MS / 1000}s.`
      : e.message;
  }
  clearTimeout(slow);
  // Index outside the request's deadline: building the lookups is local work and
  // must not be cut short by a timer meant for the network.
  if (live) return await index(live);
  if (liveError) console.warn('Live data unavailable:', liveError);

  onStatus('Falling back to the committed snapshot…');
  try {
    const r = await fetchWithTimeout('/data/observations.json', 5000);
    if (r.ok) {
      const d = await r.json();
      if (d.observations && d.observations.length) {
        const db = await index({ ...d, source: 'file' });
        db.liveError = liveError;
        return db;
      }
    }
  } catch (e) { /* fall through to demo */ }

  onStatus('Using the built-in demo dataset…');
  const db = await index(demoDataset());
  db.liveError = liveError;
  db.liveElapsedMs = Date.now() - started;
  return db;
}

/** Add the lookups the views need, without changing the wire format. */
async function index(d) {
  const ref = await taxonReference();
  const taxaByCode = new Map(d.taxa.map(t => {
    const code = Number(t.code);
    const known = ref.get(code);
    return [code, {
      code,
      sci: (known && known.sci) || t.sci || String(code),
      common: (known && known.common) || t.common || '',
      category: t.category ?? (known && known.category) ?? Math.floor(code / 1000)
    }];
  }));

  const bySite = new Map();
  for (const o of d.observations) {
    if (!bySite.has(o.site)) bySite.set(o.site, []);
    bySite.get(o.site).push(o);
  }
  for (const arr of bySite.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    for (const o of arr) o.ts = Date.parse(o.date + 'T00:00:00Z');
  }

  const datasets = d.datasets ||
    [...new Set(d.observations.map(o => o.datasetLabel).filter(Boolean))]
      .map(label => ({ label, dataset: label, completenessKnown: true }));

  return { ...d, taxaByCode, bySite, datasets, sites: [...bySite.keys()].sort() };
}

/* ------------------------------------------------------------------ *
 * Demo dataset — seeded, identical on every load. Southern-hemisphere
 * seasonality, split across a retrospective archive and the prospective
 * grid so the join behaviour is visible. Delete once live.
 * ------------------------------------------------------------------ */
const DEMO_TAXA = [
  [1016, 'Cupressaceae', 'Cypress', 1, 200, 38, 120],
  [1041, 'Platanus', 'Plane', 1, 255, 26, 180],
  [1045, 'Quercus', 'Oak', 1, 268, 25, 95],
  [1038, 'Oleaceae', 'Olive family', 1, 288, 30, 140],
  [1034, 'Moraceae', 'Mulberry family', 1, 240, 24, 70],
  [1040, 'Pinus', 'Pine', 1, 272, 34, 60],
  [2001, 'Poaceae', 'Grass', 2, 330, 72, 105],
  [2002, 'Zea mays', 'Maize', 2, 20, 28, 14],
  [3009, 'Asteraceae', 'Daisy family', 3, 80, 55, 26],
  [3015, 'Chenopodiaceae', 'Goosefoot', 3, 60, 48, 22],
  [3034, 'Plantaginaceae', 'Plantain', 3, 330, 60, 18],
  [3007, 'Artemisia', 'Mugwort', 3, 95, 34, 12],
  [4012, 'Cladosporium', '', 4, 80, 120, 2600],
  [4001, 'Alternaria', '', 4, 70, 70, 220],
  [4004, 'Ascospores', '', 4, 120, 95, 700],
  [4006, 'Basidiospores', '', 4, 110, 100, 540],
  [4014, 'Epicoccum', '', 4, 95, 60, 90]
];
const DEMO_SITES = {
  'Cape Town': [1.15, .85, 1.05, .8], 'Bloemfontein': [.75, 1.25, .95, .55],
  'Durban': [.7, 1.05, .8, 1.7], 'George': [.95, 1.0, .85, 1.25],
  'Gqeberha': [.9, 1.1, 1.0, .95], 'Johannesburg Central': [1.25, 1.15, 1.05, .85],
  'Kimberley': [.6, 1.1, 1.2, .5], 'Pretoria': [1.35, 1.05, 1.0, .9]
};
const REASONS = { 1: 'Trap or equipment failure', 2: 'Power outage', 3: 'Slide damaged or lost',
  4: 'No staff available', 5: 'Slide not yet read', 6: 'Other (see notes)' };
const FACTOR = 0.72;

function demoDataset() {
  let seed = 20261101;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const DAY = 864e5;
  const start = Date.UTC(2019, 0, 7);
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cutover = Date.UTC(2026, 0, 5);   // archive ends, prospective grid begins
  const doy = d => Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY);
  const observations = [];

  for (const [site, mod] of Object.entries(DEMO_SITES)) {
    for (let t = start; t <= end; t += DAY) {
      const d = new Date(t), k = doy(d);
      const retro = t < cutover;
      // The archive holds only days that were digitised; roughly a fifth are absent.
      if (retro && rnd() < 0.2) continue;

      let status = 1, validHours = 24, reason = null, pendingRead = false;
      if (!retro) {
        const r = rnd();
        if (r < 0.03) { status = 3; validHours = 0; reason = 1 + Math.floor(rnd() * 4); }
        else if (r < 0.045) { status = 3; validHours = 0; reason = 5; pendingRead = true; }
      }

      const raw = {}, counts = {};
      if (status !== 3) {
        for (const [code, , , cat, peak, spread, amp] of DEMO_TAXA) {
          let dist = Math.abs(k - peak); dist = Math.min(dist, 365 - dist);
          let v = amp * Math.exp(-(dist * dist) / (2 * spread * spread)) * mod[cat - 1];
          v *= 0.45 + 1.35 * rnd();
          if (rnd() < 0.10) v *= 2.3;
          // A gentle upward drift so the year-on-year overlay has something to show.
          v *= 1 + 0.035 * (d.getUTCFullYear() - 2019);
          const rc = Math.round(v);
          if (rc > 0) { raw[code] = rc; counts[code] = rc * FACTOR; }
        }
      }

      observations.push({
        site, date: new Date(t).toISOString().slice(0, 10),
        dataset: retro ? 'retrospective' : 'prospective',
        datasetLabel: retro ? 'Retrospective archive' : 'Prospective',
        status, validHours, reason,
        reasonLabel: reason ? REASONS[reason] : null,
        pendingRead,
        methodVersion: `${retro ? 'retrospective archive' : 'prospective grid'}, converted count = raw x ${FACTOR}`,
        conversionFactor: FACTOR,
        raw, counts
      });
    }
  }

  return {
    source: 'demo', schema: 'mixed',
    generatedAt: new Date().toISOString(),
    conversionFactor: FACTOR,
    conversionFactorsInUse: [FACTOR],
    conversionBasis: `All values are converted counts, derived as raw count x ${FACTOR}.`,
    provisional: true,
    provisionalReason: 'Demonstration data. Neither project records measured flow rate or valid ' +
      'sampling hours, so the conversion factor is a network convention rather than a measured value.',
    datasets: [
      { dataset: 'prospective', label: 'Prospective', schema: 'grid', completenessKnown: true },
      { dataset: 'retrospective', label: 'Retrospective archive', schema: 'retrospective', completenessKnown: false }
    ],
    sites: Object.keys(DEMO_SITES).sort(),
    taxa: DEMO_TAXA.map(([code, sci, common, category]) => ({ code, sci, common, category })),
    observations
  };
}

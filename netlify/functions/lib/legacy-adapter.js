/**
 * Legacy schema adapter.
 *
 * Reads the SAPNET instrument as it exists today — seven copied day-forms, twenty
 * fixed slots each, four parallel taxon dropdowns per slot — and emits exactly the
 * same fact table the v2 repeating-instrument transform produces. The dashboard
 * therefore works against the live project now, and keeps working after migration.
 *
 * Field names come from legacy-schema.json, which is generated from the real REDCap
 * data dictionary rather than guessed. Regenerate it with:
 *   node scripts/build-legacy-map.mjs <data-dictionary.csv>
 *
 * Requires a RAW export (rawOrLabel: 'raw'), because the adapter needs choice codes.
 */

const SCHEMA = require('./legacy-schema.json');
const { conversionFactor, toConcentration, toRawCount, methodLabel } = require('./conversion.js');

const CATEGORY = {
  1: 'Tree pollen', 2: 'Grass pollen', 3: 'Weed and herb pollen',
  4: 'Fungal spore', 5: 'Other biological particle', 9: 'Unidentified'
};

/** Legacy category code -> the key prefix used in the taxon crosswalk. */
const CAT_KEY = { 1: 'fungal', 2: 'grass', 3: 'tree', 4: 'weed' };

const blank = v => v === undefined || v === null || String(v).trim() === '';

/** REDCap stores dates as YYYY-MM-DD, but tolerate DD-MM-YYYY and DD/MM/YYYY. */
function normaliseDate(raw) {
  if (blank(raw)) return null;
  const s = String(raw).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * @param {Array<object>} records  raw REDCap flat export
 * @param {object} opts            { conversionFactor, siteFilter }
 * @returns {{payload:object, diagnostics:object}}
 */
function transformLegacy(records, opts = {}) {
  const factor = conversionFactor(opts.conversionFactor);
  const dataset = opts.dataset || 'primary';
  const datasetLabel = opts.datasetLabel || dataset;
  const diagnostics = {
    dataset, datasetLabel,
    schema: 'legacy',
    recordsSeen: 0,
    dayFormsRead: 0,
    slotsRead: 0,
    daysNotCollected: 0,
    rowsMissingDate: 0,
    rowsMissingTaxon: 0,
    rowsMissingCount: 0,
    unmappedTaxonCodes: [],
    duplicateTaxonSameDay: [],
    duplicateSiteDayAcrossRecords: [],
    derivedFromRawCount: 0,
    backDerivedFromStoredCount: 0,
    storedVsDerivedRows: 0,
    storedVsDerivedMeanAbsDiff: null,
    conversionFactorUsed: factor
  };
  let diffSum = 0;

  const out = new Map();            // site|date -> observation
  const seenIn = new Map();         // site|date -> record_id that created it
  const taxaSeen = new Map();
  const unmapped = new Set();

  for (const rec of records) {
    // Legacy project has no repeating instruments; ignore anything that does.
    if (rec.redcap_repeat_instrument) continue;
    diagnostics.recordsSeen++;

    for (const day of SCHEMA.days) {
      const date = normaliseDate(rec[day.date]);
      const siteCode = rec[day.site];
      if (blank(siteCode) && !date) continue;   // day form never opened
      diagnostics.dayFormsRead++;

      if (!date) { diagnostics.rowsMissingDate++; continue; }

      const site = SCHEMA.siteChoices[String(siteCode)] || `Site ${siteCode || '?'}`;
      const key = `${site}|${date}`;

      const collectedRaw = rec[day.collected];
      const notCollected = String(collectedRaw) === '0';
      if (notCollected) diagnostics.daysNotCollected++;

      if (!out.has(key)) {
        out.set(key, {
          site, date, dataset, datasetLabel,
          status: notCollected ? 3 : 1,
          // The legacy instrument does not record sampling hours. Anything less than a
          // full day is invisible here, which is one reason concentrations from this
          // schema are provisional.
          validHours: notCollected ? 0 : 24,
          reason: null,
          reasonText: blank(rec[day.reason]) ? null : String(rec[day.reason]).trim(),
          methodVersion: methodLabel('prospective', factor),
          conversionFactor: factor,
          qcStatus: null,
          releaseStatus: 1,          // legacy data is provisional by construction
          sourceRecordId: rec.record_id,
          counts: {}, raw: {}
        });
        seenIn.set(key, rec.record_id);
      } else if (seenIn.get(key) !== rec.record_id) {
        diagnostics.duplicateSiteDayAcrossRecords.push(
          { site, date, records: [seenIn.get(key), rec.record_id] });
      }

      const obs = out.get(key);
      if (notCollected) continue;

      const seenThisDay = new Set();

      for (const slot of day.slots) {
        const catCode = rec[slot.category];
        if (blank(catCode)) continue;
        diagnostics.slotsRead++;

        const taxonField = slot.taxon[String(catCode)];
        const taxonCode = taxonField ? rec[taxonField] : undefined;
        if (blank(taxonCode)) { diagnostics.rowsMissingTaxon++; continue; }

        const legacyKey = `${CAT_KEY[Number(catCode)]}:${String(taxonCode).trim()}`;
        const v2 = SCHEMA.legacyTaxonToV2[legacyKey];
        if (!v2) { unmapped.add(legacyKey); continue; }

        const stored = rec[slot.ccount];
        const raw = rec[slot.count];
        let rawCount, conc;

        if (!blank(raw)) {
          // Preferred path. The stored ccount is REDCap's round([count]*0.72,0), so it
          // has already lost precision; the raw count has not.
          rawCount = Number(raw);
          conc = toConcentration(rawCount, factor);
          diagnostics.derivedFromRawCount++;
          if (!blank(stored) && Number.isFinite(Number(stored)) && Number.isFinite(conc)) {
            diagnostics.storedVsDerivedRows++;
            diffSum += Math.abs(Number(stored) - conc);
          }
        } else if (!blank(stored)) {
          // No raw count recorded. Keep the row rather than lose it, but recover the
          // raw value from the stored one so the whole series stays on one basis.
          conc = Number(stored);
          rawCount = toRawCount(conc, factor);
          diagnostics.backDerivedFromStoredCount++;
        } else {
          diagnostics.rowsMissingCount++; continue;
        }
        if (!Number.isFinite(conc)) { diagnostics.rowsMissingCount++; continue; }

        // The legacy form cannot stop the same taxon being entered in two slots.
        // Pool them, and report it, rather than letting one silently overwrite the other.
        if (seenThisDay.has(v2)) {
          diagnostics.duplicateTaxonSameDay.push(
            { site, date, taxon: SCHEMA.legacyTaxonLabels[legacyKey] || legacyKey });
        }
        seenThisDay.add(v2);

        obs.counts[v2] = (obs.counts[v2] || 0) + conc;
        obs.raw[v2] = (obs.raw[v2] || 0) + rawCount;

        if (!taxaSeen.has(v2)) {
          taxaSeen.set(v2, {
            code: v2,
            sci: SCHEMA.legacyTaxonLabels[legacyKey]
              ? String(SCHEMA.legacyTaxonLabels[legacyKey]).split(';')[0].trim()
              : String(v2),
            common: SCHEMA.legacyTaxonLabels[legacyKey] &&
              SCHEMA.legacyTaxonLabels[legacyKey].includes(';')
              ? SCHEMA.legacyTaxonLabels[legacyKey].split(';')[1].trim() : '',
            category: Math.floor(v2 / 1000)
          });
        }
      }
    }
  }

  diagnostics.storedVsDerivedMeanAbsDiff = diagnostics.storedVsDerivedRows
    ? Math.round(1000 * diffSum / diagnostics.storedVsDerivedRows) / 1000 : null;
  diagnostics.unmappedTaxonCodes = [...unmapped].sort();
  diagnostics.duplicateTaxonSameDay = diagnostics.duplicateTaxonSameDay.slice(0, 50);
  diagnostics.duplicateSiteDayAcrossRecords =
    diagnostics.duplicateSiteDayAcrossRecords.slice(0, 50);

  const observations = [...out.values()]
    .sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));

  diagnostics.siteDaysProduced = observations.length;
  diagnostics.observationRowsProduced =
    observations.reduce((n, o) => n + Object.keys(o.counts).length, 0);

  return {
    payload: {
      source: 'redcap',
      dataset, datasetLabel,
      schema: 'legacy',
      generatedAt: new Date().toISOString(),
      minReleaseStatus: 1,
      provisional: true,
      conversionFactor: factor,
      provisionalReason:
        `Converted counts are derived as raw count x ${factor} and assume a full ` +
        `24-hour sample, because the prospective instrument records neither measured ` +
        `flow rate nor valid sampling hours.`,
      sites: [...new Set(observations.map(o => o.site))].sort(),
      categories: CATEGORY,
      taxa: [...taxaSeen.values()].sort((a, b) => a.code - b.code),
      observations
    },
    diagnostics
  };
}

/** True when the export looks like the legacy seven-day instrument. */
function looksLegacy(records) {
  if (!records.length) return false;
  const keys = new Set();
  for (const r of records.slice(0, 25)) for (const k in r) keys.add(k);
  const hasV2 = keys.has('tc_taxon') || keys.has('day_status') ||
    records.some(r => r.redcap_repeat_instrument === 'taxon_count');
  if (hasV2) return false;
  return keys.has('category1') || keys.has('count1') || keys.has('pollenyesno1');
}

module.exports = { transformLegacy, looksLegacy, SCHEMA };

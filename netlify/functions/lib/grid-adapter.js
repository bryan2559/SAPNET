/**
 * Grid adapter — the current prospective instrument.
 *
 * The prospective project was rebuilt as a single `weekly_pollen_count_grid` form:
 * one record is one site-week, holding a 50-row by 7-day grid. This replaced the
 * seven duplicated day-forms with twenty slots each, and it fixed most of what made
 * the old shape hard to read:
 *
 *   - one instrument instead of seven copies, so field names are readable again
 *   - 50 taxon rows instead of 20, so a busy spring day no longer overflows
 *   - day dates derived from the week start with @CALCDATE, not typed seven times
 *   - an explicit per-day "sampled and read?" flag with a CODED reason when not
 *   - raw counts validated to 0-10000 instead of unbounded
 *
 * Two things the grid still cannot give us, both reported rather than assumed:
 *   - the conversion factor is hard-coded as round([wk_dNrM]*0.72,0), so there is
 *     still no measured flow rate or proportion of slide analysed behind it
 *   - there is no record of valid sampling hours, so a part-day reads as a full day
 *
 * Field names come from grid-schema.json, generated from the real dictionary.
 * Regenerate with: npm run grid-map -- <data-dictionary.csv>
 *
 * Requires a RAW export (rawOrLabel: 'raw'); the adapter needs choice codes.
 */

const SCHEMA = require('./grid-schema.json');
const { conversionFactor, toConcentration, methodLabel } = require('./conversion.js');

const CATEGORY = {
  1: 'Tree pollen', 2: 'Grass pollen', 3: 'Weed and herb pollen',
  4: 'Fungal spore', 5: 'Other biological particle', 9: 'Unidentified'
};

const DAY_MS = 864e5;

/** "Slide not yet read" is work outstanding, not data lost. Tracked separately. */
const PENDING_REASON = '5';

const blank = v => v === undefined || v === null || String(v).trim() === '';

function normaliseDate(raw) {
  if (blank(raw)) return null;
  const s = String(raw).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const addDays = (isoDate, n) =>
  new Date(Date.parse(isoDate + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);

/**
 * @param {Array<object>} records raw REDCap flat export
 * @param {object} opts { dataset, datasetLabel, conversionFactor }
 */
function transformGrid(records, opts = {}) {
  const factor = conversionFactor(opts.conversionFactor);
  const dataset = opts.dataset || 'prospective';
  const datasetLabel = opts.datasetLabel || 'Prospective';

  const diagnostics = {
    dataset, datasetLabel, schema: 'grid',
    instrument: SCHEMA.instrument,
    gridDimensions: SCHEMA.dimensions,
    recordsSeen: 0, weeksRead: 0, dayCellsRead: 0, taxonRowsUsed: 0,
    daysSampled: 0, daysNotSampled: 0, daysPendingRead: 0,
    rowsMissingStartDate: 0, rowsMissingTaxon: 0, rowsMissingSite: 0,
    unmappedTaxonCodes: [], duplicateTaxonSameWeek: [], duplicateSiteDayAcrossRecords: [],
    derivedFromRawCount: 0, storedVsDerivedRows: 0, storedVsDerivedMeanAbsDiff: null,
    notFoundTreatedAsZero: 0,
    conversionFactorUsed: factor,
    instrumentFactor: SCHEMA.instrumentFactor,
    noSampleReasonCounts: {}
  };

  const out = new Map();
  const seenIn = new Map();
  const taxaSeen = new Map();
  const unmapped = new Set();
  let diffSum = 0;

  for (const rec of records) {
    if (rec.redcap_repeat_instrument) continue;
    diagnostics.recordsSeen++;

    if (blank(rec[SCHEMA.header.site])) { diagnostics.rowsMissingSite++; continue; }
    const siteCode = String(rec[SCHEMA.header.site]).trim();
    const site = SCHEMA.siteChoices[siteCode] || `Site ${siteCode}`;

    const start = normaliseDate(rec[SCHEMA.header.startDate]);
    if (!start) { diagnostics.rowsMissingStartDate++; continue; }
    diagnostics.weeksRead++;

    const weekNumber = blank(rec[SCHEMA.header.weekNumber])
      ? null : Number(rec[SCHEMA.header.weekNumber]);
    const weekNotes = blank(rec[SCHEMA.header.notes]) ? null : String(rec[SCHEMA.header.notes]).trim();

    // ---- day-level status for this week ----
    const dayInfo = new Map();
    for (const d of SCHEMA.days) {
      // Prefer the stored @CALCDATE value; fall back to week start + offset.
      const stored = d.date && d.date !== SCHEMA.header.startDate ? normaliseDate(rec[d.date]) : null;
      const date = d.n === 1 ? start : (stored || addDays(start, d.n - 1));

      const sampledRaw = d.sampled ? rec[d.sampled] : '1';
      // Unanswered is not the same as "no". Treat only an explicit 0 as not sampled.
      const notSampled = String(sampledRaw) === '0';
      const reasonCode = d.noSampleReason && !blank(rec[d.noSampleReason])
        ? String(rec[d.noSampleReason]).trim() : null;
      const pending = notSampled && reasonCode === PENDING_REASON;

      if (notSampled) {
        diagnostics.daysNotSampled++;
        if (pending) diagnostics.daysPendingRead++;
        if (reasonCode) {
          const label = SCHEMA.noSampleChoices[reasonCode] || `Reason ${reasonCode}`;
          diagnostics.noSampleReasonCounts[label] = (diagnostics.noSampleReasonCounts[label] || 0) + 1;
        }
      } else {
        diagnostics.daysSampled++;
      }

      dayInfo.set(d.n, { date, notSampled, reasonCode, pending });
    }

    // ---- create one observation per day ----
    for (const [dn, info] of dayInfo) {
      const key = `${site}|${info.date}`;
      if (out.has(key) && seenIn.get(key) !== rec.record_id) {
        diagnostics.duplicateSiteDayAcrossRecords.push(
          { site, date: info.date, records: [seenIn.get(key), rec.record_id] });
        continue;
      }
      if (!out.has(key)) {
        out.set(key, {
          site, date: info.date, dataset, datasetLabel,
          status: info.notSampled ? 3 : 1,
          // The grid records no sampling hours, so a sampled day is taken as a full day.
          validHours: info.notSampled ? 0 : 24,
          reason: info.reasonCode ? Number(info.reasonCode) : null,
          reasonLabel: info.reasonCode ? (SCHEMA.noSampleChoices[info.reasonCode] || null) : null,
          pendingRead: info.pending,
          weekNumber,
          weekNotes,
          methodVersion: methodLabel('prospective grid', factor),
          conversionFactor: factor,
          qcStatus: blank(rec[SCHEMA.header.qcDate]) ? null : 1,
          releaseStatus: blank(rec[SCHEMA.header.qcDate]) ? 1 : 2,
          sourceRecordId: rec.record_id,
          counts: {}, raw: {}
        });
        seenIn.set(key, rec.record_id);
      }
    }

    // ---- taxon rows ----
    const seenTaxaThisWeek = new Set();

    for (const row of SCHEMA.rows) {
      const catCode = rec[row.category];
      if (blank(catCode)) continue;

      const taxonField = row.taxon[String(catCode)];
      const taxonCode = taxonField ? rec[taxonField] : undefined;
      if (blank(taxonCode)) { diagnostics.rowsMissingTaxon++; continue; }

      const legacyKey = `${SCHEMA.categoryKey[String(catCode)]}:${String(taxonCode).trim()}`;
      const v2 = SCHEMA.legacyTaxonToV2[legacyKey];
      if (!v2) { unmapped.add(legacyKey); continue; }

      if (seenTaxaThisWeek.has(v2)) {
        diagnostics.duplicateTaxonSameWeek.push(
          { site, weekStart: start, taxon: SCHEMA.taxonLabels[legacyKey] || legacyKey });
      }
      seenTaxaThisWeek.add(v2);
      diagnostics.taxonRowsUsed++;

      if (!taxaSeen.has(v2)) {
        const label = SCHEMA.taxonLabels[legacyKey] || String(v2);
        const [sci, common] = label.includes(';')
          ? label.split(';').map(x => x.trim()) : [label.trim(), ''];
        taxaSeen.set(v2, { code: v2, sci, common, category: Math.floor(v2 / 1000) });
      }

      // The row's "days found" checkboxes export as <field>___<n>. A day that is
      // sampled but not ticked is a searched-for absence, i.e. a true zero, so no
      // row is written for it and the dashboard reads the gap as zero.
      for (const d of SCHEMA.days) {
        const info = dayInfo.get(d.n);
        if (!info || info.notSampled) continue;

        const ticked = row.daysFound
          ? String(rec[`${row.daysFound}___${d.n}`]) === '1'
          : true;

        const rawVal = rec[row.raw[d.n]];
        if (blank(rawVal)) {
          if (ticked) diagnostics.dayCellsRead++;
          else diagnostics.notFoundTreatedAsZero++;
          continue;
        }
        diagnostics.dayCellsRead++;

        const rawCount = Number(rawVal);
        if (!Number.isFinite(rawCount)) continue;

        // Derive rather than read wk_dNcM: the instrument stores
        // round([wk_dNrM]*0.72,0), which has already lost precision.
        const conc = toConcentration(rawCount, factor);
        const stored = rec[row.converted[d.n]];
        if (!blank(stored) && Number.isFinite(Number(stored))) {
          diagnostics.storedVsDerivedRows++;
          diffSum += Math.abs(Number(stored) - conc);
        }
        diagnostics.derivedFromRawCount++;

        const obs = out.get(`${site}|${info.date}`);
        if (!obs) continue;
        obs.counts[v2] = (obs.counts[v2] || 0) + conc;
        obs.raw[v2] = (obs.raw[v2] || 0) + rawCount;
      }
    }
  }

  diagnostics.storedVsDerivedMeanAbsDiff = diagnostics.storedVsDerivedRows
    ? Math.round(1000 * diffSum / diagnostics.storedVsDerivedRows) / 1000 : null;
  diagnostics.unmappedTaxonCodes = [...unmapped].sort();
  diagnostics.duplicateTaxonSameWeek = diagnostics.duplicateTaxonSameWeek.slice(0, 50);
  diagnostics.duplicateSiteDayAcrossRecords = diagnostics.duplicateSiteDayAcrossRecords.slice(0, 50);

  const observations = [...out.values()]
    .sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));
  diagnostics.siteDaysProduced = observations.length;

  return {
    payload: {
      source: 'redcap', dataset, datasetLabel, schema: 'grid',
      generatedAt: new Date().toISOString(),
      provisional: true,
      completenessKnown: true,
      conversionFactor: factor,
      provisionalReason:
        `${datasetLabel}: converted counts are derived as raw count x ${factor}. The grid ` +
        `records neither measured flow rate nor valid sampling hours, so the factor is a ` +
        `network convention rather than a measured value and a part-day reads as a full day.`,
      sites: [...new Set(observations.map(o => o.site))].sort(),
      categories: CATEGORY,
      taxa: [...taxaSeen.values()].sort((a, b) => a.code - b.code),
      observations
    },
    diagnostics
  };
}

/** True when the export looks like the weekly_pollen_count_grid instrument. */
function looksGrid(records) {
  if (!records.length) return false;
  const keys = new Set();
  for (const r of records.slice(0, 25)) for (const k in r) keys.add(k);
  return keys.has('wk_site') || keys.has('wk_startdate') ||
    [...keys].some(k => /^wk_d\d+r\d+$/.test(k));
}

module.exports = { transformGrid, looksGrid, SCHEMA };

/**
 * Retrospective archive adapter.
 *
 * The retrospective project is a different shape from the prospective one, and in one
 * respect a better one: it is already long format. One REDCap record is one observation
 * — site, taxon, count, day, week, date — rather than a wide grid of fixed slots.
 *
 *   record_id, site_location, old_category, new_group, classification,
 *   common_name, count, day_number, week_number, day_date
 *
 * The difficulty is that every identifying column is free text with @READONLY, because
 * the archive was bulk-imported from spreadsheets rather than typed into REDCap. There
 * are no choice codes to rely on, so site names and taxon names have to be resolved by
 * matching, and anything that fails to resolve is REPORTED rather than dropped silently.
 *
 * Resolution order for a taxon, with the tier recorded in diagnostics so it can be audited:
 *   1. exact override in retrospective-map.json
 *   2. exact match on normalised scientific name
 *   3. exact match on normalised common name
 *   4. genus match, where the archive gives "Quercus robur" and the reference has "Quercus"
 *   5. unresolved — counted, listed, and skipped
 *
 * Three things the archive cannot tell us, all surfaced rather than assumed:
 *   - whether `count` is a raw count or an already-converted concentration
 *     (set REDCAP_COUNT_KIND_<KEY> to "raw" or "concentration"; defaults to raw)
 *   - how much of the slide was analysed, or the flow rate, so no real conversion factor exists
 *   - which days were sampled but yielded nothing, because absent days are simply absent,
 *     so completeness is unknowable and is reported as such rather than as 100%
 */

const REF = require('./taxon-reference.json');
const MAP = require('./retrospective-map.json');
const { conversionFactor, toConcentration, toRawCount, methodLabel } = require('./conversion.js');

const CATEGORY = {
  1: 'Tree pollen', 2: 'Grass pollen', 3: 'Weed and herb pollen',
  4: 'Fungal spore', 5: 'Other biological particle', 9: 'Unidentified'
};

const DAY_MS = 864e5;
const blank = v => v === undefined || v === null || String(v).trim() === '';

/** Lowercase, strip accents, collapse punctuation and whitespace, drop rank noise. */
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(spp?|sp|type|cf|aff)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* ---- lookup tables, built once ---- */
const bySci = new Map(), byCommon = new Map(), byGenus = new Map();
for (const t of REF.taxa) {
  const s = norm(t.sci);
  if (s && !bySci.has(s)) bySci.set(s, t);
  const c = norm(t.common);
  if (c && !byCommon.has(c)) byCommon.set(c, t);
  const g = s.split(' ')[0];
  if (g && !byGenus.has(g)) byGenus.set(g, t);
}
const overrides = new Map(Object.entries(MAP.taxonOverrides || {}).map(([k, v]) => [norm(k), Number(v)]));
const byCode = new Map(REF.taxa.map(t => [t.code, t]));
const siteAliases = new Map(Object.entries(MAP.siteAliases || {}).map(([k, v]) => [norm(k), v]));
const canonicalSites = new Map((MAP.canonicalSites || []).map(n => [norm(n), n]));
const groupAliases = new Map(Object.entries(MAP.groupAliases || {}).map(([k, v]) => [norm(k), Number(v)]));

/** Canonical site name, or the original string if it cannot be resolved. */
function resolveSite(raw) {
  const n = norm(raw);
  if (!n) return { site: null, matched: false };
  if (siteAliases.has(n)) return { site: siteAliases.get(n), matched: true };
  // A value that simply differs in case or spacing from a known site is not a problem.
  if (canonicalSites.has(n)) return { site: canonicalSites.get(n), matched: true };
  // Otherwise keep the value rather than dropping the rows, but report it. Title-case
  // so that "cape town" and "Cape Town" cannot become two separate series.
  const titled = String(raw).trim().replace(/\s+/g, ' ')
    .replace(/\b[a-z]/g, c => c.toUpperCase());
  return { site: titled, matched: false };
}

/** Category code from the archive's group columns, falling back to the taxon's own. */
function resolveCategory(newGroup, oldCategory, taxon) {
  for (const raw of [newGroup, oldCategory]) {
    const n = norm(raw);
    if (n && groupAliases.has(n)) return groupAliases.get(n);
  }
  return taxon ? taxon.category : null;
}

/** Resolve a taxon, returning the match tier for auditing. */
function resolveTaxon(classification, commonName) {
  const cls = norm(classification), com = norm(commonName);

  for (const n of [cls, com]) {
    if (n && overrides.has(n)) {
      const t = byCode.get(overrides.get(n));
      if (t) return { taxon: t, tier: 'override' };
    }
  }
  if (cls && bySci.has(cls)) return { taxon: bySci.get(cls), tier: 'scientific' };
  if (com && byCommon.has(com)) return { taxon: byCommon.get(com), tier: 'common' };
  if (cls && bySci.has(com)) return { taxon: bySci.get(com), tier: 'scientific' };

  // "Quercus robur" -> Quercus. Reported separately because it discards infra-generic detail.
  const genus = cls.split(' ')[0];
  if (genus && genus !== cls && byGenus.has(genus)) {
    return { taxon: byGenus.get(genus), tier: 'genus' };
  }
  return { taxon: null, tier: 'unresolved' };
}

function normaliseDate(raw) {
  if (blank(raw)) return null;
  const s = String(raw).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * @param {Array<object>} records raw REDCap flat export
 * @param {object} opts { dataset, datasetLabel, countKind, conversionFactor }
 */
function transformRetrospective(records, opts = {}) {
  const dataset = opts.dataset || 'retrospective';
  const datasetLabel = opts.datasetLabel || 'Retrospective';
  // The archive's `count` column is treated as a RAW count, the same basis as the
  // prospective project, so both series convert identically. Set countKind to
  // 'concentration' only if the archive was imported with values already converted;
  // the raw count is then recovered so the two datasets still share one basis.
  const countKind = String(opts.countKind || 'raw').toLowerCase();
  const factor = conversionFactor(opts.conversionFactor);

  const diagnostics = {
    dataset, datasetLabel, schema: 'retrospective',
    recordsSeen: 0, rowsUsed: 0,
    rowsMissingDate: 0, rowsMissingCount: 0, rowsMissingSite: 0,
    countKind, conversionFactorUsed: factor,
    derivedFromRawCount: 0, backDerivedFromStoredCount: 0,
    matchTiers: { override: 0, scientific: 0, common: 0, genus: 0, unresolved: 0 },
    unmatchedTaxa: [], unmatchedSites: [], fuzzyMatches: [],
    duplicateTaxonSameDay: [], dateMismatchWithDayNumber: 0
  };

  const unresolvedTaxa = new Map(), unresolvedSites = new Map(), fuzzy = new Map();
  const out = new Map(), taxaSeen = new Map();

  for (const rec of records) {
    if (rec.redcap_repeat_instrument) continue;
    diagnostics.recordsSeen++;

    const date = normaliseDate(rec.day_date);
    if (!date) { diagnostics.rowsMissingDate++; continue; }

    if (blank(rec.site_location)) { diagnostics.rowsMissingSite++; continue; }
    const { site, matched: siteMatched } = resolveSite(rec.site_location);
    if (!siteMatched) {
      unresolvedSites.set(norm(rec.site_location),
        { value: String(rec.site_location).trim(), usedAs: site,
          rows: (unresolvedSites.get(norm(rec.site_location))?.rows || 0) + 1 });
    }

    if (blank(rec.count)) { diagnostics.rowsMissingCount++; continue; }
    const value = Number(String(rec.count).replace(/[, ]/g, ''));
    if (!Number.isFinite(value)) { diagnostics.rowsMissingCount++; continue; }

    let rawCount, conc;
    if (countKind === 'concentration') {
      conc = value;
      rawCount = toRawCount(value, factor);
      diagnostics.backDerivedFromStoredCount++;
    } else {
      rawCount = value;
      conc = toConcentration(value, factor);
      diagnostics.derivedFromRawCount++;
    }

    const { taxon, tier } = resolveTaxon(rec.classification, rec.common_name);
    diagnostics.matchTiers[tier]++;

    if (!taxon) {
      const k = norm(rec.classification) + '|' + norm(rec.common_name);
      const prev = unresolvedTaxa.get(k);
      unresolvedTaxa.set(k, {
        classification: String(rec.classification || '').trim(),
        commonName: String(rec.common_name || '').trim(),
        newGroup: String(rec.new_group || '').trim(),
        rows: (prev?.rows || 0) + 1
      });
      continue;
    }
    if (tier === 'genus') {
      const k = norm(rec.classification);
      fuzzy.set(k, { archiveValue: String(rec.classification).trim(),
        matchedTo: taxon.sci, code: taxon.code,
        rows: (fuzzy.get(k)?.rows || 0) + 1 });
    }

    // Cross-check day_number against the date, since both are stored independently.
    if (!blank(rec.day_number)) {
      const dow = ((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
      if (Number(rec.day_number) >= 1 && Number(rec.day_number) <= 7 &&
          Number(rec.day_number) !== dow) diagnostics.dateMismatchWithDayNumber++;
    }

    const key = `${site}|${date}`;
    if (!out.has(key)) {
      out.set(key, {
        site, date, dataset, datasetLabel,
        // The archive records no sampling status, so every day it holds is treated as
        // sampled. Days it does not hold are unknown, not zero — see completenessKnown.
        status: 1, validHours: 24, reason: null,
        methodVersion: methodLabel('retrospective archive', factor),
        conversionFactor: factor,
        qcStatus: null, releaseStatus: 1,
        weekNumber: blank(rec.week_number) ? null : Number(rec.week_number),
        counts: {}, raw: {}
      });
    }
    const obs = out.get(key);

    const cat = resolveCategory(rec.new_group, rec.old_category, taxon);
    if (cat && taxon.category !== cat && taxon.category !== 9) {
      // The archive's own grouping disagrees with the reference. Keep the reference's
      // category (the taxon is the stronger signal) but note it.
      diagnostics.matchTiers.categoryDisagreement =
        (diagnostics.matchTiers.categoryDisagreement || 0) + 1;
    }

    if (obs.counts[taxon.code] !== undefined) {
      diagnostics.duplicateTaxonSameDay.push({ site, date, taxon: taxon.sci });
    }
    obs.counts[taxon.code] = (obs.counts[taxon.code] || 0) + conc;
    obs.raw[taxon.code] = (obs.raw[taxon.code] || 0) + rawCount;
    diagnostics.rowsUsed++;

    if (!taxaSeen.has(taxon.code)) taxaSeen.set(taxon.code, { ...taxon });
  }

  diagnostics.unmatchedTaxa = [...unresolvedTaxa.values()]
    .sort((a, b) => b.rows - a.rows).slice(0, 60);
  diagnostics.unmatchedSites = [...unresolvedSites.values()].sort((a, b) => b.rows - a.rows);
  diagnostics.fuzzyMatches = [...fuzzy.values()].sort((a, b) => b.rows - a.rows).slice(0, 60);
  diagnostics.duplicateTaxonSameDay = diagnostics.duplicateTaxonSameDay.slice(0, 50);

  const observations = [...out.values()]
    .sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));

  // Calendar gaps: days between the first and last record that hold no data at all.
  // These are NOT filled in as lost days, because the archive cannot distinguish
  // "trap was down" from "this day was never digitised".
  let gapDays = 0, spanDays = 0;
  const bySite = new Map();
  for (const o of observations) {
    if (!bySite.has(o.site)) bySite.set(o.site, []);
    bySite.get(o.site).push(o.date);
  }
  for (const dates of bySite.values()) {
    const first = Date.parse(dates[0]), last = Date.parse(dates[dates.length - 1]);
    const span = Math.round((last - first) / DAY_MS) + 1;
    spanDays += span;
    gapDays += span - new Set(dates).size;
  }
  diagnostics.calendarSpanDays = spanDays;
  diagnostics.calendarGapDays = gapDays;
  diagnostics.siteDaysProduced = observations.length;

  return {
    payload: {
      source: 'redcap', dataset, datasetLabel, schema: 'retrospective',
      generatedAt: new Date().toISOString(),
      provisional: true,
      conversionFactor: factor,
      // Absent days are unknown, not zero, so a completeness percentage would be a fiction.
      completenessKnown: false,
      provisionalReason:
        `${datasetLabel}: converted counts are derived as raw count x ${factor}, the same ` +
        `basis as the prospective project. The archive records no flow rate, no proportion ` +
        `of slide analysed and no sampling status, so the factor is a network convention ` +
        `rather than a measured value. Days absent from the archive are unknown rather ` +
        `than zero, so completeness is not reported.`,
      sites: [...new Set(observations.map(o => o.site))].sort(),
      categories: CATEGORY,
      taxa: [...taxaSeen.values()].sort((a, b) => a.code - b.code),
      observations
    },
    diagnostics
  };
}

/** True when the export looks like the retrospective archive. */
function looksRetrospective(records) {
  if (!records.length) return false;
  const keys = new Set();
  for (const r of records.slice(0, 25)) for (const k in r) keys.add(k);
  return keys.has('site_location') && keys.has('classification') &&
    (keys.has('new_group') || keys.has('old_category'));
}

module.exports = {
  transformRetrospective, looksRetrospective,
  // exported for tests and for the mapping-helper script
  norm, resolveTaxon, resolveSite
};

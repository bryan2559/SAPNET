/**
 * Conversion policy — one place, used by every adapter.
 *
 * The network reports CONVERTED counts only. Raw counts are what the analyst records
 * at the microscope and what the dashboard models from; the converted count is derived:
 *
 *     concentration = raw count x CONVERSION_FACTOR
 *
 * Every source goes through this same function, so a day from the retrospective archive
 * and a day from the prospective project are on one scale and can sit in one series.
 *
 * Two deliberate choices:
 *
 * 1. The stored `ccount` field in the prospective project is NOT used as the value.
 *    REDCap computes it as round([count]*0.72,0) — rounded to a whole number per row.
 *    Twenty rows each rounded before summing accumulates error, and the error is worst
 *    at the low counts that determine season start and end dates. Deriving from the raw
 *    count instead keeps full precision. Where a raw count is missing, the stored value
 *    is used as a fallback so the row is not lost, and that is reported.
 *
 * 2. Rounding happens at presentation, never in storage. Values are carried unrounded.
 *
 * Changing the factor changes every published number, so it lives here and nowhere else.
 * Override with the CONVERSION_FACTOR environment variable if the network agrees a new
 * value; the factor in force is reported in /api/diagnostics and travels with the CSV
 * export, so any figure can be traced back to the factor that produced it.
 */

const DEFAULT_FACTOR = 0.72;

function conversionFactor(override) {
  const v = Number(override ?? process.env.CONVERSION_FACTOR ?? DEFAULT_FACTOR);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_FACTOR;
}

/** raw count -> particles/m3. Unrounded by design. */
function toConcentration(rawCount, factor) {
  const n = Number(rawCount);
  if (!Number.isFinite(n)) return null;
  return n * conversionFactor(factor);
}

/** Recover a raw count from an already-converted value, for rows with no raw count. */
function toRawCount(concentration, factor) {
  const n = Number(concentration);
  if (!Number.isFinite(n)) return null;
  return n / conversionFactor(factor);
}

/** Human-readable basis string, attached to every observation. */
function methodLabel(sourceName, factor) {
  return `${sourceName}, converted count = raw x ${conversionFactor(factor)}`;
}

module.exports = { DEFAULT_FACTOR, conversionFactor, toConcentration, toRawCount, methodLabel };

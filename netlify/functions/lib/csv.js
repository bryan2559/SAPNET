/**
 * RFC 4180 CSV parser for REDCap exports.
 *
 * The prospective instrument has 1,082 fields. A `format=json` flat export repeats
 * every field NAME in every record, so the key text alone can run to several
 * megabytes before a single count is transferred. CSV writes the header once, which
 * is typically five to ten times smaller on an instrument this wide, and is the
 * difference between an export that returns inside the function's time budget and
 * one that does not.
 *
 * Returns an array of plain objects, identical in shape to what format=json gives,
 * so the adapters are unchanged.
 */

function parseCsv(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];

  const head = rows.shift().map(h => h.trim());
  const out = [];
  for (const r of rows) {
    // A trailing newline produces a single empty cell; skip it rather than emitting
    // a record of 1,082 empty fields.
    if (r.length === 1 && r[0] === '') continue;
    const o = {};
    for (let i = 0; i < head.length; i++) o[head[i]] = r[i] ?? '';
    out.push(o);
  }
  return out;
}

module.exports = { parseCsv };

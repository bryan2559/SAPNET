/**
 * Chart library — hand-rolled SVG, no charting dependency.
 *
 * Conventions held throughout:
 *   - categorical hues assigned in fixed order, never cycled
 *   - magnitude uses the one-hue sequential ramp (tape, calendar), never a rainbow
 *   - 2px surface gap between stacked segments, 4px rounded data-ends at the top
 *   - every series chart carries a legend, and tables double as the text relief
 *     for the two light-mode slots that sit under 3:1 contrast
 *   - hover is built in: elements carry data-tt, app.js renders the tooltip
 */

import { BANDS } from './data.js';

const SANS = 'Inter, Helvetica Neue, Arial, sans-serif';
const MONO = 'IBM Plex Mono, ui-monospace, Menlo, monospace';
export const DAY = 864e5;

/** Category -> fixed categorical slot. Order is the CVD-safety mechanism. */
export const CAT = {
  1: { n: 'Tree pollen',  c: 'var(--series-1)', k: 1 },
  2: { n: 'Grass pollen', c: 'var(--series-2)', k: 2 },
  3: { n: 'Weed pollen',  c: 'var(--series-3)', k: 3 },
  4: { n: 'Fungal spore', c: 'var(--series-4)', k: 4 },
  5: { n: 'Other',        c: 'var(--series-5)', k: 5 },
  9: { n: 'Unidentified', c: 'var(--series-9)', k: 9 }
};
export const STACK = [4, 3, 2, 1];           // fungal at the base, trees on top

/** Categories the current "load shown" filter includes, in stack order. */
export function catsFor(key) {
  if (key === 'all') return STACK;
  if (key === 'pollen') return [3, 2, 1];
  const n = Number(key);
  // Anything that is not a known category falls back to the full stack rather than
  // producing an empty or undefined series.
  return CAT[n] ? [n] : STACK;
}
const SEQ = ['var(--seq-100)','var(--seq-200)','var(--seq-300)','var(--seq-400)',
             'var(--seq-500)','var(--seq-600)','var(--seq-700)'];
/** Ramp for the tape, which sits on a fixed dark surface in both themes. */
const TAPE_SEQ = ['var(--tape-1)','var(--tape-2)','var(--tape-3)','var(--tape-4)',
                  'var(--tape-5)','var(--tape-6)','var(--tape-7)'];

export const fmt = (n, dp = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? '—'
    : Math.abs(n) >= 10000 ? Math.round(n).toLocaleString('en-ZA')
    : Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-ZA')
    : n.toFixed(dp);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Encode a tooltip: "heading¦label∷color∷value¦…" — parsed by app.js. */
export const tt = (heading, rows = []) =>
  esc([heading, ...rows.map(r => r.join('∷'))].join('¦'));

/* ---------------- shared scales ---------------- */
export function catTotal(day, key, T) {
  if (day.status === 3) return null;
  let s = 0;
  for (const code in day.counts) {
    const cat = T.get(+code)?.category ?? Math.floor(+code / 1000);
    if (key === 'all') s += day.counts[code];
    else if (key === 'pollen') { if (cat !== 4 && cat !== 5) s += day.counts[code]; }
    else if (cat === +key) s += day.counts[code];
  }
  return s;
}

export function byCat(day, T) {
  if (day.status === 3) return null;
  const o = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const code in day.counts) {
    const cat = T.get(+code)?.category ?? Math.floor(+code / 1000);
    if (o[cat] !== undefined) o[cat] += day.counts[code];
  }
  return o;
}

/** "Nice" axis maximum so gridline labels are readable numbers. */
function niceMax(v) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}

function yAxis(max, h, pad, W, ticks = 4) {
  let s = '';
  for (let g = 0; g <= ticks; g++) {
    const y = pad.t + (h - pad.t - pad.b) * g / ticks;
    const v = max * (1 - g / ticks);
    s += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--rule)" stroke-width="1"${g === ticks ? '' : ' stroke-dasharray="2 3"'}/>`
       + `<text x="${pad.l - 8}" y="${y + 3.5}" text-anchor="end" font-family="${MONO}" font-size="10" fill="var(--ink-3)">${fmt(v)}</text>`;
  }
  return s;
}

/* ---------------- the tape (sequential magnitude) ---------------- */
export function tape(days, key, T) {
  const W = 1000, H = 88, n = days.length;
  if (!n) return '';
  const w = W / n;
  // Anchored to the risk thresholds, not to this window's own maximum: a quiet week
  // and a peak week must not come out the same shade. Colour means the same thing
  // in every view, which is what makes the tape worth scanning across weeks.
  const th = BANDS[key] || BANDS.pollen;
  const step = v => v < th[0] * 0.34 ? 0 : v < th[0] * 0.67 ? 1 : v < th[0] ? 2
    : v < th[1] ? 3 : v < (th[1] + th[2]) / 2 ? 4 : v < th[2] ? 5 : 6;
  let s = `<defs><pattern id="lost" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="8" height="8" fill="#2a0d08"/><rect width="3" height="8" fill="var(--critical)"/></pattern></defs>`;

  days.forEach((d, i) => {
    const x = i * w;
    if (d.status === 3) {
      s += `<rect x="${x}" y="0" width="${w}" height="${H}" fill="url(#lost)" data-tt="${tt(d.date, [['No valid sample', 'var(--critical)', d.reasonLabel || 'reason not recorded']])}"/>`;
    } else {
      const v = catTotal(d, key, T);
      // Sequential: one hue, light -> dark, stepped rather than continuous opacity.
      const idx = step(v);
      s += `<rect x="${x}" y="0" width="${w}" height="${H}" fill="${TAPE_SEQ[idx]}" data-tt="${tt(d.date, [['Load', TAPE_SEQ[idx], fmt(v) + ' /m³']])}"/>`;
      if (d.pendingRead) {
        s += `<rect x="${x}" y="${H - 6}" width="${w}" height="6" fill="var(--warning)"/>`;
      }
    }
    if (n <= 40) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#E8E8E4" stroke-width="1" opacity=".3"/>`;
  });

  s += `<g opacity=".4">`;
  for (let i = 0; i <= n; i += Math.max(1, Math.round(n / 26)))
    s += `<line x1="${i * w}" y1="${H - 11}" x2="${i * w}" y2="${H}" stroke="#E8E8E4" stroke-width="1"/>`;
  s += `</g>`;
  return s;
}

export function tapeScale(key = 'pollen') {
  const th = BANDS[key] || BANDS.pollen;
  return `<span>Load</span>` + TAPE_SEQ.map(c =>
    `<i style="background:${c};border-radius:2px;width:22px"></i>`).join('') +
    `<span class="muted">0 to ${fmt(th[2])}+ /m³ &middot; fixed scale, comparable between views</span>`;
}

/* ---------------- stacked daily bars ---------------- */
export function stackedBars(days, T, key = 'all', h = 230) {
  const cats = catsFor(key);
  const W = 1000, pad = { l: 46, r: 8, t: 10, b: 28 }, n = days.length;
  if (!n) return '';
  const bw = (W - pad.l - pad.r) / n;
  const totals = days.map(d => { const c = byCat(d, T); return c ? cats.reduce((a, k) => a + c[k], 0) : 0; });
  const max = niceMax(Math.max(1, ...totals));
  const sc = v => (h - pad.t - pad.b) * v / max;
  let s = yAxis(max, h, pad, W);

  days.forEach((d, i) => {
    const x = pad.l + i * bw, c = byCat(d, T);
    const bar = Math.max(2, bw - 3);
    if (!c) {
      s += `<rect x="${x + 1.5}" y="${pad.t}" width="${bar}" height="${h - pad.t - pad.b}" rx="3"
        fill="var(--critical)" opacity=".10" data-tt="${tt(d.date, [['No valid sample', 'var(--critical)', d.reasonLabel || '—']])}"/>`;
      return;
    }
    const total = cats.reduce((a, k) => a + c[k], 0);
    let y = h - pad.b;
    const rows = [];
    cats.forEach((k, si) => {
      const hh = sc(c[k]);
      if (hh <= 0) return;
      y -= hh;
      // 4px rounded data-end on the topmost segment only; 2px surface gap between fills.
      const isTop = cats.slice(si + 1).every(kk => c[kk] <= 0);
      const gap = si === 0 ? 0 : 2;
      s += `<rect x="${x + 1.5}" y="${y}" width="${bar}" height="${Math.max(0.5, hh - gap)}"
        ${isTop ? 'rx="4"' : ''} fill="${CAT[k].c}"/>`;
      rows.unshift([CAT[k].n, CAT[k].c, fmt(c[k]) + ' /m³']);
    });
    rows.push(['Total', 'transparent', fmt(total) + ' /m³']);
    s += `<rect x="${x}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}" fill="transparent"
      data-tt="${tt(d.date, rows)}"/>`;
  });

  const step = Math.max(1, Math.round(n / 12));
  days.forEach((d, i) => {
    if (i % step) return;
    s += `<text x="${pad.l + i * bw + bw / 2}" y="${h - 9}" text-anchor="middle" font-family="${MONO}"
      font-size="10" fill="var(--ink-3)">${n <= 31 ? d.date.slice(8) : d.date.slice(5)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" class="hoverable">${s}</svg>`;
}

/* ---------------- rolling-mean lines, with crosshair ---------------- */
export function lineByCat(days, T, key = 'all', smooth = 3, h = 250) {
  const cats = catsFor(key);
  const W = 1000, pad = { l: 50, r: 64, t: 12, b: 28 }, n = days.length;
  if (!n) return '';
  const series = {};
  cats.forEach(k => series[k] = days.map(d => { const c = byCat(d, T); return c ? c[k] : null; }));
  const roll = a => a.map((_, i) => {
    const w = a.slice(Math.max(0, i - smooth + 1), i + 1).filter(v => v !== null);
    return w.length ? w.reduce((x, y) => x + y, 0) / w.length : null;
  });
  let peak = 0;
  cats.forEach(k => { series[k] = roll(series[k]); series[k].forEach(v => { if (v !== null && v > peak) peak = v; }); });
  const max = niceMax(Math.max(1, peak));
  const X = i => pad.l + (W - pad.l - pad.r) * i / Math.max(1, n - 1);
  const Y = v => h - pad.b - (h - pad.t - pad.b) * v / max;
  let s = yAxis(max, h, pad, W);

  cats.forEach(k => {
    let d = '', open = false;
    series[k].forEach((v, i) => {
      if (v === null) { open = false; return; }   // break at gaps, never bridge them
      d += (open ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' ';
      open = true;
    });
    s += `<path d="${d}" fill="none" stroke="${CAT[k].c}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>`;
    // Direct label at the series end — identity never rests on colour alone.
    for (let i = series[k].length - 1; i >= 0; i--) {
      if (series[k][i] !== null) {
        s += `<text x="${X(i) + 7}" y="${Y(series[k][i]) + 3.5}" font-family="${SANS}" font-size="10.5"
          font-weight="600" fill="${CAT[k].c}">${CAT[k].n.split(' ')[0]}</text>`;
        break;
      }
    }
  });

  s += `<line class="xhair" x1="0" y1="${pad.t}" x2="0" y2="${h - pad.b}" stroke="var(--ink-3)"
    stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
  const bw = (W - pad.l - pad.r) / Math.max(1, n - 1);
  days.forEach((d, i) => {
    const rows = cats.filter(k => series[k][i] !== null)
      .map(k => [CAT[k].n, CAT[k].c, fmt(series[k][i], series[k][i] < 10 ? 1 : 0) + ' /m³']);
    if (d.status === 3) rows.push(['No valid sample', 'var(--critical)', d.reasonLabel || '—']);
    s += `<rect x="${X(i) - bw / 2}" y="${pad.t}" width="${Math.max(2, bw)}" height="${h - pad.t - pad.b}"
      fill="transparent" data-x="${X(i).toFixed(1)}" data-tt="${tt(d.date + (smooth > 1 ? ` · ${smooth}-day mean` : ''), rows)}"/>`;
  });

  const step = Math.max(1, Math.round(n / 10));
  days.forEach((d, i) => {
    if (i % step) return;
    s += `<text x="${X(i)}" y="${h - 9}" text-anchor="middle" font-family="${MONO}" font-size="10"
      fill="var(--ink-3)">${d.date.slice(5)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" class="hoverable xh">${s}</svg>`;
}

/* ---------------- long run: monthly stacked area across the record ---------------- */
export function longSeries(days, T, key = 'all', h = 280) {
  const cats = catsFor(key);
  const W = 1000, pad = { l: 52, r: 10, t: 14, b: 42 };
  if (!days.length) return '';
  // Bucket to months — a daily line over eight years is unreadable noise.
  const buckets = new Map();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    const b = buckets.get(key) || { key, sum: { 1: 0, 2: 0, 3: 0, 4: 0 }, valid: 0, lost: 0, datasets: new Set() };
    const c = byCat(d, T);
    if (c) { cats.forEach(k => b.sum[k] += c[k]); b.valid++; } else b.lost++;
    b.datasets.add(d.datasetLabel || '');
    buckets.set(key, b);
  }
  const months = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  const mean = b => { const o = {}; cats.forEach(k => o[k] = b.valid ? b.sum[k] / b.valid : 0); return o; };
  const totals = months.map(b => { const m = mean(b); return cats.reduce((a, k) => a + m[k], 0); });
  const max = niceMax(Math.max(1, ...totals));
  const n = months.length;
  const X = i => pad.l + (W - pad.l - pad.r) * i / Math.max(1, n - 1);
  const Y = v => h - pad.b - (h - pad.t - pad.b) * v / max;
  let s = yAxis(max, h, pad, W);

  // Stacked areas, drawn from the base up.
  const cum = months.map(() => 0);
  cats.forEach(k => {
    const lower = cum.slice();
    months.forEach((b, i) => cum[i] += mean(b)[k]);
    let top = '', bot = '';
    months.forEach((b, i) => { top += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(cum[i]).toFixed(1) + ' '; });
    for (let i = n - 1; i >= 0; i--) bot += 'L' + X(i).toFixed(1) + ' ' + Y(lower[i]).toFixed(1) + ' ';
    s += `<path d="${top}${bot}Z" fill="${CAT[k].c}" opacity=".88"/>`
       + `<path d="${top}" fill="none" stroke="var(--surface-1)" stroke-width="1.5" opacity=".55"/>`;
  });

  // Year boundaries, so eight years of x-axis stay legible.
  const seenYear = new Set();
  months.forEach((b, i) => {
    const y = b.key.slice(0, 4);
    if (seenYear.has(y)) return;
    seenYear.add(y);
    s += `<line x1="${X(i)}" y1="${pad.t}" x2="${X(i)}" y2="${h - pad.b}" stroke="var(--rule-strong)" stroke-width="1" opacity=".55"/>`
       + `<text x="${X(i) + 4}" y="${h - 26}" font-family="${MONO}" font-size="10.5" fill="var(--ink-2)" font-weight="500">${y}</text>`;
  });

  const bw = (W - pad.l - pad.r) / Math.max(1, n - 1);
  months.forEach((b, i) => {
    const m = mean(b);
    const rows = cats.map(k => [CAT[k].n, CAT[k].c, fmt(m[k], m[k] < 10 ? 1 : 0)]).reverse();
    rows.push(['Valid days', 'transparent', `${b.valid}${b.lost ? ` (+${b.lost} lost)` : ''}`]);
    s += `<rect x="${X(i) - bw / 2}" y="${pad.t}" width="${Math.max(2, bw)}" height="${h - pad.t - pad.b}"
      fill="transparent" data-x="${X(i).toFixed(1)}" data-tt="${tt(b.key + ' · monthly mean /m³', rows)}"/>`;
  });
  s += `<line class="xhair" x1="0" y1="${pad.t}" x2="0" y2="${h - pad.b}" stroke="var(--ink-3)"
    stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
  return `<svg viewBox="0 0 ${W} ${h}" class="hoverable xh">${s}</svg>`;
}

/* ---------------- year-over-year seasonal overlay ---------------- */
/**
 * Every year drawn on one calendar. The viewBox is deliberately narrow: this panel
 * sits at roughly half width, so a 1000-unit box would shrink 10px type to about 5px
 * on screen. Years are identified by a legend rather than by end-of-line labels,
 * which collide wherever the curves converge.
 */
export function seasonalOverlay(days, key, T, h = 300) {
  const W = 660, pad = { l: 44, r: 12, t: 12, b: 26 };
  if (!days.length) return { svg: '', legend: '' };
  const years = new Map();
  for (const d of days) {
    const y = d.date.slice(0, 4);
    const doy = Math.floor((Date.parse(d.date + 'T00:00:00Z') - Date.UTC(+y, 0, 0)) / DAY);
    const v = catTotal(d, key, T);
    if (v === null) continue;
    if (!years.has(y)) years.set(y, new Array(367).fill(null));
    years.get(y)[doy] = v;
  }
  const yrs = [...years.keys()].sort();
  if (!yrs.length) return { svg: '', legend: '' };

  const smooth = arr => arr.map((_, i) => {
    const w = arr.slice(Math.max(0, i - 7), i + 8).filter(v => v !== null);
    return w.length >= 3 ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
  const curves = yrs.map(y => ({ y, v: smooth(years.get(y)) }));

  // Recency is the magnitude here, so it gets the sequential ramp: earlier years
  // recede toward the surface, the current year is the darkest and heaviest line.
  const colAt = i => {
    const n = curves.length;
    if (i === n - 1) return 'var(--series-1)';
    const step = 1 + Math.round((i / Math.max(1, n - 2)) * 3);   // seq-200 .. seq-500
    return `var(--seq-${step * 100})`;
  };

  let peak = 0;
  curves.forEach(c => c.v.forEach(v => { if (v !== null && v > peak) peak = v; }));
  const max = niceMax(Math.max(1, peak));
  const X = d => pad.l + (W - pad.l - pad.r) * (d - 1) / 365;
  const Y = v => h - pad.b - (h - pad.t - pad.b) * v / max;

  let s = '';
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + (h - pad.t - pad.b) * g / 4;
    s += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--rule)" stroke-width="1"${g === 4 ? '' : ' stroke-dasharray="2 3"'}/>`
       + `<text x="${pad.l - 7}" y="${y + 4}" text-anchor="end" font-family="${MONO}" font-size="11" fill="var(--ink-3)">${fmt(max * (1 - g / 4))}</text>`;
  }

  curves.forEach((c, i) => {
    const latest = i === curves.length - 1;
    const col = colAt(i);
    let d = '', open = false;
    c.v.forEach((v, doy) => {
      if (v === null) { open = false; return; }
      d += (open ? 'L' : 'M') + X(doy).toFixed(1) + ' ' + Y(v).toFixed(1) + ' ';
      open = true;
    });
    s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${latest ? 2.6 : 1.5}"
      opacity="${latest ? 1 : .9}" stroke-linejoin="round"/>`;
  });

  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DIM = [31,28,31,30,31,30,31,31,30,31,30,31];
  let acc = 1;
  MON.forEach((m, i) => {
    s += `<text x="${X(acc + DIM[i] / 2)}" y="${h - 8}" text-anchor="middle" font-family="${SANS}"
      font-size="11" fill="var(--ink-3)">${m[0]}</text>`;
    if (i) s += `<line x1="${X(acc)}" y1="${pad.t}" x2="${X(acc)}" y2="${h - pad.b}" stroke="var(--rule)" stroke-width="1" opacity=".5"/>`;
    acc += DIM[i];
  });

  for (let doy = 1; doy <= 365; doy += 4) {
    const rows = curves.filter(c => c.v[doy] !== null)
      .map((c, i) => [c.y, colAt(curves.indexOf(c)), fmt(c.v[doy], c.v[doy] < 10 ? 1 : 0)]);
    if (!rows.length) continue;
    const dt = new Date(Date.UTC(2001, 0, doy));
    s += `<rect x="${X(doy) - 2}" y="${pad.t}" width="4" height="${h - pad.t - pad.b}" fill="transparent"
      data-x="${X(doy).toFixed(1)}" data-tt="${tt(`${MON[dt.getUTCMonth()]} ${dt.getUTCDate()} · 15-day mean /m³`, rows)}"/>`;
  }
  s += `<line class="xhair" x1="0" y1="${pad.t}" x2="0" y2="${h - pad.b}" stroke="var(--ink-3)"
    stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;

  const legendHtml = `<div class="legend">` + curves.map((c, i) =>
    `<span><i class="ln" style="background:${colAt(i)};height:${i === curves.length - 1 ? 3 : 2}px"></i>${c.y}</span>`
  ).join('') + `</div>`;

  return { svg: `<svg viewBox="0 0 ${W} ${h}" class="hoverable xh">${s}</svg>`, legend: legendHtml };
}

/* ---------------- multi-year calendar heatmap ---------------- */
export function calendarYears(days, key, T) {
  if (!days.length) return '';
  const byYear = new Map();
  for (const d of days) {
    const y = d.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(d);
  }
  const yrs = [...byYear.keys()].sort();
  const vals = days.map(d => catTotal(d, key, T)).filter(v => v !== null).sort((a, b) => a - b);
  // Percentile scale: a handful of extreme days must not flatten everything else.
  const p = q => vals.length ? vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] : 1;
  const stops = [p(.15), p(.35), p(.55), p(.72), p(.86), p(.95)];
  const bucket = v => { let i = 0; while (i < stops.length && v > stops[i]) i++; return i; };

  const W = 1000, rowH = 17, labW = 40, h = yrs.length * rowH + 26;
  const cw = (W - labW) / 366;
  let s = '';
  yrs.forEach((y, r) => {
    const top = r * rowH;
    s += `<text x="0" y="${top + 12}" font-family="${MONO}" font-size="10.5" fill="var(--ink-2)">${y}</text>`;
    // One background strip per year rather than 366 empty cells: days with no record
    // at all show through as surface, and the file stays a fraction of the size.
    s += `<rect x="${labW}" y="${top + 2}" width="${366 * cw}" height="${rowH - 5}" rx="2"
      fill="var(--surface-2)" stroke="var(--rule)" stroke-width=".75"/>`;
    const seen = new Set();
    for (const d of byYear.get(y)) {
      const doy = Math.floor((Date.parse(d.date + 'T00:00:00Z') - Date.UTC(+y, 0, 0)) / DAY);
      seen.add(doy);
      const v = catTotal(d, key, T);
      const x = labW + (doy - 1) * cw;
      if (v === null) {
        s += `<rect x="${x}" y="${top + 2}" width="${Math.max(1, cw - .4)}" height="${rowH - 5}" rx="1.5"
          fill="var(--critical)" opacity=".45" data-tt="${tt(d.date, [['No valid sample', 'var(--critical)', d.reasonLabel || '—']])}"/>`;
      } else {
        s += `<rect x="${x}" y="${top + 2}" width="${Math.max(1, cw - .4)}" height="${rowH - 5}" rx="1.5"
          fill="${SEQ[bucket(v)]}" data-tt="${tt(d.date, [['Load', SEQ[bucket(v)], fmt(v) + ' /m³'], ['Dataset', 'transparent', d.datasetLabel || '—']])}"/>`;
      }
    }
  });
  const MON = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  let acc = 1;
  MON.forEach((m, i) => {
    const dim = [31,28,31,30,31,30,31,31,30,31,30,31][i];
    s += `<text x="${labW + (acc + dim / 2 - 1) * cw}" y="${yrs.length * rowH + 14}" text-anchor="middle"
      font-family="${SANS}" font-size="10" fill="var(--ink-3)">${m}</text>`;
    acc += dim;
  });
  return `<svg viewBox="0 0 ${W} ${h}" class="hoverable">${s}</svg>`;
}

/* ---------------- sparkline for table rows ---------------- */
export function sparkline(values, color, w = 90, h = 20) {
  const vals = values.filter(v => v !== null && v !== undefined);
  if (!vals.length) return '';
  const max = Math.max(1, ...vals);
  const n = values.length;
  let d = '', open = false;
  values.forEach((v, i) => {
    if (v === null || v === undefined) { open = false; return; }
    const x = (w * i / Math.max(1, n - 1)).toFixed(1);
    const y = (h - 2 - (h - 4) * v / max).toFixed(1);
    d += (open ? 'L' : 'M') + x + ' ' + y + ' ';
    open = true;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

/* ---------------- tables ---------------- */
export function taxonTable(days, T, key = 'all', limit = 10, unit = 'mean /m³', spark = true) {
  const cats = new Set(catsFor(key));
  const valid = days.filter(d => d.status !== 3);
  const agg = {};
  valid.forEach(d => {
    for (const c in d.counts) {
      const cat = T.get(+c)?.category ?? Math.floor(+c / 1000);
      if (!cats.has(cat)) continue;
      agg[c] = (agg[c] || 0) + d.counts[c];
    }
  });
  const rows = Object.entries(agg).map(([c, sum]) => ({ c: +c, sum, mean: sum / Math.max(1, valid.length) }))
    .sort((a, b) => b.sum - a.sum).slice(0, limit);
  if (!rows.length) return `<p class="hint">No observations in this period.</p>`;
  const total = Object.values(agg).reduce((a, b) => a + b, 0) || 1;

  return `<table><thead><tr><th>Taxon</th><th style="text-align:right">${unit}</th>
    <th style="text-align:right">peak</th>${spark ? '<th>shape</th>' : ''}<th style="width:22%">share</th></tr></thead><tbody>` +
    rows.map(r => {
      const t = T.get(r.c) || { sci: String(r.c), common: '', category: Math.floor(r.c / 1000) };
      const col = (CAT[t.category] || CAT[9]).c;
      let pk = 0, pd = '—';
      valid.forEach(d => { if ((d.counts[r.c] || 0) > pk) { pk = d.counts[r.c]; pd = d.date; } });
      const series = spark ? valid.map(d => d.counts[r.c] || 0) : null;
      return `<tr><td><span class="chip" style="background:${col}"></span><span class="sci">${esc(t.sci)}</span>` +
        `${t.common ? ` <span class="muted">${esc(t.common)}</span>` : ''}</td>
        <td class="n">${fmt(r.mean, r.mean < 10 ? 1 : 0)}</td>
        <td class="n">${fmt(pk)}<br><span class="muted" style="font-size:10.5px">${pd.slice(0, 10)}</span></td>
        ${spark ? `<td>${sparkline(series, col)}</td>` : ''}
        <td><div class="meter"><i style="width:${(100 * r.sum / total).toFixed(1)}%;background:${col}"></i></div>
          <span class="muted" style="font-size:10.5px">${(100 * r.sum / total).toFixed(1)}%</span></td></tr>`;
    }).join('') + `</tbody></table>`;
}

export function seasonTable(days, T, key = 'all', limit = 12) {
  const cats = new Set(catsFor(key));
  const valid = days.filter(d => d.status !== 3);
  const agg = {};
  valid.forEach(d => {
    for (const c in d.counts) {
      const cat = T.get(+c)?.category ?? Math.floor(+c / 1000);
      if (!cats.has(cat)) continue;
      agg[c] = (agg[c] || 0) + d.counts[c];
    }
  });
  const rows = Object.entries(agg).map(([c, sum]) => ({ c: +c, sum })).sort((a, b) => b.sum - a.sum).slice(0, limit);
  if (!rows.length) return `<p class="hint">No observations in this period.</p>`;
  return `<table><thead><tr><th>Taxon</th><th style="text-align:right">integral</th>
    <th style="text-align:right">start</th><th style="text-align:right">peak</th>
    <th style="text-align:right">end</th><th style="text-align:right">days</th></tr></thead><tbody>` +
    rows.map(r => {
      let cum = 0, st = '—', en = '—', pk = { v: -1, date: '—' };
      valid.forEach(d => {
        const v = d.counts[r.c] || 0; cum += v;
        if (st === '—' && cum >= 0.025 * r.sum) st = d.date;
        if (cum <= 0.975 * r.sum) en = d.date;
        if (v > pk.v) pk = { v, date: d.date };
      });
      const dur = (st !== '—' && en !== '—') ? Math.round((Date.parse(en) - Date.parse(st)) / DAY) + 1 : '—';
      const t = T.get(r.c) || { sci: String(r.c), category: Math.floor(r.c / 1000) };
      return `<tr><td><span class="chip" style="background:${(CAT[t.category] || CAT[9]).c}"></span>
        <span class="sci">${esc(t.sci)}</span></td>
        <td class="n">${fmt(r.sum)}</td><td class="n">${st.slice(5)}</td>
        <td class="n">${pk.date.slice(5)}</td><td class="n">${en.slice(5)}</td><td class="n">${dur}</td></tr>`;
    }).join('') + `</tbody></table>`;
}

export function ledger(days) {
  return `<div class="ledger">` + days.map(d => {
    const col = d.status === 3 ? (d.pendingRead ? 'var(--warning)' : 'var(--critical)') : 'var(--good)';
    const txt = d.status === 3
      ? `${d.pendingRead ? 'Awaiting slide read' : 'No valid sample'}${d.reasonLabel ? ` — ${esc(d.reasonLabel)}` : ''}`
      : d.status === 2 ? `Partial, ${d.validHours} valid hours` : 'Complete, 24 h';
    return `<div><span class="dot" style="background:${col}"></span><span class="dt">${d.date.slice(5)}</span><span>${txt}</span></div>`;
  }).join('') + `</div>`;
}

export function legend(keys = STACK.slice().reverse(), line = false) {
  if (typeof keys === 'string') keys = catsFor(keys).slice().reverse();
  return `<div class="legend">` + keys.map(k =>
    `<span><i class="${line ? 'ln' : ''}" style="background:${CAT[k].c}"></i>${CAT[k].n}</span>`).join('') + `</div>`;
}

import { CAT, BANDS, BANDNAME, BANDCOL } from './data.js';

const MONO = 'IBM Plex Mono, monospace';
const COND = 'IBM Plex Sans Condensed, sans-serif';
export const DAY = 864e5;

export const fmt = (n, dp = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? '—'
    : n >= 10000 ? Math.round(n).toLocaleString('en-ZA') : n.toFixed(dp);

export const bandOf = (v, key) => {
  const t = BANDS[key] || BANDS.pollen;
  return v < t[0] ? 0 : v < t[1] ? 1 : v < t[2] ? 2 : 3;
};

/** Total for a day under the selected category filter. null when no valid sample. */
export function catTotal(day, key, taxaByCode) {
  if (day.status === 3) return null;
  let s = 0;
  for (const code in day.counts) {
    const cat = taxaByCode.get(+code)?.category ?? Math.floor(+code / 1000);
    if (key === 'all') s += day.counts[code];
    else if (key === 'pollen') { if (cat !== 4 && cat !== 5) s += day.counts[code]; }
    else if (cat === +key) s += day.counts[code];
  }
  return s;
}

export function byCat(day, taxaByCode) {
  if (day.status === 3) return null;
  const o = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const code in day.counts) {
    const cat = taxaByCode.get(+code)?.category ?? Math.floor(+code / 1000);
    if (o[cat] !== undefined) o[cat] += day.counts[code];
  }
  return o;
}

/* ---------------- signature: the tape ---------------- */
export function tape(days, key, taxaByCode) {
  const W = 1000, H = 96, n = days.length;
  if (!n) return '';
  const w = W / n;
  const vals = days.map(d => catTotal(d, key, taxaByCode)).filter(v => v !== null);
  const max = Math.max(1, ...vals);
  let s = `<defs><pattern id="lost" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="9" height="9" fill="#2a0d00"/><rect width="3.4" height="9" fill="#B23A00"/></pattern></defs>`;
  days.forEach((d, i) => {
    const x = i * w;
    if (d.status === 3) {
      s += `<rect x="${x}" y="0" width="${w}" height="${H}" fill="url(#lost)"><title>${d.date} · no valid sample</title></rect>`;
    } else {
      const v = catTotal(d, key, taxaByCode);
      const o = 0.10 + 0.90 * Math.pow(v / max, 0.62);
      s += `<rect x="${x}" y="0" width="${w}" height="${H}" fill="#A8004F" opacity="${o.toFixed(3)}"><title>${d.date} · ${fmt(v)} /m³</title></rect>`;
      if (d.status === 2) s += `<rect x="${x}" y="${H - 7}" width="${w}" height="7" fill="#8a6d00"/>`;
    }
    if (n <= 40) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#E8EAE6" stroke-width=".8" opacity=".3"/>`;
  });
  s += `<g opacity=".45">`;
  for (let i = 0; i <= n; i += Math.max(1, Math.round(n / 26)))
    s += `<line x1="${i * w}" y1="${H - 13}" x2="${i * w}" y2="${H}" stroke="#E8EAE6" stroke-width="1"/>`;
  s += `</g>`;
  return s;
}

/* ---------------- stacked daily bars ---------------- */
export function stackedBars(days, taxaByCode, h = 210) {
  const W = 1000, pad = { l: 44, r: 6, t: 8, b: 26 }, n = days.length;
  if (!n) return '';
  const bw = (W - pad.l - pad.r) / n;
  const tot = days.map(d => { const c = byCat(d, taxaByCode); return c ? c[1] + c[2] + c[3] + c[4] : 0; });
  const max = Math.max(1, ...tot), sc = v => (h - pad.t - pad.b) * v / max;
  let s = '';
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + (h - pad.t - pad.b) * g / 4;
    s += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#CDD2CC" stroke-width=".8"/>
          <text x="${pad.l - 7}" y="${y + 3.5}" text-anchor="end" font-family="${MONO}" font-size="10" fill="#6B7378">${fmt(max * (1 - g / 4))}</text>`;
  }
  days.forEach((d, i) => {
    const x = pad.l + i * bw, c = byCat(d, taxaByCode);
    if (!c) {
      s += `<rect x="${x + .6}" y="${pad.t}" width="${bw - 1.2}" height="${h - pad.t - pad.b}" fill="#B23A00" opacity=".10"><title>${d.date} · no valid sample</title></rect>`;
      return;
    }
    let y = h - pad.b;
    [4, 3, 2, 1].forEach(k => {
      const hh = sc(c[k]); y -= hh;
      s += `<rect x="${x + .6}" y="${y}" width="${bw - 1.2}" height="${hh}" fill="${CAT[k].c}"><title>${d.date} · ${CAT[k].n} ${fmt(c[k])} /m³</title></rect>`;
    });
  });
  const step = Math.max(1, Math.round(n / 12));
  days.forEach((d, i) => {
    if (i % step) return;
    s += `<text x="${pad.l + i * bw + bw / 2}" y="${h - 8}" text-anchor="middle" font-family="${MONO}" font-size="10" fill="#6B7378">${n <= 31 ? d.date.slice(8) : d.date.slice(5)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}">${s}</svg>`;
}

/* ---------------- rolling-mean lines by category ---------------- */
export function lineByCat(days, taxaByCode, smooth = 3, h = 230) {
  const W = 1000, pad = { l: 48, r: 6, t: 10, b: 26 }, n = days.length;
  if (!n) return '';
  const series = {};
  [1, 2, 3, 4].forEach(k => series[k] = days.map(d => { const c = byCat(d, taxaByCode); return c ? c[k] : null; }));
  const roll = a => a.map((_, i) => {
    const w = a.slice(Math.max(0, i - smooth + 1), i + 1).filter(v => v !== null);
    return w.length ? w.reduce((x, y) => x + y, 0) / w.length : null;
  });
  let max = 1;
  [1, 2, 3, 4].forEach(k => { series[k] = roll(series[k]); series[k].forEach(v => { if (v !== null && v > max) max = v; }); });
  const X = i => pad.l + (W - pad.l - pad.r) * i / Math.max(1, n - 1);
  const Y = v => h - pad.b - (h - pad.t - pad.b) * v / max;
  let s = '';
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + (h - pad.t - pad.b) * g / 4;
    s += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#CDD2CC" stroke-width=".8"/>
          <text x="${pad.l - 7}" y="${y + 3.5}" text-anchor="end" font-family="${MONO}" font-size="10" fill="#6B7378">${fmt(max * (1 - g / 4))}</text>`;
  }
  [4, 1, 2, 3].forEach(k => {
    let d = '', open = false;
    series[k].forEach((v, i) => {
      if (v === null) { open = false; return; }
      d += (open ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' '; open = true;
    });
    s += `<path d="${d}" fill="none" stroke="${CAT[k].c}" stroke-width="1.9" stroke-linejoin="round"/>`;
  });
  const step = Math.max(1, Math.round(n / 10));
  days.forEach((d, i) => {
    if (i % step) return;
    s += `<text x="${X(i)}" y="${h - 8}" text-anchor="middle" font-family="${MONO}" font-size="10" fill="#6B7378">${d.date.slice(5)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}">${s}</svg>`;
}

/* ---------------- year heatmap ---------------- */
export function yearHeat(days, key, taxaByCode) {
  const W = 1000, cell = W / 53, rows = 7, h = rows * 13 + 22;
  const max = (BANDS[key] || BANDS.pollen)[2];
  let s = '';
  days.forEach(d => {
    const dt = new Date(d.ts), jan1 = Date.UTC(dt.getUTCFullYear(), 0, 1);
    const wk = Math.floor((d.ts - jan1) / DAY / 7), dw = (dt.getUTCDay() + 6) % 7;
    const v = catTotal(d, key, taxaByCode);
    const o = v === null ? 0.28 : Math.min(1, 0.08 + 0.92 * Math.pow(v / max, 0.5));
    s += `<rect x="${wk * cell + .5}" y="${dw * 13 + .5}" width="${cell - 1}" height="12"
      fill="${v === null ? '#B23A00' : '#A8004F'}" opacity="${o.toFixed(3)}"><title>${d.date} · ${v === null ? 'no valid sample' : fmt(v) + ' /m³'}</title></rect>`;
  });
  ['J','F','M','A','M','J','J','A','S','O','N','D'].forEach((m, i) => {
    s += `<text x="${(i * 53 / 12) * cell + 2}" y="${rows * 13 + 15}" font-family="${COND}" font-size="10.5" fill="#6B7378">${m}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}">${s}</svg>`;
}

/* ---------------- tables ---------------- */
export function taxonTable(days, taxaByCode, limit = 10, unit = 'mean /m³') {
  const valid = days.filter(d => d.status !== 3);
  const agg = {};
  valid.forEach(d => { for (const c in d.counts) agg[c] = (agg[c] || 0) + d.counts[c]; });
  const rows = Object.entries(agg).map(([c, sum]) => ({ c: +c, sum, mean: sum / Math.max(1, valid.length) }))
    .sort((a, b) => b.sum - a.sum).slice(0, limit);
  const total = Object.values(agg).reduce((a, b) => a + b, 0) || 1;
  if (!rows.length) return `<p class="hint">No observations in this period.</p>`;
  return `<table><thead><tr><th>Taxon</th><th style="text-align:right">${unit}</th>
    <th style="text-align:right">peak day</th><th style="width:30%">share</th></tr></thead><tbody>` +
    rows.map(r => {
      const t = taxaByCode.get(r.c) || { sci: String(r.c), common: '', category: Math.floor(r.c / 1000) };
      let pk = 0, pd = '—';
      valid.forEach(d => { if ((d.counts[r.c] || 0) > pk) { pk = d.counts[r.c]; pd = d.date.slice(5); } });
      const col = (CAT[t.category] || CAT[9]).c;
      return `<tr><td><span class="chip" style="background:${col}"></span><span class="sci">${t.sci}</span>${t.common ? ` <span style="color:var(--slate)">${t.common}</span>` : ''}</td>
        <td class="n">${fmt(r.mean, r.mean < 10 ? 1 : 0)}</td><td class="n">${pd} · ${fmt(pk)}</td>
        <td><div class="bar"><i style="width:${(100 * r.sum / total).toFixed(1)}%;background:${col}"></i></div></td></tr>`;
    }).join('') + `</tbody></table>`;
}

export function seasonTable(days, taxaByCode) {
  const valid = days.filter(d => d.status !== 3);
  const agg = {};
  valid.forEach(d => { for (const c in d.counts) agg[c] = (agg[c] || 0) + d.counts[c]; });
  const rows = Object.entries(agg).map(([c, sum]) => ({ c: +c, sum })).sort((a, b) => b.sum - a.sum).slice(0, 12);
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
      const t = taxaByCode.get(r.c) || { sci: String(r.c), category: Math.floor(r.c / 1000) };
      return `<tr><td><span class="chip" style="background:${(CAT[t.category] || CAT[9]).c}"></span><span class="sci">${t.sci}</span></td>
        <td class="n">${fmt(r.sum)}</td><td class="n">${st.slice(5)}</td><td class="n">${pk.date.slice(5)}</td>
        <td class="n">${en.slice(5)}</td><td class="n">${dur}</td></tr>`;
    }).join('') + `</tbody></table>`;
}

export function bandBreakdown(days, key, taxaByCode) {
  const valid = days.filter(d => d.status !== 3);
  const c = [0, 0, 0, 0];
  valid.forEach(d => c[bandOf(catTotal(d, key, taxaByCode), key)]++);
  const tot = Math.max(1, valid.length);
  return `<table><tbody>` + c.map((n, i) =>
    `<tr><td><span class="band" style="background:${BANDCOL[i]}">${BANDNAME[i]}</span></td>
     <td class="n">${n} d</td><td><div class="bar"><i style="width:${(100 * n / tot).toFixed(1)}%;background:${BANDCOL[i]}"></i></div></td>
     <td class="n">${(100 * n / tot).toFixed(0)}%</td></tr>`).join('') + `</tbody></table>`;
}

export function ledger(days) {
  const REASON = { 1: 'power interruption', 2: 'pump or motor failure', 3: 'drum or clock failure',
    4: 'tape damaged or lost', 5: 'rain ingress', 6: 'orifice blocked', 7: 'trap maintenance',
    8: 'slide broken or contaminated', 9: 'overloaded, uncountable', 10: 'staff unavailable',
    11: 'site access denied', 88: 'other' };
  return `<div class="ledger">` + days.map(d => {
    const col = d.status === 3 ? '#B23A00' : d.status === 2 ? '#8a6d00' : '#12706B';
    const why = d.reason ? ` — ${REASON[d.reason] || 'reason recorded'}` : '';
    const txt = d.status === 3 ? `no valid sample${why}`
      : d.status === 2 ? `partial, ${d.validHours} valid hours${why}` : 'complete, 24 h';
    return `<div><span class="st" style="background:${col}"></span><span class="dt">${d.date}</span><span>${txt}</span></div>`;
  }).join('') + `</div>`;
}

export function legendRow() {
  return `<div class="tapelegend" style="color:var(--ink);margin-top:12px">` +
    [1, 2, 3, 4].map(k => `<span><i style="background:${CAT[k].c}"></i>${CAT[k].n}</span>`).join('') + `</div>`;
}

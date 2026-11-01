import { loadData, BANDNAME } from './data.js';
import {
  DAY, CAT, STACK, fmt, catTotal, byCat, tape, tapeScale, stackedBars, lineByCat,
  longSeries, seasonalOverlay, calendarYears, taxonTable, seasonTable, ledger, legend
} from './charts.js';
import { bandOf } from './data.js';

let DB = null;
const state = {
  site: null, period: 'overview', key: 'pollen', dataset: 'all',
  anchor: new Date(), theme: null
};
const $ = id => document.getElementById(id);

/* ============================================================ theme */
function applyTheme(t) {
  state.theme = t;
  if (t) document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  const btn = $('theme');
  if (btn) {
    // Light is the default; dark happens only when the viewer has asked for it.
    const dark = t === 'dark';
    btn.textContent = dark ? '☀' : '☾';
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
  try { if (t) localStorage.setItem('sapnet-theme', t); else localStorage.removeItem('sapnet-theme'); }
  catch (e) { /* private window or blocked storage — the toggle still works for this visit */ }
}

/* ============================================================ tooltip */
function initTooltip() {
  const tip = $('tip');
  let raf = null;

  document.addEventListener('mousemove', e => {
    const el = e.target.closest ? e.target.closest('[data-tt]') : null;
    if (!el) {
      tip.style.opacity = '0';
      document.querySelectorAll('svg .xhair').forEach(l => l.setAttribute('opacity', '0'));
      return;
    }
    const parts = el.getAttribute('data-tt').split('¦');
    const head = parts.shift();
    tip.innerHTML = `<div class="tt-h">${head}</div>` + parts.map(p => {
      const [label, color, value] = p.split('∷');
      return `<div class="tt-r"><span class="tt-l">${color && color !== 'transparent'
        ? `<i style="background:${color}"></i>` : '<i style="background:transparent"></i>'}${label}</span><b>${value ?? ''}</b></div>`;
    }).join('');
    tip.style.opacity = '1';

    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = tip.getBoundingClientRect();
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
      tip.style.left = Math.max(8, x) + 'px';
      tip.style.top = Math.max(8, y) + 'px';
    });

    // Crosshair follows the hovered column on line and area charts.
    const svg = el.closest('svg.xh');
    if (svg) {
      const line = svg.querySelector('.xhair');
      const dx = el.getAttribute('data-x');
      if (line && dx) {
        line.setAttribute('x1', dx); line.setAttribute('x2', dx);
        line.setAttribute('opacity', '1');
      }
    }
  }, { passive: true });

  document.addEventListener('mouseleave', () => { tip.style.opacity = '0'; }, true);
  document.addEventListener('scroll', () => { tip.style.opacity = '0'; }, { passive: true });
}

/* ============================================================ selection */
/** Every observation for the current site and dataset filter, full record. */
function allDays() {
  let a = DB.bySite.get(state.site) || [];
  if (state.dataset !== 'all') a = a.filter(d => (d.dataset || 'primary') === state.dataset);
  return a;
}

function windowDays() {
  const a = state.anchor, y = a.getUTCFullYear(), all = allDays();
  let from, to, label;
  if (state.period === 'overview') {
    if (!all.length) return { from: a, to: a, label: 'Full record', days: [] };
    from = new Date(all[0].ts); to = new Date(all[all.length - 1].ts);
    label = `${all[0].date.slice(0, 4)} – ${all[all.length - 1].date.slice(0, 4)}`;
    return { from, to, label, days: all };
  }
  if (state.period === 'week') {
    const dow = (a.getUTCDay() + 6) % 7;
    from = new Date(Date.UTC(y, a.getUTCMonth(), a.getUTCDate() - dow));
    to = new Date(from.getTime() + 6 * DAY);
    label = `${from.toUTCString().slice(5, 11)} – ${to.toUTCString().slice(5, 16)}`;
  } else if (state.period === 'month') {
    from = new Date(Date.UTC(y, a.getUTCMonth(), 1));
    to = new Date(Date.UTC(y, a.getUTCMonth() + 1, 0));
    label = from.toLocaleString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } else if (state.period === 'quarter') {
    const q = Math.floor(a.getUTCMonth() / 3);
    from = new Date(Date.UTC(y, q * 3, 1)); to = new Date(Date.UTC(y, q * 3 + 3, 0));
    label = `Q${q + 1} ${y}`;
  } else {
    from = new Date(Date.UTC(y, 0, 1)); to = new Date(Date.UTC(y, 11, 31)); label = String(y);
  }
  return { from, to, label, days: all.filter(d => d.ts >= from.getTime() && d.ts <= to.getTime()) };
}

function span(site) {
  const arrs = site ? [DB.bySite.get(site) || []] : [...DB.bySite.values()];
  let lo = null, hi = null;
  for (const arr of arrs) for (const o of arr) {
    if (state.dataset !== 'all' && (o.dataset || 'primary') !== state.dataset) continue;
    if (lo === null || o.ts < lo) lo = o.ts;
    if (hi === null || o.ts > hi) hi = o.ts;
  }
  return { lo, hi };
}

/* ============================================================ tiles */
function completenessKnownFor(days) {
  const unknown = new Set((DB.datasets || []).filter(d => d.completenessKnown === false).map(d => d.dataset));
  return !days.length || !days.every(d => unknown.has(d.dataset));
}

function tiles(days, key) {
  const T = DB.taxaByCode;
  const valid = days.filter(d => d.status !== 3);
  const vals = valid.map(d => catTotal(d, key, T));
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const peak = vals.length ? Math.max(...vals) : 0;
  const peakDay = valid[vals.indexOf(peak)];
  const hi = vals.filter(v => bandOf(v, key) >= 2).length;
  const spMean = valid.map(d => catTotal(d, '4', T)).reduce((a, b) => a + b, 0) / Math.max(1, valid.length);
  const comp = 100 * valid.length / Math.max(1, days.length);
  const pending = days.filter(d => d.pendingRead).length;
  const known = completenessKnownFor(days);
  const b = bandOf(mean, key), pb = bandOf(peak, key);

  $('tiles').innerHTML = `
    <div class="tile"><div class="k">Mean daily load</div><div class="v">${fmt(mean)}</div>
      <div class="u"><span class="pill b${b}">${BANDNAME[b]}</span> particles/m³</div></div>
    <div class="tile"><div class="k">Peak day</div><div class="v">${fmt(peak)}</div>
      <div class="u">${peakDay ? peakDay.date : '—'} <span class="pill b${pb}">${BANDNAME[pb]}</span></div></div>
    <div class="tile"><div class="k">Days high or above</div><div class="v">${hi}</div>
      <div class="u">of ${valid.length.toLocaleString('en-ZA')} valid days</div></div>
    <div class="tile"><div class="k">Mean fungal spores</div><div class="v">${fmt(spMean)}</div>
      <div class="u">spores/m³</div></div>
    ${known
      ? `<div class="tile${comp < 90 ? ' alert' : ''}"><div class="k">Data completeness</div>
          <div class="v">${comp.toFixed(0)}%</div>
          <div class="u">${days.length - valid.length} lost${pending ? ` · ${pending} awaiting read` : ''}</div></div>`
      : `<div class="tile"><div class="k">Data completeness</div>
          <div class="v sm">not recorded</div>
          <div class="u">${days.length.toLocaleString('en-ZA')} days held in the archive</div></div>`}`;
}

/* ============================================================ shared blocks */
function siteCompare(from, to, key) {
  const T = DB.taxaByCode;
  const rows = DB.sites.map(s => {
    let all = (DB.bySite.get(s) || []).filter(x => x.ts >= from.getTime() && x.ts <= to.getTime());
    if (state.dataset !== 'all') all = all.filter(x => (x.dataset || 'primary') === state.dataset);
    const valid = all.filter(x => x.status !== 3);
    return { s, m: valid.reduce((a, b) => a + catTotal(b, key, T), 0) / Math.max(1, valid.length),
      comp: 100 * valid.length / Math.max(1, all.length), n: all.length };
  }).filter(r => r.n).sort((a, b) => b.m - a.m);
  if (!rows.length) return `<p class="hint">No sites with data in this period.</p>`;
  const max = Math.max(1, ...rows.map(r => r.m));
  return `<table><thead><tr><th>Site</th><th style="text-align:right">mean /m³</th>
    <th style="width:38%"></th><th style="text-align:right">complete</th></tr></thead><tbody>` +
    rows.map(r => `<tr${r.s === state.site ? ' style="font-weight:600"' : ''}><td>${r.s}</td>
      <td class="n">${fmt(r.m)}</td>
      <td><div class="meter"><i style="width:${(100 * r.m / max).toFixed(1)}%;background:${r.s === state.site ? 'var(--seq-500)' : 'var(--rule-strong)'}"></i></div></td>
      <td class="n" style="color:${r.comp < 90 ? 'var(--critical)' : 'var(--ink-3)'}">${r.comp.toFixed(0)}%</td></tr>`).join('') +
    `</tbody></table>`;
}

function bandBreakdown(days, key) {
  const T = DB.taxaByCode;
  const valid = days.filter(d => d.status !== 3);
  const c = [0, 0, 0, 0];
  valid.forEach(d => c[bandOf(catTotal(d, key, T), key)]++);
  const tot = Math.max(1, valid.length);
  return `<table><tbody>` + c.map((n, i) =>
    `<tr><td><span class="pill b${i}">${BANDNAME[i]}</span></td><td class="n">${n} d</td>
     <td><div class="meter"><i style="width:${(100 * n / tot).toFixed(1)}%;background:${
       ['var(--good)','var(--warning)','var(--serious)','var(--critical)'][i]}"></i></div></td>
     <td class="n">${(100 * n / tot).toFixed(0)}%</td></tr>`).join('') + `</tbody></table>`;
}

function yearTable() {
  const T = DB.taxaByCode;
  const all = allDays();
  const years = [...new Set(all.map(d => d.date.slice(0, 4)))].sort();
  if (!years.length) return '';
  const rows = years.map(y => {
    const d = all.filter(x => x.date.startsWith(y));
    const valid = d.filter(x => x.status !== 3);
    return { y, sum: valid.reduce((a, b) => a + catTotal(b, state.key, T), 0),
      mean: valid.reduce((a, b) => a + catTotal(b, state.key, T), 0) / Math.max(1, valid.length),
      comp: 100 * valid.length / Math.max(1, d.length), n: d.length,
      ds: [...new Set(d.map(x => x.datasetLabel))].join(', ') };
  });
  const max = Math.max(1, ...rows.map(r => r.sum));
  return `<table><thead><tr><th>Year</th><th style="text-align:right">integral</th><th style="width:26%"></th>
    <th style="text-align:right">mean</th><th style="text-align:right">days held</th>
    <th style="text-align:right">of year</th></tr></thead><tbody>` +
    rows.map(r => {
      // Integrals are only comparable where coverage is, so coverage sits beside each one.
      const yearDays = (+r.y % 4 === 0) ? 366 : 365;
      const thisYear = r.y === String(new Date().getUTCFullYear());
      const elapsed = thisYear
        ? Math.ceil((Date.now() - Date.UTC(+r.y, 0, 1)) / 864e5) : yearDays;
      const cov = 100 * r.n / Math.max(1, elapsed);
      return `<tr><td>${r.y}${thisYear ? ' <span class="muted">to date</span>' : ''}</td>
      <td class="n">${fmt(r.sum)}</td>
      <td><div class="meter"><i style="width:${(100 * r.sum / max).toFixed(1)}%;background:var(--seq-500)"></i></div></td>
      <td class="n">${fmt(r.mean)}</td><td class="n">${r.n}</td>
      <td class="n" style="color:${cov < 85 ? 'var(--serious)' : 'var(--ink-3)'}">${cov.toFixed(0)}%</td></tr>`;
    }).join('') + `</tbody></table>`;
}

/**
 * A series assembled from two projects can contain a step change at the join that is
 * purely methodological. Say so whenever the visible window spans more than one
 * dataset or more than one method.
 */
function joinNotice(days) {
  const el = $('joinWarn');
  const sets = [...new Set(days.map(d => d.datasetLabel).filter(Boolean))];
  const methods = [...new Set(days.map(d => d.methodVersion).filter(Boolean))];
  const unknown = new Set((DB.datasets || []).filter(d => d.completenessKnown === false).map(d => d.label));
  if (sets.length < 2 && methods.length < 2 && !sets.some(l => unknown.has(l))) { el.hidden = true; return; }
  const parts = [];
  if (sets.some(l => unknown.has(l))) {
    parts.push(`Completeness cannot be computed for ${sets.filter(l => unknown.has(l))
      .map(l => `<b>${l}</b>`).join(' and ')}: days absent from the archive are unknown rather than lost.`);
  }
  if (sets.length > 1) {
    const firstOf = l => days.find(d => d.datasetLabel === l).date;
    parts.push(`This view spans ${sets.length} datasets (${sets.map(l => `<b>${l}</b> from ${firstOf(l)}`).join(', ')}).`);
  }
  if (methods.length > 1) parts.push(`It also spans ${methods.length} counting methods.`);
  parts.push('A change in level at the join may be methodological rather than real.');
  el.innerHTML = parts.join(' ');
  el.className = 'callout warn';
  el.hidden = false;
}

/* ============================================================ render */
function render() {
  const T = DB.taxaByCode;
  const { from, to, label, days } = windowDays();
  $('periodLbl').textContent = label;
  const j = $('jump'); if (j) j.value = from.toISOString().slice(0, 10);

  const overview = state.period === 'overview';
  $('navgroup').querySelectorAll('.step').forEach(b => b.hidden = overview);

  joinNotice(days);

  if (!days.length) {
    $('tiles').innerHTML = '';
    $('tapewrap').hidden = true;
    const { lo, hi } = span(state.site);
    if (lo === null) {
      $('views').innerHTML = `<div class="empty"><p>No data for <b>${state.site}</b>${
        state.dataset !== 'all' ? ' in this dataset' : ''}.</p></div>`;
    } else {
      const loS = new Date(lo).toISOString().slice(0, 10), hiS = new Date(hi).toISOString().slice(0, 10);
      $('views').innerHTML = `<div class="empty">
        <p>No sampling recorded for <b>${state.site}</b> in ${label}.<br>
        Available for this site: <b>${loS}</b> to <b>${hiS}</b>.</p>
        <button class="btn" data-goto="${loS}">Go to ${loS.slice(0, 4)}</button>
        <button class="btn" data-goto="${hiS}">Go to ${hiS.slice(0, 4)}</button></div>`;
      $('views').querySelectorAll('[data-goto]').forEach(b =>
        b.onclick = () => { state.anchor = new Date(b.dataset.goto + 'T00:00:00Z'); render(); });
    }
    return;
  }

  tiles(days, state.key);

  // The tape is a week-to-quarter device; over eight years the calendar replaces it.
  const showTape = !overview && days.length <= 400;
  $('tapewrap').hidden = !showTape;
  if (showTape) {
    $('tapeSvg').innerHTML = tape(days, state.key, T);
    const miss = days.filter(d => d.status === 3).length;
    const pend = days.filter(d => d.pendingRead).length;
    $('tapeMeta').textContent = `${days.length} day segments · ${days.length - miss} valid · ${miss} lost${pend ? ` · ${pend} awaiting read` : ''}`;
    $('tapeScale').innerHTML = tapeScale(state.key);
  }

  const V = $('views');

  if (overview) {
    const yearsN = new Set(days.map(d => d.date.slice(0, 4))).size;
    V.innerHTML = `
    <div class="panel">
      <header><div><h3>The whole record</h3>
        <p class="hint">Monthly mean concentration by category across every year held for ${state.site},
        stacked. Each month averages its valid days only, so an outage lowers confidence rather than the value.</p></div></header>
      ${longSeries(days, T, state.key)}${legend(state.key)}
    </div>

    <div class="grid g32">
      <div class="panel">
        <header><div><h3>Season shape, year on year</h3>
          <p class="hint">Every year overlaid on a common calendar, 15-day rolling mean. This is where a season
          arriving early or running long becomes visible; the most recent year is drawn heaviest.</p></div></header>
        ${(() => { const o = seasonalOverlay(days, state.key, T); return o.svg + o.legend; })()}
      </div>
      <div class="panel">
        <header><div><h3>Year by year</h3>
          <p class="hint">Annual integral for the selected load, with the project each year came from.</p></div></header>
        ${yearTable()}
      </div>
    </div>

    <div class="panel">
      <header><div><h3>Every day, ${yearsN} years</h3>
        <p class="hint">One cell per day. Grey is a day with no record at all, red a day recorded as lost —
        the difference matters, and the pattern shows whether outages are random or structural.</p></div></header>
      ${calendarYears(days, state.key, T)}
      <div class="legend"><span><i style="background:var(--surface-2);border:1px solid var(--rule)"></i>no record</span>
        <span><i style="background:var(--critical);opacity:.45"></i>recorded as lost</span>
        <span style="gap:3px">${tapeScale()}</span></div>
    </div>

    <div class="grid g2">
      <div class="panel">
        <header><div><h3>Taxa across the record</h3>
          <p class="hint">Ranked by total contribution. The shape column is each taxon's own series over the whole period.</p></div></header>
        ${taxonTable(days, T, state.key, 14, 'mean /m³')}
      </div>
      <div class="panel">
        <header><div><h3>Network, whole record</h3>
          <p class="hint">Every site over the same span, with completeness alongside each mean.</p></div></header>
        ${siteCompare(from, to, state.key)}
        <h3 style="margin:22px 0 10px;font-size:15px">Days by risk band</h3>
        ${bandBreakdown(days, state.key)}
      </div>
    </div>`;
  }

  else if (state.period === 'week') {
    V.innerHTML = `
    <div class="grid g32">
      <div class="panel"><header><div><h3>Daily load by category</h3>
        <p class="hint">Stacked concentrations for each day of the drum rotation. A pale red column is a lost day, not a zero.</p></div></header>
        ${stackedBars(days, T, state.key)}${legend(state.key)}</div>
      <div class="panel"><header><div><h3>Day ledger</h3>
        <p class="hint">Coded status for every day, feeding the completeness figure above.</p></div></header>
        ${ledger(days)}</div>
    </div>
    <div class="grid g2">
      <div class="panel"><header><div><h3>Taxa this week</h3>
        <p class="hint">Ranked by contribution to the week's total.</p></div></header>${taxonTable(days, T, state.key, 10)}</div>
      <div class="panel"><header><div><h3>All sites, this week</h3>
        <p class="hint">The same window across the network.</p></div></header>${siteCompare(from, to, state.key)}</div>
    </div>`;
  }

  else if (state.period === 'month') {
    V.innerHTML = `
    <div class="panel"><header><div><h3>Daily concentration through the month</h3>
      <p class="hint">Three-day rolling mean per category. Lines break at lost days rather than bridging them.</p></div></header>
      ${lineByCat(days, T, state.key, 3)}${legend(state.key, true)}</div>
    <div class="grid g2">
      <div class="panel"><header><div><h3>Taxa this month</h3>
        <p class="hint">Monthly mean over valid days only, so an outage does not depress the average.</p></div></header>
        ${taxonTable(days, T, state.key, 12, 'monthly mean /m³')}</div>
      <div class="panel"><header><div><h3>Network comparison</h3>
        <p class="hint">Monthly means across all sites.</p></div></header>${siteCompare(from, to, state.key)}
        <h3 style="margin:22px 0 10px;font-size:15px">Days by risk band</h3>${bandBreakdown(days, state.key)}</div>
    </div>`;
  }

  else if (state.period === 'quarter') {
    V.innerHTML = `
    <div class="panel"><header><div><h3>Quarter at daily resolution</h3>
      <p class="hint">Seven-day rolling mean per category — the shape of the season rather than day-to-day weather noise.</p></div></header>
      ${lineByCat(days, T, state.key, 7, 270)}${legend(state.key, true)}</div>
    <div class="grid g2">
      <div class="panel"><header><div><h3>Quarterly taxon integrals</h3>
        <p class="hint">Sum of daily concentrations, the standard measure of seasonal exposure.</p></div></header>
        ${taxonTable(days, T, state.key, 12, 'quarterly mean /m³')}</div>
      <div class="panel"><header><div><h3>Network comparison</h3>
        <p class="hint">Quarterly means, reporting site highlighted.</p></div></header>${siteCompare(from, to, state.key)}
        <h3 style="margin:22px 0 10px;font-size:15px">Days by risk band</h3>${bandBreakdown(days, state.key)}</div>
    </div>`;
  }

  else {
    V.innerHTML = `
    <div class="panel"><header><div><h3>The year, day by day</h3>
      <p class="hint">One cell per day. Grey is no record, red a recorded loss.</p></div></header>
      ${calendarYears(days, state.key, T)}</div>
    <div class="panel"><header><div><h3>Season descriptors by taxon</h3>
      <p class="hint">Main pollen season by the 95% cumulative method: start at 2.5% of the annual integral,
      end at 97.5%. Integrals are only comparable between years when completeness is, so both are reported together.</p></div></header>
      ${seasonTable(days, T, state.key)}</div>
    <div class="grid g2">
      <div class="panel"><header><div><h3>Year on year</h3>
        <p class="hint">Annual integral for this site across the available record.</p></div></header>${yearTable()}</div>
      <div class="panel"><header><div><h3>Network annual means</h3>
        <p class="hint">Completeness is reported next to every number, never separately from it.</p></div></header>
        ${siteCompare(from, to, state.key)}</div>
    </div>`;
  }
}

/* ============================================================ export */
function exportCsv() {
  const { days, label } = windowDays();
  const T = DB.taxaByCode;
  const head = ['site', 'date', 'dataset', 'method_version', 'conversion_factor', 'day_status',
    'status_reason', 'valid_hours', 'taxon_code', 'scientific_name', 'category',
    'raw_count', 'converted_count_per_m3'];
  const STATUS = { 1: 'complete', 2: 'partial', 3: 'not_collected', 4: 'invalidated' };
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [head.join(',')];
  for (const d of days) {
    const base = [d.site, d.date, q(d.datasetLabel), q(d.methodVersion), d.conversionFactor ?? '',
      STATUS[d.status], q(d.reasonLabel || ''), d.validHours];
    const codes = Object.keys(d.counts);
    if (!codes.length) { rows.push([...base, '', '', '', '', ''].join(',')); continue; }
    for (const c of codes) {
      const t = T.get(+c) || { sci: '', category: Math.floor(+c / 1000) };
      rows.push([...base, c, q(t.sci), q((CAT[t.category] || CAT[9]).n),
        d.raw && d.raw[c] !== undefined ? d.raw[c] : '', d.counts[c].toFixed(3)].join(','));
    }
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sapnet_${state.site.replace(/\s+/g, '-')}_${label.replace(/[^\w]+/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================ wiring */
function shift(dir) {
  const a = state.anchor, y = a.getUTCFullYear(), m = a.getUTCMonth();
  if (state.period === 'week') state.anchor = new Date(a.getTime() + dir * 7 * DAY);
  else if (state.period === 'month') state.anchor = new Date(Date.UTC(y, m + dir, 15));
  else if (state.period === 'quarter') state.anchor = new Date(Date.UTC(y, m + dir * 3, 15));
  else if (state.period === 'year') state.anchor = new Date(Date.UTC(y + dir, 6, 1));
  render();
}

async function init() {
  try { applyTheme(localStorage.getItem('sapnet-theme')); } catch (e) { applyTheme(null); }
  initTooltip();

  DB = await loadData();
  state.site = DB.sites[0];
  const last = (DB.bySite.get(state.site) || []).at(-1);
  state.anchor = last ? new Date(last.ts) : new Date();

  const sel = $('siteSel');
  DB.sites.forEach(s => { const o = document.createElement('option'); o.value = o.textContent = s; sel.append(o); });
  sel.value = state.site;

  const dsSel = $('dsSel');
  if (DB.datasets && DB.datasets.length > 1) {
    const all = document.createElement('option');
    all.value = 'all'; all.textContent = 'All datasets'; dsSel.append(all);
    for (const d of DB.datasets) {
      const o = document.createElement('option'); o.value = d.dataset; o.textContent = d.label; dsSel.append(o);
    }
    $('dsField').hidden = false;
    dsSel.onchange = e => { state.dataset = e.target.value; render(); };
  }

  // Coverage line: a series that is loaded but out of view must not look like a failure.
  const per = new Map();
  for (const arr of DB.bySite.values()) for (const o of arr) {
    const k = o.datasetLabel || 'Data';
    const e = per.get(k) || { lo: o.ts, hi: o.ts, n: 0 };
    e.lo = Math.min(e.lo, o.ts); e.hi = Math.max(e.hi, o.ts); e.n++;
    per.set(k, e);
  }
  if (per.size) {
    $('spanNote').innerHTML = '· ' + [...per.entries()].map(([k, e]) =>
      `${k} ${new Date(e.lo).toISOString().slice(0, 4)}–${new Date(e.hi).toISOString().slice(0, 4)} ` +
      `(${e.n.toLocaleString('en-ZA')} site-days)`).join(' · ');
  }

  const badge = $('srcBadge');
  if (DB.source === 'redcap') {
    badge.className = 'badge live';
    badge.textContent = DB.datasets && DB.datasets.length > 1
      ? `Live REDCap · ${DB.datasets.length} projects`
      : `Live REDCap · ${DB.schema} schema`;
  } else if (DB.source === 'file') { badge.className = 'badge'; badge.textContent = 'Committed dataset'; }
  else { badge.className = 'badge demo'; badge.textContent = 'Demo data'; }
  $('srcNote').textContent = DB.source === 'demo'
    ? 'No REDCap connection configured — showing synthetic data.'
    : `Refreshed ${new Date(DB.generatedAt).toLocaleString('en-ZA')}`;

  if (DB.conversionBasis) {
    $('basisNote').hidden = false;
    $('basisNote').textContent = DB.conversionBasis;
    $('basisNote').className = (DB.conversionFactorsInUse || []).length > 1 ? 'callout warn' : 'callout ok';
  }
  if (DB.provisional && DB.provisionalReason) {
    $('srcWarn').hidden = false;
    $('srcWarn').textContent = DB.provisionalReason;
  }

  // The view lives in the URL hash, so a particular tab can be linked or bookmarked.
  const PERIODS = ['overview', 'week', 'month', 'quarter', 'year'];
  function setPeriod(p, push = true) {
    if (!PERIODS.includes(p)) p = 'overview';
    state.period = p;
    document.querySelectorAll('.tab').forEach(x =>
      x.setAttribute('aria-selected', String(x.dataset.p === p)));
    if (push && location.hash.slice(1) !== p) location.hash = p;
    render();
  }
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => setPeriod(t.dataset.p));
  window.addEventListener('hashchange', () => setPeriod(location.hash.slice(1), false));
  sel.onchange = e => { state.site = e.target.value; render(); };
  $('catSel').onchange = e => { state.key = e.target.value; render(); };
  $('prev').onclick = () => shift(-1);
  $('next').onclick = () => shift(1);
  $('csv').onclick = exportCsv;
  $('print').onclick = () => window.print();
  $('aboutToggle').onclick = e => {
    const open = $('about').hidden;
    $('about').hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
  };
  $('theme').onclick = () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    render();
  };

  const { lo, hi } = span(null);
  const jump = $('jump');
  if (lo !== null) {
    jump.min = new Date(lo).toISOString().slice(0, 10);
    jump.max = new Date(hi).toISOString().slice(0, 10);
  }
  jump.onchange = e => {
    if (!e.target.value) return;
    state.anchor = new Date(e.target.value + 'T00:00:00Z');
    // Jumping to a date from the whole-record view only makes sense at a shorter period.
    if (state.period === 'overview') { setPeriod('month'); return; }
    render();
  };
  $('first').onclick = () => { const { lo } = span(state.site); if (lo !== null) { state.anchor = new Date(lo); render(); } };
  $('last').onclick = () => { const { hi } = span(state.site); if (hi !== null) { state.anchor = new Date(hi); render(); } };

  $('loading').remove();
  $('app').hidden = false;
  setPeriod(location.hash.slice(1) || 'overview', false);
}

init().catch(err => {
  $('loading').innerHTML = `Could not start the dashboard.<br><br>
    <span style="color:var(--critical)">${err.message}</span>`;
  console.error(err);
});

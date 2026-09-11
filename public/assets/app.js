import { loadData, CAT, BANDNAME, BANDCOL } from './data.js';
import {
  DAY, fmt, bandOf, catTotal, tape, stackedBars, lineByCat, yearHeat,
  taxonTable, seasonTable, bandBreakdown, ledger, legendRow
} from './charts.js';

let DB = null;
const state = { site: null, period: 'week', key: 'pollen', dataset: 'all', anchor: new Date() };

const $ = id => document.getElementById(id);

/* ---------------- period window ---------------- */
function windowDays() {
  const a = state.anchor, y = a.getUTCFullYear(), all = DB.bySite.get(state.site) || [];
  let from, to, label;
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
    from = new Date(Date.UTC(y, q * 3, 1));
    to = new Date(Date.UTC(y, q * 3 + 3, 0));
    label = `Q${q + 1} ${y}`;
  } else {
    from = new Date(Date.UTC(y, 0, 1)); to = new Date(Date.UTC(y, 11, 31)); label = String(y);
  }
  let days = all.filter(d => d.ts >= from.getTime() && d.ts <= to.getTime());
  if (state.dataset !== 'all') days = days.filter(d => (d.dataset || 'primary') === state.dataset);
  return { from, to, label, days };
}

/* ---------------- KPIs ---------------- */
function kpis(days, key) {
  const T = DB.taxaByCode;
  const valid = days.filter(d => d.status !== 3);
  const vals = valid.map(d => catTotal(d, key, T));
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const peak = vals.length ? Math.max(...vals) : 0;
  const peakDay = valid[vals.indexOf(peak)];
  const partial = days.filter(d => d.status === 2).length;

  // A dataset that only holds days with counts cannot report completeness: an absent
  // day is unknown, not lost. Showing 100% there would be a fiction.
  const unknownSets = new Set((DB.datasets || [])
    .filter(d => d.completenessKnown === false).map(d => d.dataset));
  const completenessKnown = !days.length ||
    !days.every(d => unknownSets.has(d.dataset));
  const comp = 100 * valid.length / Math.max(1, days.length);
  const spMean = valid.map(d => catTotal(d, '4', T)).reduce((a, b) => a + b, 0) / Math.max(1, valid.length);
  const hi = vals.filter(v => bandOf(v, key) >= 2).length;
  const b = bandOf(mean, key), pb = bandOf(peak, key);
  $('kpis').innerHTML = `
    <div class="kpi"><div class="k">Mean daily load</div><div class="v">${fmt(mean)}</div>
      <div class="u"><span class="band" style="background:${BANDCOL[b]}">${BANDNAME[b]}</span> particles/m³</div></div>
    <div class="kpi"><div class="k">Peak day</div><div class="v">${fmt(peak)}</div>
      <div class="u">${peakDay ? peakDay.date : '—'} · <span class="band" style="background:${BANDCOL[pb]}">${BANDNAME[pb]}</span></div></div>
    <div class="kpi"><div class="k">Days at high or above</div><div class="v">${hi}</div>
      <div class="u">of ${valid.length} valid days</div></div>
    <div class="kpi"><div class="k">Mean fungal spores</div><div class="v">${fmt(spMean)}</div><div class="u">spores/m³</div></div>
    ${completenessKnown
      ? `<div class="kpi${comp < 90 ? ' alert' : ''}"><div class="k">Data completeness</div>
           <div class="v">${comp.toFixed(0)}%</div>
           <div class="u">${days.length - valid.length} lost · ${partial} partial</div></div>`
      : `<div class="kpi"><div class="k">Data completeness</div>
           <div class="v" style="font-size:19px;color:var(--slate)">not recorded</div>
           <div class="u">${days.length} days held in the archive</div></div>`}`;
}

/* ---------------- cross-site comparison ---------------- */
function siteCompare(from, to, key) {
  const T = DB.taxaByCode;
  const rows = DB.sites.map(s => {
    let all = (DB.bySite.get(s) || []).filter(x => x.ts >= from.getTime() && x.ts <= to.getTime());
    if (state.dataset !== 'all') all = all.filter(x => (x.dataset || 'primary') === state.dataset);
    const valid = all.filter(x => x.status !== 3);
    return {
      s,
      m: valid.reduce((a, b) => a + catTotal(b, key, T), 0) / Math.max(1, valid.length),
      comp: 100 * valid.length / Math.max(1, all.length)
    };
  }).sort((a, b) => b.m - a.m);
  const max = Math.max(1, ...rows.map(r => r.m));
  return `<table><thead><tr><th>Site</th><th style="text-align:right">mean /m³</th>
    <th style="width:40%"></th><th style="text-align:right">complete</th></tr></thead><tbody>` +
    rows.map(r => `<tr${r.s === state.site ? ' style="font-weight:600"' : ''}><td>${r.s}</td>
      <td class="n">${fmt(r.m)}</td>
      <td><div class="bar"><i style="width:${(100 * r.m / max).toFixed(1)}%;background:${r.s === state.site ? 'var(--fuchsin)' : 'var(--slate)'}"></i></div></td>
      <td class="n" style="color:${r.comp < 90 ? 'var(--warn)' : 'var(--slate)'}">${r.comp.toFixed(0)}%</td></tr>`).join('') +
    `</tbody></table>`;
}

function yoy() {
  const T = DB.taxaByCode;
  const all = DB.bySite.get(state.site) || [];
  const years = [...new Set(all.map(d => d.date.slice(0, 4)))].sort();
  const rows = years.map(y => {
    const d = all.filter(x => x.date.startsWith(y));
    const valid = d.filter(x => x.status !== 3);
    return { y, sum: valid.reduce((a, b) => a + catTotal(b, state.key, T), 0),
      comp: 100 * valid.length / Math.max(1, d.length), n: d.length };
  });
  const max = Math.max(1, ...rows.map(r => r.sum));
  return `<table><thead><tr><th>Year</th><th style="text-align:right">integral</th><th style="width:38%"></th>
    <th style="text-align:right">complete</th><th style="text-align:right">days</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${r.y}${r.n < 360 ? ' <span style="color:var(--warn)">part year</span>' : ''}</td>
      <td class="n">${fmt(r.sum)}</td>
      <td><div class="bar"><i style="width:${(100 * r.sum / max).toFixed(1)}%;background:var(--fuchsin)"></i></div></td>
      <td class="n">${r.comp.toFixed(0)}%</td><td class="n">${r.n}</td></tr>`).join('') + `</tbody></table>`;
}

/* ---------------- render ---------------- */
function render() {
  const T = DB.taxaByCode;
  const { from, to, label, days } = windowDays();
  $('periodLbl').textContent = label;
  $('tapeSvg').innerHTML = tape(days, state.key, T);

  const miss = days.filter(d => d.status === 3).length, part = days.filter(d => d.status === 2).length;
  $('tapeMeta').textContent = `${days.length} day segments · ${days.length - miss} valid · ${part} partial · ${miss} lost`;
  $('tapeTitle').textContent = state.period === 'week' ? 'The tape · one drum rotation' : 'The tape · consecutive drum rotations';

  joinNotice(days);
  kpis(days, state.key);
  const V = $('views'), P = state.period;

  if (P === 'week') {
    V.innerHTML = `
    <div class="grid g32">
      <div class="panel"><h3>Daily load by category</h3>
        <p class="hint">Stacked concentrations for each day of the drum rotation. A pale red column is a lost day, not a zero.</p>
        ${stackedBars(days, T)}${legendRow()}</div>
      <div class="panel"><h3>Day ledger</h3>
        <p class="hint">Coded status for every day, carried straight through to the completeness figure above.</p>
        ${ledger(days)}</div>
    </div>
    <div class="grid g2">
      <div class="panel"><h3>Taxa this week</h3>
        <p class="hint">Ranked by contribution to the week's total.</p>${taxonTable(days, T, 10)}</div>
      <div class="panel"><h3>All sites, this week</h3>
        <p class="hint">The same window across the network, with each site's completeness alongside.</p>
        ${siteCompare(from, to, state.key)}</div>
    </div>`;
  } else if (P === 'month') {
    V.innerHTML = `
    <div class="panel"><h3>Daily concentration through the month</h3>
      <p class="hint">Three-day rolling mean per category. Lines break at lost days rather than bridging them.</p>
      ${lineByCat(days, T, 3)}${legendRow()}</div>
    <div class="grid g2">
      <div class="panel"><h3>Taxa this month</h3>
        <p class="hint">Monthly mean over valid days only, so an outage does not depress the average.</p>
        ${taxonTable(days, T, 12, 'monthly mean /m³')}</div>
      <div class="panel"><h3>Network comparison</h3>
        <p class="hint">Monthly means across all sites. Completeness below 90% is flagged.</p>
        ${siteCompare(from, to, state.key)}
        <h3 style="margin-top:22px">Days by risk band</h3>${bandBreakdown(days, state.key, T)}</div>
    </div>`;
  } else if (P === 'quarter') {
    V.innerHTML = `
    <div class="panel"><h3>Quarter at daily resolution</h3>
      <p class="hint">Seven-day rolling mean per category, showing the shape of the season rather than day-to-day weather noise.</p>
      ${lineByCat(days, T, 7, 250)}${legendRow()}</div>
    <div class="grid g2">
      <div class="panel"><h3>Quarterly taxon integrals</h3>
        <p class="hint">Sum of daily concentrations, the standard measure of seasonal exposure.</p>
        ${taxonTable(days, T, 12, 'quarterly mean /m³')}</div>
      <div class="panel"><h3>Network comparison</h3>
        <p class="hint">Quarterly means, with the reporting site highlighted.</p>
        ${siteCompare(from, to, state.key)}
        <h3 style="margin-top:22px">Days by risk band</h3>${bandBreakdown(days, state.key, T)}</div>
    </div>`;
  } else {
    V.innerHTML = `
    <div class="panel"><h3>The year, day by day</h3>
      <p class="hint">One cell per day, weeks running left to right. Red cells are lost days — the pattern shows whether outages are random or structural.</p>
      ${yearHeat(days, state.key, T)}</div>
    <div class="panel"><h3>Season descriptors by taxon</h3>
      <p class="hint">Main pollen season by the 95% cumulative method: start at 2.5% of the annual integral, end at 97.5%. Integrals are only comparable between years when completeness is comparable, so both are reported together.</p>
      ${seasonTable(days, T)}</div>
    <div class="grid g2">
      <div class="panel"><h3>Year on year</h3>
        <p class="hint">Annual integral for this site across the available record.</p>${yoy()}</div>
      <div class="panel"><h3>Network annual means</h3>
        <p class="hint">Completeness is reported next to every number, never separately from it.</p>
        ${siteCompare(from, to, state.key)}</div>
    </div>`;
  }
}

/**
 * A series assembled from two projects can contain a step change at the join that is
 * purely methodological. Say so whenever the visible window spans more than one
 * dataset or more than one method version.
 */
function joinNotice(days) {
  const el = $('joinWarn');
  const sets = [...new Set(days.map(d => d.datasetLabel).filter(Boolean))];
  const methods = [...new Set(days.map(d => d.methodVersion).filter(Boolean))];
  const unknown = new Set((DB.datasets || [])
    .filter(d => d.completenessKnown === false).map(d => d.label));
  if (sets.length < 2 && methods.length < 2 && !sets.some(l => unknown.has(l))) {
    el.hidden = true; return;
  }

  const parts = [];
  const unknownSets = new Set((DB.datasets || [])
    .filter(d => d.completenessKnown === false).map(d => d.label));
  if (sets.some(l => unknownSets.has(l))) {
    parts.push(`Completeness cannot be computed for ` +
      sets.filter(l => unknownSets.has(l)).map(l => `<b>${l}</b>`).join(' and ') +
      `: days absent from the archive are unknown rather than lost.`);
  }
  if (sets.length > 1) {
    const firstOf = l => days.find(d => d.datasetLabel === l).date;
    parts.push(`This window spans ${sets.length} datasets (` +
      sets.map(l => `<b>${l}</b> from ${firstOf(l)}`).join(', ') + ').');
  }
  if (methods.length > 1) {
    parts.push(`It also spans ${methods.length} counting methods (${methods.join('; ')}).`);
  }
  parts.push('A change in level at the join may be methodological rather than real. ' +
    'Do not read a trend across it without checking both methods first.');
  el.innerHTML = parts.join(' ');
  el.hidden = false;
}

/* ---------------- CSV export of the current window ---------------- */
function exportCsv() {
  const { days, label } = windowDays();
  const T = DB.taxaByCode;
  const head = ['site', 'date', 'dataset', 'method_version', 'conversion_factor',
    'day_status', 'valid_hours', 'taxon_code', 'scientific_name', 'category',
    'raw_count', 'converted_count_per_m3'];
  const rows = [head.join(',')];
  const STATUS = { 1: 'complete', 2: 'partial', 3: 'not_collected', 4: 'invalidated' };
  for (const d of days) {
    if (!Object.keys(d.counts).length) {
      rows.push([d.site, d.date, `"${d.datasetLabel || ''}"`, `"${d.methodVersion || ''}"`,
        d.conversionFactor ?? '', STATUS[d.status], d.validHours, '', '', '', '', ''].join(','));
      continue;
    }
    for (const c in d.counts) {
      const t = T.get(+c) || { sci: '', category: Math.floor(+c / 1000) };
      rows.push([d.site, d.date, `"${d.datasetLabel || ''}"`, `"${d.methodVersion || ''}"`,
        d.conversionFactor ?? '', STATUS[d.status], d.validHours, c, `"${t.sci}"`,
        (CAT[t.category] || CAT[9]).n,
        d.raw && d.raw[c] !== undefined ? d.raw[c] : '',
        d.counts[c].toFixed(3)].join(','));
    }
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sapnet_${state.site.replace(/\s+/g, '-')}_${label.replace(/[^\w]+/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------- wiring ---------------- */
function shift(dir) {
  const a = state.anchor, y = a.getUTCFullYear(), m = a.getUTCMonth(), d = a.getUTCDate();
  if (state.period === 'week') state.anchor = new Date(a.getTime() + dir * 7 * DAY);
  else if (state.period === 'month') state.anchor = new Date(Date.UTC(y, m + dir, 15));
  else if (state.period === 'quarter') state.anchor = new Date(Date.UTC(y, m + dir * 3, 15));
  else state.anchor = new Date(Date.UTC(y + dir, 6, 1));
  render();
}

async function init() {
  DB = await loadData();
  state.site = DB.sites[0];
  const last = (DB.bySite.get(state.site) || []).at(-1);
  state.anchor = last ? new Date(last.ts) : new Date();

  const sel = $('siteSel');
  DB.sites.forEach(s => { const o = document.createElement('option'); o.value = o.textContent = s; sel.append(o); });
  sel.value = state.site;

  // Dataset selector appears only when more than one project is connected.
  const dsSel = $('dsSel');
  if (DB.datasets && DB.datasets.length > 1) {
    const optAll = document.createElement('option');
    optAll.value = 'all'; optAll.textContent = 'All datasets';
    dsSel.append(optAll);
    for (const d of DB.datasets) {
      const o = document.createElement('option');
      o.value = d.dataset; o.textContent = d.label;
      dsSel.append(o);
    }
    dsSel.hidden = false; $('dsLabel').hidden = false;
    dsSel.onchange = e => { state.dataset = e.target.value; render(); };
  }

  const badge = $('srcBadge'), note = $('srcNote'), warn = $('srcWarn');
  if (DB.source === 'redcap') {
    badge.className = 'badge live';
    badge.textContent = DB.datasets && DB.datasets.length > 1
      ? `Live REDCap · ${DB.datasets.length} projects`
      : DB.schema === 'legacy' ? 'Live REDCap · legacy schema' : 'Live REDCap · v2 schema';
  } else if (DB.source === 'file') {
    badge.className = 'badge'; badge.textContent = 'Committed dataset';
  } else {
    badge.className = 'badge demo'; badge.textContent = 'Demo data';
  }
  const basis = $('basisNote');
  if (DB.conversionBasis) {
    basis.hidden = false;
    basis.textContent = DB.conversionBasis;
    basis.className = (DB.conversionFactorsInUse || []).length > 1 ? 'provwarn' : 'basisnote';
  } else { basis.hidden = true; }

  note.textContent = DB.source === 'demo'
    ? 'No REDCap connection configured — showing synthetic data. Set REDCAP_URL and REDCAP_TOKEN in Netlify environment variables.'
    : `Last refreshed ${new Date(DB.generatedAt).toLocaleString('en-ZA')}`;

  // The legacy instrument cannot support verified concentrations. Say so, on every view.
  if (DB.provisional && DB.provisionalReason) {
    warn.hidden = false;
    warn.textContent = DB.provisionalReason;
  } else {
    warn.hidden = true;
  }

  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', 'false'));
    t.setAttribute('aria-selected', 'true');
    state.period = t.dataset.p;
    render();
  });
  sel.onchange = e => { state.site = e.target.value; render(); };
  $('catSel').onchange = e => { state.key = e.target.value; render(); };
  $('prev').onclick = () => shift(-1);
  $('next').onclick = () => shift(1);
  $('csv').onclick = exportCsv;
  $('print').onclick = () => window.print();

  $('loading').remove();
  $('app').hidden = false;
  render();
}

init().catch(err => {
  $('loading').innerHTML = `Could not start the dashboard.<br><br>
    <span style="color:var(--warn)">${err.message}</span>`;
  console.error(err);
});

(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // public/assets/data.js
  var BANDS = {
    1: [15, 90, 1500],
    2: [10, 30, 100],
    3: [10, 50, 500],
    4: [500, 3e3, 15e3],
    pollen: [20, 100, 1e3],
    all: [500, 3e3, 15e3]
  };
  var BANDNAME = ["Low", "Moderate", "High", "Very high"];
  var bandOf = (v, key) => {
    const t = BANDS[key] || BANDS.pollen;
    return v < t[0] ? 0 : v < t[1] ? 1 : v < t[2] ? 2 : 3;
  };
  function fetchWithTimeout(_0, _1) {
    return __async(this, arguments, function* (url, ms, init2 = {}) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), ms);
      try {
        return yield fetch(url, __spreadProps(__spreadValues({}, init2), { signal: ctl.signal }));
      } finally {
        clearTimeout(timer);
      }
    });
  }
  function taxonReference() {
    return __async(this, null, function* () {
      try {
        const r = yield fetchWithTimeout("/data/taxa.json", 5e3);
        if (r.ok) {
          const d = yield r.json();
          return new Map(d.taxa.map((t) => [Number(t.code), t]));
        }
      } catch (e) {
        console.warn("taxa.json unavailable:", e.message);
      }
      return /* @__PURE__ */ new Map();
    });
  }
  var LIVE_TIMEOUT_MS = 15e3;
  function loadData() {
    return __async(this, arguments, function* (onStatus = () => {
    }, opts = {}) {
      onStatus("Contacting REDCap\u2026");
      const started = Date.now();
      let liveError = null;
      const slow = setTimeout(
        () => onStatus("REDCap is taking a while \u2014 a full export of a wide instrument is slow\u2026"),
        6e3
      );
      let live = null;
      try {
        const url = "/api/observations" + (opts.force ? "?refresh=1" : "");
        const r = yield fetchWithTimeout(
          url,
          LIVE_TIMEOUT_MS,
          { headers: { Accept: "application/json" }, cache: opts.force ? "no-store" : "default" }
        );
        if (r.ok) {
          onStatus("Reading response\u2026");
          const d = yield r.json();
          if (d.observations && d.observations.length) live = d;
          else liveError = "REDCap returned no observations.";
        } else if (r.status === 501) {
          liveError = null;
        } else {
          const e = yield r.json().catch(() => ({}));
          liveError = e.message || `API returned ${r.status}`;
        }
      } catch (e) {
        liveError = e.name === "AbortError" ? `No response from /api/observations within ${LIVE_TIMEOUT_MS / 1e3}s.` : e.message;
      }
      clearTimeout(slow);
      onStatus("Loading the historical archive\u2026");
      const archive = yield loadArchive();
      if (live) {
        const merged = archive ? mergeSources(archive, live) : live;
        const db2 = yield index(merged);
        db2.archiveUsed = Boolean(archive);
        return db2;
      }
      if (liveError) console.warn("Live data unavailable:", liveError);
      if (archive) {
        const db2 = yield index(archive);
        db2.liveError = liveError;
        db2.archiveOnly = true;
        return db2;
      }
      onStatus("Falling back to the committed snapshot\u2026");
      try {
        const r = yield fetchWithTimeout("/data/observations.json", 5e3);
        if (r.ok) {
          const d = yield r.json();
          if (d.observations && d.observations.length) {
            const db2 = yield index(__spreadProps(__spreadValues({}, d), { source: "file" }));
            db2.liveError = liveError;
            return db2;
          }
        }
      } catch (e) {
      }
      onStatus("Using the built-in demo dataset\u2026");
      const db = yield index(demoDataset());
      db.liveError = liveError;
      db.liveElapsedMs = Date.now() - started;
      return db;
    });
  }
  function loadArchive() {
    return __async(this, null, function* () {
      try {
        const r = yield fetchWithTimeout("/data/archive.json", 1e4);
        if (!r.ok) return null;
        const d = yield r.json();
        if (d.observations && d.observations.length) return d;
      } catch (e) {
        console.warn("archive.json unavailable:", e.message);
      }
      return null;
    });
  }
  function mergeSources(archive, live) {
    const byKey = /* @__PURE__ */ new Map();
    for (const o of archive.observations) byKey.set(`${o.site}|${o.date}`, o);
    let overlaps = 0;
    for (const o of live.observations) {
      const k = `${o.site}|${o.date}`;
      if (byKey.has(k)) overlaps++;
      byKey.set(k, o);
    }
    const taxa = /* @__PURE__ */ new Map();
    for (const t of [...archive.taxa || [], ...live.taxa || []]) {
      if (!taxa.has(Number(t.code))) taxa.set(Number(t.code), t);
    }
    const datasets = [...live.datasets || []];
    for (const d of archive.datasets || []) {
      if (!datasets.some((x) => x.dataset === d.dataset)) datasets.push(d);
    }
    const observations = [...byKey.values()].sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));
    return __spreadProps(__spreadValues({}, live), {
      datasets,
      taxa: [...taxa.values()].sort((a, b) => a.code - b.code),
      observations,
      sites: [...new Set(observations.map((o) => o.site))].sort(),
      archiveOverlaps: overlaps,
      archiveGeneratedAt: archive.generatedAt || null
    });
  }
  function index(d) {
    return __async(this, null, function* () {
      const ref = yield taxonReference();
      const taxaByCode = new Map(d.taxa.map((t) => {
        var _a, _b;
        const code = Number(t.code);
        const known = ref.get(code);
        return [code, {
          code,
          sci: known && known.sci || t.sci || String(code),
          common: known && known.common || t.common || "",
          category: (_b = (_a = t.category) != null ? _a : known && known.category) != null ? _b : Math.floor(code / 1e3)
        }];
      }));
      const bySite = /* @__PURE__ */ new Map();
      for (const o of d.observations) {
        if (!bySite.has(o.site)) bySite.set(o.site, []);
        bySite.get(o.site).push(o);
      }
      for (const arr of bySite.values()) {
        arr.sort((a, b) => a.date.localeCompare(b.date));
        for (const o of arr) o.ts = Date.parse(o.date + "T00:00:00Z");
      }
      const datasets = d.datasets || [...new Set(d.observations.map((o) => o.datasetLabel).filter(Boolean))].map((label) => ({ label, dataset: label, completenessKnown: true }));
      return __spreadProps(__spreadValues({}, d), { taxaByCode, bySite, datasets, sites: [...bySite.keys()].sort() });
    });
  }
  var DEMO_TAXA = [
    [1016, "Cupressaceae", "Cypress", 1, 200, 38, 120],
    [1041, "Platanus", "Plane", 1, 255, 26, 180],
    [1045, "Quercus", "Oak", 1, 268, 25, 95],
    [1038, "Oleaceae", "Olive family", 1, 288, 30, 140],
    [1034, "Moraceae", "Mulberry family", 1, 240, 24, 70],
    [1040, "Pinus", "Pine", 1, 272, 34, 60],
    [2001, "Poaceae", "Grass", 2, 330, 72, 105],
    [2002, "Zea mays", "Maize", 2, 20, 28, 14],
    [3009, "Asteraceae", "Daisy family", 3, 80, 55, 26],
    [3015, "Chenopodiaceae", "Goosefoot", 3, 60, 48, 22],
    [3034, "Plantaginaceae", "Plantain", 3, 330, 60, 18],
    [3007, "Artemisia", "Mugwort", 3, 95, 34, 12],
    [4012, "Cladosporium", "", 4, 80, 120, 2600],
    [4001, "Alternaria", "", 4, 70, 70, 220],
    [4004, "Ascospores", "", 4, 120, 95, 700],
    [4006, "Basidiospores", "", 4, 110, 100, 540],
    [4014, "Epicoccum", "", 4, 95, 60, 90]
  ];
  var DEMO_SITES = {
    "Cape Town": [1.15, 0.85, 1.05, 0.8],
    "Bloemfontein": [0.75, 1.25, 0.95, 0.55],
    "Durban": [0.7, 1.05, 0.8, 1.7],
    "George": [0.95, 1, 0.85, 1.25],
    "Gqeberha": [0.9, 1.1, 1, 0.95],
    "Johannesburg Central": [1.25, 1.15, 1.05, 0.85],
    "Kimberley": [0.6, 1.1, 1.2, 0.5],
    "Pretoria": [1.35, 1.05, 1, 0.9]
  };
  var REASONS = {
    1: "Trap or equipment failure",
    2: "Power outage",
    3: "Slide damaged or lost",
    4: "No staff available",
    5: "Slide not yet read",
    6: "Other (see notes)"
  };
  var FACTOR = 0.72;
  function demoDataset() {
    let seed = 20261101;
    const rnd = () => {
      seed = seed * 1103515245 + 12345 & 2147483647;
      return seed / 2147483647;
    };
    const DAY2 = 864e5;
    const start = Date.UTC(2019, 0, 7);
    const now = /* @__PURE__ */ new Date();
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const cutover = Date.UTC(2026, 0, 5);
    const doy = (d) => Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY2);
    const observations = [];
    for (const [site, mod] of Object.entries(DEMO_SITES)) {
      for (let t = start; t <= end; t += DAY2) {
        const d = new Date(t), k = doy(d);
        const retro = t < cutover;
        if (retro && rnd() < 0.2) continue;
        let status = 1, validHours = 24, reason = null, pendingRead = false;
        if (!retro) {
          const r = rnd();
          if (r < 0.03) {
            status = 3;
            validHours = 0;
            reason = 1 + Math.floor(rnd() * 4);
          } else if (r < 0.045) {
            status = 3;
            validHours = 0;
            reason = 5;
            pendingRead = true;
          }
        }
        const raw = {}, counts = {};
        if (status !== 3) {
          for (const [code, , , cat, peak, spread, amp] of DEMO_TAXA) {
            let dist = Math.abs(k - peak);
            dist = Math.min(dist, 365 - dist);
            let v = amp * Math.exp(-(dist * dist) / (2 * spread * spread)) * mod[cat - 1];
            v *= 0.45 + 1.35 * rnd();
            if (rnd() < 0.1) v *= 2.3;
            v *= 1 + 0.035 * (d.getUTCFullYear() - 2019);
            const rc = Math.round(v);
            if (rc > 0) {
              raw[code] = rc;
              counts[code] = rc * FACTOR;
            }
          }
        }
        observations.push({
          site,
          date: new Date(t).toISOString().slice(0, 10),
          dataset: retro ? "retrospective" : "prospective",
          datasetLabel: retro ? "Retrospective archive" : "Prospective",
          status,
          validHours,
          reason,
          reasonLabel: reason ? REASONS[reason] : null,
          pendingRead,
          methodVersion: `${retro ? "retrospective archive" : "prospective grid"}, converted count = raw x ${FACTOR}`,
          conversionFactor: FACTOR,
          raw,
          counts
        });
      }
    }
    return {
      source: "demo",
      schema: "mixed",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      conversionFactor: FACTOR,
      conversionFactorsInUse: [FACTOR],
      conversionBasis: `All values are converted counts, derived as raw count x ${FACTOR}.`,
      provisional: true,
      provisionalReason: "Demonstration data. Neither project records measured flow rate or valid sampling hours, so the conversion factor is a network convention rather than a measured value.",
      datasets: [
        { dataset: "prospective", label: "Prospective", schema: "grid", completenessKnown: true },
        { dataset: "retrospective", label: "Retrospective archive", schema: "retrospective", completenessKnown: false }
      ],
      sites: Object.keys(DEMO_SITES).sort(),
      taxa: DEMO_TAXA.map(([code, sci, common, category]) => ({ code, sci, common, category })),
      observations
    };
  }

  // public/assets/charts.js
  var SANS = "Inter, Helvetica Neue, Arial, sans-serif";
  var MONO = "IBM Plex Mono, ui-monospace, Menlo, monospace";
  var DAY = 864e5;
  var CAT = {
    1: { n: "Tree pollen", c: "var(--series-1)", k: 1 },
    2: { n: "Grass pollen", c: "var(--series-2)", k: 2 },
    3: { n: "Weed pollen", c: "var(--series-3)", k: 3 },
    4: { n: "Fungal spore", c: "var(--series-4)", k: 4 },
    5: { n: "Other", c: "var(--series-5)", k: 5 },
    9: { n: "Unidentified", c: "var(--series-9)", k: 9 }
  };
  var STACK = [4, 3, 2, 1];
  function catsFor(key) {
    if (key === "all") return STACK;
    if (key === "pollen") return [3, 2, 1];
    const n = Number(key);
    return CAT[n] ? [n] : STACK;
  }
  var SEQ = [
    "var(--seq-100)",
    "var(--seq-200)",
    "var(--seq-300)",
    "var(--seq-400)",
    "var(--seq-500)",
    "var(--seq-600)",
    "var(--seq-700)"
  ];
  var TAPE_SEQ = [
    "var(--tape-1)",
    "var(--tape-2)",
    "var(--tape-3)",
    "var(--tape-4)",
    "var(--tape-5)",
    "var(--tape-6)",
    "var(--tape-7)"
  ];
  var fmt = (n, dp = 0) => n === null || n === void 0 || Number.isNaN(n) ? "\u2014" : Math.abs(n) >= 1e4 ? Math.round(n).toLocaleString("en-ZA") : Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-ZA") : n.toFixed(dp);
  var esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  var tt = (heading, rows = []) => esc([heading, ...rows.map((r) => r.join("\u2237"))].join("\xA6"));
  function catTotal(day, key, T) {
    var _a, _b;
    if (day.status === 3) return null;
    let s = 0;
    for (const code in day.counts) {
      const cat = (_b = (_a = T.get(+code)) == null ? void 0 : _a.category) != null ? _b : Math.floor(+code / 1e3);
      if (key === "all") s += day.counts[code];
      else if (key === "pollen") {
        if (cat !== 4 && cat !== 5) s += day.counts[code];
      } else if (cat === +key) s += day.counts[code];
    }
    return s;
  }
  function byCat(day, T) {
    var _a, _b;
    if (day.status === 3) return null;
    const o = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const code in day.counts) {
      const cat = (_b = (_a = T.get(+code)) == null ? void 0 : _a.category) != null ? _b : Math.floor(+code / 1e3);
      if (o[cat] !== void 0) o[cat] += day.counts[code];
    }
    return o;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }
  function yAxis(max, h, pad, W, ticks = 4) {
    let s = "";
    for (let g = 0; g <= ticks; g++) {
      const y = pad.t + (h - pad.t - pad.b) * g / ticks;
      const v = max * (1 - g / ticks);
      s += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--rule)" stroke-width="1"${g === ticks ? "" : ' stroke-dasharray="2 3"'}/><text x="${pad.l - 8}" y="${y + 3.5}" text-anchor="end" font-family="${MONO}" font-size="10" fill="var(--ink-3)">${fmt(v)}</text>`;
    }
    return s;
  }
  function tape(days, key, T) {
    const W = 1e3, H = 88, n = days.length;
    if (!n) return "";
    const w = W / n;
    const th = BANDS[key] || BANDS.pollen;
    const step = (v) => v < th[0] * 0.34 ? 0 : v < th[0] * 0.67 ? 1 : v < th[0] ? 2 : v < th[1] ? 3 : v < (th[1] + th[2]) / 2 ? 4 : v < th[2] ? 5 : 6;
    let s = `<defs><pattern id="lost" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="8" height="8" fill="#2a0d08"/><rect width="3" height="8" fill="var(--critical)"/></pattern></defs>`;
    days.forEach((d, i) => {
      const x = i * w;
      if (d.status === 3) {
        s += `<rect x="${x}" y="0" width="${w}" height="${H}" fill="url(#lost)" data-tt="${tt(d.date, [["No valid sample", "var(--critical)", d.reasonLabel || "reason not recorded"]])}"/>`;
      } else {
        const v = catTotal(d, key, T);
        const idx = step(v);
        s += `<rect x="${x}" y="0" width="${w}" height="${H}" fill="${TAPE_SEQ[idx]}" data-tt="${tt(d.date, [["Load", TAPE_SEQ[idx], fmt(v) + " /m\xB3"]])}"/>`;
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
  function tapeScale(key = "pollen") {
    const th = BANDS[key] || BANDS.pollen;
    return `<span>Load</span>` + TAPE_SEQ.map((c) => `<i style="background:${c};border-radius:2px;width:22px"></i>`).join("") + `<span class="muted">0 to ${fmt(th[2])}+ /m\xB3 &middot; fixed scale, comparable between views</span>`;
  }
  function stackedBars(days, T, key = "all", h = 230) {
    const cats = catsFor(key);
    const W = 1e3, pad = { l: 46, r: 8, t: 10, b: 28 }, n = days.length;
    if (!n) return "";
    const bw = (W - pad.l - pad.r) / n;
    const totals = days.map((d) => {
      const c = byCat(d, T);
      return c ? cats.reduce((a, k) => a + c[k], 0) : 0;
    });
    const max = niceMax(Math.max(1, ...totals));
    const sc = (v) => (h - pad.t - pad.b) * v / max;
    let s = yAxis(max, h, pad, W);
    days.forEach((d, i) => {
      const x = pad.l + i * bw, c = byCat(d, T);
      const bar = Math.max(2, bw - 3);
      if (!c) {
        s += `<rect x="${x + 1.5}" y="${pad.t}" width="${bar}" height="${h - pad.t - pad.b}" rx="3"
        fill="var(--critical)" opacity=".10" data-tt="${tt(d.date, [["No valid sample", "var(--critical)", d.reasonLabel || "\u2014"]])}"/>`;
        return;
      }
      const total = cats.reduce((a, k) => a + c[k], 0);
      let y = h - pad.b;
      const rows = [];
      cats.forEach((k, si) => {
        const hh = sc(c[k]);
        if (hh <= 0) return;
        y -= hh;
        const isTop = cats.slice(si + 1).every((kk) => c[kk] <= 0);
        const gap = si === 0 ? 0 : 2;
        s += `<rect x="${x + 1.5}" y="${y}" width="${bar}" height="${Math.max(0.5, hh - gap)}"
        ${isTop ? 'rx="4"' : ""} fill="${CAT[k].c}"/>`;
        rows.unshift([CAT[k].n, CAT[k].c, fmt(c[k]) + " /m\xB3"]);
      });
      rows.push(["Total", "transparent", fmt(total) + " /m\xB3"]);
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
  function lineByCat(days, T, key = "all", smooth = 3, h = 250) {
    const cats = catsFor(key);
    const W = 1e3, pad = { l: 50, r: 64, t: 12, b: 28 }, n = days.length;
    if (!n) return "";
    const series = {};
    cats.forEach((k) => series[k] = days.map((d) => {
      const c = byCat(d, T);
      return c ? c[k] : null;
    }));
    const roll = (a) => a.map((_, i) => {
      const w = a.slice(Math.max(0, i - smooth + 1), i + 1).filter((v) => v !== null);
      return w.length ? w.reduce((x, y) => x + y, 0) / w.length : null;
    });
    let peak = 0;
    cats.forEach((k) => {
      series[k] = roll(series[k]);
      series[k].forEach((v) => {
        if (v !== null && v > peak) peak = v;
      });
    });
    const max = niceMax(Math.max(1, peak));
    const X = (i) => pad.l + (W - pad.l - pad.r) * i / Math.max(1, n - 1);
    const Y = (v) => h - pad.b - (h - pad.t - pad.b) * v / max;
    let s = yAxis(max, h, pad, W);
    cats.forEach((k) => {
      let d = "", open = false;
      series[k].forEach((v, i) => {
        if (v === null) {
          open = false;
          return;
        }
        d += (open ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1) + " ";
        open = true;
      });
      s += `<path d="${d}" fill="none" stroke="${CAT[k].c}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>`;
      for (let i = series[k].length - 1; i >= 0; i--) {
        if (series[k][i] !== null) {
          s += `<text x="${X(i) + 7}" y="${Y(series[k][i]) + 3.5}" font-family="${SANS}" font-size="10.5"
          font-weight="600" fill="${CAT[k].c}">${CAT[k].n.split(" ")[0]}</text>`;
          break;
        }
      }
    });
    s += `<line class="xhair" x1="0" y1="${pad.t}" x2="0" y2="${h - pad.b}" stroke="var(--ink-3)"
    stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
    const bw = (W - pad.l - pad.r) / Math.max(1, n - 1);
    days.forEach((d, i) => {
      const rows = cats.filter((k) => series[k][i] !== null).map((k) => [CAT[k].n, CAT[k].c, fmt(series[k][i], series[k][i] < 10 ? 1 : 0) + " /m\xB3"]);
      if (d.status === 3) rows.push(["No valid sample", "var(--critical)", d.reasonLabel || "\u2014"]);
      s += `<rect x="${X(i) - bw / 2}" y="${pad.t}" width="${Math.max(2, bw)}" height="${h - pad.t - pad.b}"
      fill="transparent" data-x="${X(i).toFixed(1)}" data-tt="${tt(d.date + (smooth > 1 ? ` \xB7 ${smooth}-day mean` : ""), rows)}"/>`;
    });
    const step = Math.max(1, Math.round(n / 10));
    days.forEach((d, i) => {
      if (i % step) return;
      s += `<text x="${X(i)}" y="${h - 9}" text-anchor="middle" font-family="${MONO}" font-size="10"
      fill="var(--ink-3)">${d.date.slice(5)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${h}" class="hoverable xh">${s}</svg>`;
  }
  function longSeries(days, T, key = "all", h = 280) {
    const cats = catsFor(key);
    const W = 1e3, pad = { l: 52, r: 10, t: 14, b: 42 };
    if (!days.length) return "";
    const buckets = /* @__PURE__ */ new Map();
    for (const d of days) {
      const key2 = d.date.slice(0, 7);
      const b = buckets.get(key2) || { key: key2, sum: { 1: 0, 2: 0, 3: 0, 4: 0 }, valid: 0, lost: 0, datasets: /* @__PURE__ */ new Set() };
      const c = byCat(d, T);
      if (c) {
        cats.forEach((k) => b.sum[k] += c[k]);
        b.valid++;
      } else b.lost++;
      b.datasets.add(d.datasetLabel || "");
      buckets.set(key2, b);
    }
    const months = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
    const mean = (b) => {
      const o = {};
      cats.forEach((k) => o[k] = b.valid ? b.sum[k] / b.valid : 0);
      return o;
    };
    const totals = months.map((b) => {
      const m = mean(b);
      return cats.reduce((a, k) => a + m[k], 0);
    });
    const max = niceMax(Math.max(1, ...totals));
    const n = months.length;
    const X = (i) => pad.l + (W - pad.l - pad.r) * i / Math.max(1, n - 1);
    const Y = (v) => h - pad.b - (h - pad.t - pad.b) * v / max;
    let s = yAxis(max, h, pad, W);
    const cum = months.map(() => 0);
    cats.forEach((k) => {
      const lower = cum.slice();
      months.forEach((b, i) => cum[i] += mean(b)[k]);
      let top = "", bot = "";
      months.forEach((b, i) => {
        top += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(cum[i]).toFixed(1) + " ";
      });
      for (let i = n - 1; i >= 0; i--) bot += "L" + X(i).toFixed(1) + " " + Y(lower[i]).toFixed(1) + " ";
      s += `<path d="${top}${bot}Z" fill="${CAT[k].c}" opacity=".88"/><path d="${top}" fill="none" stroke="var(--surface-1)" stroke-width="1.5" opacity=".55"/>`;
    });
    const seenYear = /* @__PURE__ */ new Set();
    months.forEach((b, i) => {
      const y = b.key.slice(0, 4);
      if (seenYear.has(y)) return;
      seenYear.add(y);
      s += `<line x1="${X(i)}" y1="${pad.t}" x2="${X(i)}" y2="${h - pad.b}" stroke="var(--rule-strong)" stroke-width="1" opacity=".55"/><text x="${X(i) + 4}" y="${h - 26}" font-family="${MONO}" font-size="10.5" fill="var(--ink-2)" font-weight="500">${y}</text>`;
    });
    const bw = (W - pad.l - pad.r) / Math.max(1, n - 1);
    months.forEach((b, i) => {
      const m = mean(b);
      const rows = cats.map((k) => [CAT[k].n, CAT[k].c, fmt(m[k], m[k] < 10 ? 1 : 0)]).reverse();
      rows.push(["Valid days", "transparent", `${b.valid}${b.lost ? ` (+${b.lost} lost)` : ""}`]);
      s += `<rect x="${X(i) - bw / 2}" y="${pad.t}" width="${Math.max(2, bw)}" height="${h - pad.t - pad.b}"
      fill="transparent" data-x="${X(i).toFixed(1)}" data-tt="${tt(b.key + " \xB7 monthly mean /m\xB3", rows)}"/>`;
    });
    s += `<line class="xhair" x1="0" y1="${pad.t}" x2="0" y2="${h - pad.b}" stroke="var(--ink-3)"
    stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
    return `<svg viewBox="0 0 ${W} ${h}" class="hoverable xh">${s}</svg>`;
  }
  function seasonalOverlay(days, key, T, h = 300) {
    const W = 660, pad = { l: 44, r: 12, t: 12, b: 26 };
    if (!days.length) return { svg: "", legend: "" };
    const years = /* @__PURE__ */ new Map();
    for (const d of days) {
      const y = d.date.slice(0, 4);
      const doy = Math.floor((Date.parse(d.date + "T00:00:00Z") - Date.UTC(+y, 0, 0)) / DAY);
      const v = catTotal(d, key, T);
      if (v === null) continue;
      if (!years.has(y)) years.set(y, new Array(367).fill(null));
      years.get(y)[doy] = v;
    }
    const yrs = [...years.keys()].sort();
    if (!yrs.length) return { svg: "", legend: "" };
    const smooth = (arr) => arr.map((_, i) => {
      const w = arr.slice(Math.max(0, i - 7), i + 8).filter((v) => v !== null);
      return w.length >= 3 ? w.reduce((a, b) => a + b, 0) / w.length : null;
    });
    const curves = yrs.map((y) => ({ y, v: smooth(years.get(y)) }));
    const colAt = (i) => {
      const n = curves.length;
      if (i === n - 1) return "var(--series-1)";
      const step = 1 + Math.round(i / Math.max(1, n - 2) * 3);
      return `var(--seq-${step * 100})`;
    };
    let peak = 0;
    curves.forEach((c) => c.v.forEach((v) => {
      if (v !== null && v > peak) peak = v;
    }));
    const max = niceMax(Math.max(1, peak));
    const X = (d) => pad.l + (W - pad.l - pad.r) * (d - 1) / 365;
    const Y = (v) => h - pad.b - (h - pad.t - pad.b) * v / max;
    let s = "";
    for (let g = 0; g <= 4; g++) {
      const y = pad.t + (h - pad.t - pad.b) * g / 4;
      s += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--rule)" stroke-width="1"${g === 4 ? "" : ' stroke-dasharray="2 3"'}/><text x="${pad.l - 7}" y="${y + 4}" text-anchor="end" font-family="${MONO}" font-size="11" fill="var(--ink-3)">${fmt(max * (1 - g / 4))}</text>`;
    }
    curves.forEach((c, i) => {
      const latest = i === curves.length - 1;
      const col = colAt(i);
      let d = "", open = false;
      c.v.forEach((v, doy) => {
        if (v === null) {
          open = false;
          return;
        }
        d += (open ? "L" : "M") + X(doy).toFixed(1) + " " + Y(v).toFixed(1) + " ";
        open = true;
      });
      s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${latest ? 2.6 : 1.5}"
      opacity="${latest ? 1 : 0.9}" stroke-linejoin="round"/>`;
    });
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let acc = 1;
    MON.forEach((m, i) => {
      s += `<text x="${X(acc + DIM[i] / 2)}" y="${h - 8}" text-anchor="middle" font-family="${SANS}"
      font-size="11" fill="var(--ink-3)">${m[0]}</text>`;
      if (i) s += `<line x1="${X(acc)}" y1="${pad.t}" x2="${X(acc)}" y2="${h - pad.b}" stroke="var(--rule)" stroke-width="1" opacity=".5"/>`;
      acc += DIM[i];
    });
    for (let doy = 1; doy <= 365; doy += 4) {
      const rows = curves.filter((c) => c.v[doy] !== null).map((c, i) => [c.y, colAt(curves.indexOf(c)), fmt(c.v[doy], c.v[doy] < 10 ? 1 : 0)]);
      if (!rows.length) continue;
      const dt = new Date(Date.UTC(2001, 0, doy));
      s += `<rect x="${X(doy) - 2}" y="${pad.t}" width="4" height="${h - pad.t - pad.b}" fill="transparent"
      data-x="${X(doy).toFixed(1)}" data-tt="${tt(`${MON[dt.getUTCMonth()]} ${dt.getUTCDate()} \xB7 15-day mean /m\xB3`, rows)}"/>`;
    }
    s += `<line class="xhair" x1="0" y1="${pad.t}" x2="0" y2="${h - pad.b}" stroke="var(--ink-3)"
    stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
    const legendHtml = `<div class="legend">` + curves.map(
      (c, i) => `<span><i class="ln" style="background:${colAt(i)};height:${i === curves.length - 1 ? 3 : 2}px"></i>${c.y}</span>`
    ).join("") + `</div>`;
    return { svg: `<svg viewBox="0 0 ${W} ${h}" class="hoverable xh">${s}</svg>`, legend: legendHtml };
  }
  function calendarYears(days, key, T) {
    if (!days.length) return "";
    const byYear = /* @__PURE__ */ new Map();
    for (const d of days) {
      const y = d.date.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(d);
    }
    const yrs = [...byYear.keys()].sort();
    const vals = days.map((d) => catTotal(d, key, T)).filter((v) => v !== null).sort((a, b) => a - b);
    const p = (q) => vals.length ? vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] : 1;
    const stops = [p(0.15), p(0.35), p(0.55), p(0.72), p(0.86), p(0.95)];
    const bucket = (v) => {
      let i = 0;
      while (i < stops.length && v > stops[i]) i++;
      return i;
    };
    const W = 1e3, rowH = 17, labW = 40, h = yrs.length * rowH + 26;
    const cw = (W - labW) / 366;
    let s = "";
    yrs.forEach((y, r) => {
      const top = r * rowH;
      s += `<text x="0" y="${top + 12}" font-family="${MONO}" font-size="10.5" fill="var(--ink-2)">${y}</text>`;
      s += `<rect x="${labW}" y="${top + 2}" width="${366 * cw}" height="${rowH - 5}" rx="2"
      fill="var(--surface-2)" stroke="var(--rule)" stroke-width=".75"/>`;
      const seen = /* @__PURE__ */ new Set();
      for (const d of byYear.get(y)) {
        const doy = Math.floor((Date.parse(d.date + "T00:00:00Z") - Date.UTC(+y, 0, 0)) / DAY);
        seen.add(doy);
        const v = catTotal(d, key, T);
        const x = labW + (doy - 1) * cw;
        if (v === null) {
          s += `<rect x="${x}" y="${top + 2}" width="${Math.max(1, cw - 0.4)}" height="${rowH - 5}" rx="1.5"
          fill="var(--critical)" opacity=".45" data-tt="${tt(d.date, [["No valid sample", "var(--critical)", d.reasonLabel || "\u2014"]])}"/>`;
        } else {
          s += `<rect x="${x}" y="${top + 2}" width="${Math.max(1, cw - 0.4)}" height="${rowH - 5}" rx="1.5"
          fill="${SEQ[bucket(v)]}" data-tt="${tt(d.date, [["Load", SEQ[bucket(v)], fmt(v) + " /m\xB3"], ["Dataset", "transparent", d.datasetLabel || "\u2014"]])}"/>`;
        }
      }
    });
    const MON = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    let acc = 1;
    MON.forEach((m, i) => {
      const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i];
      s += `<text x="${labW + (acc + dim / 2 - 1) * cw}" y="${yrs.length * rowH + 14}" text-anchor="middle"
      font-family="${SANS}" font-size="10" fill="var(--ink-3)">${m}</text>`;
      acc += dim;
    });
    return `<svg viewBox="0 0 ${W} ${h}" class="hoverable">${s}</svg>`;
  }
  function sparkline(values, color, w = 90, h = 20) {
    const vals = values.filter((v) => v !== null && v !== void 0);
    if (!vals.length) return "";
    const max = Math.max(1, ...vals);
    const n = values.length;
    let d = "", open = false;
    values.forEach((v, i) => {
      if (v === null || v === void 0) {
        open = false;
        return;
      }
      const x = (w * i / Math.max(1, n - 1)).toFixed(1);
      const y = (h - 2 - (h - 4) * v / max).toFixed(1);
      d += (open ? "L" : "M") + x + " " + y + " ";
      open = true;
    });
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }
  function taxonTable(days, T, key = "all", limit = 10, unit = "mean /m\xB3", spark = true) {
    const cats = new Set(catsFor(key));
    const valid = days.filter((d) => d.status !== 3);
    const agg = {};
    valid.forEach((d) => {
      var _a, _b;
      for (const c in d.counts) {
        const cat = (_b = (_a = T.get(+c)) == null ? void 0 : _a.category) != null ? _b : Math.floor(+c / 1e3);
        if (!cats.has(cat)) continue;
        agg[c] = (agg[c] || 0) + d.counts[c];
      }
    });
    const rows = Object.entries(agg).map(([c, sum]) => ({ c: +c, sum, mean: sum / Math.max(1, valid.length) })).sort((a, b) => b.sum - a.sum).slice(0, limit);
    if (!rows.length) return `<p class="hint">No observations in this period.</p>`;
    const total = Object.values(agg).reduce((a, b) => a + b, 0) || 1;
    return `<table><thead><tr><th>Taxon</th><th style="text-align:right">${unit}</th>
    <th style="text-align:right">peak</th>${spark ? "<th>shape</th>" : ""}<th style="width:22%">share</th></tr></thead><tbody>` + rows.map((r) => {
      const t = T.get(r.c) || { sci: String(r.c), common: "", category: Math.floor(r.c / 1e3) };
      const col = (CAT[t.category] || CAT[9]).c;
      let pk = 0, pd = "\u2014";
      valid.forEach((d) => {
        if ((d.counts[r.c] || 0) > pk) {
          pk = d.counts[r.c];
          pd = d.date;
        }
      });
      const series = spark ? valid.map((d) => d.counts[r.c] || 0) : null;
      return `<tr><td><span class="chip" style="background:${col}"></span><span class="sci">${esc(t.sci)}</span>${t.common ? ` <span class="muted">${esc(t.common)}</span>` : ""}</td>
        <td class="n">${fmt(r.mean, r.mean < 10 ? 1 : 0)}</td>
        <td class="n">${fmt(pk)}<br><span class="muted" style="font-size:10.5px">${pd.slice(0, 10)}</span></td>
        ${spark ? `<td>${sparkline(series, col)}</td>` : ""}
        <td><div class="meter"><i style="width:${(100 * r.sum / total).toFixed(1)}%;background:${col}"></i></div>
          <span class="muted" style="font-size:10.5px">${(100 * r.sum / total).toFixed(1)}%</span></td></tr>`;
    }).join("") + `</tbody></table>`;
  }
  function seasonTable(days, T, key = "all", limit = 12) {
    const cats = new Set(catsFor(key));
    const valid = days.filter((d) => d.status !== 3);
    const agg = {};
    valid.forEach((d) => {
      var _a, _b;
      for (const c in d.counts) {
        const cat = (_b = (_a = T.get(+c)) == null ? void 0 : _a.category) != null ? _b : Math.floor(+c / 1e3);
        if (!cats.has(cat)) continue;
        agg[c] = (agg[c] || 0) + d.counts[c];
      }
    });
    const rows = Object.entries(agg).map(([c, sum]) => ({ c: +c, sum })).sort((a, b) => b.sum - a.sum).slice(0, limit);
    if (!rows.length) return `<p class="hint">No observations in this period.</p>`;
    return `<table><thead><tr><th>Taxon</th><th style="text-align:right">integral</th>
    <th style="text-align:right">start</th><th style="text-align:right">peak</th>
    <th style="text-align:right">end</th><th style="text-align:right">days</th></tr></thead><tbody>` + rows.map((r) => {
      let cum = 0, st = "\u2014", en = "\u2014", pk = { v: -1, date: "\u2014" };
      valid.forEach((d) => {
        const v = d.counts[r.c] || 0;
        cum += v;
        if (st === "\u2014" && cum >= 0.025 * r.sum) st = d.date;
        if (cum <= 0.975 * r.sum) en = d.date;
        if (v > pk.v) pk = { v, date: d.date };
      });
      const dur = st !== "\u2014" && en !== "\u2014" ? Math.round((Date.parse(en) - Date.parse(st)) / DAY) + 1 : "\u2014";
      const t = T.get(r.c) || { sci: String(r.c), category: Math.floor(r.c / 1e3) };
      return `<tr><td><span class="chip" style="background:${(CAT[t.category] || CAT[9]).c}"></span>
        <span class="sci">${esc(t.sci)}</span></td>
        <td class="n">${fmt(r.sum)}</td><td class="n">${st.slice(5)}</td>
        <td class="n">${pk.date.slice(5)}</td><td class="n">${en.slice(5)}</td><td class="n">${dur}</td></tr>`;
    }).join("") + `</tbody></table>`;
  }
  function ledger(days) {
    return `<div class="ledger">` + days.map((d) => {
      const col = d.status === 3 ? d.pendingRead ? "var(--warning)" : "var(--critical)" : "var(--good)";
      const txt = d.status === 3 ? `${d.pendingRead ? "Awaiting slide read" : "No valid sample"}${d.reasonLabel ? ` \u2014 ${esc(d.reasonLabel)}` : ""}` : d.status === 2 ? `Partial, ${d.validHours} valid hours` : "Complete, 24 h";
      return `<div><span class="dot" style="background:${col}"></span><span class="dt">${d.date.slice(5)}</span><span>${txt}</span></div>`;
    }).join("") + `</div>`;
  }
  function legend(keys = STACK.slice().reverse(), line = false) {
    if (typeof keys === "string") keys = catsFor(keys).slice().reverse();
    return `<div class="legend">` + keys.map((k) => `<span><i class="${line ? "ln" : ""}" style="background:${CAT[k].c}"></i>${CAT[k].n}</span>`).join("") + `</div>`;
  }

  // public/assets/app.js
  var DB = null;
  var state = {
    site: null,
    period: "overview",
    key: "pollen",
    dataset: "all",
    anchor: /* @__PURE__ */ new Date(),
    theme: null
  };
  var $ = (id) => document.getElementById(id);
  function applyTheme(t) {
    state.theme = t;
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    const btn = $("theme");
    if (btn) {
      const dark = t === "dark";
      btn.textContent = dark ? "\u2600" : "\u263E";
      btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    }
    try {
      if (t) localStorage.setItem("sapnet-theme", t);
      else localStorage.removeItem("sapnet-theme");
    } catch (e) {
    }
  }
  function initTooltip() {
    const tip = $("tip");
    let raf = null;
    document.addEventListener("mousemove", (e) => {
      const el = e.target.closest ? e.target.closest("[data-tt]") : null;
      if (!el) {
        tip.style.opacity = "0";
        document.querySelectorAll("svg .xhair").forEach((l) => l.setAttribute("opacity", "0"));
        return;
      }
      const parts = el.getAttribute("data-tt").split("\xA6");
      const head = parts.shift();
      tip.innerHTML = `<div class="tt-h">${head}</div>` + parts.map((p) => {
        const [label, color, value] = p.split("\u2237");
        return `<div class="tt-r"><span class="tt-l">${color && color !== "transparent" ? `<i style="background:${color}"></i>` : '<i style="background:transparent"></i>'}${label}</span><b>${value != null ? value : ""}</b></div>`;
      }).join("");
      tip.style.opacity = "1";
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = tip.getBoundingClientRect();
        let x = e.clientX + 14, y = e.clientY + 14;
        if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
        if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
        tip.style.left = Math.max(8, x) + "px";
        tip.style.top = Math.max(8, y) + "px";
      });
      const svg = el.closest("svg.xh");
      if (svg) {
        const line = svg.querySelector(".xhair");
        const dx = el.getAttribute("data-x");
        if (line && dx) {
          line.setAttribute("x1", dx);
          line.setAttribute("x2", dx);
          line.setAttribute("opacity", "1");
        }
      }
    }, { passive: true });
    document.addEventListener("mouseleave", () => {
      tip.style.opacity = "0";
    }, true);
    document.addEventListener("scroll", () => {
      tip.style.opacity = "0";
    }, { passive: true });
  }
  function allDays() {
    let a = DB.bySite.get(state.site) || [];
    if (state.dataset !== "all") a = a.filter((d) => (d.dataset || "primary") === state.dataset);
    return a;
  }
  function windowDays() {
    const a = state.anchor, y = a.getUTCFullYear(), all = allDays();
    let from, to, label;
    if (state.period === "overview") {
      if (!all.length) return { from: a, to: a, label: "Full record", days: [] };
      from = new Date(all[0].ts);
      to = new Date(all[all.length - 1].ts);
      label = `${all[0].date.slice(0, 4)} \u2013 ${all[all.length - 1].date.slice(0, 4)}`;
      return { from, to, label, days: all };
    }
    if (state.period === "week") {
      const dow = (a.getUTCDay() + 6) % 7;
      from = new Date(Date.UTC(y, a.getUTCMonth(), a.getUTCDate() - dow));
      to = new Date(from.getTime() + 6 * DAY);
      label = `${from.toUTCString().slice(5, 11)} \u2013 ${to.toUTCString().slice(5, 16)}`;
    } else if (state.period === "month") {
      from = new Date(Date.UTC(y, a.getUTCMonth(), 1));
      to = new Date(Date.UTC(y, a.getUTCMonth() + 1, 0));
      label = from.toLocaleString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
    } else if (state.period === "quarter") {
      const q = Math.floor(a.getUTCMonth() / 3);
      from = new Date(Date.UTC(y, q * 3, 1));
      to = new Date(Date.UTC(y, q * 3 + 3, 0));
      label = `Q${q + 1} ${y}`;
    } else {
      from = new Date(Date.UTC(y, 0, 1));
      to = new Date(Date.UTC(y, 11, 31));
      label = String(y);
    }
    return { from, to, label, days: all.filter((d) => d.ts >= from.getTime() && d.ts <= to.getTime()) };
  }
  function span(site) {
    const arrs = site ? [DB.bySite.get(site) || []] : [...DB.bySite.values()];
    let lo = null, hi = null;
    for (const arr of arrs) for (const o of arr) {
      if (state.dataset !== "all" && (o.dataset || "primary") !== state.dataset) continue;
      if (lo === null || o.ts < lo) lo = o.ts;
      if (hi === null || o.ts > hi) hi = o.ts;
    }
    return { lo, hi };
  }
  function completenessKnownFor(days) {
    const unknown = new Set((DB.datasets || []).filter((d) => d.completenessKnown === false).map((d) => d.dataset));
    return !days.length || !days.every((d) => unknown.has(d.dataset));
  }
  function tiles(days, key) {
    const T = DB.taxaByCode;
    const valid = days.filter((d) => d.status !== 3);
    const vals = valid.map((d) => catTotal(d, key, T));
    const mean = vals.reduce((a, b2) => a + b2, 0) / Math.max(1, vals.length);
    const peak = vals.length ? Math.max(...vals) : 0;
    const peakDay = valid[vals.indexOf(peak)];
    const hi = vals.filter((v) => bandOf(v, key) >= 2).length;
    const spMean = valid.map((d) => catTotal(d, "4", T)).reduce((a, b2) => a + b2, 0) / Math.max(1, valid.length);
    const comp = 100 * valid.length / Math.max(1, days.length);
    const pending = days.filter((d) => d.pendingRead).length;
    const known = completenessKnownFor(days);
    const b = bandOf(mean, key), pb = bandOf(peak, key);
    $("tiles").innerHTML = `
    <div class="tile"><div class="k">Mean daily load</div><div class="v">${fmt(mean)}</div>
      <div class="u"><span class="pill b${b}">${BANDNAME[b]}</span> particles/m\xB3</div></div>
    <div class="tile"><div class="k">Peak day</div><div class="v">${fmt(peak)}</div>
      <div class="u">${peakDay ? peakDay.date : "\u2014"} <span class="pill b${pb}">${BANDNAME[pb]}</span></div></div>
    <div class="tile"><div class="k">Days high or above</div><div class="v">${hi}</div>
      <div class="u">of ${valid.length.toLocaleString("en-ZA")} valid days</div></div>
    <div class="tile"><div class="k">Mean fungal spores</div><div class="v">${fmt(spMean)}</div>
      <div class="u">spores/m\xB3</div></div>
    ${known ? `<div class="tile${comp < 90 ? " alert" : ""}"><div class="k">Data completeness</div>
          <div class="v">${comp.toFixed(0)}%</div>
          <div class="u">${days.length - valid.length} lost${pending ? ` \xB7 ${pending} awaiting read` : ""}</div></div>` : `<div class="tile"><div class="k">Data completeness</div>
          <div class="v sm">not recorded</div>
          <div class="u">${days.length.toLocaleString("en-ZA")} days held in the archive</div></div>`}`;
  }
  function siteCompare(from, to, key) {
    const T = DB.taxaByCode;
    const rows = DB.sites.map((s) => {
      let all = (DB.bySite.get(s) || []).filter((x) => x.ts >= from.getTime() && x.ts <= to.getTime());
      if (state.dataset !== "all") all = all.filter((x) => (x.dataset || "primary") === state.dataset);
      const valid = all.filter((x) => x.status !== 3);
      return {
        s,
        m: valid.reduce((a, b) => a + catTotal(b, key, T), 0) / Math.max(1, valid.length),
        comp: 100 * valid.length / Math.max(1, all.length),
        n: all.length
      };
    }).filter((r) => r.n).sort((a, b) => b.m - a.m);
    if (!rows.length) return `<p class="hint">No sites with data in this period.</p>`;
    const max = Math.max(1, ...rows.map((r) => r.m));
    return `<table><thead><tr><th>Site</th><th style="text-align:right">mean /m\xB3</th>
    <th style="width:38%"></th><th style="text-align:right">complete</th></tr></thead><tbody>` + rows.map((r) => `<tr${r.s === state.site ? ' style="font-weight:600"' : ""}><td>${r.s}</td>
      <td class="n">${fmt(r.m)}</td>
      <td><div class="meter"><i style="width:${(100 * r.m / max).toFixed(1)}%;background:${r.s === state.site ? "var(--seq-500)" : "var(--rule-strong)"}"></i></div></td>
      <td class="n" style="color:${r.comp < 90 ? "var(--critical)" : "var(--ink-3)"}">${r.comp.toFixed(0)}%</td></tr>`).join("") + `</tbody></table>`;
  }
  function bandBreakdown(days, key) {
    const T = DB.taxaByCode;
    const valid = days.filter((d) => d.status !== 3);
    const c = [0, 0, 0, 0];
    valid.forEach((d) => c[bandOf(catTotal(d, key, T), key)]++);
    const tot = Math.max(1, valid.length);
    return `<table><tbody>` + c.map((n, i) => `<tr><td><span class="pill b${i}">${BANDNAME[i]}</span></td><td class="n">${n} d</td>
     <td><div class="meter"><i style="width:${(100 * n / tot).toFixed(1)}%;background:${["var(--good)", "var(--warning)", "var(--serious)", "var(--critical)"][i]}"></i></div></td>
     <td class="n">${(100 * n / tot).toFixed(0)}%</td></tr>`).join("") + `</tbody></table>`;
  }
  function yearTable() {
    const T = DB.taxaByCode;
    const all = allDays();
    const years = [...new Set(all.map((d) => d.date.slice(0, 4)))].sort();
    if (!years.length) return "";
    const rows = years.map((y) => {
      const d = all.filter((x) => x.date.startsWith(y));
      const valid = d.filter((x) => x.status !== 3);
      return {
        y,
        sum: valid.reduce((a, b) => a + catTotal(b, state.key, T), 0),
        mean: valid.reduce((a, b) => a + catTotal(b, state.key, T), 0) / Math.max(1, valid.length),
        comp: 100 * valid.length / Math.max(1, d.length),
        n: d.length,
        ds: [...new Set(d.map((x) => x.datasetLabel))].join(", ")
      };
    });
    const max = Math.max(1, ...rows.map((r) => r.sum));
    return `<table><thead><tr><th>Year</th><th style="text-align:right">integral</th><th style="width:26%"></th>
    <th style="text-align:right">mean</th><th style="text-align:right">days held</th>
    <th style="text-align:right">of year</th></tr></thead><tbody>` + rows.map((r) => {
      const yearDays = +r.y % 4 === 0 ? 366 : 365;
      const thisYear = r.y === String((/* @__PURE__ */ new Date()).getUTCFullYear());
      const elapsed = thisYear ? Math.ceil((Date.now() - Date.UTC(+r.y, 0, 1)) / 864e5) : yearDays;
      const cov = 100 * r.n / Math.max(1, elapsed);
      return `<tr><td>${r.y}${thisYear ? ' <span class="muted">to date</span>' : ""}</td>
      <td class="n">${fmt(r.sum)}</td>
      <td><div class="meter"><i style="width:${(100 * r.sum / max).toFixed(1)}%;background:var(--seq-500)"></i></div></td>
      <td class="n">${fmt(r.mean)}</td><td class="n">${r.n}</td>
      <td class="n" style="color:${cov < 85 ? "var(--serious)" : "var(--ink-3)"}">${cov.toFixed(0)}%</td></tr>`;
    }).join("") + `</tbody></table>`;
  }
  function joinNotice(days) {
    const el = $("joinWarn");
    const sets = [...new Set(days.map((d) => d.datasetLabel).filter(Boolean))];
    const methods = [...new Set(days.map((d) => d.methodVersion).filter(Boolean))];
    const unknown = new Set((DB.datasets || []).filter((d) => d.completenessKnown === false).map((d) => d.label));
    if (sets.length < 2 && methods.length < 2 && !sets.some((l) => unknown.has(l))) {
      el.hidden = true;
      return;
    }
    const parts = [];
    if (sets.some((l) => unknown.has(l))) {
      parts.push(`Completeness cannot be computed for ${sets.filter((l) => unknown.has(l)).map((l) => `<b>${l}</b>`).join(" and ")}: days absent from the archive are unknown rather than lost.`);
    }
    if (sets.length > 1) {
      const firstOf = (l) => days.find((d) => d.datasetLabel === l).date;
      parts.push(`This view spans ${sets.length} datasets (${sets.map((l) => `<b>${l}</b> from ${firstOf(l)}`).join(", ")}).`);
    }
    if (methods.length > 1) parts.push(`It also spans ${methods.length} counting methods.`);
    parts.push("A change in level at the join may be methodological rather than real.");
    el.innerHTML = parts.join(" ");
    el.className = "callout warn";
    el.hidden = false;
  }
  function render() {
    const T = DB.taxaByCode;
    const { from, to, label, days } = windowDays();
    $("periodLbl").textContent = label;
    const j = $("jump");
    if (j) j.value = from.toISOString().slice(0, 10);
    const overview = state.period === "overview";
    $("navgroup").querySelectorAll(".step").forEach((b) => b.hidden = overview);
    joinNotice(days);
    if (!days.length) {
      $("tiles").innerHTML = "";
      $("tapewrap").hidden = true;
      const { lo, hi } = span(state.site);
      if (lo === null) {
        $("views").innerHTML = `<div class="empty"><p>No data for <b>${state.site}</b>${state.dataset !== "all" ? " in this dataset" : ""}.</p></div>`;
      } else {
        const loS = new Date(lo).toISOString().slice(0, 10), hiS = new Date(hi).toISOString().slice(0, 10);
        $("views").innerHTML = `<div class="empty">
        <p>No sampling recorded for <b>${state.site}</b> in ${label}.<br>
        Available for this site: <b>${loS}</b> to <b>${hiS}</b>.</p>
        <button class="btn" data-goto="${loS}">Go to ${loS.slice(0, 4)}</button>
        <button class="btn" data-goto="${hiS}">Go to ${hiS.slice(0, 4)}</button></div>`;
        $("views").querySelectorAll("[data-goto]").forEach((b) => b.onclick = () => {
          state.anchor = /* @__PURE__ */ new Date(b.dataset.goto + "T00:00:00Z");
          render();
        });
      }
      return;
    }
    tiles(days, state.key);
    const showTape = !overview && days.length <= 400;
    $("tapewrap").hidden = !showTape;
    if (showTape) {
      $("tapeSvg").innerHTML = tape(days, state.key, T);
      const miss = days.filter((d) => d.status === 3).length;
      const pend = days.filter((d) => d.pendingRead).length;
      $("tapeMeta").textContent = `${days.length} day segments \xB7 ${days.length - miss} valid \xB7 ${miss} lost${pend ? ` \xB7 ${pend} awaiting read` : ""}`;
      $("tapeScale").innerHTML = tapeScale(state.key);
    }
    const V = $("views");
    if (overview) {
      const yearsN = new Set(days.map((d) => d.date.slice(0, 4))).size;
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
        ${(() => {
        const o = seasonalOverlay(days, state.key, T);
        return o.svg + o.legend;
      })()}
      </div>
      <div class="panel">
        <header><div><h3>Year by year</h3>
          <p class="hint">Annual integral for the selected load, with the project each year came from.</p></div></header>
        ${yearTable()}
      </div>
    </div>

    <div class="panel">
      <header><div><h3>Every day, ${yearsN} years</h3>
        <p class="hint">One cell per day. Grey is a day with no record at all, red a day recorded as lost \u2014
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
        ${taxonTable(days, T, state.key, 14, "mean /m\xB3")}
      </div>
      <div class="panel">
        <header><div><h3>Network, whole record</h3>
          <p class="hint">Every site over the same span, with completeness alongside each mean.</p></div></header>
        ${siteCompare(from, to, state.key)}
        <h3 style="margin:22px 0 10px;font-size:15px">Days by risk band</h3>
        ${bandBreakdown(days, state.key)}
      </div>
    </div>`;
    } else if (state.period === "week") {
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
    } else if (state.period === "month") {
      V.innerHTML = `
    <div class="panel"><header><div><h3>Daily concentration through the month</h3>
      <p class="hint">Three-day rolling mean per category. Lines break at lost days rather than bridging them.</p></div></header>
      ${lineByCat(days, T, state.key, 3)}${legend(state.key, true)}</div>
    <div class="grid g2">
      <div class="panel"><header><div><h3>Taxa this month</h3>
        <p class="hint">Monthly mean over valid days only, so an outage does not depress the average.</p></div></header>
        ${taxonTable(days, T, state.key, 12, "monthly mean /m\xB3")}</div>
      <div class="panel"><header><div><h3>Network comparison</h3>
        <p class="hint">Monthly means across all sites.</p></div></header>${siteCompare(from, to, state.key)}
        <h3 style="margin:22px 0 10px;font-size:15px">Days by risk band</h3>${bandBreakdown(days, state.key)}</div>
    </div>`;
    } else if (state.period === "quarter") {
      V.innerHTML = `
    <div class="panel"><header><div><h3>Quarter at daily resolution</h3>
      <p class="hint">Seven-day rolling mean per category \u2014 the shape of the season rather than day-to-day weather noise.</p></div></header>
      ${lineByCat(days, T, state.key, 7, 270)}${legend(state.key, true)}</div>
    <div class="grid g2">
      <div class="panel"><header><div><h3>Quarterly taxon integrals</h3>
        <p class="hint">Sum of daily concentrations, the standard measure of seasonal exposure.</p></div></header>
        ${taxonTable(days, T, state.key, 12, "quarterly mean /m\xB3")}</div>
      <div class="panel"><header><div><h3>Network comparison</h3>
        <p class="hint">Quarterly means, reporting site highlighted.</p></div></header>${siteCompare(from, to, state.key)}
        <h3 style="margin:22px 0 10px;font-size:15px">Days by risk band</h3>${bandBreakdown(days, state.key)}</div>
    </div>`;
    } else {
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
  function sourceLine() {
    const badge = $("srcBadge");
    if (DB.source === "redcap") {
      badge.className = "badge live";
      badge.textContent = DB.datasets && DB.datasets.length > 1 ? `Live REDCap \xB7 ${DB.datasets.length} projects` : `Live REDCap \xB7 ${DB.schema} schema`;
    } else if (DB.source === "file") {
      badge.className = "badge";
      badge.textContent = "Committed dataset";
    } else {
      badge.className = "badge demo";
      badge.textContent = "Demo data";
    }
    $("srcNote").textContent = DB.source === "redcap" ? `Refreshed ${new Date(DB.generatedAt).toLocaleString("en-ZA")}` : DB.source === "file" ? "Committed snapshot." : "No REDCap connection configured \u2014 showing synthetic data.";
    if (DB.liveError) {
      $("srcWarn").hidden = false;
      $("srcWarn").innerHTML = `<b>Live REDCap data could not be loaded, so this is not your data.</b> ${DB.liveError} Check <code>/api/diagnostics</code> for the reason.`;
      $("about").hidden = false;
      $("aboutToggle").setAttribute("aria-expanded", "true");
    } else {
      $("srcWarn").hidden = true;
    }
  }
  function refreshNow() {
    return __async(this, null, function* () {
      const btn = $("refresh");
      if (btn.disabled) return;
      const label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = "\u21BB Refreshing\u2026";
      try {
        const fresh = yield loadData((msg) => {
          btn.innerHTML = "\u21BB " + msg;
        }, { force: true });
        if (fresh.source === "redcap") {
          DB = fresh;
          if (!DB.sites.includes(state.site)) state.site = DB.sites[0];
          sourceLine();
          render();
          btn.innerHTML = "\u2713 Updated";
        } else {
          btn.innerHTML = "\u21BB Not updated";
          $("srcWarn").hidden = false;
          $("srcWarn").innerHTML = "<b>Refresh did not reach REDCap, so the figures below are unchanged.</b> " + (fresh.liveError ? fresh.liveError : "No live connection is configured.") + " Check <code>/api/diagnostics</code> for the reason.";
          $("about").hidden = false;
        }
      } catch (e) {
        btn.innerHTML = "\u21BB Failed";
        console.error("Refresh failed:", e);
      }
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = label;
      }, 2500);
    });
  }
  function exportCsv() {
    var _a;
    const { days, label } = windowDays();
    const T = DB.taxaByCode;
    const head = [
      "site",
      "date",
      "dataset",
      "method_version",
      "conversion_factor",
      "day_status",
      "status_reason",
      "valid_hours",
      "taxon_code",
      "scientific_name",
      "category",
      "raw_count",
      "converted_count_per_m3"
    ];
    const STATUS = { 1: "complete", 2: "partial", 3: "not_collected", 4: "invalidated" };
    const q = (v) => `"${String(v != null ? v : "").replace(/"/g, '""')}"`;
    const rows = [head.join(",")];
    for (const d of days) {
      const base = [
        d.site,
        d.date,
        q(d.datasetLabel),
        q(d.methodVersion),
        (_a = d.conversionFactor) != null ? _a : "",
        STATUS[d.status],
        q(d.reasonLabel || ""),
        d.validHours
      ];
      const codes = Object.keys(d.counts);
      if (!codes.length) {
        rows.push([...base, "", "", "", "", ""].join(","));
        continue;
      }
      for (const c of codes) {
        const t = T.get(+c) || { sci: "", category: Math.floor(+c / 1e3) };
        rows.push([
          ...base,
          c,
          q(t.sci),
          q((CAT[t.category] || CAT[9]).n),
          d.raw && d.raw[c] !== void 0 ? d.raw[c] : "",
          d.counts[c].toFixed(3)
        ].join(","));
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sapnet_${state.site.replace(/\s+/g, "-")}_${label.replace(/[^\w]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function shift(dir) {
    const a = state.anchor, y = a.getUTCFullYear(), m = a.getUTCMonth();
    if (state.period === "week") state.anchor = new Date(a.getTime() + dir * 7 * DAY);
    else if (state.period === "month") state.anchor = new Date(Date.UTC(y, m + dir, 15));
    else if (state.period === "quarter") state.anchor = new Date(Date.UTC(y, m + dir * 3, 15));
    else if (state.period === "year") state.anchor = new Date(Date.UTC(y + dir, 6, 1));
    render();
  }
  var BUILD = "2026-11-17";
  function init() {
    return __async(this, null, function* () {
      window.__sapnetStarted = Date.now();
      try {
        applyTheme(localStorage.getItem("sapnet-theme"));
      } catch (e) {
        applyTheme(null);
      }
      initTooltip();
      console.info(`SAPNET dashboard build ${BUILD}`);
      const watchdog = new Promise((resolve) => setTimeout(
        () => resolve({ __watchdog: true }),
        3e4
      ));
      DB = yield Promise.race([
        loadData((msg) => {
          const el = $("loading");
          if (el) el.innerHTML = `<span class="spin"></span>${msg}`;
        }),
        watchdog
      ]);
      if (DB && DB.__watchdog) {
        $("loading").innerHTML = `<p style="max-width:52ch;margin:0 auto;text-align:left;line-height:1.6">
         <b>Loading did not finish within 30 seconds.</b><br><br>
         Something the page requested accepted the connection and never answered.
         Open the browser console and the Network tab, reload, and look for the
         request that stays pending \u2014 that is the one to chase.<br><br>
         <code>/api/health</code> answers instantly and will say whether the REDCap
         tokens are configured at all.<br><br>
         Build ${BUILD}.
       </p>`;
        return;
      }
      state.site = DB.sites[0];
      const siteDays = DB.bySite.get(state.site) || [];
      const last = siteDays.length ? siteDays[siteDays.length - 1] : null;
      state.anchor = last ? new Date(last.ts) : /* @__PURE__ */ new Date();
      const sel = $("siteSel");
      DB.sites.forEach((s) => {
        const o = document.createElement("option");
        o.value = o.textContent = s;
        sel.append(o);
      });
      sel.value = state.site;
      const dsSel = $("dsSel");
      if (DB.datasets && DB.datasets.length > 1) {
        const all = document.createElement("option");
        all.value = "all";
        all.textContent = "All datasets";
        dsSel.append(all);
        for (const d of DB.datasets) {
          const o = document.createElement("option");
          o.value = d.dataset;
          o.textContent = d.label;
          dsSel.append(o);
        }
        $("dsField").hidden = false;
        dsSel.onchange = (e) => {
          state.dataset = e.target.value;
          render();
        };
      }
      const per = /* @__PURE__ */ new Map();
      for (const arr of DB.bySite.values()) for (const o of arr) {
        const k = o.datasetLabel || "Data";
        const e = per.get(k) || { lo: o.ts, hi: o.ts, n: 0 };
        e.lo = Math.min(e.lo, o.ts);
        e.hi = Math.max(e.hi, o.ts);
        e.n++;
        per.set(k, e);
      }
      if (per.size) {
        $("spanNote").innerHTML = "\xB7 " + [...per.entries()].map(([k, e]) => `${k} ${new Date(e.lo).toISOString().slice(0, 4)}\u2013${new Date(e.hi).toISOString().slice(0, 4)} (${e.n.toLocaleString("en-ZA")} site-days)`).join(" \xB7 ");
      }
      sourceLine();
      if (DB.conversionBasis) {
        $("basisNote").hidden = false;
        $("basisNote").textContent = DB.conversionBasis;
        $("basisNote").className = (DB.conversionFactorsInUse || []).length > 1 ? "callout warn" : "callout ok";
      }
      if (DB.provisional && DB.provisionalReason) {
        $("srcWarn").hidden = false;
        $("srcWarn").textContent = DB.provisionalReason;
      }
      const PERIODS = ["overview", "week", "month", "quarter", "year"];
      function setPeriod(p, push = true) {
        if (!PERIODS.includes(p)) p = "overview";
        state.period = p;
        document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.p === p)));
        if (push && location.hash.slice(1) !== p) location.hash = p;
        render();
      }
      document.querySelectorAll(".tab").forEach((t) => t.onclick = () => setPeriod(t.dataset.p));
      window.addEventListener("hashchange", () => setPeriod(location.hash.slice(1), false));
      sel.onchange = (e) => {
        state.site = e.target.value;
        render();
      };
      $("catSel").onchange = (e) => {
        state.key = e.target.value;
        render();
      };
      $("prev").onclick = () => shift(-1);
      $("next").onclick = () => shift(1);
      $("refresh").onclick = refreshNow;
      $("csv").onclick = exportCsv;
      $("print").onclick = () => window.print();
      $("aboutToggle").onclick = (e) => {
        const open = $("about").hidden;
        $("about").hidden = !open;
        e.currentTarget.setAttribute("aria-expanded", String(open));
      };
      $("theme").onclick = () => {
        applyTheme(state.theme === "dark" ? "light" : "dark");
        render();
      };
      const { lo, hi } = span(null);
      const jump = $("jump");
      if (lo !== null) {
        jump.min = new Date(lo).toISOString().slice(0, 10);
        jump.max = new Date(hi).toISOString().slice(0, 10);
      }
      jump.onchange = (e) => {
        if (!e.target.value) return;
        state.anchor = /* @__PURE__ */ new Date(e.target.value + "T00:00:00Z");
        if (state.period === "overview") {
          setPeriod("month");
          return;
        }
        render();
      };
      $("first").onclick = () => {
        const { lo: lo2 } = span(state.site);
        if (lo2 !== null) {
          state.anchor = new Date(lo2);
          render();
        }
      };
      $("last").onclick = () => {
        const { hi: hi2 } = span(state.site);
        if (hi2 !== null) {
          state.anchor = new Date(hi2);
          render();
        }
      };
      const stamp = document.querySelector("footer .stamp");
      if (stamp) stamp.textContent = `Build ${BUILD} \xB7 check release status before citing`;
      $("loading").remove();
      $("app").hidden = false;
      setPeriod(location.hash.slice(1) || "overview", false);
    });
  }
  init().catch((err) => {
    $("loading").innerHTML = `Could not start the dashboard.<br><br>
    <span style="color:var(--critical)">${err.message}</span>`;
    console.error(err);
  });
})();

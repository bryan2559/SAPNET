# SAPNET aerobiology dashboard

Weekly → monthly → quarterly → annual reporting of airborne pollen and fungal spore
concentrations across the SAPNET monitoring network. Static site, deployable to Netlify,
with an optional serverless function that reads live data from REDCap.

Ships with a synthetic dataset, so it renders correctly the moment you deploy it —
before any REDCap connection exists.

---

## Deploy

### Option A — drag and drop (fastest, no Git)

1. Zip this folder, or use the supplied `sapnet-dashboard.zip`.
2. Go to <https://app.netlify.com/drop> and drop it in.
3. The site is live in about thirty seconds, showing demo data.

Netlify reads `netlify.toml`, so the publish directory and function routes are already correct.

### Option B — Git (recommended for anything ongoing)

```bash
git init && git add . && git commit -m "SAPNET dashboard"
git remote add origin git@github.com:YOUR-ORG/sapnet-dashboard.git
git push -u origin main
```

Then in Netlify: **Add new site → Import an existing project**, pick the repo, and accept
the detected settings. Every push redeploys.

### Option C — CLI

```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod
```

---

## Connect it to REDCap

The dashboard reads **both** SAPNET schemas and detects which one it is talking to
from the exported field names:

| Schema | What it is | Status |
|---|---|---|
| `legacy` | The seven copied day-forms with twenty fixed slots | The prospective project today |
| `retrospective` | One record per observation, all identifying columns free text | The retrospective archive |
| `v2` | The repeating-instrument redesign | After migration |

You do not have to migrate before deploying. Point it at the live project and it works.

### Two projects on one instance

A prospective and a retrospective project are two REDCap projects, so two tokens against
the same `REDCAP_URL`. List the keys in `REDCAP_SOURCES` and give each one a token:

| Variable | Value |
|---|---|
| `REDCAP_URL` | your API endpoint, shared by both, e.g. `https://redcap.uct.ac.za/api/` |
| `REDCAP_SOURCES` | `PROSPECTIVE,RETROSPECTIVE` |
| `REDCAP_TOKEN_PROSPECTIVE` | token for the prospective project |
| `REDCAP_TOKEN_RETROSPECTIVE` | token for the retrospective project |
| `REDCAP_LABEL_PROSPECTIVE` | `Prospective` — what appears in the dataset selector |
| `REDCAP_LABEL_RETROSPECTIVE` | `Retrospective archive` |
| `REDCAP_PRIORITY_PROSPECTIVE` | `100` — wins where the two projects overlap |
| `REDCAP_PRIORITY_RETROSPECTIVE` | `50` |

Each project's schema is detected **independently**, so the legacy prospective grid and the
free-text retrospective archive work side by side. Add `REDCAP_URL_<KEY>` only if a project
lives on a different server.

### The retrospective archive needs an audit first

The archive is already long format — one record per observation — which is the shape the
dashboard wants. But every identifying column is free text with `@READONLY`, because it was
bulk-imported from spreadsheets rather than typed into REDCap. There are no choice codes,
so site and taxon names have to be resolved by matching.

**Run the audit before connecting it.** Export the archive (Data Exports → All data → JSON,
raw values), then:

```bash
npm run audit-retro -- retro-export.json
```

It prints match tiers, unresolved taxa, unrecognised site strings, genus-level matches and
same-day duplicates, with paste-ready entries for
`netlify/functions/lib/retrospective-map.json`. Anything listed as unresolved is data that
would otherwise be skipped.

Taxa resolve in this order, and the tier is recorded so it can be audited:

1. explicit entry in `taxonOverrides`
2. exact match on normalised scientific name
3. exact match on normalised common name
4. genus match — `Quercus robur` resolves to `Quercus`, **discarding infra-generic detail**
5. unresolved — counted, listed, skipped

Sites normalise by case and spacing, so `Cape Town`, `cape town` and `CPT` become one
series rather than three. Aliases for the obvious variants (`PE` → Gqeberha, `JHB` →
Johannesburg Central) ship in the map; add any others the audit reports.

### What the archive cannot tell us

Three things, all surfaced rather than assumed:

- **Whether `count` is raw or already converted.** The dictionary does not say. The default
  treats it as raw and applies `0.72`. Set `REDCAP_COUNTKIND_RETROSPECTIVE=concentration`
  if the values were already converted, or the whole archive will be out by that factor.
- **No flow rate and no proportion of slide analysed**, so no real conversion factor exists
  for this data. It is provisional by construction.
- **Which days were sampled but empty.** Days absent from the archive are unknown, not zero
  and not lost. The dashboard therefore shows **"not recorded"** instead of a completeness
  percentage for archive-only windows — a 100% there would be a fiction. The audit reports
  `calendarGapDays` so you can see how much of the span has no data at all.

One note on the dictionary itself: the `retrospective_fungal_data` instrument contains a
single descriptive field and no data fields. Fungal spore observations are read from the
pollen instrument via `new_group` / `classification`. If fungal data was meant to live in
that second instrument, it is not currently being captured anywhere.

A single-project setup still works unchanged: set `REDCAP_TOKEN` and omit `REDCAP_SOURCES`.

**Overlaps are resolved, never summed.** If the same site and date appear in both projects,
the higher-priority dataset wins and the clash is listed in `/api/diagnostics` under
`overlapExamples`. Summing them would double-count a single physical day of sampling.

**Joins are flagged.** Where one site's series switches from one project to the other, the
dashboard shows a note naming both datasets and both counting methods. A retrospective
archive counted under the fixed 0.72 and a prospective series counted under a measured
conversion factor are not the same measurement, and a step change at the join is more
likely methodological than real. Do not publish a long-term trend across that boundary
without reconciling the methods first.

**One project failing does not take down the dashboard.** If a token expires, the surviving
project still renders and the failure is reported in the diagnostics.

### Set the environment variables (single project)


In Netlify: **Site configuration → Environment variables**.

| Variable | Value |
|---|---|
| `REDCAP_URL` | your REDCap API endpoint, e.g. `https://redcap.uct.ac.za/api/` |
| `REDCAP_TOKEN` | project API token with **Export** permission only |
| `REDCAP_SCHEMA` | `auto` — or force `legacy` / `v2` |
| `CONVERSION_FACTOR` | legacy only; overrides the hard-coded `0.72` |
| `MIN_RELEASE_STATUS` | v2 only; `2` publishes verified and final, holds back provisional |

Then **Deploys → Trigger deploy → Clear cache and deploy site**.

The token lives only in the Netlify function environment. It is never sent to the browser,
never appears in the bundle, and is not in this repository. Do not move the REDCap call into
client-side JavaScript for any reason — a token in browser code is a published token.

Two things to check on the REDCap side:

- The token must belong to a user whose export rights **exclude identifiers**, so nothing
  under POPIA leaves the server.
- If REDCap sits behind an institutional firewall, Netlify's egress will not reach it.
  Use the snapshot path below instead.

### Check it worked

Visit **`/api/diagnostics`** on your deployed site. It reports which schema was detected,
how many day-forms and slots were read, the date range, completeness, and every row that
was skipped and why. It returns counts and field names only — never record values, never
the token.

With two projects connected, `coverage.byDataset` breaks the numbers down per project,
and `parse.overlappingSiteDays` and `parse.datasetBoundaries` tell you where they meet.

A healthy legacy connection looks roughly like this:

```json
{
  "schemaDetected": "legacy",
  "provisional": true,
  "coverage": { "sites": ["Cape Town", "Pretoria"], "siteDays": 1204,
                "validDays": 1161, "completenessPct": 96.4 },
  "parse": { "dayFormsRead": 1204, "slotsRead": 8433,
             "usedStoredConvertedCount": 8433, "derivedFromRawCount": 0,
             "unmappedTaxonCodes": [], "duplicateTaxonSameDay": [] }
}
```

Things worth acting on in that report:

- **`unmappedTaxonCodes`** — a taxon exists in REDCap that the crosswalk does not know.
  Those rows are skipped. Add them to `legacyTaxonToV2` in
  `netlify/functions/lib/legacy-schema.json` and to the v2 taxon reference.
- **`duplicateTaxonSameDay`** — the same taxon entered in two slots on one day. The adapter
  pools them rather than letting one overwrite the other, but the underlying entries should
  be corrected in REDCap.
- **`rowsMissingCount`** — a taxon was selected but no count entered.

### What the legacy path cannot give you

Concentrations from the legacy schema are **provisional by construction**, and the dashboard
says so in a banner on every view. Two reasons:

1. The instrument stores a single hard-coded conversion factor of `0.72` for every site and
   every day, so measured flow rate never enters the calculation.
2. It records no valid sampling hours, so a six-hour day is reported as if it were a
   full 24 — understating the true concentration roughly fourfold.

The adapter uses the stored `ccount` where present and falls back to `count × factor`
otherwise. Both are reported in the diagnostics so you can see which path your data took.
Neither can be made verifiable without the metadata the v2 schema adds.

### When the instrument changes

The adapter is driven entirely by `netlify/functions/lib/legacy-schema.json`, generated from
your real data dictionary — no field names are guessed. Regenerate it after any change to
the instrument:

```bash
npm run legacy-map -- SAPNETPollenCountProspective_DataDictionary.csv
```

It preserves the existing taxon crosswalk and warns loudly about any new code that has no
v2 mapping yet.

### Site codes — do not renumber

Legacy site codes are **not alphabetical**: `1` is Cape Town and `2` is Bloemfontein.
The v2 dictionary preserves these codes exactly. Renumbering a live codelist would swap
two cities' entire time series with no error anywhere.

### Snapshot instead of a live connection

Export from REDCap (**Data Exports → All data → JSON**, raw values), then:

```bash
node scripts/build-data.mjs redcap-export.json > public/data/observations.json
git add public/data/observations.json && git commit -m "Data through 2026-08-23" && git push
```

`public/data/observations.json` is in `.gitignore` by default — remove that line if you
intend to commit snapshots. This path suits a network that would rather publish a reviewed
weekly snapshot than expose a live API.

## Local development

```bash
npm install -g netlify-cli
cp .env.example .env      # add your token if you have one
netlify dev               # http://localhost:8888, functions included
```

Without the CLI, any static server over `public/` works, but `/api/*` will 404 and the
dashboard will fall back to demo data — which is the correct behaviour.

```bash
npm run check             # parse-check every module and function
```

---

## One conversion basis across both projects

The network reports **converted counts only**. Raw counts are what the analyst records at
the microscope and what the dashboard models from; the converted count is derived, on the
same basis, for every source:

```
converted count = raw count x CONVERSION_FACTOR      (default 0.72)
```

A day from the retrospective archive and a day from the prospective project with the same
raw count produce the same converted value, so the two sit in one series without a scale
break at the join.

**The stored `ccount` field is deliberately not used as the value.** REDCap computes it as
`round([count]*0.72,0)` — rounded to a whole number, per row. A raw count of 7 becomes 5
instead of 5.04, and rounding twenty rows before summing accumulates error that is worst at
the low counts which set season start and end dates. The dashboard derives from the raw
count instead and carries the result unrounded, rounding only for display.
`/api/diagnostics` reports `storedVsDerivedMeanAbsDiff`, which quantifies how much the
stored field differs from the precise value across your actual data.

Rows with no raw count are not discarded. The raw value is recovered from the stored one by
dividing, so the whole series stays on one basis, and the count of such rows is reported as
`backDerivedFromStoredCount`.

Both bases travel together. Every observation carries `raw` alongside `counts`, and the CSV
export has `raw_count`, `converted_count_per_m3` and `conversion_factor` columns, so any
published figure can be traced back to the count it came from and the factor applied.

Changing the factor is a one-line change in `CONVERSION_FACTOR` and re-deploys every number
consistently. The factor in force appears in a banner on the dashboard, in the diagnostics,
and in every export.

## Data contract

Whatever the source, the dashboard consumes one shape:

```jsonc
{
  "source": "redcap" | "file" | "demo",
  "generatedAt": "2026-08-23T06:00:00.000Z",
  "sites": ["Cape Town", "Durban"],
  "taxa": [{ "code": 2001, "sci": "Poaceae", "common": "Grass", "category": 2 }],
  "conversionFactor": 0.72,
  "conversionBasis": "All values are converted counts, derived as raw count x 0.72.",
  "observations": [{
    "site": "Cape Town",
    "date": "2026-08-17",
    "dataset": "prospective",
    "methodVersion": "prospective, converted count = raw x 0.72",
    "conversionFactor": 0.72,
    "status": 1,          // 1 complete · 2 partial · 3 not collected · 4 invalidated
    "validHours": 24,
    "reason": null,       // coded outage reason when status is not 1
    "raw":    { "2001": 16 },    // taxon code -> grains counted
    "counts": { "2001": 11.52 }  // taxon code -> converted, particles/m³, unrounded
  }]
}
```

Taxon codes follow the v2 reference: 1000s trees, 2000s grass, 3000s weeds,
4000s fungal spores, 5000s other biological particles, 9000s unidentified. The category
is recoverable from the code alone, so a taxon can never contradict its category.

`See SAPNET_taxon_reference_v2.csv` for the full list.

---

## Two rules the dashboard enforces

**Lost days are never counted as zero.** Every mean is taken over valid days only.
A day with `status: 3` is excluded from the denominator and drawn as a gap on the tape strip.

**Completeness travels with the number.** An annual integral from 78 % coverage is not
comparable to one from 97 % coverage, so the two are always shown together.

These are why the four reporting levels reconcile with each other. Weekly, monthly,
quarterly and annual figures are all `GROUP BY` operations over the same rows.

---

## Before public release

- [ ] **Risk band thresholds.** The values in `public/assets/data.js` (`BANDS`) are
      placeholders. Your clinical advisory group must set them.
- [ ] **Confirm `/api/diagnostics` shows zero `unmappedTaxonCodes`.**
- [ ] **Review `overlapExamples`** and decide whether the overlap is intended duplication
      or a data-entry error to fix in REDCap.
- [ ] **Run `npm run audit-retro`** and clear every unresolved taxon before publishing
      anything from the archive.
- [ ] **Confirm the archive's `count` is a raw count** (the default). If it was imported
      already converted, set `REDCAP_COUNTKIND_RETROSPECTIVE=concentration` or the archive
      will be out by the factor.
- [ ] **Agree the conversion factor.** 0.72 is the value inherited from the prospective
      instrument, not a measured one. It is a network convention until flow rate and
      traverse geometry are captured.
- [ ] **Reconcile methods across `datasetBoundaries`** before publishing any trend that
      crosses from the retrospective archive into the prospective series.
- [ ] **Remove the demo generator** from `data.js` once live, so a REDCap outage produces
      a visible failure rather than plausible fiction.
- [ ] **Season descriptor method.** Currently the 95 % cumulative method (2.5 % to 97.5 %).
      Confirm this is what the network reports.
- [ ] **Minimum completeness for publication.** Decide the threshold below which a
      site-period is suppressed rather than published.
- [ ] **Access control.** `noindex` is set, but the site is public. For internal-only
      deployment add Netlify password protection or Identity (paid tiers), or deploy
      behind your institutional SSO.
- [ ] **Attribution and licence** for the data, and a citation statement.

---

## Files

```
netlify.toml                     publish dir, function routes, headers, CSP
package.json                     scripts only; no build step, no dependencies
public/index.html                entry point
public/assets/styles.css         design tokens, layout, print rules for PDF reports
public/assets/data.js            source resolution, risk bands, demo generator
public/assets/charts.js          SVG charts and tables, no charting library
public/assets/app.js             state, period windows, rendering, CSV export
public/data/observations.sample.json   worked example of the data contract
public/data/taxa.json            taxon names, so any schema renders readable labels
netlify/functions/observations.js       REDCap proxy, schema detection, v2 transform
netlify/functions/lib/legacy-adapter.js legacy seven-day instrument reader
netlify/functions/lib/legacy-schema.json field map generated from the real dictionary
netlify/functions/diagnostics.js        parse report for the live connection
netlify/functions/health.js             configuration check, leaks no secrets
scripts/build-data.mjs           offline ETL for the snapshot path
netlify/functions/lib/retrospective-adapter.js  free-text archive reader
netlify/functions/lib/retrospective-map.json    editable site and taxon crosswalk
netlify/functions/lib/taxon-reference.json      145 taxa, server-side copy
scripts/build-legacy-map.mjs     regenerates the legacy field map
scripts/audit-retrospective.mjs  audits the archive's free-text columns
```

No build step, no npm dependencies, no charting library. Everything is hand-rolled SVG,
which means nothing to patch when a transitive dependency is deprecated, and the whole
site is a handful of files a future maintainer can read.

---

## Notes

`Print report` produces a clean PDF via the browser's print dialogue — controls and
navigation are hidden, panels avoid page breaks. Use it for the monthly, quarterly and
annual reporting cycle.

`Export CSV` downloads the current window as a tidy long table, one row per taxon-day,
ready for analysis in R or Python.

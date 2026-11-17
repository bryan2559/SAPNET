/**
 * Connection check — a classic script with no imports and no modern syntax, so it
 * runs even when the dashboard's own modules do not.
 *
 * Tests each piece of the site independently and reports what loaded, what did not,
 * and how long each took. The point is to separate "the code never ran" from "the
 * code ran and REDCap was slow", which look identical from the dashboard itself.
 */
(function () {
  var rows = [];
  var out = document.getElementById('out');

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function paint() {
    var html = '<table><thead><tr><th>Check</th><th>Result</th>' +
      '<th style="text-align:right">Time</th><th>Detail</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var cls = r.state === 'pass' ? 'ok' : r.state === 'fail' ? 'bad' : 'wait';
      var mark = r.state === 'pass' ? 'PASS' : r.state === 'fail' ? 'FAIL' :
                 r.state === 'warn' ? 'NOTE' : '…';
      html += '<tr><td>' + esc(r.name) + '</td>' +
        '<td><span class="pill ' + cls + '">' + mark + '</span></td>' +
        '<td class="n">' + (r.ms === null ? '' : r.ms + ' ms') + '</td>' +
        '<td class="detail">' + (r.detail || '') + '</td></tr>';
    }
    html += '</tbody></table>';
    out.innerHTML = html;
  }

  function add(name) {
    var r = { name: name, state: 'run', ms: null, detail: '' };
    rows.push(r); paint(); return r;
  }

  function finish(r, state, detail, ms) {
    r.state = state; r.detail = detail; r.ms = ms === undefined ? r.ms : ms; paint();
  }

  /** fetch with a deadline; never leaves a check pending forever. */
  function get(url, ms, cb) {
    var t0 = Date.now();
    var done = false;
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      if (ctl) ctl.abort();
      cb({ timeout: true }, null, Date.now() - t0);
    }, ms);

    var opts = ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' };
    fetch(url, opts).then(function (res) {
      return res.text().then(function (body) {
        if (done) return;
        done = true; clearTimeout(timer);
        cb(null, { status: res.status, ok: res.ok, body: body,
                   type: res.headers.get('content-type') || '' }, Date.now() - t0);
      });
    }).catch(function (e) {
      if (done) return;
      done = true; clearTimeout(timer);
      cb({ error: e.message || String(e) }, null, Date.now() - t0);
    });
  }

  /* ---- 1. static assets ---- */
  function checkAsset(path, label, next) {
    var r = add(label);
    get(path, 8000, function (err, res, ms) {
      if (err) {
        finish(r, 'fail', err.timeout ? 'No response within 8 s.' :
          'Request failed: ' + esc(err.error), ms);
      } else if (!res.ok) {
        finish(r, 'fail', 'HTTP ' + res.status +
          (res.status === 404 ? ' — this file is not in the deployed build.' : ''), ms);
      } else if (/\.js$/.test(path) && res.type.indexOf('javascript') === -1) {
        // A wrong MIME type is the classic cause of a module that silently refuses
        // to execute: the browser blocks it and the page never starts.
        finish(r, 'fail', 'Served as <code>' + esc(res.type) +
          '</code> instead of JavaScript — the browser will refuse to run it.', ms);
      } else {
        finish(r, 'pass', (res.body.length / 1024).toFixed(0) + ' KB &middot; ' +
          esc(res.type.split(';')[0]), ms);
      }
      next();
    });
  }

  /* ---- 2. does the dashboard's module actually parse and run? ---- */
  function checkModule(next) {
    var r = add('Dashboard module runs');
    var done = false;
    var t0 = Date.now();
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      finish(r, 'fail',
        'The module did not execute. This is the failure that leaves the dashboard ' +
        'on its spinner: none of its data timeouts live outside it. The browser ' +
        'console will name the file and the reason.', Date.now() - t0);
      next();
    }, 10000);

    // Import the real data module. If it parses and evaluates, the dashboard's own
    // code is fine and the problem is further along, in the data itself.
    var s = document.createElement('script');
    s.type = 'module';
    s.textContent =
      "import('/assets/data.js').then(function(m){window.__modOk=!!m.loadData;})" +
      ".catch(function(e){window.__modErr=e.message||String(e);});";
    // CSP blocks inline module text, so load a tiny probe file instead.
    s.textContent = '';
    s.src = '/assets/probe.js';
    s.onerror = function () {
      if (done) return;
      done = true; clearTimeout(timer);
      finish(r, 'fail', 'The probe module could not be loaded at all.', Date.now() - t0);
      next();
    };
    document.head.appendChild(s);

    var poll = setInterval(function () {
      if (done) return;
      if (window.__modOk) {
        done = true; clearInterval(poll); clearTimeout(timer);
        finish(r, 'pass', 'data.js parses and evaluates.', Date.now() - t0);
        next();
      } else if (window.__modErr) {
        done = true; clearInterval(poll); clearTimeout(timer);
        finish(r, 'fail', '<code>' + esc(window.__modErr) + '</code>', Date.now() - t0);
        next();
      }
    }, 120);
  }

  /* ---- 3. the API ---- */
  function checkHealth(next) {
    var r = add('/api/health');
    get('/api/health', 12000, function (err, res, ms) {
      if (err) {
        finish(r, 'fail', err.timeout
          ? 'No response within 12 s. If this times out, the functions are not ' +
            'running at all — the data endpoint cannot work either.'
          : 'Request failed: ' + esc(err.error), ms);
        return next();
      }
      if (res.status === 404) {
        finish(r, 'fail', 'HTTP 404 — the serverless functions are not deployed. ' +
          'Check that Netlify is building from the repository root, where ' +
          '<code>netlify.toml</code> sits.', ms);
        return next();
      }
      var j = null;
      try { j = JSON.parse(res.body); } catch (e) { /* ignore */ }
      if (!j) {
        finish(r, 'fail', 'Did not return JSON: <code>' +
          esc(res.body.slice(0, 120)) + '</code>', ms);
      } else if (j.redcapConfigured) {
        finish(r, 'pass', 'Tokens are configured &middot; source <b>' +
          esc(j.dataSource) + '</b>', ms);
      } else {
        finish(r, 'warn', 'Functions work, but no REDCap tokens are set — the ' +
          'dashboard will show demo data. Add them under Site configuration &rarr; ' +
          'Environment variables, then redeploy.', ms);
      }
      next();
    });
  }

  function checkObservations(next) {
    var r = add('/api/observations');
    get('/api/observations', 40000, function (err, res, ms) {
      if (err) {
        finish(r, 'fail', err.timeout
          ? 'No response within 40 s. The export is too slow for a serverless ' +
            'function. Narrow it with <code>REDCAP_FILTER_&lt;KEY&gt;</code>, or ' +
            'publish a snapshot instead.'
          : 'Request failed: ' + esc(err.error), ms);
        return next();
      }
      var j = null;
      try { j = JSON.parse(res.body); } catch (e) { /* ignore */ }
      if (res.status === 501) {
        finish(r, 'warn', 'Not configured yet — the dashboard falls back to demo data.', ms);
      } else if (res.status === 404) {
        finish(r, 'fail', 'HTTP 404 — the serverless functions are not deployed, so ' +
          'the dashboard can never load live data.', ms);
      } else if (!res.ok) {
        finish(r, 'fail', 'HTTP ' + res.status + ' &middot; <code>' +
          esc(j ? j.message : res.body.replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ').trim().slice(0, 160)) + '</code>', ms);
      } else if (j && j.observations) {
        finish(r, 'pass', j.observations.length.toLocaleString() + ' site-days &middot; ' +
          (j.sites ? j.sites.length : 0) + ' sites &middot; schema <b>' +
          esc(j.schema) + '</b> &middot; ' + (res.body.length / 1024).toFixed(0) + ' KB', ms);
      } else {
        finish(r, 'fail', 'Returned JSON with no observations.', ms);
      }
      next();
    });
  }

  /* ---- run in sequence ---- */
  var queue = [
    function (n) { checkAsset('/assets/styles.css', 'styles.css', n); },
    function (n) { checkAsset('/assets/bundle.js', 'bundle.js (the dashboard code)', n); },
    function (n) { checkAsset('/data/taxa.json', 'taxa.json', n); },
    checkModule,
    checkHealth,
    checkObservations
  ];
  var i = 0;
  function next() {
    if (i >= queue.length) {
      document.getElementById('done').hidden = false;
      return;
    }
    queue[i++](next);
  }
  next();
})();

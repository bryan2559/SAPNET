/**
 * Boot guard — a classic script, loaded BEFORE app.js.
 *
 * Everything else on this page is an ES module. If a module fails to load or parse
 * — a bad MIME type, a CSP rule, a 404 on the versioned URL, a syntax feature the
 * browser does not support — the browser reports it to the console and stops. No
 * code inside the module runs, so none of the module's own timeouts or watchdogs
 * can help, and the page sits on its loading spinner with no visible explanation.
 *
 * This file is deliberately plain: no imports, no modern syntax, nothing that could
 * itself fail to parse in an older browser. It exists to make silent failures loud.
 *
 * It must be a separate file rather than an inline <script>, because the site's
 * Content-Security-Policy is script-src 'self' and inline scripts are blocked.
 */
(function () {
  var BOOT = '2026-11-17';
  var started = Date.now();
  window.__sapnetBoot = { at: started, build: BOOT, errors: [] };

  function el() { return document.getElementById('loading'); }

  function show(title, detail, hint) {
    var node = el();
    if (!node) return;
    var html =
      '<div style="max-width:60ch;margin:0 auto;text-align:left;line-height:1.65;' +
      'font-family:Inter,Helvetica Neue,Arial,sans-serif;color:#0B0B0B">' +
      '<p style="font-size:15px;margin:0 0 12px"><b>' + title + '</b></p>' +
      '<p style="font-size:13px;margin:0 0 12px;color:#52514E">' + detail + '</p>';
    if (hint) {
      html += '<p style="font-size:13px;margin:0 0 12px;color:#52514E">' + hint + '</p>';
    }
    html +=
      '<p style="font-size:12.5px;margin:14px 0 0;color:#7D7C77">' +
      'Boot guard ' + BOOT + ' &middot; ' +
      '<a href="/check.html" style="color:#2a78d6">run the connection check</a> for a ' +
      'full report of what loads and what does not.</p></div>';
    node.innerHTML = html;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // A script or module that fails to load fires an error event on the element.
  window.addEventListener('error', function (e) {
    var tgt = e.target || {};
    if (tgt.tagName === 'SCRIPT' || tgt.tagName === 'LINK') {
      window.__sapnetBoot.errors.push('resource: ' + (tgt.src || tgt.href));
      show('A file the page needs did not load.',
        'The browser could not fetch <code>' + esc(tgt.src || tgt.href) + '</code>.',
        'Usually the deployed build is missing that file, or a cached page is asking ' +
        'for an old versioned filename. Redeploy with <b>Clear cache and deploy site</b>, ' +
        'then hard-refresh.');
      return;
    }
    window.__sapnetBoot.errors.push('error: ' + (e.message || e));
    show('The dashboard stopped with an error.',
      '<code>' + esc(e.message || e) + '</code>' +
      (e.filename ? '<br>' + esc(e.filename) + ':' + e.lineno : ''),
      'The browser console has the full stack trace.');
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason || {};
    window.__sapnetBoot.errors.push('rejection: ' + (r.message || r));
    show('The dashboard stopped while loading data.',
      '<code>' + esc(r.message || r) + '</code>',
      'The browser console has the full stack trace.');
  });

  /**
   * When the module has not started, find out why and say so, rather than asking
   * the reader to go and look in the console.
   *
   * Each module file is fetched and its content type inspected. The important case
   * is a file that answers 200 with HTML: that happens when a host's catch-all
   * rewrite serves the index page for a missing file, and it is invisible from the
   * outside because nothing reports an error — the browser simply cannot parse the
   * HTML as a module, and the page stops.
   */
  function diagnose(done) {
    var files = ['/assets/app.js', '/assets/data.js', '/assets/charts.js'];
    var results = [];
    var left = files.length;

    files.forEach(function (f) {
      fetch(f, { cache: 'no-store' }).then(function (res) {
        var ct = res.headers.get('content-type') || '';
        return res.text().then(function (body) {
          var looksHtml = /^\s*(<!doctype|<html)/i.test(body);
          results.push({
            file: f, status: res.status, type: ct.split(';')[0],
            html: looksHtml, size: body.length
          });
        });
      }).catch(function (e) {
        results.push({ file: f, status: 0, type: '', html: false, err: e.message });
      }).then(function () {
        if (--left === 0) done(results);
      });
    });
  }

  setTimeout(function () {
    if (window.__sapnetStarted || !el()) return;

    show('The dashboard code did not start.',
      'The page loaded, but <code>/assets/app.js</code> never began running. ' +
      'Checking what the server returns for each file&hellip;', '');

    diagnose(function (rs) {
      var bad = rs.filter(function (r) { return r.status !== 200 || r.html; });
      var list = '<ul style="margin:0 0 12px;padding-left:20px">';
      rs.sort(function (a, b) { return a.file < b.file ? -1 : 1; });
      for (var i = 0; i < rs.length; i++) {
        var r = rs[i];
        var verdict = r.status === 0 ? 'could not be fetched: ' + esc(r.err)
          : r.status !== 200 ? 'HTTP ' + r.status
          : r.html ? 'HTTP 200 but the body is <b>HTML, not JavaScript</b>'
          : 'OK (' + (r.size / 1024).toFixed(0) + ' KB, ' + esc(r.type) + ')';
        list += '<li style="margin-bottom:5px"><code>' + esc(r.file) + '</code> &mdash; ' + verdict + '</li>';
      }
      list += '</ul>';

      var hint;
      if (bad.some(function (r) { return r.html; })) {
        hint = 'A file answering with HTML means it is <b>not in the deployed build</b>: ' +
          'the host is falling back to the index page for a path it cannot find. The ' +
          'status says 200, so nothing looks wrong from the outside, but the browser ' +
          'cannot parse HTML as a module and stops. Redeploy and make sure the ' +
          '<code>assets</code> folder is published.';
      } else if (bad.some(function (r) { return r.status === 404; })) {
        hint = 'A 404 means that file is not in the deployed build. Redeploy with ' +
          '<b>Clear cache and deploy site</b> and confirm the <code>assets</code> ' +
          'folder is published.';
      } else if (!bad.length) {
        hint = 'All three files are served correctly, so the failure is inside the ' +
          'code itself — a parse or runtime error. The browser console names the ' +
          'file and the line.';
      } else {
        hint = 'The browser console will have the underlying error.';
      }

      show('The dashboard code did not start.', list, hint);
    });
  }, 6000);
})();

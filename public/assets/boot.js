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
  var BOOT = '2026-11-11';
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

  // If app.js never signals that it started, the module did not run at all.
  setTimeout(function () {
    if (window.__sapnetStarted || !el()) return;
    show('The dashboard code did not start.',
      'The page loaded, but <code>/assets/app.js</code> never began running. That ' +
      'points at the module failing to load or parse rather than anything to do with ' +
      'REDCap — none of the data timeouts live outside it.',
      'Open the browser console: there will be a message naming the file and reason. ' +
      'The most common causes are a stale cached page asking for a versioned filename ' +
      'that no longer exists, and a deploy that did not publish the assets folder.');
  }, 6000);
})();

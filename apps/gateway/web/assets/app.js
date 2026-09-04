/* AyurTrace shared frontend runtime.
 * Every call is same-origin against the live gateway — no mock, no fabricated
 * fallback. A failed call surfaces the gateway's own frozen reject envelope
 * ({code, message, detail}); a down backend shows an honest error state. */
(function (global) {
  const AT = {};

  // ---- API client ---------------------------------------------------------
  class Reject extends Error {
    constructor(code, message, detail, http) {
      super(message || code);
      this.code = code; this.detail = detail || {}; this.http = http;
    }
  }
  AT.Reject = Reject;

  AT.api = async function (method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Reject('NETWORK', 'Cannot reach the AyurTrace gateway. Is it running?', {}, 0);
    }
    let json = null;
    try { json = await res.json(); } catch (_) { /* non-JSON */ }
    if (!json) throw new Reject('BAD_RESPONSE', `Gateway returned ${res.status}.`, {}, res.status);
    if (json.ok === false) throw new Reject(json.code, json.message, json.detail, res.status);
    return json.data;
  };
  AT.get = (p) => AT.api('GET', p);
  AT.post = (p, b) => AT.api('POST', p, b);

  // ---- DOM helpers --------------------------------------------------------
  AT.$ = (sel, root) => (root || document).querySelector(sel);
  AT.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  AT.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  AT.el = (tag, attrs, html) => {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (html != null) e.innerHTML = html;
    return e;
  };
  AT.time = (iso) => {
    try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (_) { return iso; }
  };
  AT.shortEpc = (e) => String(e || '').replace(/^urn:ayurtrace:/, '');

  // ---- shared chrome ------------------------------------------------------
  const LOGO = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 22C12 22 3 17 3 9.5C3 5 7 2 12 2C17 2 21 5 21 9.5C21 17 12 22 12 22Z" fill="#DCE8DF" stroke="#2C5F4A" stroke-width="1.4"/><path d="M12 5V19M12 10L8 8M12 13L16 11" stroke="#2C5F4A" stroke-width="1.3" stroke-linecap="round"/></svg>';
  AT.LOGO = LOGO;

  const PAGES = [
    ['/index.html', 'Overview'],
    ['/collector.html', 'Collector'],
    ['/operator.html', 'Supply chain'],
    ['/regulator.html', 'Regulator'],
    ['/consumer.html', 'Consumer'],
  ];

  AT.chrome = function (roleLabel, activePath) {
    const bar = AT.el('div', { class: 'topbar' });
    const links = PAGES.map(([href, label]) => {
      const on = href === activePath ? ' on' : '';
      return `<a class="${on.trim()}" href="${href}">${label}</a>`;
    }).join('');
    bar.innerHTML = `<div class="in">
      <a class="logo" href="/index.html">${LOGO}<span class="b">Ayur<b>Trace</b></span></a>
      ${roleLabel ? `<span class="role">${roleLabel}</span>` : ''}
      <nav class="nav">${links}<span class="status-pill" id="at-status"><span class="dot" id="at-dot"></span><span id="at-status-txt">checking…</span></span></nav>
    </div>`;
    document.body.prepend(bar);
    AT.pollHealth();
  };

  AT.pollHealth = async function () {
    const dot = document.getElementById('at-dot');
    const txt = document.getElementById('at-status-txt');
    const set = (up, label) => {
      if (dot) dot.className = 'dot' + (up ? '' : ' down');
      if (txt) txt.textContent = label;
    };
    try {
      const d = await AT.get('/health');
      set(true, `live · ${d.backend}`);
    } catch (_) { set(false, 'gateway offline'); }
    setTimeout(AT.pollHealth, 8000);
  };

  // ---- status → badge helpers --------------------------------------------
  AT.statusBadge = function (status) {
    const map = {
      COMPLETE_PASSED: ['b-pass', 'Passed'],
      COMPLETE_FAILED: ['b-fail', 'Failed'],
      HOLD: ['b-hold', 'On hold'],
      ACTIVE: ['b-active', 'In progress'],
    };
    const [cls, label] = map[status] || ['b-active', status];
    return `<span class="badge ${cls}">${label}</span>`;
  };
  AT.bandColor = { GREEN: 'var(--leaf)', AMBER: 'var(--amber)', RED: 'var(--clay)' };

  global.AT = AT;
})(window);

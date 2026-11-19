/* dc-lite.js: a tiny runtime for saniyakpatel.com.
   Each page ships its markup in <template id="dc-tpl"> and one `class Component extends DCLogic`.
   Supports: {{path}} holes in text and attributes, <sc-if value="{{path}}">, onClick="{{fn}}",
   state / setState(updater, callback) / renderVals / componentDidMount / componentDidUpdate / componentWillUnmount.
   Renders by patching the live DOM in place so videos, focus and CSS transitions survive updates. */
(function () {
  'use strict';

  function get(obj, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.'), v = obj;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function esc(v) {
    if (v == null || v === false) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var IF_RE = /<sc-if\b[^>]*?\bvalue="\{\{([^}]*)\}\}"[^>]*>((?:(?!<sc-if\b)[\s\S])*?)<\/sc-if>/;

  function build(tpl, vals, handlers) {
    var html = tpl.replace(/\shint-placeholder-val="[^"]*"/g, '');
    var m;
    while ((m = IF_RE.exec(html))) {
      html = html.slice(0, m.index) + (get(vals, m[1]) ? m[2] : '') + html.slice(m.index + m[0].length);
    }
    html = html.replace(/\son([A-Z][a-zA-Z]*)="\{\{([^}]*)\}\}"/g, function (_, ev, path) {
      var fn = get(vals, path);
      if (typeof fn !== 'function') return '';
      handlers.push(fn);
      return ' data-dc-' + ev.toLowerCase() + '="' + (handlers.length - 1) + '"';
    });
    return html.replace(/\{\{([^}]*)\}\}/g, function (_, path) {
      var v = get(vals, path);
      return typeof v === 'function' ? '' : esc(v);
    });
  }

  function morphAttrs(a, b) {
    var i, at;
    for (i = 0; i < b.attributes.length; i++) {
      at = b.attributes[i];
      if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    }
    for (i = a.attributes.length - 1; i >= 0; i--) {
      at = a.attributes[i];
      if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    }
  }
  function morphNode(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) {
      a.parentNode.replaceChild(b.cloneNode(true), a);
      return;
    }
    if (a.nodeType === 3 || a.nodeType === 8) {
      if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
      return;
    }
    if (a.nodeType !== 1) return;
    morphAttrs(a, b);
    morphChildren(a, b);
  }
  function keyOf(n) {
    if (n.nodeType !== 1) return null;
    return n.id || n.getAttribute('data-reveal') || n.getAttribute('data-key') ||
      (n.nodeName === 'SECTION' && n.getAttribute('aria-label')) ||
      (n.nodeName === 'VIDEO' && n.getAttribute('src')) || null;
  }
  function same(x, y) { return x.nodeName === y.nodeName && keyOf(x) === keyOf(y); }
  function morphChildren(a, b) {
    var bc = Array.prototype.slice.call(b.childNodes);
    var cur = a.firstChild;
    for (var i = 0; i < bc.length; i++) {
      var nb = bc[i];
      if (cur && same(cur, nb)) { var nx = cur.nextSibling; morphNode(cur, nb); cur = nx; continue; }
      // look ahead for the same node further on (something before it was removed)
      var found = null, k = keyOf(nb), scan = cur, steps = 0;
      while (scan && steps < (k ? 1e9 : 6)) {
        if (same(scan, nb)) { found = scan; break; }
        if (!k && keyOf(scan)) break;  // never skip past a keyed node to match an unkeyed one
        scan = scan.nextSibling; steps++;
      }
      if (found) {
        // drop the unmatched nodes between cur and found (they were removed)
        while (cur && cur !== found) { var dead = cur; cur = cur.nextSibling; a.removeChild(dead); }
        var nx2 = found.nextSibling; morphNode(found, nb); cur = nx2;
      } else {
        a.insertBefore(nb.cloneNode(true), cur);  // a new node
      }
    }
    while (cur) { var d2 = cur; cur = cur.nextSibling; a.removeChild(d2); }
  }

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (u, cb) {
    var patch = typeof u === 'function' ? u(this.state, this.props) : u;
    if (patch) {
      if (!this.__prev) this.__prev = this.state;
      this.state = Object.assign({}, this.state, patch);
    }
    if (cb) (this.__cbs || (this.__cbs = [])).push(cb);
    this.__schedule();
  };
  DCLogic.prototype.forceUpdate = function (cb) { this.setState(null, cb); };
  DCLogic.prototype.__schedule = function () {
    if (this.__queued || !this.__mounted) return;
    this.__queued = true;
    var self = this;
    Promise.resolve().then(function () { self.__queued = false; self.__render(true); });
  };
  DCLogic.prototype.__render = function (isUpdate) {
    var handlers = [];
    var vals = this.renderVals ? this.renderVals() : {};
    var html = build(this.__tpl, vals, handlers);
    var t = document.createElement('template');
    t.innerHTML = html;
    this.__handlers = handlers;
    if (!isUpdate) {
      this.__root.innerHTML = '';
      this.__root.appendChild(t.content);
    } else {
      morphChildren(this.__root, t.content);
    }
    var prev = this.__prev; this.__prev = null;
    var cbs = this.__cbs; this.__cbs = null;
    if (isUpdate && prev && this.componentDidUpdate) this.componentDidUpdate(this.props, prev);
    if (cbs) cbs.forEach(function (f) { f(); });
  };

  function mount(Comp) {
    var tplEl = document.getElementById('dc-tpl');
    var root = document.getElementById('dc-root');
    var c = new Comp({});
    c.__tpl = tplEl.textContent;
    c.__root = root;
    ['click', 'input', 'change', 'mouseenter', 'mouseleave', 'keydown'].forEach(function (ev) {
      root.addEventListener(ev, function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-dc-' + ev + ']') : null;
        if (!el || !root.contains(el)) return;
        var fn = c.__handlers[+el.getAttribute('data-dc-' + ev)];
        if (fn) fn(e);
      }, ev === 'mouseenter' || ev === 'mouseleave');
    });
    c.__render(false);
    c.__mounted = true;
    if (c.componentDidMount) c.componentDidMount();
    if (c.__prev || c.__cbs) c.__schedule();
    window.addEventListener('pagehide', function () { if (c.componentWillUnmount) c.componentWillUnmount(); });
    return c;
  }

  window.DCLogic = DCLogic;
  window.DC = { mount: mount };
})();

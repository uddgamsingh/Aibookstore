(function () {
  'use strict';

  var API = (window.BOOKSTORE_API || '').replace(/\/$/, '');
  var state = { mode: 'new', genre: '', q: '', page: 1, total: 0, loaded: 0, addedOn: null, token: 0 };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    list: $('list-view'), detail: $('detail-view'), grid: $('grid'), status: $('status'),
    genres: $('genres'), more: $('more'), form: $('search-form'), search: $('search'),
    tabNew: $('tab-new'), tabAll: $('tab-all')
  };

  // ---------- helpers (all text goes in via textContent, never innerHTML) ----------
  function el(tag, opts, children) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) node.className = opts.cls;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.href) node.setAttribute('href', opts.href);
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function safeUrl(url) {
    return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
  }

  function cover(url, title, cls) {
    var safe = safeUrl(url);
    if (!safe) return el('div', { cls: cls || 'cover-ph' });
    var img = document.createElement('img');
    img.src = safe;
    img.alt = 'Cover of ' + title;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    return img;
  }

  async function api(path) {
    var res;
    try {
      res = await fetch(API + path);
    } catch (e) {
      throw new Error('Cannot reach the server. It may be waking up, please try again in a moment.');
    }
    if (!res.ok) throw new Error('Server error (' + res.status + '). Please try again shortly.');
    return res.json();
  }

  function qs(params) {
    var p = new URLSearchParams();
    Object.keys(params).forEach(function (k) { if (params[k]) p.set(k, params[k]); });
    var s = p.toString();
    return s ? '?' + s : '';
  }

  function setStatus(msg) { els.status.textContent = msg || ''; }

  // ---------- list view ----------
  function card(b) {
    var a = el('a', { cls: 'card', href: '#/book/' + b.id }, [
      cover(b.cover_url, b.title),
      el('div', null, [
        el('span', { cls: 'tag', text: b.genre }),
        el('h3', { text: b.title }),
        el('p', { cls: 'by', text: b.authors || 'Unknown author' }),
        el('p', { cls: 'snip', text: b.snippet })
      ])
    ]);
    return a;
  }

  async function loadGenres() {
    try {
      var genres = await api('/api/genres');
      els.genres.textContent = '';
      els.genres.appendChild(chip('', 'All genres', null));
      genres.forEach(function (g) { els.genres.appendChild(chip(g.genre, g.genre, g.count)); });
    } catch (e) { /* the list load below will show the error */ }
  }

  function chip(value, label, count) {
    var b = el('button', { cls: 'chip' + (state.genre === value ? ' active' : ''), text: label });
    b.type = 'button';
    if (count != null) b.appendChild(el('small', { text: String(count) }));
    b.addEventListener('click', function () { state.genre = value; refreshChips(); load(true); });
    b.dataset.value = value;
    return b;
  }

  function refreshChips() {
    Array.prototype.forEach.call(els.genres.children, function (c) {
      c.classList.toggle('active', c.dataset.value === state.genre);
    });
  }

  async function load(reset) {
    var token = ++state.token;
    if (reset) {
      state.page = 1; state.loaded = 0; els.grid.textContent = ''; els.more.hidden = true;
      setStatus('Loading…');
    }
    var path;
    if (state.mode === 'new' && !state.q) {
      path = '/api/books/latest' + qs({ genre: state.genre, page: state.page });
    } else {
      path = '/api/books' + qs({ genre: state.genre, q: state.q, page: state.page });
    }
    try {
      var data = await api(path);
      if (token !== state.token) return; // a newer request replaced this one
      state.total = data.total;
      state.addedOn = data.added_on || null;
      data.items.forEach(function (b) { els.grid.appendChild(card(b)); });
      state.loaded += data.items.length;
      els.more.hidden = state.loaded >= state.total;
      if (state.total === 0) {
        if (state.q) setStatus('No books match "' + state.q + '".');
        else if (state.genre) setStatus('No books in ' + state.genre + ' yet. New books are added every day.');
        else setStatus('No books yet. The first daily update has not run.');
      } else if (state.mode === 'new' && !state.q && state.addedOn) {
        setStatus(state.total + ' new books added on ' + state.addedOn);
      } else {
        setStatus(state.total + ' books' + (state.q ? ' for "' + state.q + '"' : ''));
      }
    } catch (e) {
      if (token !== state.token) return;
      setStatus(e.message);
    }
  }

  function setMode(mode) {
    state.mode = mode;
    els.tabNew.classList.toggle('active', mode === 'new');
    els.tabAll.classList.toggle('active', mode === 'all');
  }

  els.tabNew.addEventListener('click', function () { state.q = ''; els.search.value = ''; setMode('new'); load(true); });
  els.tabAll.addEventListener('click', function () { state.q = ''; els.search.value = ''; setMode('all'); load(true); });
  els.more.addEventListener('click', function () { state.page += 1; load(false); });
  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    state.q = els.search.value.trim();
    setMode(state.q ? 'all' : 'new');
    if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
    else load(true);
  });

  // ---------- detail view ----------
  function section(title, nodeList) {
    return [el('h2', { text: title }), nodeList];
  }

  function listOf(tag, items) {
    return el(tag, null, items.map(function (t) { return el('li', { text: t }); }));
  }

  async function showDetail(id) {
    els.list.hidden = true;
    els.detail.hidden = false;
    els.detail.textContent = 'Loading…';
    window.scrollTo(0, 0);
    try {
      var b = await api('/api/books/' + encodeURIComponent(id));
      els.detail.textContent = '';
      var kids = [
        el('a', { cls: 'back', href: '#/', text: '← Back' }),
        el('div', { cls: 'detail-head' }, [
          cover(b.cover_url, b.title, 'cover-ph'),
          el('div', null, [
            el('span', { cls: 'tag', text: b.genre }),
            el('h1', { text: b.title }),
            el('p', { cls: 'by', text: (b.authors || 'Unknown author') + (b.published_date ? ' · ' + b.published_date : '') })
          ])
        ])
      ];
      if (b.summary_source !== 'ai') {
        kids.push(el('p', { cls: 'note', text: 'This summary is taken from the publisher description. Main points are drawn from it; no examples are available for this book.' }));
      } else {
        kids.push(el('p', { cls: 'note', text: 'AI-generated guide. It may contain mistakes, so check the source.' }));
      }
      kids.push(el('h2', { text: 'Summary' }), el('p', { text: b.summary }));
      if (b.main_points && b.main_points.length) {
        kids.push(el('h2', { text: 'Main points' }), listOf('ul', b.main_points));
      }
      if (b.examples && b.examples.length) {
        kids.push(el('h2', { text: 'Examples' }), listOf('ol', b.examples));
      }
      if (b.explanation) {
        kids.push(el('h2', { text: 'Explained simply' }));
        b.explanation.split(/\n+/).forEach(function (para) {
          if (para.trim()) kids.push(el('p', { text: para.trim() }));
        });
      }
      var link = safeUrl(b.info_link);
      if (link) {
        var a = el('a', { href: link, text: 'View this book on Google Books' });
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        kids.push(el('p', { cls: 'source' }, [a]));
      }
      kids.forEach(function (k) { els.detail.appendChild(k); });
      document.title = b.title + ' | Daily Bookstore';
    } catch (e) {
      els.detail.textContent = '';
      els.detail.appendChild(el('a', { cls: 'back', href: '#/', text: '← Back' }));
      els.detail.appendChild(el('p', { text: e.message }));
    }
  }

  // ---------- routing ----------
  function route() {
    var m = /^#\/book\/(\d+)$/.exec(location.hash);
    if (m) { showDetail(m[1]); return; }
    els.detail.hidden = true;
    els.list.hidden = false;
    document.title = 'Daily Bookstore';
    load(true);
  }

  window.addEventListener('hashchange', route);
  loadGenres();
  route();
})();

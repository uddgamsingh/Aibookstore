(function () {
  'use strict';

  var API = (window.BOOKSTORE_API || '').replace(/\/$/, '');
  var SAVED_KEY = 'bookstore.saved.v1';

  // Each genre has its own colour, like colour-coded paperbacks. Unknown genres get a hashed colour.
  var GENRE_HUES = {
    Fiction: 24, Fantasy: 268, 'Science Fiction': 200, Mystery: 240, Romance: 330,
    Thriller: 352, History: 38, Biography: 150, 'Self-Help': 110, Business: 180
  };

  var state = {
    mode: 'new', genre: '', q: '', page: 1, total: 0, loaded: 0,
    latest: null, token: 0, rendered: false, scrollY: 0
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    list: $('list-view'), detail: $('detail-view'), feature: $('feature'), grid: $('grid'),
    status: $('status'), genres: $('genres'), more: $('more'), form: $('search-form'),
    search: $('search'), tabNew: $('tab-new'), tabAll: $('tab-all'), tabSaved: $('tab-saved'),
    savedCount: $('saved-count'), progress: $('progress')
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

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function safeUrl(url) {
    return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
  }

  function hue(genre) {
    if (Object.prototype.hasOwnProperty.call(GENRE_HUES, genre)) return GENRE_HUES[genre];
    var h = 0;
    for (var i = 0; i < genre.length; i++) h = (h * 31 + genre.charCodeAt(i)) % 360;
    return h;
  }

  function tint(node, genre) { node.style.setProperty('--h', String(hue(genre || ''))); }

  function friendlyDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    var now = new Date();
    var same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (same) return 'today';
    return 'on ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  // Retries while the free server wakes up, so a first visit shows progress instead of an error.
  async function api(path, onWait) {
    var attempts = 0;
    for (;;) {
      attempts++;
      var res = null;
      try {
        res = await fetch(API + path);
      } catch (e) {
        if (attempts >= 4) throw new Error('Cannot reach the server. Check your connection and try again.');
      }
      if (res) {
        if (res.ok) return res.json();
        var gateway = res.status === 502 || res.status === 503 || res.status === 504;
        if (!gateway || attempts >= 4) throw new Error('The server had a problem (' + res.status + '). Try again in a moment.');
      }
      if (onWait) onWait();
      await sleep(6000);
    }
  }

  function qs(params) {
    var p = new URLSearchParams();
    Object.keys(params).forEach(function (k) { if (params[k]) p.set(k, params[k]); });
    var s = p.toString();
    return s ? '?' + s : '';
  }

  function setStatus(msg, retry) {
    els.status.textContent = msg || '';
    if (retry) {
      var b = el('button', { text: 'Try again' });
      b.type = 'button';
      b.addEventListener('click', retry);
      els.status.appendChild(b);
    }
  }

  // ---------- saved books (stored only in this browser) ----------
  function readSaved() {
    try {
      var v = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function writeSaved(list) {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 200))); } catch (e) { /* storage blocked */ }
  }
  function isSaved(id) { return readSaved().some(function (x) { return x.id === id; }); }
  function toggleSaved(b) {
    var list = readSaved();
    var i = list.findIndex(function (x) { return x.id === b.id; });
    if (i >= 0) list.splice(i, 1);
    else list.unshift({
      id: b.id, title: b.title, authors: b.authors, genre: b.genre, cover_url: b.cover_url,
      added_on: b.added_on, snippet: b.snippet || String(b.summary || '').slice(0, 220)
    });
    writeSaved(list);
    updateSavedCount();
  }
  function updateSavedCount() { els.savedCount.textContent = String(readSaved().length); }

  function saveButton(b, label) {
    var btn = el('button', { cls: 'save' });
    btn.type = 'button';
    function paint() {
      var on = isSaved(b.id);
      btn.textContent = on ? '♥' : '♡';
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', (on ? 'Remove from saved: ' : 'Save for later: ') + b.title);
      if (label) { btn.textContent = on ? 'Saved' : 'Save for later'; }
    }
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      toggleSaved(b);
      paint();
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
      if (state.mode === 'saved' && !els.list.hidden) renderSaved();
    });
    paint();
    return btn;
  }

  // ---------- covers and cards ----------
  function coverEl(b, extra) {
    var wrap = el('div', { cls: 'cover' + (extra ? ' ' + extra : '') });
    tint(wrap, b.genre);
    wrap.appendChild(el('div', { cls: 'cover-ph' }, [
      el('span', { cls: 'cover-title', text: b.title }),
      el('span', { cls: 'cover-author', text: b.authors || '' })
    ]));
    var url = safeUrl(b.cover_url);
    if (url) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = 'Cover of ' + b.title;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', function () {
        // Google returns a tiny placeholder when it has no cover; keep our typeset cover for those
        if (img.naturalWidth > 40) wrap.classList.add('has-img');
      });
      img.addEventListener('error', function () { img.remove(); });
      wrap.appendChild(img);
    }
    return wrap;
  }

  function card(b, showNew) {
    var art = el('article', { cls: 'card' });
    tint(art, b.genre);
    var link = el('a', { cls: 'card-link', href: '#/book/' + b.id });
    link.appendChild(coverEl(b));
    var meta = el('span', { cls: 'card-meta' }, [el('span', { cls: 'card-genre', text: b.genre })]);
    if (showNew && state.latest && b.added_on === state.latest) meta.appendChild(el('span', { cls: 'new-tag', text: 'New' }));
    link.appendChild(meta);
    link.appendChild(el('h3', { text: b.title }));
    link.appendChild(el('p', { cls: 'by', text: b.authors || 'Unknown author' }));
    art.appendChild(link);
    art.appendChild(saveButton(b));
    return art;
  }

  function showSkeleton(n) {
    for (var i = 0; i < n; i++) {
      var s = el('div', { cls: 'card skeleton' }, [
        el('div', { cls: 'cover' }), el('div', { cls: 'bar' }), el('div', { cls: 'bar short' })
      ]);
      els.grid.appendChild(s);
    }
  }
  function clearSkeleton() {
    Array.prototype.slice.call(els.grid.querySelectorAll('.skeleton')).forEach(function (n) { n.remove(); });
  }

  // ---------- pick of the day ----------
  function renderFeature(b) {
    var f = els.feature;
    f.textContent = '';
    tint(f, b.genre);
    var snippet = String(b.snippet || '');
    if (snippet.length >= 220) snippet = snippet.replace(/\s+\S*$/, '') + '…';

    var surprise = el('button', { cls: 'btn', text: 'Surprise me' });
    surprise.type = 'button';
    surprise.addEventListener('click', function () { surpriseMe(surprise); });

    f.appendChild(coverEl(b));
    f.appendChild(el('div', null, [
      el('div', null, [
        el('span', { cls: 'pick-tag', text: 'Pick of the day' }),
        el('span', { cls: 'card-genre', text: b.genre })
      ]),
      el('h2', { text: b.title }),
      el('p', { cls: 'by', text: b.authors || 'Unknown author' }),
      snippet ? el('p', { cls: 'quote' }, [el('mark', { text: snippet })]) : null,
      el('div', { cls: 'feature-actions' }, [
        el('a', { cls: 'btn primary', href: '#/book/' + b.id, text: 'Read the summary' }),
        surprise
      ])
    ]));
    f.hidden = false;
  }

  async function surpriseMe(btn) {
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = 'Finding a book…';
    try {
      var first = await api('/api/books?limit=1');
      var total = Math.min(first.total || 0, 1000);
      if (!total) return;
      var n = 1 + Math.floor(Math.random() * total);
      var r = await api('/api/books?limit=1&page=' + n);
      if (r.items && r.items[0]) location.hash = '#/book/' + r.items[0].id;
    } catch (e) {
      setStatus(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  // ---------- genres and tabs ----------
  function chip(value, label, count) {
    var b = el('button', { cls: 'chip' });
    b.type = 'button';
    b.dataset.value = value;
    if (value) { tint(b, value); b.appendChild(el('span', { cls: 'dot' })); } else { b.classList.add('all'); }
    b.appendChild(document.createTextNode(label));
    if (count != null) b.appendChild(el('span', { cls: 'count', text: String(count) }));
    b.setAttribute('aria-pressed', String(state.genre === value));
    b.addEventListener('click', function () { state.genre = value; refreshChips(); load(true); });
    return b;
  }

  function refreshChips() {
    Array.prototype.forEach.call(els.genres.children, function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.value === state.genre));
    });
  }

  async function loadGenres() {
    try {
      var genres = await api('/api/genres');
      els.genres.textContent = '';
      els.genres.appendChild(chip('', 'All genres', null));
      genres.forEach(function (g) { els.genres.appendChild(chip(g.genre, g.genre, g.count)); });
    } catch (e) { /* the list load shows the error */ }
  }

  function setMode(mode) {
    state.mode = mode;
    els.tabNew.classList.toggle('active', mode === 'new');
    els.tabAll.classList.toggle('active', mode === 'all');
    els.tabSaved.classList.toggle('active', mode === 'saved');
  }

  function switchTab(mode) {
    state.q = '';
    els.search.value = '';
    setMode(mode);
    load(true);
  }
  els.tabNew.addEventListener('click', function () { switchTab('new'); });
  els.tabAll.addEventListener('click', function () { switchTab('all'); });
  els.tabSaved.addEventListener('click', function () { switchTab('saved'); });
  els.more.addEventListener('click', function () { state.page += 1; load(false); });

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    state.q = els.search.value.trim();
    setMode(state.q ? 'all' : 'new');
    if (/^#\/book\//.test(location.hash)) {
      state.rendered = false; // returning to the list must reload it
      location.hash = '#/';
    } else {
      load(true);
    }
  });

  // ---------- list ----------
  function renderSaved() {
    els.feature.hidden = true;
    els.more.hidden = true;
    els.grid.textContent = '';
    var q = state.q.toLowerCase();
    var items = readSaved().filter(function (b) {
      return (!state.genre || b.genre === state.genre) &&
        (!q || (b.title + ' ' + (b.authors || '')).toLowerCase().indexOf(q) !== -1);
    });
    items.forEach(function (b) { els.grid.appendChild(card(b)); });
    setStatus(items.length
      ? items.length + (items.length === 1 ? ' saved book' : ' saved books')
      : 'Nothing saved yet. Tap the heart on any book to keep it here. Saved books stay in this browser.');
    state.rendered = true;
  }

  async function load(reset) {
    if (state.mode === 'saved') { renderSaved(); return; }
    var token = ++state.token;
    if (reset) {
      state.page = 1; state.loaded = 0;
      els.grid.textContent = '';
      els.more.hidden = true;
      els.feature.hidden = true;
      setStatus('');
      showSkeleton(10);
    }
    var latestMode = state.mode === 'new' && !state.q;
    var path = latestMode
      ? '/api/books/latest' + qs({ genre: state.genre, page: state.page })
      : '/api/books' + qs({ genre: state.genre, q: state.q, page: state.page });
    try {
      var data = await api(path, function () {
        if (token === state.token) setStatus('The server is waking up. This can take up to a minute…');
      });
      if (token !== state.token) return;
      clearSkeleton();
      if (latestMode && data.added_on) state.latest = data.added_on;
      state.total = data.total;

      var items = data.items;
      var showFeature = reset && latestMode && !state.genre && items.length > 0;
      var pick = null;
      if (showFeature) {
        pick = items.filter(function (b) { return safeUrl(b.cover_url); })[0] || items[0];
        renderFeature(pick);
      }
      items.forEach(function (b) { if (b !== pick) els.grid.appendChild(card(b, !latestMode)); });
      state.loaded += items.length;
      els.more.hidden = state.loaded >= state.total;
      state.rendered = true;

      if (state.total === 0) {
        if (state.q) setStatus('No books match "' + state.q + '". Try a shorter title or an author’s name.');
        else if (state.genre) setStatus('No ' + state.genre + ' books yet. New ones arrive every day.');
        else setStatus('No books yet. The first daily update has not run.');
      } else if (latestMode && state.latest) {
        setStatus(state.total + ' new ' + (state.total === 1 ? 'book' : 'books') + ' added ' + friendlyDate(state.latest));
      } else {
        setStatus(state.total + (state.total === 1 ? ' book' : ' books') +
          (state.q ? ' for "' + state.q + '"' : state.genre ? ' in ' + state.genre : ''));
      }
    } catch (e) {
      if (token !== state.token) return;
      clearSkeleton();
      setStatus(e.message, function () { load(reset); });
    }
  }

  // ---------- book page ----------
  function addParagraphs(parent, text) {
    String(text || '').split(/\n+/).forEach(function (para) {
      if (para.trim()) parent.appendChild(el('p', { text: para.trim() }));
    });
  }

  function readMinutes(b) {
    var parts = [b.overview, b.summary, (b.main_points || []).join(' '), (b.examples || []).join(' '), b.explanation, b.who_should_read];
    var d = b.deep;
    if (d) {
      parts = [b.overview, d.big_idea, d.summary, d.easy_explanation, d.final_takeaway, b.who_should_read, (d.top_three || []).join(' ')];
      (d.key_points || []).forEach(function (k) { parts.push(k.point, k.explanation); });
      (d.examples || []).forEach(function (e) { parts.push(e.example, e.lesson); });
      (d.tips || []).forEach(function (t) { parts.push(t.title, t.detail); });
      (d.frameworks || []).forEach(function (f) { (f.steps || []).forEach(function (st) { parts.push(st.name, st.detail); }); });
      ((d.action_plan || {}).steps || []).forEach(function (st) { parts.push(st.focus, st.task); });
    }
    var words = parts.join(' ').split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }

  // The full study guide: big idea, frameworks, key points, examples, tips, plan, takeaways.
  // jump collects { id, label } so long guides get a row of "go to" buttons.
  function renderDeep(read, b, d, jump) {
    function heading(text, id, label) {
      var n = el('h2', { text: text });
      if (id) { n.id = 'sec-' + id; jump.push({ id: id, label: label || text }); }
      return n;
    }

    if (d.big_idea) read.appendChild(el('p', { cls: 'bigidea' }, [el('mark', { text: d.big_idea })]));
    if (b.overview) {
      read.appendChild(heading('About this book'));
      addParagraphs(read, b.overview);
    }
    read.appendChild(heading('Summary', 'summary'));
    addParagraphs(read, d.summary);
    read.appendChild(heading('Easy explanation', 'easy'));
    addParagraphs(read, d.easy_explanation);

    (d.frameworks || []).forEach(function (f, i) {
      read.appendChild(heading(f.title, 'framework' + i, f.title.length > 22 ? 'Framework' : f.title));
      var ol = el('ol', { cls: 'steps' });
      (f.steps || []).forEach(function (st) {
        ol.appendChild(el('li', null, [
          st.name ? el('strong', { text: st.name }) : null,
          st.detail ? document.createTextNode((st.name ? ' ' : '') + st.detail) : null
        ]));
      });
      read.appendChild(ol);
    });

    read.appendChild(heading('Key points', 'points'));
    var kps = el('div', { cls: 'kps' });
    (d.key_points || []).forEach(function (k, i) {
      var hl = el('span', { cls: 'hl', text: k.point });
      hl.style.setProperty('--i', String(Math.min(i, 8)));
      kps.appendChild(el('div', { cls: 'kp' }, [
        el('p', { cls: 'kp-point' }, [hl]),
        k.explanation ? el('p', { cls: 'kp-why', text: k.explanation }) : null
      ]));
    });
    read.appendChild(kps);

    read.appendChild(heading('Examples', 'examples'));
    (d.examples || []).forEach(function (e) {
      var ex = el('div', { cls: 'ex' }, [el('p', { cls: 'ex-text', text: e.example })]);
      if (e.lesson) {
        ex.appendChild(el('p', { cls: 'ex-lesson' }, [el('strong', { text: 'What it shows: ' }), document.createTextNode(e.lesson)]));
      }
      read.appendChild(ex);
    });

    if (d.tips && d.tips.length) {
      read.appendChild(heading('Tips you can use', 'tips', 'Tips'));
      d.tips.forEach(function (t) {
        read.appendChild(el('div', { cls: 'tip' }, [
          t.title ? el('strong', { text: t.title }) : null,
          t.detail ? el('p', { text: t.detail }) : null
        ]));
      });
    }

    var plan = d.action_plan;
    if (plan && plan.steps && plan.steps.length) {
      read.appendChild(heading(plan.title || 'Put it into practice', 'plan', 'Action plan'));
      var table = el('table');
      table.appendChild(el('thead', null, [el('tr', null, [
        el('th', { text: 'When' }), el('th', { text: 'Focus' }), el('th', { text: 'What to do' })
      ])]));
      var body = el('tbody');
      plan.steps.forEach(function (st) {
        var cells = [['When', st.period], ['Focus', st.focus], ['What to do', st.task]].map(function (c) {
          var td = el('td', { text: c[1] });
          td.setAttribute('data-label', c[0]);
          return td;
        });
        body.appendChild(el('tr', null, cells));
      });
      table.appendChild(body);
      read.appendChild(el('div', { cls: 'tablewrap' }, [table]));
    }

    if (d.top_three && d.top_three.length) {
      read.appendChild(heading('If you remember only three things', 'three', 'Top three'));
      var ol3 = el('ol', { cls: 'steps top3' });
      d.top_three.forEach(function (t, i) {
        var hl = el('span', { cls: 'hl', text: t });
        hl.style.setProperty('--i', String(i));
        ol3.appendChild(el('li', null, [hl]));
      });
      read.appendChild(ol3);
    }

    if (d.final_takeaway) {
      read.appendChild(heading('The takeaway'));
      read.appendChild(el('p', { cls: 'takeaway', text: d.final_takeaway }));
    }
  }

  function jumpRow(items) {
    var row = el('div', { cls: 'jump' });
    row.setAttribute('role', 'navigation');
    row.setAttribute('aria-label', 'Sections of this guide');
    items.forEach(function (it) {
      var btn = el('button', { text: it.label });
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var target = document.getElementById('sec-' + it.id);
        if (!target) return;
        var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      });
      row.appendChild(btn);
    });
    return row;
  }

  function shareButton(b) {
    var btn = el('button', { cls: 'btn', text: 'Share' });
    btn.type = 'button';
    btn.addEventListener('click', async function () {
      try {
        if (navigator.share) {
          await navigator.share({ title: b.title, url: location.href });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(location.href);
          btn.textContent = 'Link copied';
          setTimeout(function () { btn.textContent = 'Share'; }, 2000);
        }
      } catch (e) { /* the person cancelled sharing */ }
    });
    return btn;
  }

  async function showDetail(id) {
    if (!els.list.hidden) state.scrollY = window.scrollY;
    els.list.hidden = true;
    els.detail.hidden = false;
    els.detail.textContent = 'Loading…';
    window.scrollTo(0, 0);
    try {
      var b = await api('/api/books/' + encodeURIComponent(id), function () {
        els.detail.textContent = 'The server is waking up. This can take up to a minute…';
      });
      els.detail.textContent = '';
      var root = el('article', { cls: 'detail' });
      tint(root, b.genre);

      var actions = el('div', { cls: 'detail-actions' });
      var save = saveButton(b, true);
      save.className = 'btn primary';
      save.style.position = 'static';
      save.style.width = 'auto';
      save.style.height = 'auto';
      save.style.borderRadius = '6px';
      actions.appendChild(save);
      actions.appendChild(shareButton(b));
      var link = safeUrl(b.info_link);
      if (link) {
        var a = el('a', { cls: 'btn', href: link, text: 'View on Google Books' });
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        actions.appendChild(a);
      }

      var smart = b.summary_source === 'ai';
      var main = el('div', { cls: 'detail-main' }, [
        el('div', { cls: 'badges' }, [
          el('span', { cls: 'badge genre', text: b.genre }),
          el('span', { cls: smart ? 'badge smart' : 'badge', text: smart ? 'Smart summary' : 'Publisher summary' }),
          el('span', { cls: 'badge', text: readMinutes(b) + ' min read' })
        ]),
        el('h1', { text: b.title }),
        el('p', { cls: 'by', text: b.authors || 'Unknown author' })
      ]);
      if (b.published_date) main.appendChild(el('p', { cls: 'by', text: 'Published ' + b.published_date }));

      var read = el('div', { cls: 'read' });
      var d = b.deep;
      var jump = [];
      if (d) {
        renderDeep(read, b, d, jump);
      } else {
        if (b.overview) {
          read.appendChild(el('h2', { text: 'About this book' }));
          addParagraphs(read, b.overview);
        }
        read.appendChild(el('h2', { text: 'The short version' }));
        addParagraphs(read, b.summary);
        if (b.main_points && b.main_points.length) {
          read.appendChild(el('h2', { text: 'Key points' }));
          var ul = el('ul');
          b.main_points.forEach(function (t, i) {
            var hl = el('span', { cls: 'hl', text: t });
            hl.style.setProperty('--i', String(i));
            ul.appendChild(el('li', null, [hl]));
          });
          read.appendChild(ul);
        }
        if (b.examples && b.examples.length) {
          read.appendChild(el('h2', { text: 'Examples' }));
          b.examples.forEach(function (t) {
            read.appendChild(el('div', { cls: 'ex' }, [el('p', { cls: 'ex-text', text: t })]));
          });
        }
        if (b.explanation) {
          read.appendChild(el('h2', { text: 'Explained simply' }));
          addParagraphs(read, b.explanation);
        }
      }
      if (b.who_should_read) {
        read.appendChild(el('h2', { text: 'Who it\u2019s for' }));
        addParagraphs(read, b.who_should_read);
      }
      if (d && d.confidence === 'low') {
        main.appendChild(el('p', { cls: 'fine', text: 'Based on the publisher\u2019s description, so this guide stays general.' }));
      }
      if (jump.length >= 4) main.appendChild(jumpRow(jump));
      main.appendChild(read);

      root.appendChild(el('a', { cls: 'back', href: '#/', text: 'Back to books' }));
      root.appendChild(el('div', { cls: 'detail-grid' }, [
        el('aside', { cls: 'detail-side' }, [coverEl(b), actions]),
        main
      ]));
      els.detail.appendChild(root);
      document.title = b.title + ' | Daily Bookstore';
      loadRelated(b, root);
    } catch (e) {
      els.detail.textContent = '';
      els.detail.appendChild(el('a', { cls: 'back', href: '#/', text: 'Back to books' }));
      els.detail.appendChild(el('p', { text: e.message }));
    }
  }

  async function loadRelated(b, root) {
    try {
      var data = await api('/api/books' + qs({ genre: b.genre, limit: '6' }));
      var others = data.items.filter(function (x) { return x.id !== b.id; }).slice(0, 5);
      if (!others.length || els.detail.hidden) return;
      var grid = el('div', { cls: 'grid' });
      others.forEach(function (x) { grid.appendChild(card(x, true)); });
      root.appendChild(el('section', { cls: 'related' }, [el('h2', { text: 'More in ' + b.genre }), grid]));
    } catch (e) { /* related books are optional */ }
  }

  window.addEventListener('scroll', function () {
    if (els.detail.hidden) { els.progress.style.width = '0'; return; }
    var max = document.documentElement.scrollHeight - window.innerHeight;
    els.progress.style.width = max > 0 ? Math.min(100, (window.scrollY / max) * 100) + '%' : '0';
  }, { passive: true });

  // ---------- routing ----------
  function route() {
    var m = /^#\/book\/(\d+)$/.exec(location.hash);
    if (m) { showDetail(m[1]); return; }
    els.progress.style.width = '0';
    els.detail.hidden = true;
    els.list.hidden = false;
    document.title = 'Daily Bookstore';
    if (state.rendered) {
      window.scrollTo(0, state.scrollY || 0); // coming back from a book: keep the shelf as it was
    } else {
      load(true);
    }
  }

  window.addEventListener('hashchange', route);
  updateSavedCount();
  loadGenres();
  route();
})();

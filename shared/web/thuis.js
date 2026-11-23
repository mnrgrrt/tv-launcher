/* Thuis 1.00: startscherm. Alle gegevens komen van tv-serverr; Android speelt af en opent apps.
   Bediening: pijltjes, OK en terug. OK ingedrukt houden is een snelkoppeling, nooit de enige weg. */
(function () {
  'use strict';
  var N = window.Native || null;               // Android-brug; null in een gewone browser
  var $app = document.getElementById('app');
  // Alles is ontworpen op 1920x1080; op een tv met een ander aantal css-pixels schalen we het geheel.
  var SCALE = 1;
  function fit() { SCALE = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1; document.body.style.transformOrigin = '0 0'; document.body.style.transform = SCALE === 1 ? '' : 'scale(' + SCALE + ')'; }
  fit(); window.addEventListener('resize', fit);

  // ---------- hulpjes ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(t) { var d = new Date(t); return d.getHours() + ':' + pad(d.getMinutes()); }
  function dayName(t) {
    var d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
    var diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5);
    if (diff === 0) return 'Vandaag'; if (diff === 1) return 'Morgen'; if (diff === -1) return 'Gisteren';
    return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' });
  }
  var toastT = 0;
  function toast(msg, ms) {
    var t = document.getElementById('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3500);
  }

  // ---------- server ----------
  var cbs = {}, cbId = 0;
  window.__nativeCb = function (id, ok, data) { var c = cbs[id]; delete cbs[id]; if (!c) return; if (ok) c.res(data); else c.rej(new Error(data)); };
  function native(fn) { var args = [].slice.call(arguments, 1); return new Promise(function (res, rej) { var id = ++cbId; cbs[id] = { res: res, rej: rej }; N[fn].apply(N, [id].concat(args)); }); }
  // In een browser (testen op de pc): rechtstreeks met een sleutel uit localStorage.
  function api(method, path, body) {
    if (N) return native('srv', method, path, body ? JSON.stringify(body) : '').then(function (t) { return t ? JSON.parse(t) : {}; }, onApiError);
    var key = ''; try { key = localStorage.getItem('thuis-key') || ''; } catch (e) {}
    return fetch(path, { method: method, headers: { 'X-Thuis-Key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { if (r.status === 401) throw new Error('NIET_GEKOPPELD'); return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function onApiError(e) { if (e.message === 'NIET_GEKOPPELD') { if (N) N.srvUnpair(); go('pair', {}, true); } throw e; }
  var get = function (p) { return api('GET', p); };
  // Plaatjes: van de server (pad met /) via de app, https rechtstreeks, http via de app (anders blokkeert de pagina ze).
  function img(u) {
    if (!u) return '';
    if (u.charAt(0) === '/') return N ? 'https://appassets.androidplatform.net/srv' + u : u;
    if (u.indexOf('http://') === 0) return N ? 'https://appassets.androidplatform.net/proxy?u=' + encodeURIComponent(u) : u;
    return u;
  }
  function bg(u) { return u ? "background-image:url('" + img(u).replace(/'/g, '%27') + "')" : ''; }

  // ---------- toestand ----------
  var S = { profile: 0, profiles: [], device: null, services: [], apps: null, cats: null, reminders: {} };
  try { S.reminders = JSON.parse(localStorage.getItem('thuis-herinneringen') || '{}'); } catch (e) {}
  function me() { for (var i = 0; i < S.profiles.length; i++) if (S.profiles[i].id === S.profile) return S.profiles[i]; return S.profiles[0] || { id: 1, name: 'Samen', avatarUrl: '' }; }
  function setProfile(id) { S.profile = id; if (N) N.srvSetProfile(id); }

  // ---------- focus en bediening ----------
  var root = null, cur = null;
  function focusables() { return [].slice.call(root.querySelectorAll('.f')).filter(function (e) { return e.offsetParent !== null; }); }
  function focus(el, noScroll) {
    if (!el) return;
    if (cur) cur.classList.remove('focus');
    cur = el; el.classList.add('focus');
    if (!noScroll) reveal(el);
    if (el._onfocus) el._onfocus();
  }
  function reveal(el) {
    var row = el.closest('.row');
    if (row) {
      var r = el.getBoundingClientRect(), shift = parseFloat(row.dataset.x || 0), L = r.left / SCALE, R = r.right / SCALE;
      if (R > 1840) shift -= R - 1840; else if (L < 80) shift += 80 - L;
      shift = Math.min(0, shift); row.dataset.x = shift; row.style.transform = 'translateX(' + shift + 'px)';
    }
    var inner = el.closest('.scroll-inner');
    if (inner) {
      var box = (el.closest('.section') || el).getBoundingClientRect(), y = parseFloat(inner.dataset.y || 0), T = box.top / SCALE, B = box.bottom / SCALE;
      if (B > 1060) y -= B - 1060; else if (T < 130) y += 130 - T;
      if (el.closest('.first')) y = 0;
      y = Math.min(0, y); inner.dataset.y = y; inner.style.transform = 'translateY(' + y + 'px)';
    }
  }
  function move(dir) {
    var all = focusables(); if (!all.length) return;
    if (!cur || all.indexOf(cur) < 0) return focus(all[0]);
    if (cur._move && cur._move(dir) === true) return;
    var a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2, best = null, bestScore = 1e9;
    var group = cur.dataset.group;
    all.forEach(function (el) {
      if (el === cur) return;
      var b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2, main, side;
      if (dir === 'right') { if (b.left < a.right - 4 && bx <= ax) return; main = b.left - a.right; side = Math.abs(by - ay); if (!(b.top < a.bottom && b.bottom > a.top)) return; }
      else if (dir === 'left') { if (b.right > a.left + 4 && bx >= ax) return; main = a.left - b.right; side = Math.abs(by - ay); if (!(b.top < a.bottom && b.bottom > a.top)) return; }
      else if (dir === 'down') { if (b.top < a.bottom - 4 && by <= ay) return; main = b.top - a.bottom; side = Math.abs(bx - ax); }
      else { if (b.bottom > a.top + 4 && by >= ay) return; main = a.top - b.bottom; side = Math.abs(bx - ax); }
      if ((dir === 'left' || dir === 'right') && group && el.dataset.group !== group) side += 4000;
      var score = Math.max(0, main) + side * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) focus(best);
  }
  var okDown = 0, longFired = false;
  // Sommige tv's geven geen e.key mee maar alleen een code (23 = OK op Android).
  var CODES = { 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 13: 'Enter', 23: 'Enter', 66: 'Enter', 160: 'Enter', 27: 'Escape', 8: 'Backspace', 4: 'GoBack', 461: 'GoBack' };
  function keyOf(e) { return (e.key && e.key !== 'Unidentified' && e.key !== 'Process') ? e.key : (CODES[e.keyCode] || ''); }
  document.addEventListener('keydown', function (e) {
    var k = keyOf(e);
    if (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); move(k.slice(5).toLowerCase()); return; }
    if (k === 'Enter') {
      e.preventDefault();
      if (!e.repeat) { okDown = Date.now(); longFired = false; return; }
      if (!longFired && Date.now() - okDown > 600 && cur && cur._long) { longFired = true; cur._long(); }
      return;
    }
    if (k === 'Escape' || k === 'Backspace' || k === 'GoBack') { if (!(e.target && e.target.tagName === 'INPUT')) { e.preventDefault(); back(); } }
  });
  document.addEventListener('keyup', function (e) {
    if (keyOf(e) !== 'Enter') return;
    e.preventDefault();
    if (!longFired && cur && cur._ok) cur._ok();
    longFired = false;
  });
  document.addEventListener('click', function (e) { var f = e.target.closest('.f'); if (f) { focus(f); if (f._ok) f._ok(); } });
  window.__back = back;

  function F(el, ok, opts) { el.classList.add('f'); el._ok = ok; if (opts) { el._long = opts.long; el._onfocus = opts.focus; el._move = opts.move; if (opts.group) el.dataset.group = opts.group; } return el; }

  // ---------- schermen en terug ----------
  var stack = [], overlay = null, current = null;
  var screens = {};
  function go(name, args, replace) {
    closeOverlay();
    if (current && !replace) stack.push(current);
    if (replace) stack = [];
    current = { name: name, args: args || {} };
    render();
  }
  function render() {
    $app.innerHTML = ''; root = $app; cur = null;
    var el = screens[current.name](current.args) || null;
    if (el) $app.appendChild(el);
    var want = current.args._focus && $app.querySelector(current.args._focus);
    focus(want || firstContent());
  }
  // Eerste knop in de inhoud (niet de bovenbalk); komt de inhoud later binnen, dan pakt contentReady() het op.
  function firstContent() { var all = focusables(); return all.filter(function (e) { return !e.closest('.top'); })[0] || all[0]; }
  function contentReady() { if (!overlay && (!cur || cur.closest('.top'))) { var f = firstContent(); if (f && !f.closest('.top')) focus(f); } }
  function back() {
    if (overlay) { var o = overlay; closeOverlay(); if (o._onclose) o._onclose(); return; }
    if (current && current.args && current.args._onback && current.args._onback() === true) return;
    if (stack.length) { current = stack.pop(); render(); return; }
    if (current && current.name !== 'home' && S.profile) go('home', {}, true);
  }
  function openOverlay(el, onclose) {
    closeOverlay();
    overlay = h('div', { class: 'overlay' }); overlay.appendChild(el); overlay._prev = cur; overlay._onclose = onclose;
    $app.appendChild(overlay); root = overlay; cur = null; focus(focusables()[0]);
  }
  function closeOverlay() {
    if (!overlay) return;
    var prev = overlay._prev; overlay.remove(); overlay = null; root = $app;
    if (prev && document.body.contains(prev)) focus(prev, true); else focus(focusables()[0]);
  }

  // ---------- bovenbalk ----------
  var TABS = [['home', 'Thuis'], ['live', 'Live tv'], ['films', 'Films'], ['series', 'Series'], ['search', 'Zoeken']];
  function topbar(active) {
    var bar = h('div', { class: 'top' }), left = h('div', { class: 'left' }, '<span class="brand">thuis</span>');
    TABS.forEach(function (t) {
      var p = F(h('button', { class: 'pill' + (t[0] === active ? ' on' : '') }, t[1]), function () { go(t[0], {}, true); }, { group: 'top' });
      if (t[0] === active) p.dataset.active = '1';
      left.appendChild(p);
    });
    var right = h('div', { class: 'right' });
    var tm = h('span', null, clock(Date.now())); right.appendChild(tm);
    var gear = F(h('button', { class: 'pill', 'aria-label': 'Instellingen' }, '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>'), function () { go('settings'); }, { group: 'top' });
    right.appendChild(gear);
    var av = F(h('button', { class: 'avatar-btn', 'aria-label': 'Mijn profiel' }, '<img class="avatar" alt="" src="' + esc(img(me().avatarUrl)) + '">'), function () { go('profile'); }, { group: 'top', long: function () { whoDialog(); } });
    right.appendChild(av);
    bar.appendChild(left); bar.appendChild(right);
    return bar;
  }
  setInterval(function () { var t = document.querySelector('.top .right span'); if (t) t.textContent = clock(Date.now()); checkReminders(); }, 20000);

  // ---------- tegels ----------
  function rowSection(title, items, sub) {
    if (!items.length) return document.createTextNode('');
    setTimeout(contentReady, 0);
    var sec = h('div', { class: 'section' }, '<h2>' + esc(title) + (sub ? ' <small>· ' + esc(sub) + '</small>' : '') + '</h2>');
    var clip = h('div', { class: 'row-clip' }), row = h('div', { class: 'row' });
    items.forEach(function (it) { row.appendChild(it); });
    clip.appendChild(row); sec.appendChild(clip);
    return sec;
  }
  function wide(o) {   // 16:9-tegel: {title, sub, img, badge, live, progress, ok, long}
    var el = h('button', { class: 'row-item' });
    el.innerHTML = '<div class="thumb" style="' + bg(o.img) + '">' + (o.badge ? '<span class="badge' + (o.live ? ' live' : '') + '">' + esc(o.badge) + '</span>' : '') +
      (o.progress > 0 ? '<div class="bar"><i style="width:' + Math.round(o.progress * 100) + '%"></i></div>' : '') + '</div>' +
      '<div class="t1">' + esc(o.title) + '</div>' + (o.sub ? '<div class="t2">' + esc(o.sub) + '</div>' : '');
    return F(el, o.ok, { long: o.long, focus: o.focus });
  }
  function poster(o) {  // staand: {title, sub, img, badge, ok, long}
    var el = h('button', { class: 'poster' });
    el.innerHTML = '<div class="pimg" style="' + bg(o.img) + '">' + (o.badge ? '<div class="thumb" style="position:absolute;inset:0;background:none"><span class="badge">' + esc(o.badge) + '</span></div>' : '') +
      (o.img ? '' : '<div style="padding:18px;font-size:22px;font-weight:600">' + esc(o.title) + '</div>') + '</div>' +
      '<div class="t1">' + esc(o.title) + '</div>' + (o.sub ? '<div class="t2">' + esc(o.sub) + '</div>' : '');
    return F(el, o.ok, { long: o.long, focus: o.focus });
  }
  function loading(text) { return h('div', { class: 'spinner' }, esc(text || 'Laden…')); }

  // ---------- afspelen ----------
  function position(key) { return get('/api/position?profile=' + S.profile + '&key=' + encodeURIComponent(key)).then(function (r) { return r.pos || 0; }, function () { return 0; }); }
  function start(item) {
    item.server = true; item.profile = S.profile;
    if (N) N.playItem(JSON.stringify(item)); else toast('Afspelen kan alleen op de tv');
  }
  // Wie kijkt er? Alleen vragen als dat zo is ingesteld, of als iemand anders deze titel aan het kijken is.
  function askWho(key) {
    var ask = (S.device && S.device.ask) || 'samen';
    if (S.device && S.device.locked) return Promise.resolve();
    return get('/api/watchers?key=' + encodeURIComponent(key) + '&profile=' + S.profile).then(function (w) {
      if (ask === 'nooit' && !w.length) return;
      if (!w.length && !(ask === 'altijd' || (ask === 'samen' && S.profile === 1))) return;
      return new Promise(function (resolve) {
        var d = h('div', { class: 'dialog' });
        var first = w[0];
        d.appendChild(h('h2', null, first ? esc(first.name) + ' kijkt dit, verder als ' + esc(first.name) + '?' : 'Wie kijkt er?'));
        if (first) d.appendChild(h('div', { class: 'dim', style: 'font-size:22px' }, 'Dan gaat het verder waar ' + esc(first.name) + ' was, en telt het kijken bij ' + esc(first.name) + '.'));
        var row = h('div', { class: 'who' }), order = [];
        if (first) order.push(first.id);
        order.push(S.profile);
        S.profiles.forEach(function (p) { if (order.indexOf(p.id) < 0) order.push(p.id); });
        var left = 6, timer;
        var note = h('div', { class: 'dim', style: 'font-size:20px' });
        order.forEach(function (id) {
          var p = S.profiles.filter(function (x) { return x.id === id; })[0]; if (!p) return;
          row.appendChild(F(h('button', { class: 'who-item' }, '<img alt="" src="' + esc(img(p.avatarUrl)) + '"><span>' + esc(p.name) + '</span>'), function () {
            clearInterval(timer); setProfile(p.id); closeOverlay(); resolve();
          }, { focus: function () { clearInterval(timer); note.textContent = ''; } }));
        });
        d.appendChild(row);
        var keep = me();
        note.textContent = 'Over 5 seconden verder als ' + keep.name; d.appendChild(note);
        openOverlay(d, function () { clearInterval(timer); });
        // De focus staat op de eerste (het voorstel); na 5 s zonder keuze: verder als het huidige profiel.
        timer = setInterval(function () { left--; if (left <= 0) { clearInterval(timer); closeOverlay(); resolve(); } else note.textContent = 'Over ' + left + ' seconden verder als ' + keep.name; }, 1000);
      });
    }, function () {});
  }
  function playPlex(key, meta) {
    var k = 'plex:' + key;
    return askWho(k).then(function () { return Promise.all([get('/api/plex/play/' + key), position(k)]); }).then(function (r) {
      var it = r[0]; if (r[1] > 0) it.offsetMs = r[1];
      it.meta = Object.assign({ title: it.title, sub: it.sub, img: it.img, plexKey: key }, meta || {});
      start(it);
    }).catch(function (e) { toast('Afspelen lukt niet: ' + e.message); });
  }
  function playMovie(m) {   // IPTV-film uit de catalogus
    var k = 'movie:' + m.id;
    return askWho(k).then(function () { return Promise.all([m.url ? Promise.resolve({ url: m.url }) : get('/api/vod/movie/url/' + m.id + '?ext=' + (m.ext || 'mp4')), position(k)]); }).then(function (r) {
      start({ kind: 'movie', key: k, url: r[0].url, title: m.name || m.title, sub: m.year || '', tmdb: m.tmdb || 0, offsetMs: r[1],
        meta: { title: m.name || m.title, sub: 'Film', img: m.backdrop || m.icon || m.img || '', id: m.id, ext: m.ext, tmdb: m.tmdb || 0 } });
    }).catch(function (e) { toast('Afspelen lukt niet: ' + e.message); });
  }
  function playEpisode(series, season, ep) {   // IPTV-aflevering
    var k = 'series:' + ep.id, sk = 'series:' + series.id;
    return askWho(sk).then(function () { return position(k); }).then(function (pos) {
      start({ kind: 'series', key: k, seriesKey: sk, url: ep.url, title: series.name, sub: 'S' + season + ' · afl. ' + ep.num + (ep.title ? ' · ' + ep.title : ''),
        season: +season, episode: ep.num, tmdb: series.tmdb || 0, offsetMs: pos,
        meta: { title: series.name, sub: 'S' + season + ' · afl. ' + ep.num, img: ep.img || series.backdrop || series.icon || '', id: ep.id, ext: ep.ext, seriesId: series.id } });
    }).catch(function (e) { toast('Afspelen lukt niet: ' + e.message); });
  }
  function resume(c) {      // tegel uit Verder kijken
    var key = String(c.key || '');
    if (key.indexOf('plex:') === 0) return playPlex(key.slice(5), c);
    if (key.indexOf('movie:') === 0) return playMovie({ id: c.id || key.slice(6), ext: c.ext, name: c.title, img: c.img, tmdb: c.tmdb });
    if (key.indexOf('series:') === 0) {
      var id = c.id || key.slice(7);
      return Promise.all([get('/api/vod/series/url/' + id + '?ext=' + (c.ext || 'mkv')), position(key)]).then(function (r) {
        start({ kind: 'series', key: key, seriesKey: 'series:' + c.seriesId, url: r[0].url, title: c.title, sub: c.sub, season: c.season, episode: c.episode, offsetMs: r[1], meta: c });
      });
    }
    if (key.indexOf('catchup:') === 0) return toast('Kijk verder via de gids');
  }
  function playLive(catId, ch) { if (N) N.playLive(catId || 'alle', ch.id); else toast('Live tv kan alleen op de tv'); }
  function playCatchup(ch, p) {
    get('/api/live/catchup/' + ch.id + '?start=' + p.start + '&end=' + p.end).then(function (r) {
      start({ kind: 'catchup', key: 'catchup:' + ch.id + ':' + p.start, url: r.url, title: p.title, sub: ch.name + ' · ' + dayName(p.start) + ' ' + clock(p.start),
        meta: { title: p.title, sub: ch.name + ' · terugkijken', img: '' } });
    }).catch(function (e) { toast('Terugkijken lukt niet: ' + e.message); });
  }
  function openApp(pkgOrMatch) {
    if (!N) return toast('Apps openen kan alleen op de tv');
    loadApps().then(function (apps) {
      var m = String(pkgOrMatch).toLowerCase();
      var a = apps.filter(function (x) { return x.pkg === pkgOrMatch || x.pkg.toLowerCase().indexOf(m) >= 0 || x.label.toLowerCase().indexOf(m) >= 0; })[0];
      if (a) N.launch(a.pkg); else toast('Deze app staat niet op dit apparaat');
    });
  }
  function loadApps() { if (S.apps) return Promise.resolve(S.apps); if (!N) return Promise.resolve([]); return native('getApps').then(function (t) { S.apps = JSON.parse(t); return S.apps; }); }

  // ---------- herinneringen ----------
  function toggleReminder(ch, p, catId) {
    var k = ch.id + ':' + p.start;
    if (S.reminders[k]) { delete S.reminders[k]; toast('Herinnering weg'); }
    else { S.reminders[k] = { ch: ch.id, name: ch.name, title: p.title, start: p.start, cat: catId }; toast('Herinnering gezet: ' + p.title + ', ' + dayName(p.start).toLowerCase() + ' ' + clock(p.start)); }
    try { localStorage.setItem('thuis-herinneringen', JSON.stringify(S.reminders)); } catch (e) {}
  }
  function checkReminders() {
    var now = Date.now();
    Object.keys(S.reminders).forEach(function (k) {
      var r = S.reminders[k];
      if (r.start - now < 60000 && r.start - now > -600000 && !overlay) {
        delete S.reminders[k]; try { localStorage.setItem('thuis-herinneringen', JSON.stringify(S.reminders)); } catch (e) {}
        var d = h('div', { class: 'dialog' }, '<h2>' + esc(r.title) + '</h2><div class="dim" style="font-size:24px">Begint nu op ' + esc(r.name) + '</div>');
        var bt = h('div', { style: 'display:flex;gap:16px' });
        bt.appendChild(F(h('button', { class: 'btn' }, 'Nu kijken'), function () { closeOverlay(); playLive(r.cat, { id: r.ch }); }));
        bt.appendChild(F(h('button', { class: 'btn' }, 'Niet nu'), closeOverlay));
        d.appendChild(bt); openOverlay(d);
      } else if (r.start < now - 600000) delete S.reminders[k];
    });
  }

  // ====================================================================
  // Schermen
  // ====================================================================

  // ---------- koppelen ----------
  screens.pair = function () {
    var info = N ? JSON.parse(N.srvInfo()) : { url: location.origin, device: 'browser' };
    var st = { field: 'code', url: info.url, code: '', name: info.device || 'tv' };
    var el = h('div', { class: 'screen' });
    el.innerHTML = '<div style="position:absolute;left:160px;top:120px;width:760px;display:flex;flex-direction:column;gap:22px">' +
      '<h1 style="font-size:60px">Thuis koppelen</h1><div class="dim" style="font-size:24px;line-height:1.5">Open de beheerpagina van tv-serverr op je pc of telefoon, kies <b>Nieuwe code</b> en vul die hier in. Daarna haalt deze tv alles van de server.</div>' +
      '<div class="dim" style="font-size:20px;margin-top:10px">Adres van tv-serverr</div><div class="field f" id="fu"></div>' +
      '<div class="dim" style="font-size:20px">Koppelcode (6 cijfers)</div><div class="field f" id="fc" style="letter-spacing:10px"></div>' +
      '<div class="dim" style="font-size:20px">Naam van dit apparaat</div><div class="field f" id="fn"></div>' +
      '<div style="display:flex;gap:16px;margin-top:10px"><button class="btn f" id="go">Koppelen</button></div><div id="err" style="font-size:22px;color:#ff8a80"></div></div>';
    var kbBox = h('div', { style: 'position:absolute;left:1040px;top:300px' });
    el.appendChild(kbBox);
    function paint() {
      el.querySelector('#fu').textContent = st.url; el.querySelector('#fc').textContent = st.code || '······'; el.querySelector('#fn').textContent = st.name;
      ['fu', 'fc', 'fn'].forEach(function (id) { el.querySelector('#' + id).style.borderColor = st.field === { fu: 'url', fc: 'code', fn: 'name' }[id] ? '#fff' : ''; });
    }
    function setField(f) { st.field = f; paint(); kbBox.innerHTML = ''; kbBox.appendChild(keyboard(f === 'code' ? '1234567890' : f === 'url' ? '1234567890.:/abcdefghijklmnopqrstuvwxyz-' : 'abcdefghijklmnopqrstuvwxyz1234567890-', function (ch) {
      if (ch === '⌫') st[f] = st[f].slice(0, -1); else if (ch === '␣') st[f] += ' '; else if (f !== 'code' || st.code.length < 6) st[f] += ch;
      paint();
    })); }
    F(el.querySelector('#fu'), function () { setField('url'); });
    F(el.querySelector('#fc'), function () { setField('code'); });
    F(el.querySelector('#fn'), function () { setField('name'); });
    F(el.querySelector('#go'), function () {
      el.querySelector('#err').textContent = 'Bezig…';
      if (!N) { el.querySelector('#err').textContent = 'Koppelen kan alleen op de tv'; return; }
      native('srvPair', st.url, st.code, st.name).then(function () { boot(); }, function (e) { el.querySelector('#err').textContent = e.message; });
    });
    setTimeout(function () { setField('code'); }, 0);
    paint();
    return el;
  };
  function keyboard(chars, onkey) {
    var kb = h('div', { class: 'kb' });
    chars.split('').forEach(function (c) { kb.appendChild(F(h('button', { class: 'key' }, esc(c)), function () { onkey(c); }, { group: 'kb' })); });
    kb.appendChild(F(h('button', { class: 'key wide' }, 'spatie'), function () { onkey('␣'); }, { group: 'kb' }));
    kb.appendChild(F(h('button', { class: 'key wide' }, 'wissen'), function () { onkey('⌫'); }, { group: 'kb' }));
    return kb;
  }

  // ---------- wie kijkt er ----------
  screens.who = function () {
    var el = h('div', { class: 'screen', style: 'background:radial-gradient(1200px 700px at 50% 30%, #13242e 0%, #05070a 70%)' });
    var box = h('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:90px' }, '<h1 style="font-size:64px;font-weight:600">Wie kijkt er?</h1>');
    var row = h('div', { class: 'who' });
    S.profiles.forEach(function (p) {
      var b = F(h('button', { class: 'who-item' }, '<img alt="" src="' + esc(img(p.avatarUrl)) + '"><span>' + esc(p.name) + '</span>'), function () { setProfile(p.id); go('home', {}, true); });
      if (p.id === S.profile) b.id = 'cur';
      row.appendChild(b);
    });
    box.appendChild(row); el.appendChild(box);
    current.args._focus = '#cur';
    return el;
  };
  function whoDialog() {
    if (S.device && S.device.locked) return toast('Dit apparaat is vastgezet op ' + me().name);
    var d = h('div', { class: 'dialog' }, '<h2>Wie kijkt er?</h2>'), row = h('div', { class: 'who' });
    S.profiles.forEach(function (p) { row.appendChild(F(h('button', { class: 'who-item' }, '<img alt="" src="' + esc(img(p.avatarUrl)) + '"><span>' + esc(p.name) + '</span>'), function () { setProfile(p.id); closeOverlay(); go(current.name, current.args, true); })); });
    d.appendChild(row); openOverlay(d);
  }

  // ---------- thuis ----------
  screens.home = function () {
    var el = h('div', { class: 'screen' }); el.appendChild(topbar('home'));
    var sc = h('div', { class: 'scroll' }), inner = h('div', { class: 'scroll-inner' }); sc.appendChild(inner); el.appendChild(sc);
    var hero = h('div', { class: 'hero first leeg' }, '<div class="bg"></div><div class="txt"><span class="kicker"></span><h1></h1><div class="meta"></div><p class="desc"></p></div>');
    inner.appendChild(hero);
    function showHero(it) {
      if (!it) return;
      hero.classList.remove('leeg');
      hero.querySelector('.bg').style.cssText = bg(it.backdrop || it.art || it.img || it.thumb);
      hero.querySelector('.kicker').textContent = it.kicker || '';
      hero.querySelector('h1').textContent = it.title || '';
      hero.querySelector('.meta').textContent = it.meta || '';
      hero.querySelector('.desc').textContent = it.overview || it.summary || '';
    }
    var slots = {}; ['cont', 'live', 'picks', 'apps', 'soon'].forEach(function (k) { slots[k] = h('div'); inner.appendChild(slots[k]); });
    slots.cont.className = 'first';
    slots.cont.appendChild(loading());
    get('/api/home?profile=' + S.profile).then(function (d) {
      var picks = (d.picks && d.picks.picks) || [];
      S.services = d.picks && d.picks.services || {};
      showHero(picks[0] && { backdrop: picks[0].backdrop, kicker: 'Voor jou · ' + (picks[0].service || ''), title: picks[0].title, meta: [picks[0].type, picks[0].year, picks[0].rating ? '★ ' + picks[0].rating.toFixed(1) : ''].filter(Boolean).join(' · '), overview: picks[0].overview });
      slots.cont.innerHTML = '';
      var cont = (d.continue || []).map(function (c) {
        return wide({ title: c.title, sub: c.next ? c.sub : (c.sub || '') + (c.left > 0 ? ' · nog ' + c.left + ' min' : ''), img: c.img || c.art || c.thumb, progress: c.progress,
          badge: c.next ? 'Volgende' : '', ok: function () { resume(c); }, focus: function () { showHero({ backdrop: c.img || c.art, kicker: 'Verder kijken', title: c.title, meta: c.sub, overview: c.summary }); } });
      });
      if (cont.length) slots.cont.appendChild(rowSection('Verder kijken', cont, me().name));
      if (picks.length) slots.picks.appendChild(rowSection('Voor jou', picks.map(function (p) {
        return wide({ title: p.title, sub: p.type + (p.year ? ' · ' + p.year : ''), img: p.thumb, badge: serviceName(p.service),
          ok: function () { go('info', { type: p.id.indexOf('tv') === 0 ? 'tv' : 'movie', tmdb: p.tmdb, title: p.title }); },
          focus: function () { showHero({ backdrop: p.backdrop, kicker: 'Voor jou · ' + serviceName(p.service), title: p.title, meta: p.type + (p.year ? ' · ' + p.year : ''), overview: p.overview }); } });
      })));
      var soon = (d.upcoming || []).slice(0, 20).map(function (u) { return wide({ title: u.title, sub: u.date + ' · ' + u.sub, img: u.art || u.thumb, badge: u.hasFile ? 'Klaar' : u.date, ok: function () { if (u.tmdb) go('info', { type: u.sub.indexOf('S') === 0 ? 'tv' : 'movie', tmdb: u.tmdb, title: u.title }); } }); });
      if (soon.length) slots.soon.appendChild(rowSection('Binnenkort', soon));
    }).catch(function (e) { slots.cont.innerHTML = '<div class="empty">Thuis kan tv-serverr nu niet bereiken. ' + esc(e.message) + '</div>'; });
    liveNow().then(function (tiles) { if (tiles.length) slots.live.appendChild(rowSection('Nu live', tiles)); });
    loadApps().then(function (apps) {
      if (!apps.length) return;
      slots.apps.appendChild(rowSection('Apps', apps.map(function (a) {
        var t = wide({ title: a.label, img: '', ok: function () { N.launch(a.pkg); } });
        t.classList.add('app-tile'); t.querySelector('.thumb').style.backgroundImage = "url('" + (a.banner || a.icon) + "')";
        return t;
      })));
    });
    return el;
  };
  function serviceName(k) { var n = { netflix: 'Netflix', prime: 'Prime Video', videoland: 'Videoland', skyshowtime: 'SkyShowtime', withlove: 'WithLove', youtube: 'YouTube', npo: 'NPO Start', disney: 'Disney+', hbo: 'HBO Max', plex: 'Plex' }; return n[k] || k || ''; }
  // Favoriete zenders van dit profiel, anders de eerste categorie; met wat er nu op is.
  function liveNow() {
    return Promise.all([liveCats(), get('/api/favorites?profile=' + S.profile).catch(function () { return []; })]).then(function (r) {
      var cats = r[0], fav = r[1], cat = cats.filter(function (c) { return c.id !== 'alle' && !c.parent && c.channels.length; })[0];
      var all = (cats.filter(function (c) { return c.id === 'alle'; })[0] || { channels: [] }).channels;
      var list = fav.length ? fav.map(function (id) { return all.filter(function (c) { return c.id === id; })[0]; }).filter(Boolean) : (cat ? cat.channels.slice(0, 12) : []);
      var catId = fav.length ? 'alle' : (cat && cat.id);
      if (!list.length) return [];
      return get('/api/live/nownext?ids=' + list.map(function (c) { return c.id; }).join(',')).then(function (nn) {
        return list.map(function (ch) {
          var p = (nn[ch.id] || [])[0], prog = p && p.end ? (Date.now() - p.start) / (p.end - p.start) : 0;
          return wide({ title: p ? p.title : ch.name, sub: ch.name + (p ? ' · ' + clock(p.start) + '–' + clock(p.end) : ''), img: ch.icon, badge: 'LIVE', live: true, progress: prog, ok: function () { playLive(catId, ch); } });
        });
      });
    }).catch(function () { return []; });
  }
  function liveCats(force) {
    if (S.cats && !force && Date.now() - S.catsAt < 30 * 60e3) return Promise.resolve(S.cats);
    return get('/api/live/categories').then(function (c) { S.cats = c; S.catsAt = Date.now(); return c; });
  }

  // ---------- live tv met gids ----------
  var PX = 7.1, SPAN = 210;  // pixels per minuut, minuten in beeld
  screens.live = function (args) {
    var el = h('div', { class: 'screen' }); el.appendChild(topbar('live'));
    var pills = h('div', { style: 'position:absolute;left:80px;right:80px;top:130px;display:flex;gap:10px;overflow:hidden' });
    var day = h('div', { style: 'position:absolute;right:80px;top:140px;font-size:22px;font-weight:600' });
    var info = h('div', { class: 'g-info' }), guide = h('div', { class: 'guide' });
    el.appendChild(pills); el.appendChild(day); el.appendChild(info); el.appendChild(guide);
    el.appendChild(h('div', { class: 'hint' }, '<span><span class="kbd">↑ ↓</span>zender</span><span><span class="kbd">← →</span>tijd</span><span><span class="kbd">OK</span>kijken, terugkijken of herinnering</span><span>↺ = terugkijken kan</span>'));
    var st = args.st || (args.st = { cat: null, from: 0, row: 0 });
    liveCats().then(function (cats) {
      var shown = cats.filter(function (c) { return c.channels.length; });
      if (!st.cat) st.cat = (shown.filter(function (c) { return c.id !== 'alle' && !c.parent; })[0] || shown[0] || {}).id;
      var row = h('div', { class: 'row', style: 'padding:0;gap:10px' });
      shown.forEach(function (c) {
        row.appendChild(F(h('button', { class: 'pill' + (c.id === st.cat ? ' on' : '') }, esc(c.name)), function () { st.cat = c.id; st.from = 0; go('live', args, true); }, { group: 'cats' }));
      });
      pills.appendChild(row);
      var cat = shown.filter(function (c) { return c.id === st.cat; })[0] || shown[0];
      if (cat) drawGuide(cat);
    }).catch(function (e) { guide.innerHTML = '<div class="empty" style="padding:0">Live tv is nu niet bereikbaar. ' + esc(e.message) + '</div>'; });

    function drawGuide(cat) {
      var now = Date.now();
      if (!st.from) { var d = new Date(now); d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); st.from = d.getTime() - 60 * 60000; }
      var from = st.from, to = from + SPAN * 60000, x = function (t) { return (t - from) / 60000 * PX; };
      day.textContent = dayName(from + 60 * 60000);
      guide.innerHTML = '';
      var times = h('div', { class: 'g-times' });
      for (var t = from; t < to; t += 30 * 60000) times.appendChild(h('span', { style: 'left:' + x(t) + 'px' }, clock(t)));
      guide.appendChild(times);
      var body = h('div', { class: 'scroll-inner', style: 'position:relative' }); guide.appendChild(body);
      var chans = cat.channels.slice(0, 120);
      get('/api/live/guide?ids=' + chans.map(function (c) { return c.id; }).join(',') + '&from=' + from + '&to=' + to).then(function (g) {
        var byId = {}; g.forEach(function (r) { byId[r.id] = r; });
        chans.forEach(function (ch, i) {
          var r = h('div', { class: 'g-row' }), line = h('div', { class: 'g-line' });
          r.appendChild(h('div', { class: 'g-ch' }, (ch.icon ? '<img alt="" src="' + esc(img(ch.icon)) + '">' : '<span class="dim" style="width:40px">' + ch.num + '</span>') + '<span>' + esc(ch.name) + '</span>'));
          var progs = (byId[ch.id] || {}).programmes || [];
          if (!progs.length) progs = [{ title: ch.name, start: from, end: to, desc: 'Geen gids voor deze zender', none: true }];
          progs.forEach(function (p) {
            var left = Math.max(0, x(p.start)), right = Math.min(SPAN * PX, x(p.end));
            if (right - left < 4) return;
            var past = p.end < now, live = p.start <= now && p.end > now, canBack = past && ch.archive && p.start > now - ch.archive * 864e5;
            var b = h('button', { class: 'g-p' + (past ? ' past' : live ? ' now' : ''), style: 'left:' + left + 'px;width:' + (right - left - 6) + 'px' },
              (canBack ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true" style="flex:none"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>' : '') +
              (S.reminders[ch.id + ':' + p.start] ? '⏰ ' : '') + '<span>' + esc(p.title) + '</span>');
            F(b, function () {
              if (live || p.none) playLive(cat.id, ch);
              else if (canBack) playCatchup(ch, p);
              else if (!past) { toggleReminder(ch, p, cat.id); go('live', args, true); }
              else toast('Deze zender bewaart dit programma niet');
            }, { group: 'g' + i, long: function () { progDialog(ch, p, cat.id, live, canBack, past); },
              focus: function () {
                st.row = i;
                info.innerHTML = '<span class="kicker">' + esc(ch.name) + ' · ' + clock(p.start) + '–' + clock(p.end) + (live ? ' · NU' : past ? ' · AFGELOPEN' : '') + '</span>' +
                  '<h2 style="font-size:40px">' + esc(p.title) + '</h2><p class="desc" style="max-width:1300px">' + esc(p.desc || p.cat || '') + '</p>' +
                  '<div class="dim" style="font-size:20px">' + (live ? 'OK: kijken' : canBack ? 'OK: terugkijken vanaf het begin' : past ? 'Kan niet meer teruggekeken worden' : 'OK: herinnering ' + (S.reminders[ch.id + ':' + p.start] ? 'weghalen' : 'zetten')) + '</div>';
              },
              // Voorbij de rand van het tijdvak: een uur verschuiven.
              move: function (dir) {
                var r2 = b.getBoundingClientRect(), lineR = line.getBoundingClientRect();
                if (dir === 'right' && r2.right >= lineR.right - 10 && b === line.lastElementChild) { st.from += 60 * 60000; go('live', args, true); return true; }
                if (dir === 'left' && r2.left <= lineR.left + 10 && b === line.firstElementChild) { st.from -= 60 * 60000; go('live', args, true); return true; }
              } });
            if (live && i === st.row) b.id = 'liveNow';
            line.appendChild(b);
          });
          if (now > from && now < to) line.appendChild(h('div', { class: 'g-now', style: 'left:' + x(now) + 'px' }));
          r.appendChild(line); body.appendChild(r);
        });
        var want = document.getElementById('liveNow') || body.querySelectorAll('.g-row')[st.row] && body.querySelectorAll('.g-row')[st.row].querySelector('.g-p');
        focus(want || focusables()[0]);
      });
    }
    return el;
  };
  function progDialog(ch, p, catId, live, canBack, past) {
    var d = h('div', { class: 'dialog', style: 'align-items:flex-start;text-align:left' },
      '<span class="kicker">' + esc(ch.name) + ' · ' + dayName(p.start) + ' ' + clock(p.start) + '–' + clock(p.end) + '</span><h2>' + esc(p.title) + '</h2><p class="desc" style="-webkit-line-clamp:6;max-width:1000px">' + esc(p.desc || '') + '</p>');
    var bt = h('div', { style: 'display:flex;gap:16px' });
    if (live) bt.appendChild(F(h('button', { class: 'btn' }, 'Kijken'), function () { closeOverlay(); playLive(catId, ch); }));
    if (canBack) bt.appendChild(F(h('button', { class: 'btn' }, 'Terugkijken vanaf begin'), function () { closeOverlay(); playCatchup(ch, p); }));
    if (!past && !live) bt.appendChild(F(h('button', { class: 'btn' }, S.reminders[ch.id + ':' + p.start] ? 'Herinnering weghalen' : 'Herinnering zetten'), function () { closeOverlay(); toggleReminder(ch, p, catId); }));
    bt.appendChild(F(h('button', { class: 'btn' }, 'Andere uitzendingen'), function () { closeOverlay(); go('search', { q: p.title }); }));
    d.appendChild(bt); openOverlay(d);
  }

  // ---------- films en series ----------
  screens.films = function () { return library('movie'); };
  screens.series = function () { return library('series'); };
  function library(kind) {
    var el = h('div', { class: 'screen' }); el.appendChild(topbar(kind === 'movie' ? 'films' : 'series'));
    var sc = h('div', { class: 'scroll', style: 'top:130px' }), inner = h('div', { class: 'scroll-inner' }); sc.appendChild(inner); el.appendChild(sc);
    var plexBox = h('div', { class: 'first' }), iptvBox = h('div'); inner.appendChild(plexBox); inner.appendChild(iptvBox);
    plexBox.appendChild(loading());
    get('/api/plex/sections').then(function (secs) {
      plexBox.innerHTML = '';
      var mine = secs.filter(function (s) { return s.type === (kind === 'movie' ? 'movie' : 'show'); });
      if (!mine.length) return;
      return Promise.all(mine.map(function (s) { return get('/api/plex/library/' + s.key); })).then(function (libs) {
        libs.forEach(function (lib, n) {
          lib.rows.slice(0, 14).forEach(function (r) {
            plexBox.appendChild(rowSection(r.title, r.items.map(function (it) { return plexTile(it, kind); }), 'Plex' + (mine.length > 1 ? ' ' + mine[n].title : '')));
          });
        });
      });
    }).catch(function () { plexBox.innerHTML = ''; });
    get('/api/vod/' + kind + '/overview').then(function (o) {
      if (!o.total) return;
      iptvBox.appendChild(rowSection('Nieuw bij IPTV', o.newest.slice(0, 30).map(function (m) { return vodTile(m, kind); })));
      iptvBox.appendChild(rowSection('IPTV per genre', o.genres.slice(0, 24).map(function (g) {
        return wide({ title: g.name, sub: g.count + ' titels', img: '', ok: function () { go('grid', { kind: kind, by: 'genre', value: g.name, title: g.name }); } });
      })));
    }).catch(function () {});
    return el;
  }
  function plexTile(it, kind) {
    return poster({ title: it.title, sub: it.year || it.sub, img: it.thumb, ok: function () {
      if (it.type === 'episode') return playPlex(it.key, it);
      go('info', { type: it.type === 'show' ? 'tv' : 'movie', tmdb: it.tmdb, title: it.title, plex: it });
    }, long: function () { if (it.type === 'movie') playPlex(it.key, it); } });
  }
  function vodTile(m, kind) {
    return poster({ title: m.name, sub: m.year, img: m.icon, ok: function () { go('info', { type: kind === 'movie' ? 'movie' : 'tv', tmdb: m.tmdb, title: m.name, vod: m, vodKind: kind }); },
      long: function () { if (kind === 'movie') playMovie(m); } });
  }
  screens.grid = function (a) {
    var el = h('div', { class: 'screen' });
    el.appendChild(h('div', { style: 'position:absolute;left:80px;top:50px' }, '<h1 style="font-size:44px">' + esc(a.title) + '</h1>'));
    var sc = h('div', { class: 'scroll', style: 'top:130px' }), inner = h('div', { class: 'scroll-inner' }), grid = h('div', { class: 'grid' });
    inner.appendChild(grid); sc.appendChild(inner); el.appendChild(sc);
    get('/api/vod/' + a.kind + '/browse?by=' + a.by + '&value=' + encodeURIComponent(a.value)).then(function (r) {
      r.items.slice(0, 300).forEach(function (m) { grid.appendChild(vodTile(m, a.kind)); });
      focus(focusables()[0]);
    });
    return el;
  };

  // ---------- infopagina ----------
  screens.info = function (a) {
    var el = h('div', { class: 'screen' });
    var bgEl = h('div', { class: 'info-bg' }); el.appendChild(bgEl);
    var top = h('div', { style: 'position:absolute;left:80px;top:100px;display:flex;gap:48px' });
    var post = h('div', { style: 'width:300px;height:450px;border-radius:16px;flex:none;background:#151922 center/cover' });
    var txt = h('div', { style: 'width:1000px;display:flex;flex-direction:column;gap:18px' }, '<h1 style="font-size:68px;line-height:1">' + esc(a.title) + '</h1>');
    top.appendChild(post); top.appendChild(txt); el.appendChild(top);
    var lower = h('div', { style: 'position:absolute;left:80px;right:80px;top:640px' }); el.appendChild(lower);
    var src = a.plex ? 'plex:' + a.plex.key : a.vod ? (a.vodKind === 'movie' ? 'movie:' : 'series:') + a.vod.id : '';
    Promise.all([a.tmdb ? get('/api/info/' + a.type + '/' + a.tmdb).catch(function () { return null; }) : Promise.resolve(null),
      get('/api/mylist?profile=' + S.profile).catch(function () { return []; })]).then(function (r) {
      var d = r[0] || {}, inList = r[1].some(function (x) { return x.key === (src || 'tmdb:' + a.type + a.tmdb); });
      bgEl.style.cssText = bg(d.backdrop || (a.plex && a.plex.art) || (a.vod && a.vod.backdrop));
      post.style.backgroundImage = "url('" + img(d.poster || (a.plex && a.plex.thumb) || (a.vod && a.vod.icon)) + "')";
      var meta = [d.year || (a.vod && a.vod.year), d.seasons && d.seasons.length ? d.seasons.length + ' seizoen' + (d.seasons.length > 1 ? 'en' : '') : d.runtime ? d.runtime + ' min' : '',
        d.age ? '<span class="tag">' + esc(d.age) + '</span>' : '', d.rating ? '★ ' + d.rating.toFixed(1) : '', (d.genres || []).slice(0, 3).join(' · ')].filter(Boolean);
      var where = [a.plex ? 'Plex' : '', a.vod ? 'IPTV' : ''].concat((d.services || []).map(serviceName)).filter(Boolean);
      txt.innerHTML = '<h1 style="font-size:68px;line-height:1">' + esc(d.title || a.title) + '</h1><div class="meta">' + meta.map(function (m) { return '<span>' + (m.indexOf('<span') === 0 ? m : esc(m)) + '</span>'; }).join('') + '</div>' +
        '<p class="desc" style="-webkit-line-clamp:5">' + esc(d.overview || (a.plex && a.plex.summary) || (a.vod && a.vod.plot) || '') + '</p>' +
        '<div class="dim" style="font-size:20px">' + (d.director ? 'Makers: ' + esc(d.director) + ' · ' : '') + (where.length ? 'Te zien via: <span style="color:#fff">' + esc(where.join(', ')) + '</span>' : 'Nog niet te zien') + '</div>';
      var bt = h('div', { style: 'display:flex;gap:16px;margin-top:10px' });
      var series = a.type === 'tv';
      if (a.plex && !series) bt.appendChild(F(h('button', { class: 'btn' }, '▶&nbsp; Afspelen'), function () { playPlex(a.plex.key, a.plex); }));
      else if (a.vod && !series) bt.appendChild(F(h('button', { class: 'btn' }, '▶&nbsp; Afspelen'), function () { playMovie(a.vod); }));
      if (series && (a.plex || a.vod)) bt.appendChild(F(h('button', { class: 'btn' }, '▶&nbsp; Afleveringen'), function () { go('episodes', { title: d.title || a.title, plex: a.plex, vod: a.vod, tmdb: a.tmdb }); }));
      if (!a.plex && !a.vod && (d.services || []).length) {
        var s = d.services[0];
        bt.appendChild(F(h('button', { class: 'btn' }, 'Openen in ' + esc(serviceName(s))), function () { openApp(s); }));
      }
      bt.appendChild(F(h('button', { class: 'btn' }, inList ? '✓ Mijn lijst' : '+ Mijn lijst'), function () {
        var me2 = this; api('POST', '/api/mylist', { profile: S.profile, key: src || 'tmdb:' + a.type + a.tmdb, meta: { title: d.title || a.title, img: d.poster || '', type: a.type, tmdb: a.tmdb, plex: a.plex || null, vod: a.vod || null, vodKind: a.vodKind || '' } })
          .then(function (r2) { cur.innerHTML = r2.inList ? '✓ Mijn lijst' : '+ Mijn lijst'; toast(r2.inList ? 'Op je lijst gezet' : 'Van je lijst gehaald'); });
      }));
      if (d.trailer) bt.appendChild(F(h('button', { class: 'btn' }, 'Trailer'), function () { if (N) N.openUrl('https://www.youtube.com/watch?v=' + d.trailer); }));
      txt.appendChild(bt);
      if ((d.cast || []).length) {
        lower.appendChild(h('h2', { style: 'font-size:28px;font-weight:600;margin-bottom:16px' }, 'Acteurs'));
        var cr = h('div', { style: 'display:flex;gap:26px' });
        d.cast.slice(0, 10).forEach(function (c) { cr.appendChild(h('div', { class: 'cast' }, '<div class="ph" style="' + bg(c.photo) + '"></div><b>' + esc(c.name) + '</b><span class="dim">' + esc(c.role) + '</span>')); });
        lower.appendChild(cr);
      }
      focus(bt.firstChild);
    });
    return el;
  };
  screens.episodes = function (a) {
    var el = h('div', { class: 'screen' });
    el.appendChild(h('div', { style: 'position:absolute;left:80px;top:50px' }, '<h1 style="font-size:44px">' + esc(a.title) + '</h1>'));
    var seasonsBox = h('div', { style: 'position:absolute;left:80px;right:80px;top:130px;display:flex;gap:10px' });
    var list = h('div', { class: 'main', style: 'left:80px;top:220px' });
    el.appendChild(seasonsBox); el.appendChild(list);
    var load = a.plex ? get('/api/plex/show/' + a.plex.key) : get('/api/vod/series/info/' + a.vod.id);
    load.then(function (d) {
      var st = a.st || (a.st = { season: 0 });
      var seasons = d.seasons || [];
      seasons.forEach(function (s, i) { seasonsBox.appendChild(F(h('button', { class: 'pill' + (i === st.season ? ' on' : '') }, 'Seizoen ' + esc(s.season)), function () { st.season = i; go('episodes', a, true); }, { group: 'seasons' })); });
      var s = seasons[st.season]; if (!s) { list.innerHTML = '<div class="empty" style="padding:0">Geen afleveringen gevonden</div>'; return; }
      var inner = h('div', { class: 'scroll-inner', style: 'display:flex;flex-direction:column;gap:10px' }); list.appendChild(inner);
      s.episodes.forEach(function (ep) {
        var done = ep.watched ? ' · gezien' : ep.progress > 0.05 ? ' · bezig' : '';
        inner.appendChild(F(h('button', { class: 'listrow' }, '<span><b>' + ep.num + '.</b> ' + esc(ep.title || 'Aflevering ' + ep.num) + '</span><span class="dim">' + (ep.dur ? Math.round(ep.dur / 60) + ' min' : '') + done + '</span>'), function () {
          if (a.plex) playPlex(ep.key, { title: a.title, sub: 'S' + s.season + ' · afl. ' + ep.num, img: ep.img });
          else playEpisode({ id: a.vod.id, name: a.title, tmdb: a.tmdb, backdrop: d.backdrop, icon: a.vod.icon }, s.season, ep);
        }));
      });
      focus(inner.firstChild);
    }).catch(function (e) { list.innerHTML = '<div class="empty" style="padding:0">' + esc(e.message) + '</div>'; });
    return el;
  };

  // ---------- zoeken ----------
  screens.search = function (a) {
    var el = h('div', { class: 'screen' }); el.appendChild(topbar('search'));
    var st = a.st || (a.st = { q: a.q || '' });
    var left = h('div', { style: 'position:absolute;left:80px;top:150px;width:470px;display:flex;flex-direction:column;gap:22px' });
    var field = h('div', { class: 'field' }); left.appendChild(field);
    var mic = F(h('button', { class: 'btn', style: 'justify-content:center' }, '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg>Inspreken'), function () {
      if (!N) return toast('Inspreken kan alleen op de tv');
      native('voice').then(function (t) { if (t) { st.q = t; paint(); run(); } }, function () { toast('Inspreken lukt niet op dit apparaat'); });
    }, { group: 'kbtop' });
    left.appendChild(mic);
    left.appendChild(keyboard('abcdefghijklmnopqrstuvwxyz1234567890', function (c) { if (c === '⌫') st.q = st.q.slice(0, -1); else st.q += c === '␣' ? ' ' : c; paint(); clearTimeout(st.t); st.t = setTimeout(run, 700); }));
    left.appendChild(h('div', { class: 'dim', style: 'font-size:18px' }, 'Zoekt ook op onderwerp: "wielrennen" vindt Tour, Giro, Vuelta en veldrit.'));
    var res = h('div', { class: 'scroll', style: 'left:620px;top:140px' }), inner = h('div', { class: 'scroll-inner' }); res.appendChild(inner);
    el.appendChild(left); el.appendChild(res);
    function paint() { field.textContent = st.q || ' '; }
    function run() {
      var q = st.q.trim(); if (q.length < 2) { inner.innerHTML = ''; return; }
      inner.innerHTML = ''; inner.appendChild(loading('Zoeken…'));
      get('/api/search?q=' + encodeURIComponent(q)).then(function (r) {
        if (st.q.trim() !== q) return;
        inner.innerHTML = ''; inner.dataset.y = 0; inner.style.transform = '';
        var g = r.guide || {}, any = false;
        function add(title, tiles) { if (!tiles.length) return; any = true; var s = rowSection(title, tiles); s.querySelector('h2').style.paddingLeft = '0'; s.querySelector('.row').style.padding = '0'; inner.appendChild(s); }
        var chanTile = function (x, badge, live) { return wide({ title: x.title, sub: x.name + ' · ' + dayName(x.start) + ' ' + clock(x.start), img: x.icon, badge: badge, live: live, ok: function () {
          var ch = { id: x.channel, name: x.name, archive: x.archive };
          if (live) playLive('alle', ch); else if (x.start > Date.now()) toggleReminder(ch, x, 'alle'); else playCatchup(ch, x);
        } }); };
        add('Nu live', (g.live || []).map(function (x) { return chanTile(x, 'LIVE', true); }));
        add('Zenders', (g.channels || []).map(function (c) { return wide({ title: c.name, sub: 'Zender ' + c.num, img: c.icon, ok: function () { playLive('alle', { id: c.channel }); } }); }));
        add('Straks', (g.later || []).map(function (x) { return chanTile(x, clock(x.start)); }));
        add('Terugkijken', (g.past || []).map(function (x) { return chanTile(x, '↺'); }));
        add('Plex', (r.plex || []).map(function (it) { return plexTile(it, it.type === 'show' ? 'series' : 'movie'); }));
        add('Films bij IPTV', (r.films || []).map(function (m) { return vodTile(m, 'movie'); }));
        add('Series bij IPTV', (r.series || []).map(function (m) { return vodTile(m, 'series'); }));
        add('Bij streamingdiensten', (r.streaming || []).filter(function (s) { return s.services && s.services.length; }).map(function (s) {
          return poster({ title: s.title, sub: s.services.map(serviceName).join(', '), img: s.poster, ok: function () { go('info', { type: s.id.indexOf('tv') === 0 ? 'tv' : 'movie', tmdb: s.tmdb, title: s.title }); } });
        }));
        if (!any) inner.innerHTML = '<div class="empty" style="padding:0">Niets gevonden voor "' + esc(q) + '"</div>';
      }).catch(function (e) { inner.innerHTML = '<div class="empty" style="padding:0">' + esc(e.message) + '</div>'; });
    }
    paint(); if (st.q) run();
    current.args._focus = '.kb .key';
    return el;
  };

  // ---------- mijn profiel ----------
  var PREFS = [
    ['subs', 'Ondertitels', [['auto', 'Als het niet Nederlands is'], ['aan', 'Altijd aan'], ['uit', 'Uit']]],
    ['audio', 'Geluid', [['origineel', 'Origineel'], ['nl', 'Nederlands als dat er is']]],
    ['next', 'Volgende aflevering', [['auto', 'Automatisch afspelen'], ['vraag', 'Eerst vragen']]],
    ['kids', "Kinderprogramma's in voorstellen", [['uit', 'Uit'], ['aan', 'Aan']]]
  ];
  screens.profile = function (a) {
    var el = h('div', { class: 'screen' }), p = me(), tab = a.tab || 'list';
    var side = h('div', { class: 'side' });
    side.appendChild(h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:14px;padding:10px 0 26px' }, '<img alt="" src="' + esc(img(p.avatarUrl)) + '" style="width:170px;height:170px;border-radius:50%;object-fit:cover"><h1 style="font-size:42px">' + esc(p.name) + '</h1>'));
    [['list', 'Mijn lijst'], ['avatar', 'Avatar kiezen'], ['prefs', 'Voorkeuren'], ['switch', 'Wissel van profiel']].forEach(function (t) {
      side.appendChild(F(h('button', { class: 'listrow' + (t[0] === tab ? ' on' : '') }, esc(t[1])), function () {
        if (t[0] === 'switch') return whoDialog();
        a.tab = t[0]; go('profile', a, true);
      }, { group: 'side' }));
    });
    el.appendChild(side);
    var main = h('div', { class: 'main' }); el.appendChild(main);
    if (tab === 'list') {
      main.appendChild(h('h2', { style: 'font-size:36px' }, 'Mijn lijst'));
      get('/api/mylist?profile=' + S.profile).then(function (l) {
        if (!l.length) { main.appendChild(h('div', { class: 'dim', style: 'font-size:22px' }, 'Nog leeg. Zet iets op je lijst via de infopagina van een film of serie.')); return; }
        var g = h('div', { class: 'grid', style: 'grid-template-columns:repeat(5,230px);padding:10px 0' });
        l.forEach(function (m) { g.appendChild(poster({ title: m.title, img: m.img, ok: function () { go('info', { type: m.type || 'movie', tmdb: m.tmdb, title: m.title, plex: m.plex, vod: m.vod, vodKind: m.vodKind }); } })); });
        main.appendChild(g);
      });
    } else if (tab === 'avatar') {
      main.appendChild(h('h2', { style: 'font-size:36px' }, 'Avatar kiezen'));
      if (S.device && S.device.locked && S.device.profile !== p.id) { main.appendChild(h('div', { class: 'dim' }, 'Niet op dit apparaat.')); return el; }
      get('/api/avatars').then(function (av) {
        var g = h('div', { style: 'display:flex;flex-wrap:wrap;gap:18px;padding-top:10px' });
        av.avatars.forEach(function (x) {
          g.appendChild(F(h('button', { class: 'who-item', style: 'width:auto;padding:4px' }, '<img alt="' + esc(x.name) + '" src="' + esc(img('/avatars/' + x.id + '.svg')) + '" style="width:96px;height:96px">'), function () {
            api('POST', '/api/profiles/' + p.id + '/avatar', { avatar: x.id }).then(function (list) { S.profiles = list; toast('Avatar gewijzigd'); go('profile', a, true); });
          }));
        });
        main.appendChild(g);
        main.appendChild(h('div', { class: 'dim', style: 'font-size:16px' }, esc(av.credits)));
      });
    } else {
      main.appendChild(h('h2', { style: 'font-size:36px' }, 'Voorkeuren'));
      main.appendChild(h('div', { class: 'dim', style: 'font-size:20px;margin-bottom:10px' }, 'Deze instellingen horen bij jou en gaan mee naar elke tv. OK wisselt de keuze.'));
      var prefs = p.prefs || {};
      PREFS.forEach(function (row) {
        var val = prefs[row[0]] || row[2][0][0], label = row[2].filter(function (o) { return o[0] === val; })[0][1];
        main.appendChild(F(h('button', { class: 'listrow' }, '<b>' + esc(row[1]) + '</b><span class="dim">' + esc(label) + ' ›</span>'), function () {
          var i = row[2].map(function (o) { return o[0]; }).indexOf(val), next = row[2][(i + 1) % row[2].length][0], body = {}; body[row[0]] = next;
          api('POST', '/api/profiles/' + p.id + '/prefs', body).then(function () { p.prefs = Object.assign(prefs, body); a._focus = null; go('profile', a, true); });
        }));
      });
    }
    return el;
  };

  // ---------- instellingen ----------
  screens.settings = function (a) {
    var el = h('div', { class: 'screen' }), tab = a.tab || 'device';
    var side = h('div', { class: 'side' }, '<h1 style="font-size:44px;margin-bottom:24px">Instellingen</h1>');
    [['device', 'Dit apparaat'], ['profile', 'Profiel op dit apparaat'], ['conn', 'Verbinding'], ['about', 'Over Thuis']].forEach(function (t) {
      side.appendChild(F(h('button', { class: 'listrow' + (t[0] === tab ? ' on' : '') }, esc(t[1])), function () { a.tab = t[0]; go('settings', a, true); }, { group: 'side' }));
    });
    el.appendChild(side);
    var main = h('div', { class: 'main' }); el.appendChild(main);
    function row(title, sub, ok) { main.appendChild(F(h('button', { class: 'listrow' }, '<span style="display:flex;flex-direction:column;gap:4px;text-align:left"><b>' + esc(title) + '</b>' + (sub ? '<span class="dim" style="font-size:18px">' + esc(sub) + '</span>' : '') + '</span><span>›</span>'), ok)); }
    if (tab === 'device') {
      main.appendChild(h('h2', { style: 'font-size:36px;margin-bottom:10px' }, 'Dit apparaat'));
      row('Alle Android-instellingen', 'De instellingen van dit apparaat zelf', function () { N && N.openSystem('all'); });
      row('Wifi en netwerk', '', function () { N && N.openSystem('wifi'); });
      row('Bluetooth', 'Afstandsbedieningen en koptelefoons', function () { N && N.openSystem('bluetooth'); });
      row('Geluid', '', function () { N && N.openSystem('sound'); });
      row('Beeld', '', function () { N && N.openSystem('display'); });
      row('Apps', 'Bijwerken, opslag, gegevens wissen', function () { N && N.openSystem('apps'); });
      row('Alle apps', 'Ook apps zonder tegel op het startscherm', function () { go('apps'); });
      row('Geavanceerd: ander startscherm kiezen', 'Alleen voor noodgevallen', function () { N && N.openSystem('home'); });
    } else if (tab === 'profile') {
      main.appendChild(h('h2', { style: 'font-size:36px;margin-bottom:10px' }, 'Profiel op dit apparaat'));
      var d = S.device || {};
      if (d.locked) { main.appendChild(h('div', { class: 'dim', style: 'font-size:22px' }, 'Dit apparaat is vastgezet op ' + esc(me().name) + '. Aanpassen kan op de beheerpagina van tv-serverr.')); return el; }
      var prof = S.profiles.filter(function (p) { return p.id === d.profile; })[0];
      var asks = { altijd: 'Altijd vragen', samen: 'Vragen bij Samen', nooit: 'Nooit vragen' };
      row('Standaardprofiel', prof ? prof.name : 'Geen: bij het opstarten "Wie kijkt er?"', function () {
        var ids = [0].concat(S.profiles.map(function (p) { return p.id; })), next = ids[(ids.indexOf(d.profile || 0) + 1) % ids.length];
        api('POST', '/api/device', { profile: next }).then(function () { d.profile = next; go('settings', a, true); });
      });
      row('Vragen wie er kijkt bij het starten', asks[d.ask || 'samen'], function () {
        var ks = ['altijd', 'samen', 'nooit'], next = ks[(ks.indexOf(d.ask || 'samen') + 1) % 3];
        api('POST', '/api/device', { ask: next }).then(function () { d.ask = next; go('settings', a, true); });
      });
    } else if (tab === 'conn') {
      var info = N ? JSON.parse(N.srvInfo()) : { url: location.origin };
      main.appendChild(h('h2', { style: 'font-size:36px;margin-bottom:10px' }, 'Verbinding'));
      main.appendChild(h('div', { class: 'listrow' }, '<b>tv-serverr</b><span class="dim">' + esc(info.url) + '</span>'));
      main.appendChild(h('div', { class: 'listrow' }, '<b>Dit apparaat</b><span class="dim">' + esc(S.device ? S.device.device : '') + '</span>'));
      row('Opnieuw koppelen', 'Ontkoppelt dit apparaat; daarna heb je een nieuwe code nodig', function () {
        var dd = h('div', { class: 'dialog' }, '<h2>Dit apparaat ontkoppelen?</h2><div class="dim" style="font-size:22px">Daarna heb je een nieuwe code van de beheerpagina nodig.</div>');
        var bt = h('div', { style: 'display:flex;gap:16px' });
        bt.appendChild(F(h('button', { class: 'btn' }, 'Nee'), closeOverlay));
        bt.appendChild(F(h('button', { class: 'btn' }, 'Ja, ontkoppelen'), function () { if (N) N.srvUnpair(); closeOverlay(); go('pair', {}, true); }));
        dd.appendChild(bt); openOverlay(dd);
      });
    } else {
      main.appendChild(h('h2', { style: 'font-size:36px;margin-bottom:10px' }, 'Over Thuis'));
      main.appendChild(h('div', { class: 'listrow' }, '<b>Versie</b><span class="dim">Thuis ' + esc(N ? N.appVersion() : 'browser') + '</span>'));
      row('Zoeken naar een nieuwe versie', '', function () {
        if (!N) return;
        toast('Even kijken…');
        native('checkUpdate').then(function (t) {
          var u = JSON.parse(t);
          if (!u.newer) return toast('Je hebt de nieuwste versie (' + u.current + ')');
          toast('Thuis ' + u.latest + ' wordt gedownload…', 8000);
          native('installUpdate').then(function (r) { if (r === 'permission') toast('Sta het installeren van apps toe en kies daarna opnieuw', 6000); });
        }, function (e) { toast('Zoeken lukt niet: ' + e.message); });
      });
      get('/api/avatars').then(function (av) { main.appendChild(h('div', { class: 'dim', style: 'font-size:18px;margin-top:20px' }, esc(av.credits))); }).catch(function () {});
    }
    return el;
  };
  screens.apps = function () {
    var el = h('div', { class: 'screen' }, '<div style="position:absolute;left:80px;top:50px"><h1 style="font-size:44px">Alle apps</h1></div>');
    var sc = h('div', { class: 'scroll', style: 'top:130px' }), inner = h('div', { class: 'scroll-inner' }), g = h('div', { class: 'grid', style: 'grid-template-columns:repeat(4,400px);gap:30px 28px' });
    inner.appendChild(g); sc.appendChild(inner); el.appendChild(sc);
    loadApps().then(function (apps) {
      apps.forEach(function (a) { var t = wide({ title: a.label, ok: function () { N.launch(a.pkg); } }); t.classList.add('app-tile'); t.querySelector('.thumb').style.backgroundImage = "url('" + (a.banner || a.icon) + "')"; g.appendChild(t); });
      focus(focusables()[0]);
    });
    return el;
  };

  // ---------- opstarten ----------
  function boot() {
    var info = N ? JSON.parse(N.srvInfo()) : { paired: true, profile: 0 };
    if (!info.paired) return go('pair', {}, true);
    S.profile = info.profile || 0;
    Promise.all([get('/api/whoami'), get('/api/profiles')]).then(function (r) {
      S.device = r[0]; S.profiles = r[1];
      if (S.device.profile) setProfile(S.device.profile);                         // standaardprofiel van dit apparaat
      if (!S.profiles.some(function (p) { return p.id === S.profile; })) S.profile = 0;
      if (!S.profile) return go('who', {}, true);
      go('home', {}, true);
    }).catch(function (e) {
      if (e.message === 'NIET_GEKOPPELD') return;
      $app.innerHTML = '<div class="screen"><div style="position:absolute;left:160px;top:300px;width:1200px;display:flex;flex-direction:column;gap:24px"><h1 style="font-size:56px">tv-serverr is niet bereikbaar</h1><div class="dim" style="font-size:26px">' + esc(e.message) + '</div></div></div>';
      var b = F(h('button', { class: 'btn', style: 'position:absolute;left:160px;top:560px' }, 'Opnieuw proberen'), boot);
      $app.firstChild.appendChild(b); root = $app; focus(b);
      var s = F(h('button', { class: 'btn', style: 'position:absolute;left:520px;top:560px' }, 'Android-instellingen'), function () { N && N.openSystem('all'); });
      $app.firstChild.appendChild(s);
    });
  }
  boot();
})();

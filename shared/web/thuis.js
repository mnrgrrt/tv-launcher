/* Thuis 1.00: startscherm. Alle gegevens komen van tv-serverr; Android speelt af en opent apps.
   Bediening: pijltjes, OK en terug. OK ingedrukt houden is een snelkoppeling, nooit de enige weg. */
(function () {
  'use strict';
  var N = window.Native || null;               // Android-brug; null in een gewone browser
  var $app = document.getElementById('app');
  // Alles is ontworpen op 1920x1080; op een tv met een ander aantal css-pixels schalen we het geheel.
  // Weergave per apparaat: compact tekent op een groter vlak (meer tegels), ruim op een kleiner vlak (alles groter).
  var SCALE = 1, W = 1920, H = 1080, VIEWS = { normaal: 1, compact: 1.15, ruim: 0.9 };
  function fit() {
    var f = VIEWS[(S && S.view) || 'normaal'] || 1; W = Math.round(1920 * f); H = Math.round(1080 * f);
    var de = document.documentElement, b = document.body;
    de.style.width = b.style.width = W + 'px'; de.style.height = b.style.height = H + 'px';
    b.classList.toggle('view-compact', f > 1);
    var w = window.innerWidth || de.clientWidth || 1920, hh = window.innerHeight || de.clientHeight || 1080;
    SCALE = Math.min(w / W, hh / H); b.style.transformOrigin = '0 0'; b.style.transform = SCALE === 1 ? '' : 'scale(' + SCALE + ')'; }
  // Pas na het opbouwen weet de tv hoe groot het scherm is: daarom ook later nog eens rekenen.
  fit(); window.addEventListener('resize', fit); window.addEventListener('load', fit); setTimeout(fit, 300); setTimeout(fit, 1500);

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
  var S = { profile: 0, profiles: [], device: null, svcList: [], apps: null, cats: null, ov: {}, art: {}, reminders: {} };

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
      if (R > W - 80) shift -= R - (W - 80); else if (L < 80) shift += 80 - L;
      shift = Math.min(0, shift); row.dataset.x = shift; row.style.transform = 'translateX(' + shift + 'px)';
    }
    var inner = el.closest('.scroll-inner');
    if (inner) {
      var box = (el.closest('.section') || el).getBoundingClientRect(), y = parseFloat(inner.dataset.y || 0), T = box.top / SCALE, B = box.bottom / SCALE;
      if (B > H - 20) y -= B - (H - 20); else if (T < 130) y += 130 - T;
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
    var k = keyOf(e); touched = true;
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
    $app.innerHTML = ''; root = $app; cur = null; touched = false;
    var el = screens[current.name](current.args) || null;
    if (el) $app.appendChild(el);
    var want = current.args._focus && $app.querySelector(current.args._focus);
    focus(want || firstContent());
  }
  // Eerste knop in de inhoud: bij voorkeur in het bovenste blok (.first), anders de eerste buiten de bovenbalk.
  // Rijen komen los van elkaar binnen; zolang je nog niets hebt ingedrukt, schuift de focus mee naar de bovenste.
  var touched = false;
  function firstContent() { var all = focusables(); return all.filter(function (e) { return e.closest('.first'); })[0] || all.filter(function (e) { return !e.closest('.top'); })[0] || all[0]; }
  function contentReady() { if (overlay || touched) return; var f = firstContent(); if (f && f !== cur && !f.closest('.top')) focus(f); }
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
  var TABS = [['home', 'thuis'], ['live', 'Live tv'], ['films', 'Films'], ['series', 'Series'], ['search', 'Zoeken']];
  function topbar(active, onfocus) {
    var bar = h('div', { class: 'top' }), left = h('div', { class: 'left' }), nav = h('div', { class: 'nav' });
    TABS.forEach(function (t) {
      var p = F(h('button', { class: 'pill' + (t[0] === 'home' ? ' brand' : '') + (t[0] === active ? ' on' : '') }, t[1]), function () { go(t[0], {}, true); }, { group: 'top', focus: onfocus });
      if (t[0] === active) p.dataset.active = '1';
      (t[0] === 'home' ? left : nav).appendChild(p);
    });
    var right = h('div', { class: 'right' });
    var tm = h('span', null, clock(Date.now())); right.appendChild(tm);
    var gear = F(h('button', { class: 'pill', 'aria-label': 'Instellingen' }, '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>'), function () { go('settings'); }, { group: 'top' });
    right.appendChild(gear);
    // Wisselen in twee keer OK: avatar, dan het profiel. Mijn profiel staat in hetzelfde venster.
    var av = F(h('button', { class: 'avatar-btn', 'aria-label': 'Wie kijkt er' }, '<img class="avatar" alt="" src="' + esc(img(me().avatarUrl)) + '">'), function () { whoDialog(); }, { group: 'top' });
    right.appendChild(av);
    bar.appendChild(left); bar.appendChild(nav); bar.appendChild(right);
    return bar;
  }
  setInterval(function () { var t = document.querySelector('.top .right span'); if (t) t.textContent = clock(Date.now()); checkReminders(); }, 20000);

  // ---------- tegels ----------
  function rowSection(title, items, sub) {
    if (!items.length) return document.createTextNode('');
    setTimeout(contentReady, 0);
    var sec = h('div', { class: 'section' }, title ? '<h2>' + esc(title) + (sub ? ' <small>· ' + esc(sub) + '</small>' : '') + '</h2>' : '');
    var clip = h('div', { class: 'row-clip' }), row = h('div', { class: 'row' });
    items.forEach(function (it) { row.appendChild(it); });
    clip.appendChild(row); sec.appendChild(clip);
    return sec;
  }
  function wide(o) {   // 16:9-tegel: {title, sub, img, badge, progress, ok, long, focus}
    var el = h('button', { class: 'row-item' });
    el.innerHTML = '<div class="thumb" style="' + bg(o.img) + '">' + (o.badge ? '<span class="badge">' + esc(o.badge) + '</span>' : '') +
      (o.progress > 0 ? '<div class="bar"><i style="width:' + Math.round(o.progress * 100) + '%"></i></div>' : '') + '</div>' +
      '<div class="t1">' + esc(o.title) + '</div>' + (o.sub ? '<div class="t2">' + esc(o.sub) + '</div>' : '');
    return F(el, o.ok, { long: o.long, focus: o.focus });
  }
  function poster(o) {  // staand: {title, sub, img, badges (html), ok, long, focus}
    var el = h('button', { class: 'poster' });
    el.innerHTML = '<div class="pimg" style="' + bg(o.img) + '">' + (o.badges || '') +
      (o.img ? '' : '<div style="padding:' + (o.badges ? 44 : 16) + 'px 16px 16px;font-size:19px;font-weight:600">' + esc(o.title) + '</div>') + '</div>' +
      '<div class="t1">' + esc(o.title) + '</div>' + (o.sub ? '<div class="t2">' + esc(o.sub) + '</div>' : '');
    return F(el, o.ok, { long: o.long, focus: o.focus });
  }
  // Waar staat een titel: Plex, IPTV en/of streamingdiensten.
  // Waar je het kunt zien: eerst je diensten (icoontje), dan Plex en IPTV. Hooguit drie, kort gehouden.
  function srcBadges(o) {
    var b = (o.services || []).map(function (k) {
      var u = S.logos && S.logos[k];
      return u ? '<i class="ic" title="' + esc(serviceName(k)) + '" style="' + bg(u) + '"></i>' : '<span>' + esc(serviceName(k).slice(0, 7)) + '</span>';
    }).concat((o.sources || []).map(function (s) { return '<span class="' + s + '">' + (s === 'plex' ? 'Plex' : 'IPTV') + '</span>'; })).slice(0, 3);
    // Nergens te zien (nog niet uit, of nergens die je hebt): dat meteen op de tegel.
    if (!b.length) b = ['<span class="nog">Nog niet te zien</span>'];
    return '<div class="badges">' + b.join('') + '</div>';
  }
  // Eén titel uit de catalogus (Plex en IPTV samen) of van een streamingdienst.
  function rating(o) { var r = o.imdbRating || o.vote || 0; return r ? '★ ' + r.toFixed(1).replace('.', ',') : ''; }
  function whereFrom(o) { return (o.sources || []).map(function (s) { return s === 'plex' ? 'Plex' : 'IPTV'; }).concat((o.services || []).map(serviceName)).slice(0, 2).join(', '); }
  function titleTile(o, kind, onfocus) {
    return poster({ focus: onfocus, title: o.title, sub: o.soon ? o.year + ' · ' + o.soon : [o.year, rating(o)].filter(Boolean).join(' · '), img: o.poster, badges: srcBadges(o), ok: function () { openTitle(o, kind); },
      long: function () { if (kind === 'movie' && o.plex) playPlex(o.plex.key, o.plex); else if (kind === 'movie' && o.vod) playMovie(o.vod); } });
  }
  function openTitle(o, kind) {
    if (o.plexEps) return go('episodes', { title: o.title, plexEps: o.plexEps });   // opnames uit de filmbibliotheek
    go('info', { type: kind === 'series' ? 'tv' : 'movie', tmdb: o.tmdb, title: o.title, plex: o.plex || null, vod: o.vod || null, vodKind: kind }); }
  // Genre of collectie: vier posters naast elkaar.
  function mosaicTile(title, sub, posters, ok) {
    var el = h('button', { class: 'row-item' });
    el.innerHTML = '<div class="thumb mosaic">' + [0, 1, 2, 3].map(function (i) { return '<i style="' + bg((posters || [])[i]) + '"></i>'; }).join('') + '</div>' +
      '<div class="t1">' + esc(title) + '</div><div class="t2">' + esc(sub) + '</div>';
    return F(el, ok);
  }
  // Verder kijken: OK opent een keuzevenster (verder, vanaf begin, bekeken, naar de serie of film, weghalen).
  function contTile(c, after, focus) {
    return wide({ title: c.title, sub: c.next ? c.sub : [c.sub, c.left > 0 ? 'nog ' + c.left + ' min' : ''].filter(Boolean).join(' · '), img: c.img || c.art || c.thumb, progress: c.progress,
      badge: c.next ? 'Volgende' : '', ok: function () { contDialog(c, after); }, focus: focus });
  }
  function contDialog(c, after) {
    var items = [[c.next ? '▶ ' + c.sub : '▶ Verder kijken' + (c.left > 0 ? ' (nog ' + c.left + ' min)' : ''), function () { resume(c); }]];
    if (!c.next) items.push(['Vanaf het begin', function () { S.fromStart = true; resume(c); }]);
    items.push(['Markeer als bekeken', function () {
      setWatched([{ key: c.key, seriesKey: c.seriesId ? 'series:' + c.seriesId : '', kind: c.kind === 'movie' ? 'movie' : 'series', meta: { title: c.title, sub: c.sub, img: c.img || c.art || '', tmdb: c.tmdb } }], true)
        .then(function () { toast('Op bekeken gezet'); after && after(); });
    }]);
    var isMovie = c.kind === 'movie', plexKey = String(c.key || '').indexOf('plex:') === 0 ? String(c.key).slice(5) : '';
    var info = isMovie ? { type: 'movie', tmdb: c.tmdb || 0, title: c.title, plex: plexKey ? { key: plexKey } : null, vod: !plexKey && c.id ? { id: c.id } : null, vodKind: 'movie' }
      : { type: 'tv', tmdb: 0, title: c.title, plex: c.show ? { key: c.show } : null, vod: c.seriesId ? { id: c.seriesId } : null, vodKind: 'series' };
    if (info.tmdb || info.plex || info.vod) items.push([isMovie ? 'Naar de film' : 'Naar de serie', function () { go('info', info); }]);
    items.push(['Uit Verder kijken halen', function () { hideCont(c).then(after); }]);
    menu(c.title, items);
  }
  function hideCont(c) { return api('POST', '/api/continue/hide', { profile: S.profile, key: c.key }).then(function () { toast('Weggehaald uit Verder kijken'); }, function (e) { toast(e.message); }); }
  function menu(title, items) {
    var d = h('div', { class: 'dialog' }, '<h2>' + esc(title) + '</h2>'), bt = h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;justify-content:center' });
    items.forEach(function (it) { bt.appendChild(F(h('button', { class: 'btn' }, esc(it[0])), function () { closeOverlay(); it[1](); })); });
    d.appendChild(bt); openOverlay(d);
  }
  function appTile(title, app) {
    var t = wide({ title: title, ok: function () { N.launch(app.pkg); } });
    t.classList.add('app-tile'); t.querySelector('.thumb').style.backgroundImage = "url('" + (app.banner || app.icon) + "')";
    return t;
  }
  function loading(text) { return h('div', { class: 'spinner' }, esc(text || 'Laden…')); }

  // ---------- afspelen ----------
  function position(key) { if (S.fromStart) { S.fromStart = false; return Promise.resolve(0); } return get('/api/position?profile=' + S.profile + '&key=' + encodeURIComponent(key)).then(function (r) { return r.pos || 0; }, function () { return 0; }); }
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
  }
  // Live en terugkijken gaan allebei naar de live-speler (daar kun je ook spoelen, pauzeren en zappen).
  function playLive(catId, ch) { if (N) N.playLive(catId || 'alle', ch.id, 0, 0, ''); else toast('Live tv kan alleen op de tv'); }
  function playCatchup(ch, p, catId) { if (N) N.playLive(catId || 'alle', ch.id, p.start, p.end, p.title || ''); else toast('Terugkijken kan alleen op de tv'); }
  function openApp(pkgOrMatch) {
    if (!N) return toast('Apps openen kan alleen op de tv');
    loadApps().then(function (apps) {
      var m = String(pkgOrMatch).toLowerCase();
      var a = apps.filter(function (x) { return x.pkg === pkgOrMatch || x.pkg.toLowerCase().indexOf(m) >= 0 || x.label.toLowerCase().indexOf(m) >= 0; })[0];
      if (a) N.launch(a.pkg); else toast('Deze app staat niet op dit apparaat');
    });
  }
  function loadApps() { if (S.apps) return Promise.resolve(S.apps); if (!N) return Promise.resolve([]); return native('getApps').then(function (t) { S.apps = JSON.parse(t); return S.apps; }); }
  // Diensten waarvan de app op dit apparaat staat: [{svc, app}]
  function installedServices() {
    return loadApps().then(function (apps) {
      return S.svcList.map(function (s) {
        var app = apps.filter(function (a) { return a.pkg.toLowerCase().indexOf(s.match) >= 0 || a.label.toLowerCase().indexOf(s.match) >= 0; })[0];
        return app ? { svc: s, app: app } : null;
      }).filter(Boolean);
    });
  }
  // Diensten van dit profiel: zelf gekozen in Mijn profiel, anders wat er op dit apparaat staat.
  function myServices() {
    var p = me().prefs || {};
    if (p.services) return Promise.resolve(p.services);
    return installedServices().then(function (l) { return l.filter(function (x) { return isStreaming(x.svc); }).map(function (x) { return x.svc.key; }); });
  }
  // Diensten met eigen aanbod bij TMDB (Plex is van onszelf en telt hier niet mee).
  function isStreaming(s) { return s.provider && s.key !== 'plex'; }

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
    var d = h('div', { class: 'dialog' }, '<h2>Wie kijkt er?</h2>'), row = h('div', { class: 'who' });
    var locked = S.device && S.device.locked;
    S.profiles.forEach(function (p) {
      if (locked && p.id !== S.profile) return;
      var b = F(h('button', { class: 'who-item' }, '<img alt="" src="' + esc(img(p.avatarUrl)) + '"><span>' + esc(p.name) + '</span>'), function () {
        setProfile(p.id); S.ov = {}; closeOverlay(); go('home', {}, true);
      });
      if (p.id === S.profile) b.id = 'who-cur';
      row.appendChild(b);
    });
    d.appendChild(row);
    d.appendChild(F(h('button', { class: 'btn' }, 'Mijn profiel'), function () { closeOverlay(); go('profile'); }));
    openOverlay(d);
    var c = d.querySelector('#who-cur'); if (c) focus(c);
  }

  // ---------- thuis ----------
  screens.home = function () {
    var el = h('div', { class: 'screen' }); el.appendChild(topbar('home', function () { showPhoto(); }));
    // De foto loopt door tot achter de bovenbalk.
    var sc = h('div', { class: 'scroll', style: 'top:0' }), inner = h('div', { class: 'scroll-inner' }); sc.appendChild(inner); el.appendChild(sc);
    var hero = h('div', { class: 'hero first' }, '<div class="bg on"></div><div class="bg"></div><div class="txt uit"><img class="logo" alt=""><h1></h1><div class="meta"></div></div><div class="credit"></div>');
    inner.appendChild(hero);
    var layers = hero.querySelectorAll('.bg'), txt = hero.querySelector('.txt'), credit = hero.querySelector('.credit'), shown = '', heroT = 0;
    function setBg(u) {
      if (u === shown) return; shown = u;
      var nxt = layers[0].classList.contains('on') ? layers[1] : layers[0], old = nxt === layers[0] ? layers[1] : layers[0];
      var pic = new Image(); pic.onload = function () { if (shown !== u) return; nxt.style.backgroundImage = "url('" + pic.src + "')"; nxt.classList.add('on'); old.classList.remove('on'); }; pic.src = img(u);
    }
    // Rust: een foto uit de vaste set, zonder tekst. Elke keer een andere, en elke minuut een nieuwe zolang je bovenin staat.
    var photo = null, resting = true;
    function nextPhoto() {
      var l = S.photos || []; if (!l.length) return;
      var cand = l.filter(function (p) { return p !== photo; }); photo = cand[Math.floor(Math.random() * cand.length)] || l[0];
    }
    function showPhoto() {
      clearTimeout(heroT); resting = true; if (!photo) return;
      setBg(photo.url); txt.classList.add('uit'); credit.textContent = 'Foto: ' + photo.by + ' · Unsplash'; credit.style.opacity = 1;
    }
    (S.photos ? Promise.resolve(S.photos) : get('/api/photos').then(function (l) { S.photos = l; return l; }, function () { return []; }))
      .then(function () { nextPhoto(); showPhoto(); });
    clearInterval(S.photoTimer);
    S.photoTimer = setInterval(function () { if (!document.body.contains(hero)) return clearInterval(S.photoTimer); if (resting && cur && (cur.closest('.top') || cur.closest('.first'))) { nextPhoto(); showPhoto(); } }, 60000);
    // Een tegel met een mooie achtergrond: zacht overfaden, met het titellogo (of de titel). Anders blijft wat er staat.
    function showArt(it) {
      clearTimeout(heroT);
      heroT = setTimeout(function () {
        var art = it.tmdb ? (S.art[it.type + it.tmdb] ? Promise.resolve(S.art[it.type + it.tmdb]) : get('/api/art/' + it.type + '/' + it.tmdb).then(function (a) { S.art[it.type + it.tmdb] = a; return a; }, function () { return {}; }))
          : Promise.resolve({ backdrop: it.img || '' });
        art.then(function (a) {
          if (!a.backdrop) return;
          resting = false;
          setBg(a.backdrop); credit.style.opacity = 0;
          var lg = hero.querySelector('.logo'); lg.classList.toggle('on', !!a.logo); if (a.logo) lg.src = img(a.logo);
          hero.querySelector('h1').textContent = a.logo ? '' : it.title || '';
          hero.querySelector('.meta').textContent = it.meta || '';
          txt.classList.remove('uit');
        });
      }, 350);
    }
    // Thuis: eerst je diensten (daar begin je meestal), dan wat nieuw is en wat populair is. Verder kijken en live staan in Films, Series en Live tv.
    var slots = {}; ['svc', 'foryou', 'picks', 'later', 'apps'].forEach(function (k) { slots[k] = h('div'); inner.appendChild(slots[k]); });
    slots.svc.className = 'first';
    var svcQ = myServices().then(function (keys) { return 'profile=' + S.profile + '&services=' + keys.join(','); });
    svcQ.then(function (q) { return get('/api/home?' + q); }).then(function (d) {
      var picks = (d.picks && d.picks.picks) || [];
      if (picks.length) slots.picks.appendChild(rowSection('Populair bij je diensten', picks.map(function (p) {
        return wide({ title: p.title, sub: p.type + (p.year ? ' · ' + p.year : ''), img: p.thumb, badge: serviceName(p.service),
          ok: function () { go('info', { type: p.id.indexOf('tv') === 0 ? 'tv' : 'movie', tmdb: p.tmdb, title: p.title }); },
          focus: function () { showArt({ tmdb: p.tmdb, type: p.id.indexOf('tv') === 0 ? 'tv' : 'movie', title: p.title, meta: [p.type, p.year, serviceName(p.service)].filter(Boolean).join(' · ') }); } });
      })));
    }).catch(function (e) { slots.picks.innerHTML = '<div class="empty">Thuis kan tv-serverr nu niet bereiken. ' + esc(e.message) + '</div>'; });
    // Nieuw voor jou: nieuw uit Plex, IPTV en je diensten, en net uit; wat bij jouw smaak past bovenaan.
    svcQ.then(function (q) { return get('/api/foryou?' + q); }).then(function (d) {
      var tile = function (o) {
        return titleTile(o, o.kind, function () { if (o.tmdb) showArt({ tmdb: o.tmdb, type: o.kind === 'series' ? 'tv' : 'movie', title: o.title, meta: [o.year, rating(o), whereFrom(o) || 'Nog niet te zien'].filter(Boolean).join(' · ') }); });
      };
      if (d.now.length) slots.foryou.appendChild(rowSection('Nieuw voor jou', d.now.map(tile)));
      if (d.later.length) slots.later.appendChild(rowSection('Nog niet te zien', d.later.map(tile)));
    }).catch(function () {});
    // Streamingdiensten (alleen als de app er staat) en daarna de overige apps.
    Promise.all([installedServices(), loadApps()]).then(function (r) {
      var svc = r[0], used = svc.map(function (x) { return x.app.pkg; });
      if (svc.length) slots.svc.appendChild(rowSection('Streamingdiensten', svc.map(function (x) { return appTile(x.svc.name, x.app); })));
      var rest = r[1].filter(function (a) { return used.indexOf(a.pkg) < 0; });
      if (rest.length) slots.apps.appendChild(rowSection('Apps', rest.map(function (a) { return appTile(a.label, a); })));
    });
    return el;
  };
  function serviceName(k) { var s = S.svcList.filter(function (x) { return x.key === k; })[0]; return s ? s.name : (k || ''); }
  function liveCats(force) {
    if (S.cats && !force && Date.now() - S.catsAt < 30 * 60e3) return Promise.resolve(S.cats);
    return get('/api/live/categories').then(function (c) { S.cats = c; S.catsAt = Date.now(); return c; });
  }

  // ---------- live tv met gids ----------
  var PX = 7.1, SPAN = 210;  // pixels per minuut, minuten in beeld
  screens.live = function (args) {
    var el = h('div', { class: 'screen' }); el.appendChild(topbar('live'));
    var pills = h('div', { style: 'position:absolute;left:80px;right:80px;top:130px;display:flex;gap:10px;overflow:hidden' });
    var info = h('div', { class: 'g-info' }), guide = h('div', { class: 'guide' });
    el.appendChild(pills); el.appendChild(info); el.appendChild(guide);
    el.appendChild(h('div', { class: 'hint' }, '<span><span class="kbd">↑ ↓</span>zender</span><span><span class="kbd">← →</span>tijd</span><span><span class="kbd">OK</span>kijken, terugkijken of herinnering</span><span>↺ = terugkijken kan</span>'));
    // Vers binnen via de bovenbalk: focus op de categorieën, zodat je meteen naar Sport of ESPN kunt.
    var fresh = !args.st, st = args.st || (args.st = { cat: null, from: 0, row: 0 });
    liveCats().then(function (cats) {
      var shown = cats.filter(function (c) { return c.channels.length; });
      if (!st.cat) st.cat = (shown.filter(function (c) { return c.id !== 'alle' && !c.parent; })[0] || shown[0] || {}).id;
      var row = h('div', { class: 'row', style: 'padding:0;gap:10px' });
      shown.forEach(function (c) {
        row.appendChild(F(h('button', { class: 'pill' + (c.id === st.cat ? ' on' : '') }, esc(c.name)), function () { st.cat = c.id; st.from = 0; st.row = 0; go('live', args, true); }, { group: 'cats',
          focus: function () { info.innerHTML = '<span class="kicker">Categorie</span><h2 style="font-size:40px">' + esc(c.name) + '</h2><div class="dim" style="font-size:22px">' + c.channels.length + (c.channels.length === 1 ? ' zender' : ' zenders') + (c.id === st.cat ? ' · nu in beeld' : ' · OK: deze zenders in de gids') + '</div>'; } }));
      });
      pills.appendChild(row);
      var cat = shown.filter(function (c) { return c.id === st.cat; })[0] || shown[0];
      if (cat) drawGuide(cat);
    }).catch(function (e) { guide.innerHTML = '<div class="empty" style="padding:0">Live tv is nu niet bereikbaar. ' + esc(e.message) + '</div>'; });

    function drawGuide(cat) {
      var now = Date.now();
      if (!st.from) { var d = new Date(now); d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); st.from = d.getTime() - 60 * 60000; }
      var from = st.from, to = from + SPAN * 60000, x = function (t) { return (t - from) / 60000 * PX; };
      guide.innerHTML = '';
      // Kop: de dag boven de zenders, de tijden boven het rooster.
      var head = h('div', { class: 'g-head' }), times = h('div', { class: 'g-times' });
      head.appendChild(h('div', { class: 'g-day' }, esc(dayName(from + 60 * 60000))));
      for (var t = from; t < to; t += 30 * 60000) times.appendChild(h('span', { style: 'left:' + x(t) + 'px' }, clock(t)));
      head.appendChild(times); guide.appendChild(head);
      var clip = h('div', { class: 'g-clip' }), body = h('div', { class: 'g-body' }); clip.appendChild(body); guide.appendChild(clip);
      // De gekozen zender blijft net onder het midden staan; de lijst schuift eronder door.
      var ROWH = 84;
      var scrollTo = function (i) { var vis = Math.max(3, Math.floor(clip.clientHeight / ROWH)), top = Math.max(0, Math.min(i - Math.floor(vis / 2), chans.length - vis)); body.style.transform = 'translateY(' + (-top * ROWH) + 'px)'; };
      var chans = cat.channels.slice(0, 120);
      get('/api/live/guide?ids=' + chans.map(function (c) { return c.id; }).join(',') + '&from=' + from + '&to=' + to).then(function (g) {
        var byId = {}; g.forEach(function (r) { byId[r.id] = r; });
        chans.forEach(function (ch, i) {
          var r = h('div', { class: 'g-row' }), line = h('div', { class: 'g-line' });
          r.appendChild(h('div', { class: 'g-ch' }, (ch.icon ? '<img alt="" src="' + esc(img(ch.icon)) + '">' : '<span class="dim" style="width:40px">' + ch.num + '</span>') + '<span>' + esc(ch.name) + '</span>'));
          var progs = (byId[ch.id] || {}).programmes || [];
          if (!progs.length) progs = [{ title: 'Geen gids', start: from, end: to, desc: 'Voor deze zender is geen gids.', none: true }];
          progs.forEach(function (p) {
            var left = Math.max(0, x(p.start)), right = Math.min(SPAN * PX, x(p.end));
            if (right - left < 4) return;
            var past = p.end < now, live = p.start <= now && p.end > now, canBack = past && ch.archive && p.start > now - ch.archive * 864e5;
            var b = h('button', { class: 'g-p' + (p.none ? ' none' : past ? ' past' : live ? ' now' : ''), style: 'left:' + left + 'px;width:' + (right - left - 6) + 'px' },
              (canBack ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true" style="flex:none"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>' : '') +
              (S.reminders[ch.id + ':' + p.start] ? '⏰ ' : '') + '<span>' + esc(p.title) + '</span>');
            F(b, function () {
              if (live || p.none) playLive(cat.id, ch);
              else if (canBack) playCatchup(ch, p, cat.id);
              else if (!past) { toggleReminder(ch, p, cat.id); go('live', args, true); }
              else toast('Deze zender bewaart dit programma niet');
            }, { group: 'g' + i, long: function () { progDialog(ch, p, cat.id, live, canBack, past); },
              focus: function () {
                st.row = i; scrollTo(i);
                info.innerHTML = '<span class="kicker">' + esc(ch.name) + (p.none ? '' : ' · ' + clock(p.start) + '–' + clock(p.end) + (live ? ' · NU' : past ? ' · AFGELOPEN' : '')) + '</span>' +
                  '<h2 style="font-size:40px">' + esc(p.none ? ch.name : p.title) + '</h2><p class="desc" style="max-width:1300px">' + esc(p.desc || p.cat || '') + '</p>' +
                  '<div class="dim" style="font-size:20px">' + (live ? 'OK: kijken' : canBack ? 'OK: terugkijken vanaf het begin' : past ? 'Kan niet meer teruggekeken worden' : 'OK: herinnering ' + (S.reminders[ch.id + ':' + p.start] ? 'weghalen' : 'zetten')) + '</div>';
              },
              // Voorbij de rand van het tijdvak: een uur verschuiven.
              move: function (dir) {
                // Omhoog vanaf de bovenste zender: naar de categorie die nu in beeld is.
                if (dir === 'up' && i === 0) { focus(pills.querySelector('.pill.on')); return true; }
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
        focus((fresh && pills.querySelector('.pill.on')) || want || focusables()[0]);
      });
    }
    return el;
  };
  function progDialog(ch, p, catId, live, canBack, past) {
    var d = h('div', { class: 'dialog', style: 'align-items:flex-start;text-align:left' },
      '<span class="kicker">' + esc(ch.name) + ' · ' + dayName(p.start) + ' ' + clock(p.start) + '–' + clock(p.end) + '</span><h2>' + esc(p.title) + '</h2><p class="desc" style="-webkit-line-clamp:6;max-width:1000px">' + esc(p.desc || '') + '</p>');
    var bt = h('div', { style: 'display:flex;gap:16px' });
    if (live) bt.appendChild(F(h('button', { class: 'btn' }, 'Kijken'), function () { closeOverlay(); playLive(catId, ch); }));
    if (canBack) bt.appendChild(F(h('button', { class: 'btn' }, 'Terugkijken vanaf begin'), function () { closeOverlay(); playCatchup(ch, p, catId); }));
    if (!past && !live) bt.appendChild(F(h('button', { class: 'btn' }, S.reminders[ch.id + ':' + p.start] ? 'Herinnering weghalen' : 'Herinnering zetten'), function () { closeOverlay(); toggleReminder(ch, p, catId); }));
    bt.appendChild(F(h('button', { class: 'btn' }, 'Andere uitzendingen'), function () { closeOverlay(); go('search', { q: p.title }); }));
    d.appendChild(bt); openOverlay(d);
  }

  // ---------- films en series ----------
  screens.films = function () { return library('movie'); };
  screens.series = function () { return library('series'); };
  // Richting C: bovenaan verder kijken en nieuw, daaronder genres, collecties en de diensten van dit profiel.
  // Een genre- of collectietegel opent het raster met filters.
  function library(kind) {
    var el = h('div', { class: 'screen' }); el.appendChild(topbar(kind === 'movie' ? 'films' : 'series'));
    var sc = h('div', { class: 'scroll' }), inner = h('div', { class: 'scroll-inner' }); sc.appendChild(inner); el.appendChild(sc);
    var slots = {}; ['cont', 'rec', 'newest', 'genres', 'coll', 'svc'].forEach(function (k) { slots[k] = h('div'); inner.appendChild(slots[k]); });
    slots.cont.className = 'first'; slots.newest.appendChild(loading());
    var again = function () { go(kind === 'movie' ? 'films' : 'series', {}, true); };
    get('/api/continue?profile=' + S.profile).then(function (list) {
      var mine = list.filter(function (c) { return c.kind === kind; });
      if (mine.length) slots.cont.appendChild(rowSection('Verder kijken', mine.map(function (c) { return contTile(c, again); }), me().name));
    }).catch(function () {});
    myServices().then(function (keys) {
      var q = 'profile=' + S.profile + '&services=' + keys.join(',');
      get('/api/catalog/' + kind + '/overview?' + q).then(function (o) {
        S.ov[kind] = o; slots.newest.innerHTML = '';
        if (!o.total) { slots.newest.innerHTML = '<div class="empty">Nog geen ' + (kind === 'movie' ? 'films' : 'series') + ' gevonden.</div>'; return; }
        slots.newest.appendChild(rowSection('Nieuw', o.newest.map(function (m) { return titleTile(m, kind); })));
        if ((o.recordings || []).length) slots.rec.appendChild(rowSection('Opnames', o.recordings.map(function (m) { return titleTile(m, kind); })));
        slots.genres.appendChild(rowSection('Genres', o.genres.map(function (g) {
          return mosaicTile(g.name, g.count + ' titels', g.posters, function () { go('grid', { kind: kind, genre: g.name, title: g.name }); });
        })));
        slots.coll.appendChild(rowSection('Collecties', o.collections.map(function (c) {
          var f = c.id.split(':'), a = { kind: kind, title: c.name };
          if (f[0] === 'src') a.src = f[1]; else if (f[0] === 'soon') { a.cat = 'soon'; a.alles = '1'; } else a.cat = f.slice(1).join(':');
          return mosaicTile(c.name, c.count + ' titels', c.posters, function () { go('grid', a); });
        })));
      }).catch(function (e) { slots.newest.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
      if (!keys.length) return;
      get('/api/streaming/' + kind + '?services=' + keys.join(',')).then(function (rows) {
        rows.forEach(function (r) {
          slots.svc.appendChild(rowSection('Op ' + r.name, r.items.map(function (p) {
            return poster({ title: p.title, sub: p.year, img: p.poster, badges: srcBadges({ services: [r.service] }), ok: function () { go('info', { type: kind === 'series' ? 'tv' : 'movie', tmdb: p.tmdb, title: p.title }); } });
          })));
        });
      }).catch(function () {});
    });
    return el;
  }
  var SORTS = [['beste', 'Beste eerst'], ['nieuw', 'Nieuwste eerst'], ['az', 'A tot Z'], ['jaar', 'Jaar']];
  function nextOf(list, v) { var i = list.map(function (x) { return x[0]; }).indexOf(v || list[0][0]); return list[(i + 1) % list.length][0]; }
  function labelOf(list, v) { return (list.filter(function (x) { return x[0] === (v || list[0][0]); })[0] || list[0])[1]; }
  // Raster met filters: genre, bron (ook je diensten), volgorde en alleen goede titels. Laadt per 90 titels bij.
  screens.grid = function (a) {
    var el = h('div', { class: 'screen' });
    el.appendChild(h('div', { style: 'position:absolute;left:80px;top:46px' }, '<h1 style="font-size:44px">' + esc(a.title) + '</h1>'));
    var bar = h('div', { class: 'filters' }), count = h('span', { class: 'count' });
    var redo = function (id) { a._focus = '#' + id; go('grid', a, true); };
    el.appendChild(bar);
    var sc = h('div', { class: 'scroll', style: 'top:200px' }), inner = h('div', { class: 'scroll-inner' }), grid = h('div', { class: 'grid' });
    inner.appendChild(grid); sc.appendChild(inner); el.appendChild(sc);
    myServices().then(function (keys) {
      var srcs = [['', 'Alles'], ['plex', 'Plex'], ['iptv', 'IPTV']].concat(keys.map(function (k) { return [k, serviceName(k)]; }));
      if (a.cat !== 'soon') {
        bar.appendChild(F(h('button', { class: 'pill on', id: 'f-genre' }, 'Genre: ' + esc(a.genre || 'alle')), function () { pickGenre(a, function () { redo('f-genre'); }); }, { group: 'filters' }));
        bar.appendChild(F(h('button', { class: 'pill on', id: 'f-src' }, 'Bron: ' + esc(labelOf(srcs, a.src))), function () { a.src = nextOf(srcs, a.src); redo('f-src'); }, { group: 'filters' }));
        bar.appendChild(F(h('button', { class: 'pill on', id: 'f-sort' }, labelOf(SORTS, a.sort)), function () { a.sort = nextOf(SORTS, a.sort); redo('f-sort'); }, { group: 'filters' }));
        bar.appendChild(F(h('button', { class: 'pill on', id: 'f-good' }, a.alles === '1' ? 'Alle titels' : 'Alleen goed'), function () { a.alles = a.alles === '1' ? '' : '1'; redo('f-good'); }, { group: 'filters' }));
      }
      bar.appendChild(count);
      var want = a._focus && bar.querySelector(a._focus); if (want) focus(want);
      var total = 0, busy = false;
      function load(offset) {
        busy = true;
        get('/api/catalog/' + a.kind + '/browse?profile=' + S.profile + '&services=' + keys.join(',') + '&genre=' + encodeURIComponent(a.genre || '') + '&src=' + (a.src || '') +
          '&cat=' + encodeURIComponent(a.cat || '') + '&sort=' + (a.sort || '') + '&alles=' + (a.alles || '') + '&offset=' + offset).then(function (r) {
          total = r.total; count.textContent = total + ' titels';
          r.items.forEach(function (m) {
            var t = titleTile(m, a.kind); grid.appendChild(t);
            t._onfocus = function () { if (!busy && grid.children.length < total && [].indexOf.call(grid.children, t) >= grid.children.length - 12) load(grid.children.length); };
          });
          if (!offset && !want) focus(grid.firstChild || focusables()[0]);
          if (!total) grid.innerHTML = '<div class="empty" style="padding:0;grid-column:1/-1">Niets gevonden met deze filters.' + (a.alles === '1' ? '' : ' Zet "Alleen goed" uit voor alle titels.') + '</div>';
          busy = false;
        }).catch(function (e) { busy = false; toast(e.message); });
      }
      load(0);
    });
    return el;
  };
  function pickGenre(a, done) {
    var show = function (o) {
      var d = h('div', { class: 'dialog' }, '<h2>Genre kiezen</h2>'), box = h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:1100px' });
      [{ name: '' }].concat(o.genres).forEach(function (g) {
        box.appendChild(F(h('button', { class: 'pill' + ((a.genre || '') === g.name ? ' on' : '') }, esc(g.name || 'Alle genres')), function () { a.genre = g.name; closeOverlay(); done(); }));
      });
      d.appendChild(box); openOverlay(d);
    };
    if (S.ov[a.kind]) return show(S.ov[a.kind]);
    myServices().then(function (keys) { return get('/api/catalog/' + a.kind + '/overview?profile=' + S.profile + '&services=' + keys.join(',')); }).then(function (o) { S.ov[a.kind] = o; show(o); });
  }

  // ---------- infopagina ----------
  // Boven: poster, gegevens, waar je het kunt zien en de knoppen. Bij een serie daaronder meteen de seizoenen en afleveringen.
  screens.info = function (a) {
    var el = h('div', { class: 'screen' });
    // Groot beeld over de hele breedte, tekst linksonder op een zacht verloop; daaronder de seizoenen. Het geheel schuift mee.
    var sc = h('div', { class: 'scroll', style: 'top:0' }), inner = h('div', { class: 'scroll-inner' }); sc.appendChild(inner); el.appendChild(sc);
    var hero = h('div', { class: 'ihero first' }), bgEl = h('div', { class: 'ibg' }); hero.appendChild(bgEl);
    var txt = h('div', { class: 'itxt' }, '<h1>' + esc(a.title) + '</h1>'), castLine = h('div', { class: 'icast' });
    hero.appendChild(txt); hero.appendChild(castLine); inner.appendChild(hero);
    var lower = h('div'); inner.appendChild(lower);
    var series = a.type === 'tv';
    var src = a.plex ? 'plex:' + a.plex.key : a.vod ? (a.vodKind === 'movie' ? 'movie:' : 'series:') + a.vod.id : '';
    var showQ = series && (a.plex || a.vod) ? get('/api/show?profile=' + S.profile + (a.plex ? '&plex=' + a.plex.key : '&vod=' + a.vod.id)).catch(function () { return null; }) : Promise.resolve(null);
    showQ.then(function (show) {
      var tmdbId = a.tmdb || (show && show.tmdb) || 0;
      return Promise.all([tmdbId ? get('/api/info/' + a.type + '/' + tmdbId).catch(function () { return null; }) : null,
        get('/api/mylist?profile=' + S.profile).catch(function () { return []; }), myServices(),
        !series && src ? get('/api/watched?profile=' + S.profile + '&key=' + encodeURIComponent(src)).catch(function () { return {}; }) : {}, show]);
    }).then(function (r) {
      var d = r[0] || {}, mine = r[2], seen = !!r[3].on, show = r[4];
      var inList = r[1].some(function (x) { return x.key === (src || 'tmdb:' + a.type + a.tmdb); });
      bgEl.style.backgroundImage = "url('" + img(d.backdrop || (show && show.backdrop) || (a.plex && a.plex.art) || (a.vod && a.vod.backdrop)) + "')";
      if (d.cast && d.cast.length) castLine.innerHTML = '<span class="dim">Met </span>' + esc(d.cast.slice(0, 3).map(function (c) { return c.name; }).join(', '));
      var nSeasons = show ? show.seasons.length : (d.seasons || []).length;
      var imdb = (d.ratings && d.ratings.imdb ? 'IMDb ' + String(d.ratings.imdb).replace('.', ',') : d.rating ? '★ ' + d.rating.toFixed(1).replace('.', ',') : '') +
        (d.ratings && d.ratings.rt ? ' · Rotten Tomatoes ' + d.ratings.rt : '');
      var meta = [d.year || (a.vod && a.vod.year), nSeasons ? nSeasons + ' seizoen' + (nSeasons > 1 ? 'en' : '') : d.runtime ? d.runtime + ' min' : '',
        d.age ? '<span class="tag">' + esc(d.age) + '</span>' : '', imdb, (d.genres || []).slice(0, 3).join(' · ')].filter(Boolean);
      // Waar te zien: eerst de diensten die je hebt, dan Plex en IPTV. Diensten die je niet hebt staan er grijs bij.
      var svc = d.services || [], have = svc.filter(function (x) { return x.key && mine.indexOf(x.key) >= 0; }), other = svc.filter(function (x) { return have.indexOf(x) < 0 && !/channel|with ads|met reclame/i.test(x.name); });
      var chip = function (x, dim) { return '<span class="where' + (dim ? ' dim' : '') + '">' + (x.logo ? '<i style="' + bg(x.logo) + '"></i>' : '') + esc(x.name) + '</span>'; };
      var where = have.map(function (x) { return chip(x); }).concat(a.plex ? [chip({ name: 'Plex' })] : [], a.vod ? [chip({ name: 'IPTV' })] : []);
      txt.innerHTML = '<h1>' + esc(d.title || a.title) + '</h1><div class="meta">' + meta.map(function (m) { return '<span>' + (m.indexOf('<span') === 0 ? m : esc(m)) + '</span>'; }).join('') + '</div>' +
        '<p class="desc">' + esc(d.overview || (show && show.plot) || (a.plex && a.plex.summary) || (a.vod && a.vod.plot) || '') + '</p>' +
        '<div class="wherebox">' + (where.length ? '<span class="dim">Te zien via</span>' + where.join('') : '<span class="dim">Nog niet te zien</span>') +
        (other.length ? '<span class="dim" style="margin-left:14px">Ook op</span>' + other.slice(0, 4).map(function (x) { return chip(x, true); }).join('') : '') + '</div>';
      if (d.tmdb) (S.art[a.type + d.tmdb] ? Promise.resolve(S.art[a.type + d.tmdb]) : get('/api/art/' + a.type + '/' + d.tmdb).then(function (x) { S.art[a.type + d.tmdb] = x; return x; }, function () { return {}; })).then(function (x) {
        if (!x.logo) return; var lg = new Image(); lg.className = 'ilogo'; lg.alt = d.title || ''; lg.onload = function () { var t = txt.querySelector('h1'); if (t) t.replaceWith(lg); }; lg.src = img(x.logo);
      });
      var bt = h('div', { class: 'ibtns' });
      var openSvc = have[0] && F(h('button', { class: 'btn' }, 'Openen in ' + esc(have[0].name)), function () { openApp(serviceMatch(have[0].key)); });
      if (series && show) {
        var nx = nextUp(show);
        if (nx) bt.appendChild(F(h('button', { class: 'btn' }, '▶&nbsp; ' + esc(nx.label + ': S' + nx.s.season + ' afl. ' + nx.e.num)), function () { playEp(nx.s, nx.e); }));
      } else if (a.plex && !series) bt.appendChild(F(h('button', { class: 'btn' }, '▶&nbsp; Afspelen'), function () { playPlex(a.plex.key, a.plex); }));
      else if (a.vod && !series) bt.appendChild(F(h('button', { class: 'btn' }, '▶&nbsp; Afspelen'), function () { playMovie(a.vod); }));
      // Staat het op een dienst die je hebt, dan die knop vooraan: dan hoef je niet via IPTV.
      if (openSvc) bt.insertBefore(openSvc, bt.firstChild);
      if (!series && src) bt.appendChild(F(h('button', { class: 'btn' }, seen ? '✓ Bekeken' : 'Markeer als bekeken'), function () {
        var b = this; seen = !seen;
        setWatched([{ key: src, kind: 'movie', meta: { title: d.title || a.title, img: d.backdrop || '', tmdb: a.tmdb, type: 'movie' } }], seen).then(function () { b.innerHTML = seen ? '✓ Bekeken' : 'Markeer als bekeken'; });
      }));
      bt.appendChild(F(h('button', { class: 'btn' }, inList ? '✓ Mijn lijst' : '+ Mijn lijst'), function () {
        api('POST', '/api/mylist', { profile: S.profile, key: src || 'tmdb:' + a.type + a.tmdb, meta: { title: d.title || a.title, img: d.poster || '', type: a.type, tmdb: a.tmdb, plex: a.plex || null, vod: a.vod || null, vodKind: a.vodKind || '' } })
          .then(function (r2) { cur.innerHTML = r2.inList ? '✓ Mijn lijst' : '+ Mijn lijst'; toast(r2.inList ? 'Op je lijst gezet' : 'Van je lijst gehaald'); });
      }));
      if (d.trailer) bt.appendChild(F(h('button', { class: 'btn' }, 'Trailer'), function () { if (N) N.openUrl('https://www.youtube.com/watch?v=' + d.trailer); }));
      txt.appendChild(bt);

      // Afspelen van een aflevering (Plex of IPTV).
      function playEp(s, e) {
        if (a.plex) playPlex(e.key, { title: d.title || a.title, sub: 'S' + s.season + ' · afl. ' + e.num, img: e.img });
        else playEpisode({ id: a.vod.id, name: d.title || a.title, tmdb: a.tmdb, backdrop: show.backdrop, icon: a.vod.icon }, s.season, e);
      }
      function epItem(s, e) { return { key: e.skey, seriesKey: a.vod ? 'series:' + a.vod.id : '', kind: 'series', meta: { title: d.title || a.title, sub: 'S' + s.season + ' · afl. ' + e.num, img: e.img || '', tmdb: a.tmdb } }; }
      if (series && show && show.seasons.length) {
        var st = a.st || (a.st = { season: Math.max(0, show.seasons.indexOf((nextUp(show) || {}).s)) });
        var pills = h('div', { class: 'seasons' }, '<span class="dim">Seizoen</span>'), row = h('div');
        show.seasons.forEach(function (s, i) {
          var allSeen = s.episodes.every(function (e) { return e.watched; });
          pills.appendChild(F(h('button', { class: 'pill' + (i === st.season ? ' on' : '') }, esc(s.season) + (allSeen ? ' ✓' : '')), function () { st.season = i; paint(); }, { group: 'seasons' }));
        });
        pills.appendChild(F(h('button', { class: 'pill' }, 'Seizoen bekeken'), function () {
          var s = show.seasons[st.season], on = !s.episodes.every(function (e) { return e.watched; });
          setWatched(s.episodes.map(function (e) { return epItem(s, e); }), on).then(function () { s.episodes.forEach(function (e) { e.watched = on; e.progress = 0; }); paint(); toast(on ? 'Seizoen ' + s.season + ' op bekeken gezet' : 'Seizoen ' + s.season + ' weer op niet bekeken'); });
        }, { group: 'seasons' }));
        lower.appendChild(pills); lower.appendChild(row);
        var paint = function () {
          [].forEach.call(pills.querySelectorAll('.pill'), function (p, i) { p.classList.toggle('on', i === st.season); });
          var s = show.seasons[st.season], keep = cur && row.contains(cur) ? [].indexOf.call(cur.parentNode.children, cur) : -1;
          row.innerHTML = '';
          row.appendChild(rowSection('', s.episodes.map(function (e) {
            // Aflevering als kaart: beeld met de tekst erop, zoals in een goede videotheek.
            var b = h('button', { class: 'row-item ep' }, '<div class="thumb" style="' + bg(e.img || show.backdrop) + '"><div class="cap"><span class="k">Aflevering ' + e.num + '</span>' + (e.title && !/^(aflevering|episode)\s*\d+$/i.test(e.title) ? '<b>' + esc(e.title) + '</b>' : '') +
              (e.plot ? '<p>' + esc(e.plot) + '</p>' : '') + '<span class="f2">' + [e.dur ? Math.round(e.dur / 60) + ' min' : '', e.watched ? '✓ Bekeken' : ''].filter(Boolean).join(' · ') + '</span></div>' +
              (!e.watched && e.progress > 0.03 ? '<div class="bar"><i style="width:' + Math.round(e.progress * 100) + '%"></i></div>' : '') + '</div>');
            return F(b, function () { playEp(s, e); }, { long: function () { epMenu(s, e); } });
          })));
          if (keep >= 0) { var it = row.querySelectorAll('.row-item')[keep]; if (it) focus(it); }
        };
        var epMenu = function (s, e) {
          menu('S' + s.season + ' afl. ' + e.num, [['Afspelen', function () { playEp(s, e); }], ['Vanaf het begin', function () { S.fromStart = true; playEp(s, e); }],
            [e.watched ? 'Markeer als niet bekeken' : 'Markeer als bekeken', function () { setWatched([epItem(s, e)], !e.watched).then(function () { e.watched = !e.watched; e.progress = 0; paint(); }); }]]);
        };
        paint();
      }
      // Onder het beeld: meer zoals dit, cast, extra's, trailers, beelden en alles over de titel. Scrollen mag.
      var slot = {}; ['rel', 'cast', 'extras', 'vid', 'img', 'over'].forEach(function (k) { slot[k] = h('div'); lower.appendChild(slot[k]); });
      if ((d.related || []).length) slot.rel.appendChild(rowSection('Meer zoals dit', d.related.map(function (x) {
        var type = x.id.indexOf('tv') === 0 ? 'tv' : 'movie';
        return poster({ title: x.title, sub: x.year, img: x.poster, badges: x.sources ? srcBadges(x) : '', ok: function () { go('info', { type: type, tmdb: x.tmdb, title: x.title, plex: x.plex || null, vod: x.vod || null, vodKind: type === 'tv' ? 'series' : 'movie' }); } });
      })));
      if ((d.cast || []).length) slot.cast.appendChild(rowSection('Cast en crew', d.cast.map(function (c) {
        return F(h('button', { class: 'row-item cast' }, '<div class="ph" style="' + bg(c.photo) + '"></div><b>' + esc(c.name) + '</b><span class="dim">' + esc(c.role || '') + '</span>'), function () { go('person', { id: c.id, name: c.name }); });
      })));
      var plexKey = a.plex && a.plex.key;
      if (plexKey) get('/api/plex/extras/' + plexKey).then(function (l) {
        if (l.length) slot.extras.appendChild(rowSection("Extra's", l.map(function (x) {
          return wide({ title: x.title, sub: [EXTRA[x.sub] || 'Extra', x.minutes ? x.minutes + ' min' : ''].filter(Boolean).join(' · '), img: x.img, ok: function () { playPlex(x.key, { title: x.title, sub: d.title || a.title }); } });
        })));
      }, function () {});
      if ((d.videos || []).length) slot.vid.appendChild(rowSection('Trailers en meer', d.videos.map(function (v) {
        return wide({ title: v.name, sub: EXTRA[v.type] || v.type, img: v.img, ok: function () { if (N) N.openUrl('https://www.youtube.com/watch?v=' + v.key); } });
      })));
      // Beelden: OK zet het beeld groot bovenaan.
      if ((d.images || []).length) slot.img.appendChild(rowSection('Beelden', d.images.map(function (u) {
        return wide({ title: '', img: u, ok: function () { bgEl.style.backgroundImage = "url('" + img(u.replace('/w780/', '/original/')) + "')"; reveal(bt.firstChild); focus(bt.firstChild); } });
      })));
      // Over: het hele verhaal en de gegevens op een rij.
      var facts = [['Regie', d.director], ['Schrijvers', d.writers], ['Verschenen', d.date ? new Date(d.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''],
        ['Duur', d.runtime ? Math.floor(d.runtime / 60) + ' u ' + (d.runtime % 60) + ' min' : ''], ['Taal', d.language ? langName(d.language) : ''], ['Land', (d.countries || []).join(', ')],
        ['Gemaakt door', d.companies], ['Originele titel', d.original && d.original !== d.title ? d.original : ''], ['Leeftijd', d.age]].filter(function (f) { return f[1]; });
      if (d.overview || facts.length) {
        var card = F(h('button', { class: 'about' }, '<div class="l">' + (d.tagline ? '<i>' + esc(d.tagline) + '</i>' : '') + '<p>' + esc(d.overview || '') + '</p></div>' +
          '<dl>' + facts.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('') + '</dl>'), function () {});
        var sec = h('div', { class: 'section' }, '<h2>Over ' + esc(d.title || a.title) + '</h2>'); sec.appendChild(card); slot.over.appendChild(sec);
      }
      focus(bt.firstChild);
    });
    return el;
  };
  function langName(c) { try { return new Intl.DisplayNames(['nl'], { type: 'language' }).of(c); } catch (e) { return c; } }
  var EXTRA = { Trailer: 'Trailer', Teaser: 'Teaser', Featurette: 'Achter de schermen', 'Behind the Scenes': 'Achter de schermen', Clip: 'Fragment',
    trailer: 'Trailer', behindTheScenes: 'Achter de schermen', deletedScene: 'Verwijderde scène', featurette: 'Achter de schermen', interview: 'Interview', sceneOrSample: 'Fragment', short: 'Kort', extra: 'Extra' };
  // Iemand uit de cast: waar die verder in speelde. Wat we zelf hebben krijgt een label.
  screens.person = function (a) {
    var el = h('div', { class: 'screen' });
    el.appendChild(h('div', { style: 'position:absolute;left:80px;top:46px' }, '<h1 style="font-size:44px">' + esc(a.name) + '</h1>'));
    var sc = h('div', { class: 'scroll', style: 'top:130px' }), inner = h('div', { class: 'scroll-inner' }), grid = h('div', { class: 'grid' });
    inner.appendChild(grid); sc.appendChild(inner); el.appendChild(sc); grid.appendChild(loading());
    get('/api/person/' + a.id).then(function (d) {
      grid.innerHTML = '';
      d.items.forEach(function (x) {
        var type = x.id.indexOf('tv') === 0 ? 'tv' : 'movie';
        grid.appendChild(poster({ title: x.title, sub: [x.year, type === 'tv' ? 'Serie' : 'Film'].filter(Boolean).join(' · '), img: x.poster, ok: function () { go('info', { type: type, tmdb: x.tmdb, title: x.title }); } }));
      });
      focus(grid.firstChild);
    }).catch(function (e) { grid.innerHTML = '<div class="empty" style="padding:0">' + esc(e.message) + '</div>'; });
    return el;
  };
  // Wat er nu aan de beurt is: een aflevering die half gekeken is, anders de eerste na de laatst geziene.
  function nextUp(show) {
    var all = []; show.seasons.forEach(function (s) { s.episodes.forEach(function (e) { all.push({ s: s, e: e }); }); });
    if (!all.length) return null;
    var busy = all.filter(function (x) { return !x.e.watched && x.e.progress > 0.03; })[0];
    if (busy) return { s: busy.s, e: busy.e, label: 'Verder' };
    var last = -1; all.forEach(function (x, i) { if (x.e.watched) last = i; });
    if (last < 0) return { s: all[0].s, e: all[0].e, label: 'Begin' };
    if (last + 1 < all.length) return { s: all[last + 1].s, e: all[last + 1].e, label: 'Volgende' };
    return { s: all[0].s, e: all[0].e, label: 'Opnieuw' };
  }
  function setWatched(items, on) {
    return api('POST', '/api/watched', { profile: S.profile, items: items, on: on }).then(function () { S.ov = {}; }, function (e) { toast(e.message); throw e; });
  }
  function serviceMatch(k) { var s = S.svcList.filter(function (x) { return x.key === k; })[0]; return s ? s.match : k; }
  // Opnames uit de filmbibliotheek ("Rondo - S08E15") per seizoen.
  function groupEps(eps) {
    var by = {}; eps.forEach(function (e) { (by[e.season] = by[e.season] || []).push({ key: e.key, num: e.num, title: 'Aflevering ' + e.num, img: e.img, progress: e.progress }); });
    return Object.keys(by).sort(function (x, y) { return x - y; }).map(function (k) { return { season: k, episodes: by[k] }; });
  }
  screens.episodes = function (a) {   // alleen nog voor opnames; echte series staan op de infopagina
    var el = h('div', { class: 'screen' });
    el.appendChild(h('div', { style: 'position:absolute;left:80px;top:50px' }, '<h1 style="font-size:44px">' + esc(a.title) + '</h1>'));
    var seasonsBox = h('div', { style: 'position:absolute;left:80px;right:80px;top:130px;display:flex;gap:10px' });
    var list = h('div', { class: 'main', style: 'left:80px;top:220px' });
    el.appendChild(seasonsBox); el.appendChild(list);
    var st = a.st || (a.st = { season: 0 }), seasons = groupEps(a.plexEps || []);
    seasons.forEach(function (s, i) { seasonsBox.appendChild(F(h('button', { class: 'pill' + (i === st.season ? ' on' : '') }, 'Seizoen ' + esc(s.season)), function () { st.season = i; go('episodes', a, true); }, { group: 'seasons' })); });
    var s = seasons[st.season]; if (!s) { list.innerHTML = '<div class="empty" style="padding:0">Geen afleveringen gevonden</div>'; return el; }
    var inner = h('div', { class: 'scroll-inner', style: 'display:flex;flex-direction:column;gap:10px' }); list.appendChild(inner);
    s.episodes.forEach(function (ep) {
      inner.appendChild(F(h('button', { class: 'listrow' }, '<span><b>' + ep.num + '.</b> ' + esc(ep.title) + '</span><span class="dim">' + (ep.progress > 0.05 ? 'bezig' : '') + '</span>'), function () {
        playPlex(ep.key, { title: a.title, sub: 'S' + s.season + ' · afl. ' + ep.num, img: ep.img });
      }, { long: function () { menu('S' + s.season + ' afl. ' + ep.num, [['Vanaf het begin', function () { S.fromStart = true; playPlex(ep.key, { title: a.title, sub: 'S' + s.season + ' · afl. ' + ep.num, img: ep.img }); }],
        ['Markeer als bekeken', function () { setWatched([{ key: 'plex:' + ep.key, kind: 'movie', meta: { title: a.title, sub: 'S' + s.season + ' · afl. ' + ep.num, img: ep.img } }], true).then(function () { toast('Op bekeken gezet'); }); }]]); } }));
    });
    setTimeout(function () { focus(inner.firstChild); }, 0);
    return el;
  };

  // ---------- zoeken ----------
  // Zoeken: links typen of inspreken, rechts één lijst met filters (Alles, Nu live, Straks, Terugkijken, Zenders, Films en series).
  // Zoeken: links typen of inspreken, met daaronder onderwerpen en wat je eerder zocht. Rechts één lijst met filters.
  var FILTERS = [['alles', 'Alles'], ['live', 'Nu live'], ['later', 'Straks'], ['past', 'Terugkijken'], ['channels', 'Zenders'], ['titles', 'Films en series'], ['youtube', 'YouTube']];
  var TOPICS = ['wielrennen', 'voetbal', 'formule 1', 'darts', 'tennis'];
  screens.search = function (a) {
    var el = h('div', { class: 'screen' }); el.appendChild(topbar('search'));
    var st = a.st || (a.st = { q: a.q || '', filter: 'alles', r: null });
    var left = h('div', { style: 'position:absolute;left:80px;top:140px;width:400px;display:flex;flex-direction:column;gap:16px' });
    var field = h('div', { class: 'field', style: 'height:64px;font-size:28px' }); left.appendChild(field);
    left.appendChild(F(h('button', { class: 'btn', style: 'justify-content:center;padding:12px 24px;font-size:21px' }, '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg>Inspreken'), function () {
      listen(function (t) { st.q = t; paint(); run(); });
    }, { group: 'kbtop' }));
    left.appendChild(keyboard('abcdefghijklmnopqrstuvwxyz1234567890', function (c) { if (c === '⌫') st.q = st.q.slice(0, -1); else st.q += c === '␣' ? ' ' : c; paint(); clearTimeout(st.t); st.t = setTimeout(run, 700); }));
    var chips = h('div', { class: 'chips' }); left.appendChild(chips);
    var pills = h('div', { style: 'position:absolute;left:540px;right:80px;top:140px;display:flex;gap:8px;flex-wrap:wrap' });
    var res = h('div', { class: 'scroll', style: 'left:540px;right:0;top:206px' }), inner = h('div', { class: 'scroll-inner', style: 'padding-right:80px' }); res.appendChild(inner);
    el.appendChild(left); el.appendChild(pills); el.appendChild(res);
    function paint() { field.textContent = st.q || ' '; }
    var pick = function (q) { st.q = q; st.filter = 'alles'; paint(); run(); };
    // Onderwerpen en laatst gezocht. Ingedrukt houden haalt een eerdere zoekopdracht weg.
    function drawChips(recent) {
      chips.innerHTML = '';
      TOPICS.forEach(function (t) { chips.appendChild(F(h('button', { class: 'chip topic' }, esc(t)), function () { pick(t); }, { group: 'chips' })); });
      recent.filter(function (q) { return TOPICS.indexOf(q) < 0; }).slice(0, 8).forEach(function (q) {
        chips.appendChild(F(h('button', { class: 'chip' }, '↺ ' + esc(q)), function () { pick(q); }, { group: 'chips', long: function () {
          api('DELETE', '/api/searches?profile=' + S.profile + '&q=' + encodeURIComponent(q)).then(drawChips); } }));
      });
      if (recent.length) chips.appendChild(F(h('button', { class: 'chip' }, 'Alles wissen'), function () { api('DELETE', '/api/searches?profile=' + S.profile).then(drawChips); }, { group: 'chips' }));
      st.recent = recent; if (!st.q) emptyState();
    }
    get('/api/searches?profile=' + S.profile).then(drawChips, function () { drawChips([]); });
    // Iets gekozen uit de resultaten: dan telt deze zoekopdracht mee voor Laatst gezocht.
    function remember() { var q = st.q.trim(); if (q.length > 1) api('POST', '/api/searches', { profile: S.profile, q: q }).catch(function () {}); }
    // Nog niets getypt: wat er nu live is bij je meest gezochte onderwerp.
    function emptyState() {
      var top = (st.recent || [])[0] || TOPICS[0];
      pills.innerHTML = ''; inner.innerHTML = '';
      get('/api/search?q=' + encodeURIComponent(top)).then(function (r) {
        if (st.q) return;
        var live = (r.guide && r.guide.live) || [];
        inner.innerHTML = ''; inner.appendChild(h('h2', { style: 'font-size:24px;margin:0 0 14px' }, live.length ? 'Nu live: ' + esc(top) : 'Nu niets live bij ' + esc(top)));
        var box = h('div', { class: 'hits' }); live.slice(0, 8).forEach(function (x) { box.appendChild(hitRow(x, 'live')); }); inner.appendChild(box);
      }).catch(function () {});
    }
    function run() {
      var q = st.q.trim(); if (q.length < 2) { st.r = null; if (!q) emptyState(); else draw(); return; }
      inner.innerHTML = ''; inner.appendChild(loading('Zoeken…'));
      get('/api/search?q=' + encodeURIComponent(q)).then(function (r) { if (st.q.trim() !== q) return; st.r = r; draw(); })
        .catch(function (e) { inner.innerHTML = '<div class="empty" style="padding:0">' + esc(e.message) + '</div>'; });
    }
    function draw() {
      pills.innerHTML = ''; inner.innerHTML = ''; inner.dataset.y = 0; inner.style.transform = '';
      var r = st.r; if (!r) return;
      var g = r.guide || {}, yt = r.youtube || {};
      var lists = { live: g.live || [], later: g.later || [], past: g.past || [], channels: g.channels || [], titles: r.titles || [], youtube: (yt.live || []).concat(yt.upcoming || []) };
      var n = function (k) { return k === 'alles' ? Object.keys(lists).reduce(function (t, x) { return t + lists[x].length; }, 0) : lists[k].length; };
      FILTERS.forEach(function (f) {
        // Nu live staat er altijd, ook met 0: dan weet je dat er nu niets is.
        if (f[0] !== 'alles' && f[0] !== 'live' && !n(f[0])) return;
        pills.appendChild(F(h('button', { class: 'pill' + (st.filter === f[0] ? ' on' : '') }, esc(f[1]) + ' (' + n(f[0]) + ')'), function () { st.filter = f[0]; draw(); focus(pills.querySelector('.on')); }, { group: 'filters' }));
      });
      if (!n('alles')) { inner.innerHTML = '<div class="empty" style="padding:0">Niets gevonden voor "' + esc(st.q.trim()) + '"</div>'; return; }
      var all = st.filter === 'alles', box = h('div', { class: 'hits' });
      if (st.filter === 'live' && !lists.live.length) inner.appendChild(h('div', { class: 'empty', style: 'padding:0 0 14px' }, 'Nu is er niets live met "' + esc(st.q.trim()) + '".' + (lists.later[0] ? ' Eerstvolgende:' : '')));
      [['channels', 3], ['live', 6], ['later', 5], ['past', 5], ['youtube', 4]].forEach(function (k) {
        var list = lists[k[0]];
        if (st.filter === 'live' && k[0] === 'later' && !lists.live.length) list = list.slice(0, 1);
        else if (!all && st.filter !== k[0]) return;
        list.slice(0, all ? k[1] : 200).forEach(function (x) { box.appendChild(k[0] === 'youtube' ? ytRow(x) : hitRow(x, k[0])); });
      });
      if (box.children.length) inner.appendChild(box);
      if (lists.titles.length && (all || st.filter === 'titles')) {
        var tiles = lists.titles.map(function (t) { var e = titleTile(t, t.kind), ok = e._ok; e._ok = function () { remember(); ok(); }; return e; });
        if (all) { var sec = rowSection('Films en series', tiles); sec.querySelector('h2').style.paddingLeft = '0'; sec.querySelector('.row').style.padding = '0'; inner.appendChild(sec); }
        else { var gr = h('div', { class: 'grid', style: 'padding:4px 0' }); tiles.forEach(function (t) { gr.appendChild(t); }); inner.appendChild(gr); }
      }
    }
    function ytRow(x) {
      var live = !x.start;
      var b = h('button', { class: 'hit' }, '<span class="st yt">' + (live ? '● LIVE' : esc(dayName(x.start).length > 9 ? new Date(x.start).toLocaleDateString('nl-NL', { weekday: 'short' }) : dayName(x.start).toLowerCase()) + ' ' + clock(x.start)) + '</span>' +
        '<span class="ti">' + esc(x.title) + '</span><span class="ch"><i style="' + bg(x.thumb) + ';background-size:cover"></i>' + esc(x.channel) + '</span>' +
        '<span class="tm">YouTube' + (live && x.viewers ? ' · ' + x.viewers.toLocaleString('nl-NL') + ' kijkers' : '') + '</span><span class="pb leeg"></span>');
      return F(b, function () { remember(); if (N) N.openUrl('https://www.youtube.com/watch?v=' + x.id); else toast('YouTube openen kan alleen op de tv'); });
    }
    function hitRow(x, kind) {
      var now = Date.now(), ch = { id: x.channel, name: x.name, archive: x.archive };
      var when = function (t) { var d = dayName(t); return (d === 'Vandaag' ? '' : (d.length > 9 ? new Date(t).toLocaleDateString('nl-NL', { weekday: 'short' }) : d.toLowerCase()) + ' ') + clock(t); };
      var stHtml = kind === 'live' ? '<span class="st live">● NU</span>' : kind === 'later' ? '<span class="st">' + esc(when(x.start)) + '</span>' :
        kind === 'past' ? '<span class="st">↺ ' + esc(dayName(x.start).length > 9 ? new Date(x.start).toLocaleDateString('nl-NL', { weekday: 'short' }) : dayName(x.start).toLowerCase()) + '</span>' : '<span class="st">Zender</span>';
      var prog = kind === 'live' ? (now - x.start) / (x.end - x.start) : 0;
      var b = h('button', { class: 'hit' }, stHtml + '<span class="ti">' + esc(kind === 'channels' ? x.name : x.title) + '</span>' +
        '<span class="ch"><i style="' + bg(x.icon) + '"></i>' + esc(x.name) + '</span>' +
        '<span class="tm">' + (kind === 'channels' ? 'Zender ' + x.num : clock(x.start) + '–' + clock(x.end) + (kind === 'past' ? ' · terugkijken' : kind === 'later' && S.reminders[x.channel + ':' + x.start] ? ' · ⏰' : '')) + '</span>' +
        '<span class="pb' + (prog > 0 ? '"><i style="width:' + Math.round(prog * 100) + '%"></i>' : ' leeg">') + '</span>');
      return F(b, function () {
        remember();
        if (kind === 'channels' || kind === 'live') playLive('alle', ch);
        else if (kind === 'later') { toggleReminder(ch, x, 'alle'); draw(); }
        else playCatchup(ch, x);
      }, { long: kind === 'channels' ? null : function () { progDialog(ch, x, 'alle', kind === 'live', kind === 'past', kind === 'past'); } });
    }
    paint(); if (st.q && !st.r) run(); else if (st.r) draw();
    current.args._focus = '.kb .key';
    return el;
  };
  // Inspreken: Android luistert zelf en stopt als je klaar bent; wat je zegt verschijnt meteen. Terug = stoppen.
  function listen(done) {
    if (!N || !N.voiceStop) return toast('Inspreken kan alleen op de tv');
    var box = h('div', { class: 'listen' }, '<div class="dot"></div><div class="dim" style="font-size:22px">Luisteren…</div><div class="said"></div>');
    var said = box.querySelector('.said');
    window.__voicePartial = function (t) { said.textContent = t; };
    var d = h('div'); d.appendChild(box);
    openOverlay(d, function () { N.voiceStop(); });
    native('voice').then(function (t) { window.__voicePartial = null; closeOverlay(); if (t) done(t); },
      function (e) { window.__voicePartial = null; closeOverlay(); toast(e.message || 'Inspreken lukt niet'); });
  }

  // ---------- mijn profiel ----------
  var GENRES = ['Actie', 'Avontuur', 'Animatie', 'Komedie', 'Misdaad', 'Documentaire', 'Drama', 'Familie', 'Fantasie', 'Historisch', 'Horror',
    'Muziek', 'Mysterie', 'Romantiek', 'Sciencefiction', 'Thriller', 'Oorlog', 'Western', 'Reality', 'Sport'];
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
    [['list', 'Mijn lijst'], ['cont', 'Verder kijken'], ['seen', 'Bekeken'], ['svc', 'Mijn diensten'], ['skip', 'Genres overslaan'], ['avatar', 'Avatar kiezen'], ['prefs', 'Voorkeuren'], ['switch', 'Wissel van profiel']].forEach(function (t) {
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
        var g = h('div', { class: 'grid', style: 'grid-template-columns:repeat(6,170px);padding:10px 0' });
        l.forEach(function (m) { g.appendChild(poster({ title: m.title, img: m.img, ok: function () { go('info', { type: m.type || 'movie', tmdb: m.tmdb, title: m.title, plex: m.plex, vod: m.vod, vodKind: m.vodKind }); } })); });
        main.appendChild(g);
      });
    } else if (tab === 'cont') {
      main.appendChild(h('h2', { style: 'font-size:36px' }, 'Verder kijken'));
      main.appendChild(h('div', { class: 'dim', style: 'font-size:20px;margin-bottom:10px' }, 'OK haalt een titel weg. Kijk je hem later weer, dan komt hij vanzelf terug.'));
      get('/api/continue?profile=' + S.profile).then(function (l) {
        if (!l.length) { main.appendChild(h('div', { class: 'dim', style: 'font-size:22px' }, 'Niets om verder te kijken.')); return; }
        var box = h('div', { class: 'scroll-inner', style: 'display:flex;flex-direction:column;gap:10px' }); main.appendChild(box);
        l.forEach(function (c) {
          box.appendChild(F(h('button', { class: 'listrow' }, '<span><b>' + esc(c.title) + '</b> <span class="dim">' + esc(c.sub || '') + '</span></span><span class="dim">Weghalen</span>'), function () {
            hideCont(c).then(function () { a._focus = null; go('profile', a, true); });
          }));
        });
        focus(box.firstChild);
      });
    } else if (tab === 'seen') {
      main.appendChild(h('h2', { style: 'font-size:36px' }, 'Bekeken'));
      main.appendChild(h('div', { class: 'dim', style: 'font-size:20px;margin-bottom:10px' }, 'Wat jij hebt gezien, nieuwste bovenaan. OK zet iets terug op niet bekeken.'));
      get('/api/watched?profile=' + S.profile).then(function (l) {
        if (!l.length) { main.appendChild(h('div', { class: 'dim', style: 'font-size:22px' }, 'Nog niets. Kijk je iets uit, of markeer je het als bekeken, dan komt het hier.')); return; }
        var box = h('div', { class: 'scroll-inner', style: 'display:flex;flex-direction:column;gap:10px' }); main.appendChild(box);
        l.forEach(function (c) {
          box.appendChild(F(h('button', { class: 'listrow' }, '<span><b>' + esc(c.title || '') + '</b> <span class="dim">' + esc(c.sub || '') + '</span></span><span class="dim">' + esc(dayName(c.when)) + '</span>'), function () {
            menu(c.title || '', [['Markeer als niet bekeken', function () { setWatched([{ key: c.key }], false).then(function () { a._focus = null; go('profile', a, true); }); }]]);
          }));
        });
        focus(box.firstChild);
      });
    } else if (tab === 'svc') {
      main.appendChild(h('h2', { style: 'font-size:36px' }, 'Mijn diensten'));
      main.appendChild(h('div', { class: 'dim', style: 'font-size:20px;margin-bottom:10px' }, 'Waar heb jij een abonnement op? Dat bepaalt Voor jou en de rijen per dienst bij Films en Series. OK zet aan of uit.'));
      myServices().then(function (mine) {
        S.svcList.filter(isStreaming).forEach(function (x) {
          var on = mine.indexOf(x.key) >= 0;
          main.appendChild(F(h('button', { class: 'listrow', id: 'svc-' + x.key }, '<b>' + esc(x.name) + '</b><span class="dim">' + (on ? 'Aan' : 'Uit') + '</span>'), function () {
            var list = on ? mine.filter(function (k) { return k !== x.key; }) : mine.concat([x.key]);
            api('POST', '/api/profiles/' + p.id + '/prefs', { services: list }).then(function () { p.prefs = Object.assign(p.prefs || {}, { services: list }); a._focus = '#svc-' + x.key; go('profile', a, true); });
          }));
        });
        var back = a._focus && main.querySelector(a._focus); if (back) focus(back);
      });
    } else if (tab === 'skip') {
      main.appendChild(h('h2', { style: 'font-size:36px' }, 'Genres overslaan'));
      main.appendChild(h('div', { class: 'dim', style: 'font-size:20px;margin-bottom:10px' }, 'Wat je overslaat, zie je niet meer bij Thuis, Films en Series. Bij Zoeken blijft alles te vinden. OK zet aan of uit.'));
      var skip = (p.prefs && p.prefs.skipGenres) || [];
      var gbox = h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px' }); main.appendChild(gbox);
      GENRES.forEach(function (g) {
        var off = skip.indexOf(g) >= 0;
        gbox.appendChild(F(h('button', { class: 'pill' + (off ? '' : ' on'), id: 'g-' + g }, (off ? '✕ ' : '✓ ') + esc(g)), function () {
          var list = off ? skip.filter(function (x) { return x !== g; }) : skip.concat([g]);
          api('POST', '/api/profiles/' + p.id + '/prefs', { skipGenres: list }).then(function () { p.prefs = Object.assign(p.prefs || {}, { skipGenres: list }); S.ov = {}; a._focus = '#g-' + g; go('profile', a, true); });
        }));
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
      // Minimumcijfer voor "Alleen goed" (titels uit je eigen Plex tellen altijd mee).
      var MINS = [[6.5, '6,5 of hoger'], [7, '7 of hoger'], [6, '6 of hoger'], [0, 'Alles tonen']], cur2 = prefs.minRating == null ? 6.5 : prefs.minRating;
      main.appendChild(F(h('button', { class: 'listrow' }, '<b>Alleen goede titels</b><span class="dim">' + esc((MINS.filter(function (m) { return m[0] === cur2; })[0] || MINS[0])[1]) + ' ›</span>'), function () {
        var i = MINS.map(function (m) { return m[0]; }).indexOf(cur2), next = MINS[(i + 1) % MINS.length][0];
        api('POST', '/api/profiles/' + p.id + '/prefs', { minRating: next }).then(function () { p.prefs = Object.assign(prefs, { minRating: next }); S.ov = {}; a._focus = null; go('profile', a, true); });
      }));
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
      var VIEWN = [['normaal', 'Normaal'], ['compact', 'Compact: meer op het scherm'], ['ruim', 'Ruim: alles groter']];
      row('Weergave', labelOf(VIEWN, S.view), function () {
        var next = nextOf(VIEWN, S.view);
        api('POST', '/api/device', { view: next }).then(function () { S.view = next; fit(); a._focus = null; go('settings', a, true); }, function (e) { toast(e.message); });
      });
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
    var sc = h('div', { class: 'scroll', style: 'top:130px' }), inner = h('div', { class: 'scroll-inner' }), g = h('div', { class: 'grid', style: 'grid-template-columns:repeat(6,240px);gap:26px 22px' });
    inner.appendChild(g); sc.appendChild(inner); el.appendChild(sc);
    loadApps().then(function (apps) {
      apps.forEach(function (a) { g.appendChild(appTile(a.label, a)); });
      focus(focusables()[0]);
    });
    return el;
  };

  // ---------- opstarten ----------
  function boot() {
    var info = N ? JSON.parse(N.srvInfo()) : { paired: true, profile: 0 };
    if (!info.paired) return go('pair', {}, true);
    S.profile = info.profile || 0;
    var svc = fetch('services.json').then(function (r) { return r.json(); }).then(function (j) { return j.services; }, function () { return []; });
    Promise.all([get('/api/whoami'), get('/api/profiles'), svc]).then(function (r) {
      S.device = r[0]; S.profiles = r[1]; S.svcList = r[2];
      S.view = r[0].view || 'normaal'; fit();
      get('/api/services/logos').then(function (l) { S.logos = l; }, function () {});
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

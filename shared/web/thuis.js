/* Thuis 1.00: startscherm. Alle gegevens komen van tv-serverr; Android speelt af en opent apps.
   Bediening: pijltjes, OK en terug. OK ingedrukt houden is een snelkoppeling, nooit de enige weg. */
(function () {
  'use strict';
  // Gedeelde kern (kern.js): server, afspelen, kijkstand. Hier alleen het tv-scherm.
  var K = window.Kern, N = K.N, S = K.S, esc = K.esc, h = K.h, pad = K.pad, clock = K.clock, dayName = K.dayName, native = K.native, api = K.api, get = K.get,
    img = K.img, bg = K.bg, me = K.me, setProfile = K.setProfile, position = K.position, start = K.start, playPlex = K.playPlex, playMovie = K.playMovie,
    playEpisode = K.playEpisode, resume = K.resume, playLive = K.playLive, playCatchup = K.playCatchup, setWatched = K.setWatched, rating = K.rating, whereFrom = K.whereFrom, nextUp = K.nextUp, hideCont = K.hideCont;
  var $app = document.getElementById('app');
  // Alles is ontworpen op 1920x1080; op een tv met een ander aantal css-pixels schalen we het geheel.
  // Weergave per apparaat: compact tekent op een groter vlak (meer tegels), ruim op een kleiner vlak (alles groter).
  // Bij ruim kies je zelf hoeveel groter: 105 t/m 125%, in stappen van 5. Die stap staat op het apparaat zelf;
  // de server kent alleen normaal, compact en ruim.
  var SCALE = 1, W = 1920, H = 1080, VIEWS = { normaal: 1, compact: 1.15 };
  function groter() { var g = 110; try { g = parseInt(localStorage.getItem('thuis-groter'), 10) || 110; } catch (e) {} return Math.min(125, Math.max(105, g)); }
  function fit() {
    var v = (S && S.view) || 'normaal', f = v === 'ruim' ? 100 / groter() : (VIEWS[v] || 1); W = Math.round(1920 * f); H = Math.round(1080 * f);
    // De WebView schaalt zelf: de pagina zegt hoe breed hij is (viewport) en Android past dat op het scherm.
    // Geen eigen vergroting of verkleining met transform: dat kost op tv's te veel grafisch geheugen (zwart beeld).
    var vp = document.querySelector('meta[name=viewport]'); if (vp && vp.content !== 'width=' + W) vp.content = 'width=' + W;
    var de = document.documentElement, b = document.body;
    de.style.width = b.style.width = W + 'px'; de.style.height = b.style.height = H + 'px';
    b.classList.toggle('view-compact', f > 1);
    b.classList.toggle('view-groot', f < 1);
    // Alleen in een gewone browser (geen tv) nog verkleinen als het venster kleiner is.
    var w = window.innerWidth || W, hh = window.innerHeight || H;
    SCALE = N ? 1 : Math.min(1, w / W, hh / H); b.style.transformOrigin = '0 0'; b.style.transform = SCALE === 1 ? '' : 'scale(' + SCALE + ')';
  }
  // Pas na het opbouwen weet de tv hoe groot het scherm is: daarom ook later nog eens rekenen.
  fit(); window.addEventListener('resize', fit); window.addEventListener('load', fit); setTimeout(fit, 300); setTimeout(fit, 1500);

  var toastT = 0;
  function toast(msg, ms) {
    var t = document.getElementById('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3500);
  }

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
    // Lijsten die langer zijn dan het scherm (instellingen, diensten in de zijbalk): meeschuiven met de focus.
    var vs = el.closest('.vscroll');
    if (vs && !(el.closest('.scroll-inner') && vs.contains(el.closest('.scroll-inner')))) {
      var vr = vs.getBoundingClientRect(), er = el.getBoundingClientRect(), pad = 24 * SCALE;
      if (er.bottom > vr.bottom - pad) vs.scrollTop += (er.bottom - vr.bottom + pad) / SCALE;
      else if (er.top < vr.top + pad) vs.scrollTop -= (vr.top + pad - er.top) / SCALE;
    }
    var inner = el.closest('.scroll-inner');
    if (inner) {
      var box = (el.closest('.section') || el).getBoundingClientRect(), y = parseFloat(inner.dataset.y || 0), T = box.top / SCALE, B = box.bottom / SCALE;
      // Onder het eerste (gevouwen) blok: de rij gaat netjes bovenaan staan, zodat er niet een half leeg scherm tussen zit.
      var fd = inner.querySelector('.fold'), past = fd && !el.closest('.fold') && (fd.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (past && (B > H - 20 || T < 130)) y -= T - 130;
      else if (B > H - 20) y -= B - (H - 20); else if (T < 130) y += 130 - T;
      if (el.closest('.first')) y = 0;
      y = Math.min(0, y); inner.dataset.y = y; inner.style.transform = 'translateY(' + y + 'px)';
      inner.classList.toggle('down', y < 0);
      var scr = inner.closest('.screen'); if (scr) scr.classList.toggle('down', y < 0);   // achtergrond blijft staan en wordt donkerder
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
    else if (dir === 'left' && !overlay && S.profile && current && ['pair', 'who'].indexOf(current.name) < 0) openSidebar();   // links tegen de rand: zijbalk
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
  // Terug in Thuis. Na aan/uit eerst kiezen wie er kijkt (behalve op een vastgezet apparaat).
  window.__resume = function (woke) { if (woke && S.profiles) { go('home', {}, 'root'); wakeWho(); } };
  // Home-knop op de afstandsbediening: altijd naar het beginscherm.
  window.__home = function () { if (window.Speler && Speler.isOpen()) Speler.close(); if (!S.profile) return; go('home', {}, 'root'); };
  function manyProfiles() { return S.profiles && S.profiles.length > 1 && !(S.device && S.device.locked); }
  function wakeWho() { if (manyProfiles()) whoDialog(true); }

  K.ui.toast = toast; K.ui.sheet = function (t, items) { menu(t, items); }; K.ui.askWho = askWho; K.ui.unpaired = function () { go('pair', {}, 'root'); };

  function F(el, ok, opts) { el.classList.add('f'); el._ok = ok; if (opts) { el._long = opts.long; el._onfocus = opts.focus; el._move = opts.move; if (opts.group) el.dataset.group = opts.group; } return el; }

  // ---------- schermen en terug ----------
  var stack = [], overlay = null, current = null;
  var screens = {};
  // go(naam, args): nieuwe pagina, Terug komt hier weer uit. replace = true: zelfde plek in de geschiedenis (bijv. verversen).
  // replace = 'root': opnieuw beginnen (beginscherm, ander profiel, koppelen).
  function go(name, args, replace) {
    closeOverlay();
    if (replace === 'root') stack = [];
    else if (current && !replace) stack.push(current);
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
    if (overlay) { if (overlay._sticky) return; var o = overlay; closeOverlay(); if (o._onclose) o._onclose(); return; }
    if (saverEl) return saverStop();
    if (window.Speler && Speler.isOpen()) return Speler.back();
    if (current && current.args && current.args._onback && current.args._onback() === true) return;
    if (stack.length) { current = stack.pop(); render(); return; }
    if (current && current.name !== 'home' && S.profile) go('home', {}, 'root');
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
  // Geen balk meer bovenin: het beeld krijgt het hele scherm. Alleen op de andere tabbladen een klein kopje linksboven.
  // Het menu zit in de zijbalk: Terug, of links tegen de rand, schuift hem open (zoals op de Apple TV).
  function topbar(active) {
    var t = TABS.filter(function (x) { return x[0] === active; })[0];
    S.tab = active;
    return h('div', { class: 'top' }, active === 'home' ? '' : '<span class="crumb">' + esc(t ? t[1] : '') + '</span>');
  }
  var SVG = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var NAVICON = {
    search: SVG('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
    home: SVG('<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>'),
    live: SVG('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/>'),
    films: SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4"/>'),
    series: SVG('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M6 4h12"/>'),
    list: SVG('<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>'),
    lib: SVG('<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.5 1-4 15-3.5-1z"/>'),
    apps: SVG('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>'),
    settings: SVG('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>')
  };
  function openSidebar() {
    if (overlay) return;
    var nav = h('div', { class: 'snav' }), here = current.name;
    var close = { move: function (dir) { if (dir === 'right') { closeOverlay(); return true; } } };
    var item = function (key, label, icon, fn, extra) {
      var b = F(h('button', { class: 'it' + (key === here ? ' on' : '') }, icon + '<span>' + esc(label) + '</span>' + (extra || '')), fn, close);
      if (key === here) b.id = 'nav-cur';
      nav.appendChild(b); return b;
    };
    item('who', me().name, '<img class="av" alt="" src="' + esc(img(me().avatarUrl)) + '">', function () { whoDialog(); }, '<span class="clock">' + clock(Date.now()) + '</span>').classList.add('me');
    nav.appendChild(h('div', { class: 'gap' }));
    item('search', 'Zoeken', NAVICON.search, function () { if (here === 'search') closeOverlay(); else go('search'); });
    item('home', 'Home', NAVICON.home, function () { go('home', {}, 'root'); });
    item('live', 'Live tv', NAVICON.live, function () { if (here === 'live') closeOverlay(); else go('live'); });
    item('films', 'Films', NAVICON.films, function () { if (here === 'films') closeOverlay(); else go('films'); });
    item('series', 'Series', NAVICON.series, function () { if (here === 'series') closeOverlay(); else go('series'); });
    item('lib', 'Bibliotheek', NAVICON.lib, function () { go('grid', { lib: true, kind: 'movie', title: 'Bibliotheek', alles: '1', sort: 'nieuw' }); });
    item('list', 'Mijn lijst', NAVICON.list, function () { go('profile', { tab: 'list' }); });
    // Diensten die op dit apparaat staan, met hun logo. OK opent de app.
    var svcBox = h('div', { class: 'svcs vscroll' }); nav.appendChild(svcBox);
    installedServices().then(function (l) {
      l = sortServices(l.filter(function (x) { return x.svc.key !== 'plex'; }));
      if (!l.length) return;
      svcBox.insertBefore(h('div', { class: 'hd' }, 'Diensten'), tail[0]);   // diensten vóór Alle apps en Instellingen
      l.forEach(function (x) {
        var logo = (S.logos && S.logos[x.svc.key]) || x.app.icon || x.app.banner;
        svcBox.insertBefore(F(h('button', { class: 'it' }, (logo ? '<i class="sv" style="' + bg(logo) + '"></i>' : '<i class="sv hdmi"></i>') + '<span>' + esc(x.svc.name) + '</span>'), function () { closeOverlay(); openService(x); }, close), tail[0]);
      });
    });
    // Alle apps en Instellingen staan onderaan in hetzelfde scrollende blok als de diensten.
    var tail = [item('apps', 'Alle apps', NAVICON.apps, function () { go('apps'); }), item('settings', 'Instellingen', NAVICON.settings, function () { go('settings'); })];
    // Samsung: het eigen startscherm van de tv blijft altijd bereikbaar (tv-instellingen, Art Mode, bronnen).
    if (N && N.samsungHome) tail.push(item('samsung', 'Samsung-startscherm', NAVICON.home, function () { closeOverlay(); if (!N.samsungHome()) toast('Het Samsung-startscherm openen lukt niet'); }));
    tail.forEach(function (b) { svcBox.appendChild(b); });
    openOverlay(nav);
    overlay.classList.add('side-ov');
    focus(nav.querySelector('#nav-cur') || nav.querySelector('.it'));
  }
  setInterval(function () { var t = document.querySelector('.snav .clock'); if (t) t.textContent = clock(Date.now()); checkReminders(); }, 20000);

  // ---------- tegels ----------
  // Rust bij openen: alleen het eerste blok met inhoud staat in beeld, onderin, net boven een zacht pijltje.
  // De rest begint onder de rand; de titeltekst van de grote achtergrond staat er netjes boven.
  function fold(slots) {
    setTimeout(function () {
      var pick = slots.filter(function (el) { return el.children.length && !el.querySelector('.spinner'); })[0];
      slots.forEach(function (el) { if (el !== pick) { el.classList.remove('fold'); el.style.marginTop = el.style.paddingBottom = ''; var m = el.querySelector(':scope > .more'); if (m) m.remove(); } });
      var inner = pick && pick.closest('.scroll-inner'); if (!inner) return;
      var BOTTOM = 76;
      pick.classList.add('fold'); pick.style.marginTop = ''; pick.style.paddingBottom = BOTTOM + 'px';
      var r = pick.getBoundingClientRect(), top = (r.top - inner.getBoundingClientRect().top) / SCALE, start = inner.parentNode.getBoundingClientRect().top / SCALE;
      var add = Math.max(0, H - start - top - r.height / SCALE);
      pick.style.marginTop = add + 'px';
      // De titeltekst van de achtergrond net boven de rij.
      var txt = inner.querySelector('.hero .txt'), hero = txt && txt.parentNode;
      if (hero) txt.style.bottom = Math.max(40, hero.offsetHeight - (top + add) + 34) + 'px';
      if (!pick.querySelector(':scope > .more')) pick.appendChild(h('div', { class: 'more' }, '<svg viewBox="0 0 24 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2l9 8 9-8"/></svg>'));
    }, 0);
  }
  // quiet: deze rij mag bij de start niet zelf de focus pakken (voor bijrijen zoals films op Home,
  // zodat de apps-rij "Kijken" de focus krijgt en niet een film die eerder is ingeladen).
  function rowSection(title, items, sub, quiet) {
    if (!items.length) return document.createTextNode('');
    if (!quiet) setTimeout(contentReady, 0);
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
  // Waar je het zelf hebt: Plex en/of IPTV. Heb je het niet, dan staat dat op de tegel.
  function srcBadges(o) {
    var b = (o.sources || []).map(function (s) { return '<i class="ic ' + s + '" title="' + (s === 'plex' ? 'Plex' : 'IPTV') + '"></i>'; });
    if (!b.length) b = ['<span class="nog">Niet bij jou</span>'];
    return '<div class="badges">' + b.join('') + '</div>';
  }
  // Eén titel uit de catalogus (Plex en IPTV samen).
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
    return wide({ title: String(c.title || '').replace(/\s*\(\d{4}\)[\s.]*$/, ''), sub: c.next ? c.sub : [c.sub, c.left > 0 ? 'nog ' + c.left + ' min' : ''].filter(Boolean).join(' · '), img: c.img || c.art || c.thumb, progress: c.progress,
      badge: c.next ? 'Volgende' : '', ok: function () { contDialog(c, after); }, focus: focus });
  }
  function contDialog(c, after) {
    var items = [[c.next ? '▶ ' + c.sub : '▶ Verder kijken' + (c.left > 0 ? ' (nog ' + c.left + ' min)' : ''), function () { resume(c); }]];
    if (!c.next) items.push(['Vanaf het begin', function () { S.fromStart = true; resume(c); }]);
    items.push(['Markeer als bekeken', function () {
      setWatched([{ key: c.key, seriesKey: c.seriesId ? 'series:' + c.seriesId : '', kind: c.kind === 'movie' ? 'movie' : 'series', tmdb: c.tmdb || 0, season: c.season || 0, episode: c.episode || 0, meta: { title: c.title, sub: c.sub, img: c.img || c.art || '', tmdb: c.tmdb } }], true)
        .then(function () { toast('Op bekeken gezet'); after && after(); });
    }]);
    var isMovie = c.kind === 'movie', plexKey = String(c.key || '').indexOf('plex:') === 0 ? String(c.key).slice(5) : '';
    var info = isMovie ? { type: 'movie', tmdb: c.tmdb || 0, title: c.title, plex: plexKey ? { key: plexKey } : null, vod: !plexKey && c.id ? { id: c.id } : null, vodKind: 'movie' }
      : { type: 'tv', tmdb: 0, title: c.title, plex: c.show ? { key: c.show } : null, vod: c.seriesId ? { id: c.seriesId } : null, vodKind: 'series' };
    if (info.tmdb || info.plex || info.vod) items.push([isMovie ? 'Naar de film' : 'Naar de serie', function () { go('info', info); }]);
    items.push(['Uit Verder kijken halen', function () { hideCont(c).then(after); }]);
    menu(c.title, items);
  }
  function menu(title, items) {
    // Lange lijsten (zenders in de speler) onder elkaar en scrollend; korte keuzes naast elkaar.
    var d = h('div', { class: 'dialog' }, '<h2>' + esc(title) + '</h2>'), bt = h('div', items.length > 8 ? { class: 'vscroll', style: 'display:flex;flex-direction:column;gap:10px;max-height:620px;width:640px' } : { style: 'display:flex;gap:16px;flex-wrap:wrap;justify-content:center' });
    items.forEach(function (it) { bt.appendChild(F(h('button', { class: 'btn' }, esc(it[0])), function () { closeOverlay(); it[1](); })); });
    d.appendChild(bt); openOverlay(d);
  }
  // Merklogo's voor de app-tegels (zoals CleanFrame e.d. doen): een wit logo of de naam op een gekleurde tegel.
  // Alleen gebruikt als het apparaat geen eigen brede banner geeft (de JBL heeft die wel, de Samsung niet).
  // Logovormen (netflix, youtube, ziggo, odido) uit de open set Simple Icons (CC0); de rest een nette naamtegel.
  var MERK = {
    netflix: { c: '#E50914', p: 'm5.398 0 8.348 23.602c2.346.059 4.856.398 4.856.398L10.113 0H5.398zm8.489 0v9.172l4.715 13.33V0h-4.715zM5.398 1.5V24c1.873-.225 2.81-.312 4.715-.398V14.83L5.398 1.5z' },
    youtube: { c: '#FF0000', p: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
    ziggo: { c: '#F48C00', p: 'M18.555 18.69a3 3 0 0 0-2.52-2.865h-6.3l7.26-6.945a2.145 2.145 0 0 0 .495-2.34 2.1 2.1 0 0 0-2.205-1.23h-9a2.79 2.79 0 0 0 2.19 2.895h5.175L6 15.375a2.01 2.01 0 0 0-.42 2.13 1.965 1.965 0 0 0 2.115 1.185zM2.85 18.6a2.535 2.535 0 0 0 2.55 2.535h13.2a2.536 2.537 0 0 0 2.55-2.535V7.92A2.865 2.865 0 0 1 24 5.31V18.6a5.385 5.385 0 0 1-5.4 5.4H5.4A5.385 5.385 0 0 1 0 18.6V5.4A5.385 5.385 0 0 1 5.4 0h13.2a5.595 5.595 0 0 1 2.07.405A5.235 5.235 0 0 1 22.635 1.8a1.5 1.5 0 0 1 .42 1.005 1.41 1.41 0 0 1-.42 1.02 1.5 1.5 0 0 1-2.025 0A2.685 2.685 0 0 0 19.59 3a2.43 2.43 0 0 0-.99-.195H5.4A2.505 2.505 0 0 0 2.865 5.4z' },
    odido: { c: '#2C72FF', p: 'M20.923 15.077a3.077 3.077 0 1 0 0-6.154 3.077 3.077 0 0 0 0 6.154m-17.846 0a3.077 3.077 0 1 0 0-6.154 3.077 3.077 0 0 0 0 6.154m3.692 0a3.077 3.077 0 0 0 0-6.154zm10.462 0a3.077 3.077 0 0 1 0-6.154zm-3.693-6.154h-3.077v6.154h3.077z' },
    prime: { c: '#1399FF' },
    videoland: { c: '#E6007E' },
    skyshowtime: { c: '#1B1340' },
    npo: { c: '#E4610F' },
    withlove: { c: '#E6336A' }
  };

  function appTile(x, onfocus) {
    var t = wide({ title: x.svc.name, ok: function () { openService(x); }, focus: onfocus });
    t.classList.add('app-tile');
    var th = t.querySelector('.thumb');
    if (x.app.input) { t.classList.add('hdmi'); return t; }
    if (x.app.banner) { th.style.backgroundImage = "url('" + x.app.banner + "')"; return t; }   // JBL: de eigen brede banner
    var m = MERK[x.svc.key];
    if (m) {   // merklogo of naam op een gekleurde tegel (als het apparaat geen banner geeft, zoals de Samsung)
      t.classList.add('merk'); th.style.background = m.c;
      th.innerHTML = m.p ? '<svg class="ml" viewBox="0 0 24 24" fill="#fff"><path d="' + m.p + '"/></svg>' : '<b class="mt">' + esc(x.svc.name) + '</b>';
      return t;
    }
    // Geen banner en geen merklogo: het eigen icoon netjes in het midden, anders de naam.
    var ic = x.app.icon;
    t.classList.add('icon');
    th.innerHTML = ic ? '<img class="ai" alt="" src="' + esc(ic) + '">' : '<b class="an">' + esc(x.svc.name) + '</b>';
    var im = th.querySelector('.ai');
    if (im) im.onerror = function () { th.innerHTML = '<b class="an">' + esc(x.svc.name) + '</b>'; };
    return t;
  }
  // Tegel terug naar het Samsung-startscherm (tv-instellingen, Art Mode, bronnen). Alleen op de Samsung.
  function samsungHomeTile(onfocus) {
    var t = wide({ title: 'Samsung tv', ok: function () { if (!(N && N.samsungHome && N.samsungHome())) toast('Het Samsung-startscherm openen lukt niet'); }, focus: onfocus });
    t.classList.add('app-tile', 'merk');
    var th = t.querySelector('.thumb'); th.style.background = '#1b1b1f';
    th.innerHTML = '<b class="mt">Samsung</b>';
    return t;
  }

  // Titellogo alleen als het echt een los logo is. Heeft het plaatje een eigen (witte) achtergrond, dan blijft de titel in tekst staan.
  function logoFor(url, use) {
    var u = img(url), k = 'logo:' + u;
    if (k in S) { if (S[k]) use(u); return; }
    var i = new Image(); i.crossOrigin = 'anonymous';
    i.onload = function () {
      var ok = true;
      try {
        var c = document.createElement('canvas'), w = c.width = i.naturalWidth, hh = c.height = i.naturalHeight, x = c.getContext('2d'); x.drawImage(i, 0, 0);
        ok = [[1, 1], [w - 2, 1], [1, hh - 2], [w - 2, hh - 2]].filter(function (p) { return x.getImageData(p[0], p[1], 1, 1).data[3] > 200; }).length < 3;
      } catch (e) {}
      S[k] = ok; if (ok) use(u);
    };
    i.onerror = function () { S[k] = true; use(u); };   // niet te controleren: dan gewoon tonen
    i.src = u;
  }
  function loading(text) { return h('div', { class: 'spinner' }, esc(text || 'Laden…')); }

  // Kijkt iemand anders deze titel al? Dan vragen of je bij die verder wilt. (Wie er kijkt, vraagt Thuis al bij het aanzetten.)
  function askWho(key) {
    if (S.device && S.device.locked) return Promise.resolve();
    return get('/api/watchers?key=' + encodeURIComponent(key) + '&profile=' + S.profile).then(function (w) {
      if (!w.length) return;
      return new Promise(function (resolve) {
        var d = h('div', { class: 'dialog' });
        var first = w[0];
        d.appendChild(h('h2', null, esc(first.name) + ' kijkt dit, verder als ' + esc(first.name) + '?'));
        d.appendChild(h('div', { class: 'dim', style: 'font-size:22px' }, 'Dan gaat het verder waar ' + esc(first.name) + ' was, en telt het kijken bij ' + esc(first.name) + '.'));
        var row = h('div', { class: 'who' }), order = [];
        order.push(first.id, S.profile);
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
  function loadApps() { if (S.apps) return Promise.resolve(S.apps); if (!K.can.apps) return Promise.resolve([]); return native('getApps').then(function (t) { S.apps = JSON.parse(t); return S.apps; }); }
  // Diensten waarvan de app op dit apparaat staat, plus HDMI-ingangen waar iets op zit: [{svc, app}]
  function installedServices() {
    return loadApps().then(function (apps) {
      var l = S.svcList.map(function (s) {
        var app = apps.filter(function (a) { return a.pkg.toLowerCase().indexOf(s.match) >= 0 || a.label.toLowerCase().indexOf(s.match) >= 0; })[0];
        return app ? { svc: s, app: app } : null;
      }).filter(Boolean);
      return l.concat(hdmiInputs());
    });
  }
  // HDMI: sleutel per poort (blijft gelijk, ook als het apparaat een andere naam doorgeeft).
  // Een eigen naam (bijv. "Formuler") hoort bij dit apparaat en staat daarom op het apparaat zelf.
  function hdmiNames() { try { return JSON.parse(localStorage.getItem('thuis-hdmi-namen') || '{}'); } catch (e) { return {}; } }
  // Verborgen ingangen (bijvoorbeeld een soundbar): ook per apparaat.
  function hdmiHidden() { try { return JSON.parse(localStorage.getItem('thuis-hdmi-verborgen') || '[]'); } catch (e) { return []; } }
  function hdmiInputs() {
    var l = [], names = hdmiNames(), hidden = hdmiHidden(); try { l = K.can.inputs ? JSON.parse(N.getInputs()) : []; } catch (e) {}
    return l.filter(function (i) { return hidden.indexOf(String(i.port)) < 0; }).map(function (i) { return { svc: { key: 'hdmi:' + i.port, name: names[i.port] || i.label, hdmi: i.label }, app: { input: i.id } }; });
  }
  function renameHdmi(x, done) {
    var port = x.svc.key.slice(5), names = hdmiNames(), name = names[port] || '';
    var d = h('div', { class: 'dialog' }, '<h2>Naam voor ' + esc(x.svc.hdmi) + '</h2>'), field = h('div', { class: 'field', style: 'width:560px;height:64px;font-size:28px' });
    var paint = function () { field.textContent = name || ' '; };
    var save = function (v) { if (v) names[port] = v; else delete names[port]; try { localStorage.setItem('thuis-hdmi-namen', JSON.stringify(names)); } catch (e) {} closeOverlay(); done(); };
    d.appendChild(field);
    d.appendChild(keyboard('abcdefghijklmnopqrstuvwxyz1234567890', function (c) {
      if (c === '⌫') name = name.slice(0, -1); else if (name.length < 24) name += c === '␣' ? ' ' : (!name || name.slice(-1) === ' ' ? c.toUpperCase() : c);
      paint();
    }));
    var bt = h('div', { style: 'display:flex;gap:16px' });
    bt.appendChild(F(h('button', { class: 'btn' }, 'Opslaan'), function () { save(name.trim()); }));
    bt.appendChild(F(h('button', { class: 'btn' }, 'Standaardnaam'), function () { save(''); }));
    bt.appendChild(F(h('button', { class: 'btn' }, 'Verbergen'), function () {
      var hid = hdmiHidden(); hid.push(port); try { localStorage.setItem('thuis-hdmi-verborgen', JSON.stringify(hid)); } catch (e) {} closeOverlay(); done();
    }));
    d.appendChild(bt); paint(); openOverlay(d);
  }
  function openService(x) { if (!N) return; if (x.app.input) N.openInput(x.app.input); else N.launch(x.app.pkg); }
  // In- of uitgeplugd: het beginscherm opnieuw opbouwen (alleen als je daar bent en niets open hebt).
  window.__inputs = function () { if (current && current.name === 'home' && !overlay) go('home', current.args, true); };
  // Vaste volgorde: eerst HDMI, dan tv kijken (Ziggo, Odido), dan WithLove, dan de rest zoals in services.json.
  var FIRST = ['ziggo', 'odido', 'withlove'];
  // Per profiel: eigen volgorde (appOrder) en verborgen apps (appHide), ingesteld in Mijn profiel › Apps op Thuis.
  function sortServices(l, all) {
    var pr = me().prefs || {}, order = pr.appOrder || [], hide = pr.appHide || [];
    // HDMI-apparaten vooraan (als je iets aansluit wil je daar meestal heen), dan de vaste volgorde.
    var rank = function (k) { var i = order.indexOf(k); if (i >= 0) return i; if (/^hdmi:/.test(k)) return -1; var j = FIRST.indexOf(k); return 100 + (j < 0 ? 50 : j); };
    return l.filter(function (x) { return all || hide.indexOf(x.svc.key) < 0; }).slice().sort(function (a, b) { return rank(a.svc.key) - rank(b.svc.key); });
  }

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
      '<h1 style="font-size:60px">Sjuul TV koppelen</h1><div class="dim" style="font-size:24px;line-height:1.5">Open de beheerpagina van tv-serverr op je pc of telefoon, kies <b>Nieuwe code</b> en vul die hier in. Daarna haalt deze tv alles van de server.</div>' +
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
    var box = h('div', { style: 'position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:90px' }, '<h1 style="font-size:64px;font-weight:600">Wie kijkt er?</h1>');
    var row = h('div', { class: 'who' });
    S.profiles.forEach(function (p) {
      var b = F(h('button', { class: 'who-item' }, '<img alt="" src="' + esc(img(p.avatarUrl)) + '"><span>' + esc(p.name) + '</span>'), function () { setProfile(p.id); go('home', {}, 'root'); });
      if (p.id === S.profile) b.id = 'cur';
      row.appendChild(b);
    });
    box.appendChild(row); el.appendChild(box);
    current.args._focus = '#cur';
    return el;
  };
  function whoDialog(must) {
    var d = h('div', { class: 'dialog' }, '<h2>Wie kijkt er?</h2>'), row = h('div', { class: 'who' });
    var locked = S.device && S.device.locked;
    S.profiles.forEach(function (p) {
      if (locked && p.id !== S.profile) return;
      var b = F(h('button', { class: 'who-item' }, '<img alt="" src="' + esc(img(p.avatarUrl)) + '"><span>' + esc(p.name) + '</span>'), function () {
        setProfile(p.id); S.ov = {}; closeOverlay(); go('home', {}, 'root');
      });
      if (p.id === S.profile) b.id = 'who-cur';
      row.appendChild(b);
    });
    d.appendChild(row);
    if (!must) d.appendChild(F(h('button', { class: 'btn' }, 'Mijn profiel'), function () { closeOverlay(); go('profile'); }));
    openOverlay(d);
    overlay._sticky = !!must;   // na aanzetten: eerst kiezen, Terug doet dan niets
    var c = d.querySelector('#who-cur'); if (c) focus(c);
  }

  // ---------- thuis ----------
  // Grote achtergrond bovenaan (Thuis, Films, Series) die vanzelf wisselt.
  // In rust: een eigen foto ({ photo }) en/of uitgelichte titels ({ item }). Met focus op een tegel: het beeld van die tegel.
  function heroBlock(inner) {
    // Het beeld staat vast achter de pagina; de rijen schuiven eroverheen. De tekst schuift wel mee.
    var hero = h('div', { class: 'hero first' }, '<div class="txt uit"><img class="logo" alt=""><h1></h1><div class="meta"></div></div>');
    inner.appendChild(hero);
    var bgl = backdrop(inner.parentNode.parentNode, inner.parentNode), setBg = bgl.set;
    var txt = hero.querySelector('.txt'), heroT = 0, resting = true;
    var slides = [], idx = 0, slideT = 0;
    // Beeld, logo (of titel) en een regel info van een titel.
    function paint(it, mine) {
      var art = it.tmdb ? artFor(it.type, it.tmdb) : Promise.resolve({ backdrop: it.img || '' });
      art.then(function (a) {
        if (!a.backdrop || !mine()) return;
        setBg(a.backdrop);
        var lg = hero.querySelector('.logo'), t1 = hero.querySelector('h1');
        lg.classList.remove('on'); t1.textContent = it.title || '';
        if (a.logo) logoFor(a.logo, function (u) { if (bgl.shown() !== a.backdrop) return; lg.src = u; lg.classList.add('on'); t1.textContent = ''; });
        hero.querySelector('.meta').textContent = it.meta || '';
        txt.classList.remove('uit');
      });
    }
    function show(i) {
      clearTimeout(slideT); if (!slides.length) return;
      idx = (i + slides.length) % slides.length;
      var sl = slides[idx], want = idx;
      if (sl.photo) { sl.photo().then(function (u) { if (resting && idx === want) { setBg(u); txt.classList.add('uit'); } }); }
      else paint(sl.item, function () { return resting && idx === want; });
      // Vanzelf verder, alleen als je bovenin staat (op de eerste rij). Een foto blijft langer staan.
      slideT = setTimeout(function () {
        if (!document.body.contains(hero)) return;
        if (resting && cur && cur.closest('.first')) show(idx + 1); else show(idx);
      }, sl.photo ? 20000 : 8000);
    }
    function setSlides(l) { slides = l; if (resting) show(0); }
    function rest() { clearTimeout(heroT); if (resting) return; resting = true; show(idx); }
    function showArt(it) {
      clearTimeout(heroT); clearTimeout(slideT);
      heroT = setTimeout(function () { resting = false; paint(it, function () { return !resting; }); }, 350);
    }
    return { showArt: showArt, rest: rest, setSlides: setSlides };
  }
  // Achtergrondbeeld dat vast blijft staan (achter de pagina), met zacht overvloeien. Zet het voor 'before' in 'parent'.
  function backdrop(parent, before, cls) {
    var back = h('div', { class: 'hero-bg' + (cls ? ' ' + cls : '') }, '<div class="bg on"></div><div class="bg"></div>'), layers = back.querySelectorAll('.bg'), shown = '';
    parent.insertBefore(back, before);
    return {
      shown: function () { return shown; },
      set: function (u) {
        if (!u || u === shown) return; shown = u;
        var nxt = layers[0].classList.contains('on') ? layers[1] : layers[0], old = nxt === layers[0] ? layers[1] : layers[0];
        var pic = new Image(); pic.onload = function () { if (shown !== u) return; nxt.style.backgroundImage = "url('" + pic.src.replace(/'/g, '%27') + "')"; nxt.classList.add('on'); old.classList.remove('on'); }; pic.src = img(u);
      }
    };
  }
  function artFor(type, tmdb) {
    return S.art[type + tmdb] ? Promise.resolve(S.art[type + tmdb]) : get('/api/art/' + type + '/' + tmdb).then(function (a) { S.art[type + tmdb] = a; return a; }, function () { return {}; });
  }
  // Een titel als dia: beeld en logo.
  function slideOf(o, kind) { return { item: artOf(o, kind) }; }
  function artOf(o, kind) { return { tmdb: o.tmdb, type: kind === 'series' ? 'tv' : 'movie', title: o.title, meta: [o.year, rating(o), whereFrom(o) || 'Niet bij jou'].filter(Boolean).join(' · ') }; }
  screens.home = function () {
    var el = h('div', { class: 'screen' }); el.appendChild(topbar('home'));
    // De foto loopt door tot achter de bovenbalk.
    var sc = h('div', { class: 'scroll', style: 'top:0' }), inner = h('div', { class: 'scroll-inner' }); sc.appendChild(inner); el.appendChild(sc);
    // Carrousel: eerst een eigen foto (album 1, elke keer een andere), daarna een paar titels uit Nieuw voor jou.
    var photo = null, photoSlide = { photo: function () {
      return (S.photos ? Promise.resolve(S.photos) : get('/api/photos').then(function (l) { S.photos = l; return l; }, function () { return []; })).then(function (l) {
        var cand = l.filter(function (p) { return p !== photo; }); photo = cand[Math.floor(Math.random() * cand.length)] || l[0];
        return photo ? photo.url : '';
      });
    } };
    var hb = heroBlock(inner), showArt = hb.showArt, showPhoto = hb.rest;
    hb.setSlides([photoSlide]);
    // Thuis: eerst de apps (daar begin je meestal), dan wat nieuw is in je eigen bibliotheek. Verder kijken en live staan in Films, Series en Live tv.
    var slots = {}; ['svc', 'foryou', 'fav', 'later'].forEach(function (k) { slots[k] = h('div'); inner.appendChild(slots[k]); });
    slots.svc.className = 'first';
    var q = 'profile=' + S.profile;
    // Nieuw voor jou: nieuw in Plex en IPTV en wat nu populair is; wat bij jouw smaak past bovenaan.
    get('/api/foryou?' + q).then(function (d) {
      var tile = function (o) {
        return titleTile(o, o.kind, function () { if (o.tmdb) showArt(artOf(o, o.kind)); });
      };
      if (d.now.length) slots.foryou.appendChild(rowSection('Nieuw voor jou', d.now.map(tile), null, true));
      fold([slots.svc, slots.foryou]);
      hb.setSlides([photoSlide].concat(d.now.filter(function (o) { return o.tmdb; }).slice(0, 5).map(function (o) { return slideOf(o, o.kind); })));
      if (d.later.length) slots.later.appendChild(rowSection('Populair, niet bij jou', d.later.map(tile), null, true));
    }).catch(function (e) { slots.foryou.innerHTML = '<div class="empty">Sjuul TV kan tv-serverr nu niet bereiken. ' + esc(e.message) + '</div>'; });
    // Favoriet genre van dit profiel (Mijn profiel › Voorkeuren): de beste titels die je kunt kijken.
    var fav = (me().prefs || {}).favGenre;
    if (fav) get('/api/catalog/movie/browse?' + q + '&genre=' + encodeURIComponent(fav) + '&sort=beste').then(function (r) {
      var l = r.items.slice(0, 30);
      if (l.length) slots.fav.appendChild(rowSection(fav + ' voor jou', l.map(function (o) { return titleTile(o, 'movie'); }), null, true));
    }).catch(function () {});
    // Bovenaan de apps waar je meteen naartoe wilt: tv (Ziggo of Odido) en WithLove eerst, dan de andere diensten.
    installedServices().then(function (l) {
      l = sortServices(l.filter(function (x) { return x.svc.key !== 'plex'; }));
      var tiles = l.map(function (x) { return appTile(x, showPhoto); });
      if (N && N.samsungHome) tiles.push(samsungHomeTile(showPhoto));   // laatste tegel: terug naar Samsung
      if (tiles.length) slots.svc.appendChild(rowSection('Kijken', tiles));
      fold([slots.svc, slots.foryou]);
    });
    return el;
  };
  function liveCats(force) {
    if (S.cats && !force && Date.now() - S.catsAt < 30 * 60e3) return Promise.resolve(S.cats);
    return get('/api/live/categories').then(function (c) { S.cats = c; S.catsAt = Date.now(); return c; });
  }

  // ---------- live tv met gids ----------
  var PX = 5.4, SPAN = 280;  // pixels per minuut, minuten in beeld
  screens.live = function (args) {
    var el = h('div', { class: 'screen' }); el.appendChild(topbar('live'));
    var pills = h('div', { style: 'position:absolute;left:80px;right:80px;top:130px;display:flex;gap:10px;overflow:hidden' });
    var info = h('div', { class: 'g-info' }), guide = h('div', { class: 'guide' });
    // Beeld van het programma met focus, rechtsboven. Loopt zacht weg achter de bovenste zenders.
    var art = h('div', { class: 'g-art' }, '<div></div><div></div>'), artL = art.children, artOn = 0, artWant = '', artT = 0;
    function setArt(pic, logo) {
      var want = pic || logo || ''; if (want === artWant) return; artWant = want;
      clearTimeout(artT);
      artT = setTimeout(function () {
        var show = function (url, isLogo) {
          if (artWant !== want) return;
          var nxt = artL[1 - artOn], old = artL[artOn]; artOn = 1 - artOn;
          nxt.className = isLogo ? 'logo' : ''; nxt.style.backgroundImage = url ? "url('" + url.replace(/'/g, '%27') + "')" : 'none';
          nxt.classList.add('on'); old.classList.remove('on');
        };
        if (!pic) return show(logo ? img(logo) : '', true);
        var i = new Image(); i.onload = function () { show(i.src, false); }; i.onerror = function () { show(logo ? img(logo) : '', true); }; i.src = img(pic);
      }, 180);
    }
    el.appendChild(art); el.appendChild(pills); el.appendChild(info); el.appendChild(guide);
    el.appendChild(h('div', { class: 'hint' }, '<span><span class="kbd">↑ ↓</span>zender</span><span><span class="kbd">← →</span>tijd</span><span><span class="kbd">OK</span>kijken, terugkijken of herinnering</span><span>↺ = terugkijken kan</span>'));
    // Vers binnen via de bovenbalk: focus op de categorieën, zodat je meteen naar Sport of ESPN kunt.
    var fresh = !args.st, st = args.st || (args.st = { cat: null, from: 0, row: 0 });
    liveCats().then(function (cats) {
      var shown = cats.filter(function (c) { return c.channels.length; });
      if (!st.cat) st.cat = (shown.filter(function (c) { return c.id !== 'alle' && !c.parent; })[0] || shown[0] || {}).id;
      var row = h('div', { class: 'row', style: 'padding:0;gap:10px' });
      shown.forEach(function (c) {
        row.appendChild(F(h('button', { class: 'pill' + (c.id === st.cat ? ' on' : '') }, esc(c.name)), function () { st.cat = c.id; st.from = 0; st.row = 0; go('live', args, true); }, { group: 'cats',
          focus: function () { setArt('', ''); info.innerHTML = '<span class="kicker">Categorie</span><h2>' + esc(c.name) + '</h2><div class="dim" style="font-size:22px">' + c.channels.length + (c.channels.length === 1 ? ' zender' : ' zenders') + (c.id === st.cat ? ' · nu in beeld' : ' · OK: deze zenders in de gids') + '</div>'; } }));
      });
      pills.appendChild(row);
      var cat = shown.filter(function (c) { return c.id === st.cat; })[0] || shown[0];
      if (cat) drawGuide(cat);
    }).catch(function (e) { guide.innerHTML = '<div class="empty" style="padding:0">Live tv is nu niet bereikbaar. ' + esc(e.message) + '</div>'; });

    function pickDay() {
      var d = h('div', { class: 'dialog' }, '<h2>Welke dag?</h2>'), box = h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:1200px' });
      var t0 = new Date(); t0.setHours(0, 0, 0, 0);
      var curDay = new Date(st.from + 60 * 60000); curDay.setHours(0, 0, 0, 0);
      for (var k = -7; k <= 7; k++) (function (k) {
        var day = t0.getTime() + k * 864e5, b = F(h('button', { class: 'pill' + (day === curDay.getTime() ? ' on' : '') }, esc(dayName(day + 12 * 36e5))), function () {
          // Zelfde tijdstip op die dag; vandaag gewoon vanaf nu.
          var tod = st.from - new Date(st.from).setHours(0, 0, 0, 0);
          st.from = k === 0 ? 0 : day + tod; st.row = 0; closeOverlay(); go('live', args, true);
        });
        if (day === curDay.getTime()) b.id = 'day-cur';
        box.appendChild(b);
      })(k);
      d.appendChild(box); openOverlay(d); focus(d.querySelector('#day-cur') || box.firstChild);
    }
    function drawGuide(cat) {
      var now = Date.now();
      if (!st.from) { var d = new Date(now); d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); st.from = d.getTime() - 60 * 60000; }
      var from = st.from, to = from + SPAN * 60000, x = function (t) { return (t - from) / 60000 * PX; };
      guide.innerHTML = '';
      // Kop: de dag boven de zenders, de tijden boven het rooster.
      var head = h('div', { class: 'g-head' }), times = h('div', { class: 'g-times' });
      // De dag is een knop: kies gisteren, morgen of een andere dag (een week terug, een week vooruit).
      var dayBtn = F(h('button', { class: 'g-day pill', id: 'g-day' }, esc(dayName(from + 60 * 60000)) + ' ▾'), function () { pickDay(); }, { group: 'day' });
      head.appendChild(dayBtn);
      for (var t = from; t < to; t += 30 * 60000) times.appendChild(h('span', { style: 'left:' + x(t) + 'px' }, clock(t)));
      head.appendChild(times); guide.appendChild(head);
      var clip = h('div', { class: 'g-clip' }), body = h('div', { class: 'g-body' }); clip.appendChild(body); guide.appendChild(clip);
      // De gekozen zender blijft net onder het midden staan; de lijst schuift eronder door.
      var ROWH = 62;
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
            var b = h('button', { class: 'g-p' + (p.none ? ' none' : canBack ? ' back' : past ? ' past' : live ? ' now' : ''), style: 'left:' + left + 'px;width:' + (right - left - 6) + 'px' },
              (canBack ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true" style="flex:none"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>' : '') +
              (S.reminders[ch.id + ':' + p.start] ? '⏰ ' : '') + '<span>' + esc(p.title) + '</span>');
            F(b, function () {
              if (live || p.none) playLive(cat.id, ch);
              else if (canBack) playCatchup(ch, p, cat.id);
              else if (!past) { toggleReminder(ch, p, cat.id); go('live', args, true); }
              else toast('Deze zender bewaart dit programma niet');
            }, { group: 'g' + i, long: function () { progDialog(ch, p, cat.id, live, canBack, past); },
              focus: function () {
                st.row = i; scrollTo(i); setArt(p.img, ch.icon);
                info.innerHTML = '<span class="kicker">' + esc(ch.name) + (p.none ? '' : ' · ' + clock(p.start) + '–' + clock(p.end) + (live ? ' · NU' : past ? ' · AFGELOPEN' : '')) + '</span>' +
                  '<h2>' + esc(p.none ? ch.name : p.title) + '</h2><p class="desc">' + esc(p.desc || p.cat || '') + '</p>' +
                  '<div class="dim" style="font-size:20px">' + (live ? 'OK: kijken' : canBack ? 'OK: terugkijken vanaf het begin' : past ? 'Kan niet meer teruggekeken worden' : 'OK: herinnering ' + (S.reminders[ch.id + ':' + p.start] ? 'weghalen' : 'zetten')) + '</div>';
              },
              // Voorbij de rand van het tijdvak: een uur verschuiven.
              move: function (dir) {
                // Omhoog vanaf de bovenste zender: naar de categorie die nu in beeld is.
                if (dir === 'up' && i === 0) { focus(dayBtn); return true; }
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
    var el = h('div', { class: 'screen' });
    var sc = h('div', { class: 'scroll', style: 'top:0' }), inner = h('div', { class: 'scroll-inner' }); sc.appendChild(inner); el.appendChild(sc);
    el.appendChild(topbar(kind === 'movie' ? 'films' : 'series'));
    // Zoeken binnen alleen films of alleen series (omhoog vanaf de eerste rij).
    el.appendChild(F(h('button', { class: 'pill lsearch' }, NAVICON.search + '<span>Zoeken in ' + (kind === 'movie' ? 'films' : 'series') + '</span>'), function () { go('search', { only: kind }); }));
    // Bovenaan een carrousel met het nieuwste uit je eigen bibliotheek; met focus op een titel het beeld van die titel.
    var hb = heroBlock(inner);
    var tile = function (m) { return titleTile(m, kind, function () { if (m.tmdb) hb.showArt(artOf(m, kind)); else hb.rest(); }); };
    var slots = {}; ['cont', 'newest', 'rec', 'genres', 'coll'].forEach(function (k) { slots[k] = h('div'); inner.appendChild(slots[k]); });
    slots.cont.className = 'first'; slots.newest.appendChild(loading());
    var again = function () { go(kind === 'movie' ? 'films' : 'series', {}, true); };
    get('/api/continue?profile=' + S.profile).then(function (list) {
      var mine = list.filter(function (c) { return c.kind === kind; });
      if (mine.length) slots.cont.appendChild(rowSection('Verder kijken', mine.map(function (c) {
        return contTile(c, again, function () { if (c.tmdb) hb.showArt({ tmdb: c.tmdb, type: kind === 'series' ? 'tv' : 'movie', title: String(c.title || '').replace(/\s*\(\d{4}\)[\s.]*$/, ''), meta: c.sub || '' }); else hb.rest(); });
      }), me().name));
      fold([slots.cont, slots.newest]);
    }).catch(function () {});
    get('/api/catalog/' + kind + '/overview?profile=' + S.profile).then(function (o) {
      S.ov[kind] = o; slots.newest.innerHTML = '';
      hb.setSlides((o.newest || []).filter(function (m) { return m.tmdb; }).slice(0, 6).map(function (m) { return slideOf(m, kind); }));
      if (!o.total) { slots.newest.innerHTML = '<div class="empty">Nog geen ' + (kind === 'movie' ? 'films' : 'series') + ' gevonden.</div>'; return; }
      slots.newest.appendChild(rowSection('Nieuw', o.newest.map(tile)));
      fold([slots.cont, slots.newest]);
      if ((o.recordings || []).length) slots.rec.appendChild(rowSection('Opnames', o.recordings.map(tile)));
      slots.genres.appendChild(rowSection('Genres', o.genres.map(function (g) {
        return mosaicTile(g.name, g.count + ' titels', g.posters, function () { go('grid', { kind: kind, genre: g.name, title: g.name }); });
      })));
      slots.coll.appendChild(rowSection('Collecties', o.collections.map(function (c) {
        var f = c.id.split(':'), a = { kind: kind, title: c.name };
        if (f[0] === 'src') { a.src = f[1]; a.alles = '1'; a.sort = 'nieuw'; } else if (f[0] === 'soon') { a.cat = 'soon'; a.alles = '1'; } else a.cat = f.slice(1).join(':');
        return mosaicTile(c.name, c.count + ' titels', c.posters, function () { go('grid', a); });
      })));
    }).catch(function (e) { slots.newest.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
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
    // Rustige achtergrond: het beeld van de titel met focus, gedimd achter het raster.
    var bgl = backdrop(el, el.firstChild, 'dim'), bgT = 0;
    var bgOf = function (m) { clearTimeout(bgT); if (m.tmdb) bgT = setTimeout(function () { artFor(a.kind === 'series' ? 'tv' : 'movie', m.tmdb).then(function (x) { bgl.set(x.backdrop); }); }, 400); };
    (function () {
      var srcs = [['', 'Plex en IPTV'], ['plex', 'Plex'], ['iptv', 'IPTV']];
      // Bibliotheek: alles wat je zelf hebt, films of series.
      // Keuzeknoppen: wat er nu gekozen is, met een pijltje. OK wisselt of opent de keuze.
      var opt = function (id, k, v) { return h('button', { class: 'pill menu', id: id }, (k ? '<span class="k">' + esc(k) + '</span>' : '') + esc(v) + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'); };
      if (a.lib) bar.appendChild(F(opt('f-kind', '', a.kind === 'series' ? 'Series' : 'Films'), function () { a.kind = a.kind === 'series' ? 'movie' : 'series'; a.genre = ''; redo('f-kind'); }, { group: 'filters' }));
      if (a.cat !== 'soon') {
        bar.appendChild(F(opt('f-genre', 'Genre', a.genre || 'Alle'), function () { pickGenre(a, function () { redo('f-genre'); }); }, { group: 'filters' }));
        bar.appendChild(F(opt('f-src', 'Bron', labelOf(srcs, a.src)), function () { a.src = nextOf(srcs, a.src); redo('f-src'); }, { group: 'filters' }));
        bar.appendChild(F(opt('f-sort', '', labelOf(SORTS, a.sort)), function () { a.sort = nextOf(SORTS, a.sort); redo('f-sort'); }, { group: 'filters' }));
        bar.appendChild(F(opt('f-good', '', a.alles === '1' ? 'Alle titels' : 'Alleen goed'), function () { a.alles = a.alles === '1' ? '' : '1'; redo('f-good'); }, { group: 'filters' }));
      }
      bar.appendChild(count);
      var want = a._focus && bar.querySelector(a._focus); if (want) focus(want);
      var total = 0, busy = false;
      function load(offset) {
        busy = true;
        get('/api/catalog/' + a.kind + '/browse?profile=' + S.profile + '&genre=' + encodeURIComponent(a.genre || '') + '&src=' + (a.src || '') +
          '&cat=' + encodeURIComponent(a.cat || '') + '&sort=' + (a.sort || '') + '&alles=' + (a.alles || '') + '&offset=' + offset).then(function (r) {
          total = r.total; count.textContent = total + ' titels';
          r.items.forEach(function (m) {
            var t = titleTile(m, a.kind, function () { bgOf(m); }); grid.appendChild(t);
            t._onfocus = function () { if (!busy && grid.children.length < total && [].indexOf.call(grid.children, t) >= grid.children.length - 12) load(grid.children.length); };
          });
          if (!offset && !want) focus(grid.firstChild || focusables()[0]);
          if (!total) grid.innerHTML = '<div class="empty" style="padding:0;grid-column:1/-1">Niets gevonden met deze filters.' + (a.alles === '1' ? '' : ' Zet "Alleen goed" uit voor alle titels.') + '</div>';
          busy = false;
        }).catch(function (e) { busy = false; toast(e.message); });
      }
      load(0);
    })();
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
    get('/api/catalog/' + a.kind + '/overview?profile=' + S.profile).then(function (o) { S.ov[a.kind] = o; show(o); });
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
      // Geen TMDB-nummer? Dan op titel en jaar opzoeken, zodat ook deze titels cast, extra's en aanbevelingen krijgen.
      var tmdbId = a.tmdb || (show && show.tmdb) || 0;
      var idQ = tmdbId ? Promise.resolve(tmdbId) : get('/api/info-find?type=' + a.type + '&title=' + encodeURIComponent(a.title || '') + '&year=' + encodeURIComponent((a.plex && a.plex.year) || (a.vod && a.vod.year) || '')).then(function (r) { return r.id || 0; }, function () { return 0; });
      return idQ.then(function (id) { tmdbId = id; a.tmdb = a.tmdb || id; return id; }).then(function () { return Promise.all([tmdbId ? get('/api/info/' + a.type + '/' + tmdbId).catch(function () { return null; }) : null,
        get('/api/mylist?profile=' + S.profile).catch(function () { return []; }),
        !series && src ? get('/api/watched?profile=' + S.profile + '&key=' + encodeURIComponent(src)).catch(function () { return {}; }) : {}, show]); });
    }).then(function (r) {
      var d = r[0] || {}, seen = !!r[2].on, show = r[3];
      var inList = r[1].some(function (x) { return x.key === (src || 'tmdb:' + a.type + a.tmdb); });
      var bgMain = d.backdrop || (show && show.backdrop) || (a.plex && a.plex.art) || (a.vod && a.vod.backdrop), bgNow = '';
      // Achtergrond wisselen (per seizoen fanart van fanart.tv, anders de gewone). Pas na het laden, zodat er geen leeg vlak is.
      var setInfoBg = function (u) {
        if (!u || u === bgNow) return; bgNow = u;
        var pic = new Image(); pic.onload = function () { if (bgNow !== u) return; bgEl.style.backgroundImage = "url('" + pic.src.replace(/'/g, '%27') + "')"; }; pic.src = img(u);
      };
      setInfoBg(bgMain);
      if (d.cast && d.cast.length) castLine.innerHTML = '<span class="dim">Met </span>' + esc(d.cast.slice(0, 3).map(function (c) { return c.name; }).join(', '));
      var nSeasons = show ? show.seasons.length : (d.seasons || []).length;
      var imdb = (d.ratings && d.ratings.imdb ? 'IMDb ' + String(d.ratings.imdb).replace('.', ',') : d.rating ? '★ ' + d.rating.toFixed(1).replace('.', ',') : '') +
        (d.ratings && d.ratings.rt ? ' · Rotten Tomatoes ' + d.ratings.rt : '');
      var meta = [d.year || (a.vod && a.vod.year), nSeasons ? nSeasons + ' seizoen' + (nSeasons > 1 ? 'en' : '') : d.runtime ? d.runtime + ' min' : '',
        d.age ? '<span class="tag">' + esc(d.age) + '</span>' : '', imdb, (d.genres || []).slice(0, 3).join(' · ')].filter(Boolean);
      // Ook op een streamingdienst? Dat staat er ter informatie bij; kijken doe je in Thuis via Plex of IPTV, of in de app zelf.
      var other = (d.services || []).filter(function (x) { return !/channel|with ads|met reclame/i.test(x.name); });
      var chip = function (x) { return '<span class="where dim">' + (x.logo ? '<i style="' + bg(x.logo) + '"></i>' : '') + esc(x.name) + '</span>'; };
      var canWatch = a.plex || a.vod;
      txt.innerHTML = '<h1>' + esc(d.title || a.title) + '</h1><div class="meta">' + meta.map(function (m) { return '<span>' + (m.indexOf('<span') === 0 ? m : esc(m)) + '</span>'; }).join('') + '</div>' +
        '<p class="desc">' + esc(d.overview || (show && show.plot) || (a.plex && a.plex.summary) || (a.vod && a.vod.plot) || '') + '</p>' +
        '<div class="wherebox">' + (canWatch ? '' : '<span class="dim">Nog niet te zien</span>') +
        (other.length ? '<span class="dim"' + (canWatch ? '' : ' style="margin-left:14px"') + '>Ook op</span>' + other.slice(0, 4).map(chip).join('') : '') + '</div>';
      if (d.tmdb) artFor(a.type, d.tmdb).then(function (x) {
        if (x.logo) logoFor(x.logo, function (u) { var lg = new Image(); lg.className = 'ilogo'; lg.alt = d.title || ''; lg.onload = function () { var t = txt.querySelector('h1'); if (t) t.replaceWith(lg); }; lg.src = u; });
      });
      var bt = h('div', { class: 'ibtns' });
      // Kijken: één knop per bron, met het logo: Plex, dan IPTV.
      var srcBtn = function (logoHtml, label, fn) { return F(h('button', { class: 'btn src' }, logoHtml + '<span>' + esc(label) + '</span>'), fn); };
      if (series && show) {
        var nx = nextUp(show);
        if (nx) bt.appendChild(srcBtn('<i class="ic ' + (a.plex ? 'plex' : 'iptv') + '"></i>', (a.plex ? 'Plex' : 'IPTV') + ' · ' + nx.label + ' S' + nx.s.season + ' afl. ' + nx.e.num, function () { playEp(nx.s, nx.e); }));
      } else if (!series) {
        if (a.plex) bt.appendChild(srcBtn('<i class="ic plex"></i>', 'Plex', function () { playPlex(a.plex.key, a.plex); }));
        if (a.vod) bt.appendChild(srcBtn('<i class="ic iptv"></i>', 'IPTV', function () { playMovie(Object.assign({}, a.vod, { tmdb: a.vod.tmdb || a.tmdb || 0 })); }));
      }
      if (bt.firstChild) bt.appendChild(h('span', { class: 'sep' }));
      if (!series && src) bt.appendChild(F(h('button', { class: 'btn' }, seen ? '✓ Bekeken' : 'Markeer als bekeken'), function () {
        var b = this; seen = !seen;
        setWatched([{ key: src, kind: 'movie', meta: { title: d.title || a.title, img: d.backdrop || '', tmdb: a.tmdb, type: 'movie' } }], seen).then(function () { b.innerHTML = seen ? '✓ Bekeken' : 'Markeer als bekeken'; });
      }));
      // Staat deze titel in Verder kijken? Dan ook een knop om hem daar weg te halen (zonder hem op bekeken te zetten).
      get('/api/continue?profile=' + S.profile).then(function (l) {
        var c = l.filter(function (x) {
          return x.key === src || (a.plex && (x.show === String(a.plex.key) || x.key === 'plex:' + a.plex.key)) || (a.vod && series && String(x.seriesId) === String(a.vod.id));
        })[0];
        if (!c) return;
        var b = F(h('button', { class: 'btn' }, 'Uit Verder kijken'), function () { hideCont(c).then(function () { var n = b.nextSibling || b.previousSibling; b.remove(); if (n) focus(n); }); });
        var ml = bt.querySelector('.btn.ml'); bt.insertBefore(b, ml || null);
      }, function () {});
      bt.appendChild(F(h('button', { class: 'btn ml' }, inList ? '✓ Mijn lijst' : '+ Mijn lijst'), function () {
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
      function epItem(s, e) { return { key: e.skey, seriesKey: a.vod ? 'series:' + a.vod.id : '', kind: 'series', tmdb: a.tmdb || (show && show.tmdb) || 0, season: +s.season, episode: e.num, meta: { title: d.title || a.title, sub: 'S' + s.season + ' · afl. ' + e.num, img: e.img || '', tmdb: a.tmdb } }; }
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
          setInfoBg((d.seasonArt || {})[s.season] || bgMain);
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
      // Onder het beeld (en bij series onder de seizoenen): extra's en trailers, cast, alles over de titel, en als laatste meer zoals dit.
      var slot = {}; ['extras', 'vid', 'cast', 'over', 'rel'].forEach(function (k) { slot[k] = h('div'); lower.appendChild(slot[k]); });
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
      // Over: het hele verhaal en de gegevens op een rij.
      var facts = [['Regie', d.director], ['Schrijvers', d.writers], ['Verschenen', d.date ? new Date(d.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''],
        ['Duur', d.runtime ? Math.floor(d.runtime / 60) + ' u ' + (d.runtime % 60) + ' min' : ''], ['Taal', d.language ? langName(d.language) : ''], ['Land', (d.countries || []).join(', ')],
        ['Gemaakt door', d.companies], ['Originele titel', d.original && d.original !== d.title ? d.original : ''], ['Leeftijd', d.age]].filter(function (f) { return f[1]; });
      // Het hele verhaal: van Wikipedia als dat er is, anders de langste tekst die we hebben. Bovenin blijft het kort.
      var story = d.story && d.story.text, plain = [d.overview, show && show.plot, a.plex && a.plex.summary, a.vod && a.vod.plot].filter(Boolean).sort(function (x, y) { return y.length - x.length; })[0] || '';
      var long = story || plain;
      if (long || facts.length) {
        var card = F(h('button', { class: 'about' }, '<div class="l">' + (d.tagline ? '<i>' + esc(d.tagline) + '</i>' : '') +
          long.split(/\n\n+/).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + (story ? '<small class="src">Bron: Wikipedia</small>' : '') + '</div>' +
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
  // Zoeken: links typen of inspreken, met daaronder onderwerpen en wat je eerder zocht. Rechts één lijst met filters.
  // YouTube live en straks staan gewoon tussen de resultaten. Gewone YouTube-video's alleen onder hun eigen filter.
  var FILTERS = [['alles', 'Alles'], ['live', 'Nu live'], ['later', 'Straks'], ['past', 'Terugkijken'], ['channels', 'Zenders'], ['titles', 'Films en series'], ['youtube', 'YouTube live'], ['ytvideos', "YouTube video's"]];
  var TOPICS = ['wielrennen', 'voetbal', 'formule 1', 'darts', 'tennis'];
  // a.only = 'movie' of 'series': alleen zoeken in je eigen films of series (vanuit Films of Series).
  screens.search = function (a) {
    var el = h('div', { class: 'screen' }), only = a.only || '';
    el.appendChild(topbar('search'));
    if (only) el.querySelector('.crumb').textContent = 'Zoeken in ' + (only === 'movie' ? 'films' : 'series');
    var st = a.st || (a.st = { q: a.q || '', filter: 'alles', r: null });
    var left = h('div', { style: 'position:absolute;left:80px;top:140px;width:400px;display:flex;flex-direction:column;gap:16px' });
    var field = h('div', { class: 'field', style: 'height:64px;font-size:28px' }); left.appendChild(field);
    if (K.can.voice) left.appendChild(F(h('button', { class: 'btn', style: 'justify-content:center;padding:12px 24px;font-size:21px' }, '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg>Inspreken'), function () {
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
      if (!only) TOPICS.forEach(function (t) { chips.appendChild(F(h('button', { class: 'chip topic' }, esc(t)), function () { pick(t); }, { group: 'chips' })); });
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
      if (only) { pills.innerHTML = ''; inner.innerHTML = '<div class="empty" style="padding:0">Typ of spreek een titel in.</div>'; return; }
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
      var lists = { live: g.live || [], later: g.later || [], past: g.past || [], channels: g.channels || [], titles: r.titles || [], youtube: (yt.live || []).concat(yt.upcoming || []), ytvideos: yt.videos || [] };
      if (only) {   // alleen titels van deze soort, als raster
        var mine = lists.titles.filter(function (t) { return t.kind === only; });
        if (!mine.length) { inner.innerHTML = '<div class="empty" style="padding:0">Geen ' + (only === 'movie' ? 'films' : 'series') + ' gevonden voor "' + esc(st.q.trim()) + '"</div>'; return; }
        var grd = h('div', { class: 'grid', style: 'padding:4px 0' });
        mine.forEach(function (t) { var e = titleTile(t, t.kind), ok = e._ok; e._ok = function () { remember(); ok(); }; grd.appendChild(e); });
        inner.appendChild(grd); return;
      }
      // Alles telt de gewone YouTube-video's niet mee: die staan er ook niet tussen.
      var n = function (k) { return k === 'alles' ? Object.keys(lists).reduce(function (t, x) { return x === 'ytvideos' ? t : t + lists[x].length; }, 0) : lists[k].length; };
      FILTERS.forEach(function (f) {
        // Nu live staat er altijd, ook met 0: dan weet je dat er nu niets is.
        if (f[0] !== 'alles' && f[0] !== 'live' && !n(f[0])) return;
        pills.appendChild(F(h('button', { class: 'pill' + (st.filter === f[0] ? ' on' : '') }, esc(f[1]) + ' (' + n(f[0]) + ')'), function () { st.filter = f[0]; draw(); focus(pills.querySelector('.on')); }, { group: 'filters' }));
      });
      if (yt.error) inner.appendChild(h('div', { class: 'empty', style: 'padding:0 0 14px' }, 'YouTube reageert nu niet. Kijk bij de status op de beheerpagina.'));
      if (!n('alles') && !lists.ytvideos.length) { inner.appendChild(h('div', { class: 'empty', style: 'padding:0' }, 'Niets gevonden voor "' + esc(st.q.trim()) + '"')); return; }
      var all = st.filter === 'alles', box = h('div', { class: 'hits' });
      if (st.filter === 'live' && !lists.live.length) inner.appendChild(h('div', { class: 'empty', style: 'padding:0 0 14px' }, 'Nu is er niets live met "' + esc(st.q.trim()) + '".' + (lists.later[0] ? ' Eerstvolgende:' : '')));
      [['channels', 3], ['live', 6], ['later', 5], ['past', 5], ['youtube', 4], ['ytvideos', 0]].forEach(function (k) {
        var list = lists[k[0]];
        if (st.filter === 'live' && k[0] === 'later' && !lists.live.length) list = list.slice(0, 1);
        else if (!all && st.filter !== k[0]) return;
        list.slice(0, all ? k[1] : 200).forEach(function (x) { box.appendChild(k[0] === 'youtube' || k[0] === 'ytvideos' ? ytRow(x) : hitRow(x, k[0])); });
      });
      if (box.children.length) inner.appendChild(box);
      if (lists.titles.length && (all || st.filter === 'titles')) {
        var tiles = lists.titles.map(function (t) { var e = titleTile(t, t.kind), ok = e._ok; e._ok = function () { remember(); ok(); }; return e; });
        if (all) { var sec = rowSection('Films en series', tiles); sec.querySelector('h2').style.paddingLeft = '0'; sec.querySelector('.row').style.padding = '0'; inner.appendChild(sec); }
        else { var gr = h('div', { class: 'grid', style: 'padding:4px 0' }); tiles.forEach(function (t) { gr.appendChild(t); }); inner.appendChild(gr); }
      }
    }
    // Lengte als 1:02:03 of 4:05.
    function dur(s) { var hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; return (hh ? hh + ':' + (mm < 10 ? '0' : '') : '') + mm + ':' + (ss < 10 ? '0' : '') + ss; }
    // Hoe lang geleden geplaatst.
    function ago(t) { var d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? 'vandaag' : d < 2 ? 'gisteren' : d < 31 ? d + ' dagen geleden' : d < 365 ? Math.floor(d / 30) + ' mnd geleden' : Math.floor(d / 365) + ' jaar geleden'; }
    function ytRow(x) {
      var video = 'published' in x, live = !video && !x.start;
      var label = video ? '▶ ' + (x.duration ? dur(x.duration) : 'video') : live ? '● LIVE' : esc(dayName(x.start).length > 9 ? new Date(x.start).toLocaleDateString('nl-NL', { weekday: 'short' }) : dayName(x.start).toLowerCase()) + ' ' + clock(x.start);
      var b = h('button', { class: 'hit' }, '<span class="st yt">' + label + '</span>' +
        '<span class="ti">' + esc(x.title) + '</span><span class="ch"><i style="' + bg(x.thumb) + ';background-size:cover"></i>' + esc(x.channel) + '</span>' +
        '<span class="tm">YouTube' + (live && x.viewers ? ' · ' + x.viewers.toLocaleString('nl-NL') + ' kijkers' : video && x.published ? ' · ' + ago(x.published) : '') + '</span><span class="pb leeg"></span>');
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
    if (!K.can.voice) return toast('Inspreken kan niet op dit apparaat');
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
    [['list', 'Mijn lijst'], ['cont', 'Verder kijken'], ['seen', 'Bekeken'], ['apps', 'Apps op Home'], ['skip', 'Genres overslaan'], ['avatar', 'Avatar kiezen'], ['prefs', 'Voorkeuren'], ['switch', 'Wissel van profiel']].forEach(function (t) {
      side.appendChild(F(h('button', { class: 'listrow' + (t[0] === tab ? ' on' : '') }, esc(t[1])), function () {
        if (t[0] === 'switch') return whoDialog();
        a.tab = t[0]; go('profile', a, true);
      }, { group: 'side', move: function (dir) { if (dir !== 'right') return; var f = main.querySelector('.f'); if (f) { focus(f); return true; } } }));
    });
    el.appendChild(side);
    var main = h('div', { class: 'main vscroll' }); el.appendChild(main);
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
    } else if (tab === 'apps') {
      // Volgorde en zichtbaarheid van de apps in de rij Kijken en in de zijbalk. Alleen voor dit profiel.
      main.appendChild(h('h2', { style: 'font-size:36px' }, 'Apps op Home'));
      main.appendChild(h('div', { class: 'dim', style: 'font-size:20px;margin-bottom:10px' }, 'OK zet een app aan of uit. Met "Hoger" schuift hij een plek naar boven.'));
      var box2 = h('div', { class: 'scroll-inner', style: 'display:flex;flex-direction:column;gap:10px' }); main.appendChild(box2);
      installedServices().then(function (l) {
        l = sortServices(l.filter(function (x) { return x.svc.key !== 'plex'; }), true);
        var pr = p.prefs || {}, hide = (pr.appHide || []).slice(), order = l.map(function (x) { return x.svc.key; });
        var save = function (focusId) { api('POST', '/api/profiles/' + p.id + '/prefs', { appOrder: order, appHide: hide }).then(function () { p.prefs = Object.assign(pr, { appOrder: order, appHide: hide }); a._focus = focusId; go('profile', a, true); }); };
        l.forEach(function (x, i) {
          var k = x.svc.key, sid = k.replace(/[^\w-]/g, '_'), off = hide.indexOf(k) >= 0, row = h('div', { style: 'display:flex;gap:10px' });
          row.appendChild(F(h('button', { class: 'listrow', id: 'app-' + sid, style: 'flex:1' }, '<b>' + esc(x.svc.name) + '</b><span class="dim">' + (off ? 'Verborgen' : 'Op Home') + '</span>'), function () {
            if (off) hide.splice(hide.indexOf(k), 1); else hide.push(k); save('#app-' + sid);
          }));
          if (x.app.input) row.appendChild(F(h('button', { class: 'listrow', id: 'nm-' + sid, style: 'width:150px;justify-content:center' }, 'Naam'), function () {
            renameHdmi(x, function () { a._focus = '#nm-' + sid; go('profile', a, true); });
          }));
          if (i > 0) row.appendChild(F(h('button', { class: 'listrow', id: 'up-' + sid, style: 'width:150px;justify-content:center' }, 'Hoger'), function () {
            order.splice(i, 1); order.splice(i - 1, 0, k); save('#up-' + sid);
          }));
          box2.appendChild(row);
        });
        if (!a._focus) focus(box2.querySelector('.listrow'));
      });
    } else if (tab === 'skip') {
      main.appendChild(h('h2', { style: 'font-size:36px' }, 'Genres overslaan'));
      main.appendChild(h('div', { class: 'dim', style: 'font-size:20px;margin-bottom:10px' }, 'Wat je overslaat, zie je niet meer bij Home, Films en Series. Bij Zoeken blijft alles te vinden. OK zet aan of uit.'));
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
      // Favoriet genre: een eigen rij op Thuis met de beste titels in dat genre.
      var favs = [''].concat(GENRES), fv = prefs.favGenre || '';
      main.appendChild(F(h('button', { class: 'listrow' }, '<b>Favoriet genre op Home</b><span class="dim">' + esc(fv || 'Geen') + ' ›</span>'), function () {
        var next = favs[(favs.indexOf(fv) + 1) % favs.length];
        api('POST', '/api/profiles/' + p.id + '/prefs', { favGenre: next }).then(function () { p.prefs = Object.assign(prefs, { favGenre: next }); a._focus = null; go('profile', a, true); });
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

  // ---------- schermbeveiliging ----------
  // Android: de dagdroom van het systeem (werkt ook in andere apps). Andere tv's (Samsung): binnen Sjuul TV zelf, hieronder.
  // Instellingen per apparaat; dezelfde keuzes op beide.
  var SAVERSRC = [['film', 'Filmart', 'Beelden van je eigen films en series'], ['album1', "Eigen foto's 1", 'Ook bovenaan Home'], ['album2', "Eigen foto's 2", ''],
    ['album3', "Eigen foto's 3", ''], ['kunst', 'Kunst', 'Schilderijen uit het Art Institute of Chicago'], ['klok', 'Alleen klok en weer', 'Rustig scherm zonder foto\'s']];
  var APPSAVER = 'sjuul-schermbeveiliging';
  function saverPrefs() {
    if (K.can.saver) { try { return JSON.parse(N.saverGet()); } catch (e) { return null; } }
    if (!K.can.appSaver) return null;
    var p = { src: 'film', speed: 45, fixed: '', delay: 10, canDelay: true, active: true };
    try { var o = JSON.parse(localStorage.getItem(APPSAVER) || '{}'); for (var k in o) p[k] = o[k]; } catch (e) {}
    return p;
  }
  function saverSet(o) {
    if (K.can.saver) return N.saverSet(JSON.stringify(o));
    var p = saverPrefs(); for (var k in o) p[k] = o[k];
    try { localStorage.setItem(APPSAVER, JSON.stringify(p)); } catch (e) {}
    idleReset();
  }
  function saverRows(row, redo) {
    var sp = saverPrefs(); if (!sp) return;
    var src = sp.src.split(','), names = SAVERSRC.filter(function (x) { return src.indexOf(x[0]) >= 0; }).map(function (x) { return x[1]; });
    if (!sp.active) row('Schermbeveiliging is nog niet aangezet', 'Eenmalig via de computer in te stellen. Tot dan toont Android zijn eigen schermbeveiliging.', function () { N.openSystem('saver'); });
    row('Schermbeveiliging: beelden', names.join(', '), function () { pickSaverSources(sp, redo); });
    var DELAY = [['5', 'Na 5 minuten'], ['10', 'Na 10 minuten'], ['30', 'Na 30 minuten'], ['60', 'Na een uur'], ['0', 'Nooit']];
    if (sp.canDelay) row('Schermbeveiliging start', labelOf(DELAY, String(sp.delay)), function () { saverSet({ delay: +nextOf(DELAY, String(sp.delay)) }); redo(); });
    else row('Schermbeveiliging start', sp.delay ? 'Na ' + sp.delay + ' minuten (aanpassen nog niet toegestaan)' : 'Nooit', function () { N.openSystem('saver'); });
    if (src.join() === 'klok') return;
    row('Foto', sp.fixed ? 'Steeds dezelfde' : 'Wisselen', function () { pickSaverPhoto(sp, redo); });
    var SPEED = [['45', 'Elke 45 seconden'], ['120', 'Elke 2 minuten'], ['300', 'Elke 5 minuten'], ['15', 'Elke 15 seconden']];
    if (!sp.fixed) row('Wisselen van foto', labelOf(SPEED, String(sp.speed)), function () { saverSet({ speed: +nextOf(SPEED, String(sp.speed)) }); redo(); });
  }
  // Bronnen aan- en uitvinken. "Alleen klok en weer" sluit de rest uit.
  function pickSaverSources(sp, redo) {
    get('/api/saver?src=none').then(function (r) { return r.albums || {}; }, function () { return {}; }).then(function (albums) {
      var src = sp.src.split(','), d = h('div', { class: 'dialog' }, '<h2>Beelden in de schermbeveiliging</h2>'), list = h('div', { style: 'display:flex;flex-direction:column;gap:8px;width:720px' });
      var draw = function () {
        list.innerHTML = '';
        SAVERSRC.forEach(function (x) {
          var on = src.indexOf(x[0]) >= 0, n = /^album/.test(x[0]) ? albums[x[0].slice(5)] : null;
          var sub = n === 0 ? 'Nog leeg: foto\'s toevoegen op de beheerpagina' : n ? n + " foto's" + (x[2] ? ' · ' + x[2] : '') : x[2];
          list.appendChild(F(h('button', { class: 'listrow', id: 'ss-' + x[0] }, '<span style="display:flex;flex-direction:column;gap:4px;text-align:left"><b>' + esc(x[1]) + '</b>' + (sub ? '<span class="dim" style="font-size:18px">' + esc(sub) + '</span>' : '') + '</span><span>' + (on ? '✓' : '') + '</span>'), function () {
            if (x[0] === 'klok') src = ['klok'];
            else { src = src.filter(function (k) { return k !== 'klok'; }); src = on ? src.filter(function (k) { return k !== x[0]; }) : src.concat(x[0]); }
            if (!src.length) src = ['film'];
            saverSet({ src: src.join(','), fixed: '' }); sp.src = src.join(','); sp.fixed = '';
            draw(); focus(list.querySelector('#ss-' + x[0]));
          }));
        });
      };
      draw(); d.appendChild(list); openOverlay(d, redo);
    });
  }
  // Schermbeveiliging binnen Sjuul TV: na een tijd niets doen, beelden met klok, datum en weer. Elke knop haalt hem weg.
  var idleT = 0, saverEl = null;
  function idleReset() {
    clearTimeout(idleT);
    var sp = K.can.appSaver && saverPrefs(); if (!sp || !+sp.delay) return;
    idleT = setTimeout(saverStart, sp.delay * 60e3);
  }
  function saverStart() {
    if ((window.Speler && Speler.isOpen()) || saverEl) return idleReset();
    var sp = saverPrefs(), layers = [h('div', { class: 'sv-bg' }), h('div', { class: 'sv-bg' })], txt = h('div', { class: 'sv-tx' + (sp.src === 'klok' ? ' mid' : '') }, '<b></b><span class="d"></span><span class="w"></span>');
    saverEl = h('div', { class: 'saver' }); layers.forEach(function (l) { saverEl.appendChild(l); }); saverEl.appendChild(txt);
    saverEl.onclick = saverStop; document.body.appendChild(saverEl);
    var clockT = setInterval(paint, 10e3), slideT = 0, imgs = [], n = 0, top = 0;
    saverEl._stop = function () { clearInterval(clockT); clearInterval(slideT); };
    function paint() {
      var d = new Date(); txt.querySelector('b').textContent = d.getHours() + ':' + K.pad(d.getMinutes());
      txt.querySelector('.d').textContent = d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, function (c) { return c.toUpperCase(); });
    }
    function next() {
      if (!imgs.length) return;
      var u = imgs[n++ % imgs.length].url, l = layers[top = 1 - top];
      var im = new Image(); im.onload = function () { l.style.backgroundImage = "url('" + K.img(u).replace(/'/g, '%27') + "')"; l.classList.add('on'); layers[1 - top].classList.remove('on'); }; im.src = K.img(u);
    }
    paint();
    get('/api/saver?src=' + encodeURIComponent(sp.src)).then(function (r) {
      if (!saverEl) return;
      if (r.weather) txt.querySelector('.w').textContent = r.weather.temp + '°  ' + r.weather.text + (r.weather.place ? '  ·  ' + r.weather.place : '');
      if (sp.src === 'klok') return;
      imgs = r.images || [];
      var fixed = sp.fixed && imgs.filter(function (p) { return p.url.split('?')[0] === sp.fixed; })[0];
      if (fixed) imgs = [fixed];
      next(); if (imgs.length > 1) slideT = setInterval(next, (+sp.speed || 45) * 1000);
    }).catch(function () {});
  }
  function saverStop() { if (!saverEl) return; saverEl._stop(); saverEl.remove(); saverEl = null; idleReset(); }
  if (K.can.appSaver) {
    // Eerst kijken of de schermbeveiliging aan staat: dan haalt de knop hem alleen weg en doet verder niets.
    document.addEventListener('keydown', function (e) { if (saverEl) { e.preventDefault(); e.stopImmediatePropagation(); saverStop(); } else idleReset(); }, true);
    document.addEventListener('click', idleReset, true);
    idleReset();
  }

  // Eén vaste foto kiezen uit de gekozen bronnen, of laten wisselen.
  function pickSaverPhoto(sp, redo) {
    get('/api/saver?src=' + encodeURIComponent(sp.src)).then(function (r) {
      var d = h('div', { class: 'dialog' }, '<h2>Foto in de schermbeveiliging</h2>'), box = h('div', { style: 'display:flex;flex-wrap:wrap;gap:16px;justify-content:center;max-width:1300px;max-height:640px;overflow:hidden' });
      var pick = function (v) { saverSet({ fixed: v }); closeOverlay(); redo(); };
      box.appendChild(F(h('button', { class: 'pill' + (sp.fixed ? '' : ' on'), style: 'align-self:center' }, 'Wisselen'), function () { pick(''); }));
      r.images.slice(0, 24).forEach(function (p) {
        var key = p.url.split('?')[0];
        box.appendChild(F(h('button', { class: 'row-item', style: 'width:240px' }, '<div class="thumb" style="' + bg(p.url) + (key === sp.fixed ? ';outline:3px solid #fff' : '') + '"></div>'), function () { pick(key); }));
      });
      d.appendChild(box); openOverlay(d);
    }, function (e) { toast(e.message); });
  }

  // ---------- instellingen ----------
  screens.settings = function (a) {
    var el = h('div', { class: 'screen' }), tab = a.tab || 'device';
    var side = h('div', { class: 'side' }, '<h1 style="font-size:44px;margin-bottom:24px">Instellingen</h1>');
    [['device', 'Dit apparaat'], ['profile', 'Profiel op dit apparaat'], ['conn', 'Verbinding'], ['about', 'Over Sjuul TV']].forEach(function (t) {
      side.appendChild(F(h('button', { class: 'listrow' + (t[0] === tab ? ' on' : '') }, esc(t[1])), function () { a.tab = t[0]; go('settings', a, true); },
        { group: 'side', move: function (dir) { if (dir !== 'right') return; var f = main.querySelector('.f'); if (f) { focus(f); return true; } } }));
    });
    el.appendChild(side);
    var main = h('div', { class: 'main vscroll' }); el.appendChild(main);
    function row(title, sub, ok) { main.appendChild(F(h('button', { class: 'listrow' }, '<span style="display:flex;flex-direction:column;gap:4px;text-align:left"><b>' + esc(title) + '</b>' + (sub ? '<span class="dim" style="font-size:18px">' + esc(sub) + '</span>' : '') + '</span><span>›</span>'), ok)); }
    if (tab === 'device') {
      main.appendChild(h('h2', { style: 'font-size:36px;margin-bottom:10px' }, 'Dit apparaat'));
      var VIEWN = [['normaal', 'Normaal'], ['compact', 'Compact: meer op het scherm'], ['105', 'Groter: 105%'], ['110', 'Groter: 110%'], ['115', 'Groter: 115%'], ['120', 'Groter: 120%'], ['125', 'Groter: 125%']];
      var nu = S.view === 'ruim' ? String(groter()) : S.view;
      row('Weergave', labelOf(VIEWN, nu), function () {
        var next = nextOf(VIEWN, nu), view = /^\d+$/.test(next) ? 'ruim' : next;
        api('POST', '/api/device', { view: view }).then(function () {
          if (view === 'ruim') { try { localStorage.setItem('thuis-groter', next); } catch (e) {} }
          S.view = view; fit(); a._focus = null; go('settings', a, true);
        }, function (e) { toast(e.message); });
      });
      saverRows(row, function () { a._focus = null; go('settings', a, true); });
      if (K.can.system) {
        row('Alle Android-instellingen', 'De instellingen van dit apparaat zelf', function () { N.openSystem('all'); });
        row('Wifi en netwerk', '', function () { N.openSystem('wifi'); });
        row('Bluetooth', 'Afstandsbedieningen en koptelefoons', function () { N.openSystem('bluetooth'); });
        row('Geluid', '', function () { N.openSystem('sound'); });
        row('Beeld', '', function () { N.openSystem('display'); });
        row('Apps', 'Bijwerken, opslag, gegevens wissen', function () { N.openSystem('apps'); });
      }
      if (K.can.apps) row('Alle apps', 'Ook apps zonder tegel op het startscherm', function () { go('apps'); });
      if (hdmiHidden().length) row('Verborgen HDMI-ingangen weer tonen', 'HDMI ' + hdmiHidden().join(', '), function () { try { localStorage.removeItem('thuis-hdmi-verborgen'); } catch (e) {} a._focus = null; go('settings', a, true); });
      if (K.can.system) row('Geavanceerd: ander startscherm kiezen', 'Alleen voor noodgevallen', function () { N.openSystem('home'); });
    } else if (tab === 'profile') {
      main.appendChild(h('h2', { style: 'font-size:36px;margin-bottom:10px' }, 'Profiel op dit apparaat'));
      var d = S.device || {};
      if (d.locked) { main.appendChild(h('div', { class: 'dim', style: 'font-size:22px' }, 'Dit apparaat is vastgezet op ' + esc(me().name) + '. Aanpassen kan op de beheerpagina van tv-serverr.')); return el; }
      var prof = S.profiles.filter(function (p) { return p.id === d.profile; })[0];
      var asks = { altijd: 'Altijd vragen', samen: 'Vragen bij Samen', nooit: 'Nooit vragen' };
      row('Standaardprofiel', prof ? prof.name + ': staat voorgeselecteerd bij "Wie kijkt er?"' : 'Geen', function () {
        var ids = [0].concat(S.profiles.map(function (p) { return p.id; })), next = ids[(ids.indexOf(d.profile || 0) + 1) % ids.length];
        api('POST', '/api/device', { profile: next }).then(function () { d.profile = next; go('settings', a, true); });
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
        bt.appendChild(F(h('button', { class: 'btn' }, 'Ja, ontkoppelen'), function () { if (N) N.srvUnpair(); closeOverlay(); go('pair', {}, 'root'); }));
        dd.appendChild(bt); openOverlay(dd);
      });
    } else {
      main.appendChild(h('h2', { style: 'font-size:36px;margin-bottom:10px' }, 'Over Sjuul TV'));
      main.appendChild(h('div', { class: 'listrow' }, '<b>Versie</b><span class="dim">Sjuul TV ' + esc(N ? N.appVersion() : 'browser') + '</span>'));
      if (K.can.update) row('Zoeken naar een nieuwe versie', '', function () {
        toast('Even kijken…');
        native('checkUpdate').then(function (t) {
          var u = JSON.parse(t);
          if (!u.newer) return toast('Je hebt de nieuwste versie (' + u.current + ')');
          toast('Sjuul TV ' + u.latest + ' wordt gedownload…', 8000);
          native('installUpdate').then(function (r) {
            if (r === 'permission') toast('Sta het installeren van apps toe en kies daarna opnieuw', 6000);
            else toast('Bezig met bijwerken. Sjuul TV start zo opnieuw.', 8000);
          }, function (e) { toast('Bijwerken lukt niet: ' + e.message, 8000); });
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
      apps.forEach(function (a) { g.appendChild(appTile({ svc: { name: a.label }, app: a })); });
      focus(focusables()[0]);
    });
    return el;
  };

  // ---------- opstarten ----------
  function boot() {
    var info = N ? JSON.parse(N.srvInfo()) : { paired: true, profile: 0 };
    if (!info.paired) return go('pair', {}, 'root');
    S.profile = info.profile || 0;
    var svc = fetch('services.json').then(function (r) { return r.json(); }).then(function (j) { return j.services; }, function () { return []; });
    Promise.all([get('/api/whoami'), get('/api/profiles'), svc]).then(function (r) {
      S.device = r[0]; S.profiles = r[1]; S.svcList = r[2];
      S.view = r[0].view || 'normaal'; fit();
      get('/api/services/logos').then(function (l) { S.logos = l; }, function () {});
      if (S.device.profile) setProfile(S.device.profile);                         // standaardprofiel van dit apparaat
      if (!S.profiles.some(function (p) { return p.id === S.profile; })) S.profile = 0;
      if (!S.profile) return go('who', {}, 'root');
      go('home', {}, 'root'); wakeWho();
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

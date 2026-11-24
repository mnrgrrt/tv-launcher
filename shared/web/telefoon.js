/* Sjuul TV op de telefoon: Home, Live, Bibliotheek en Zoeken, met de infopagina en de spelers van de app.
   Gedeelde kern (server, afspelen, kijkstand) staat in kern.js, net als op de tv. Hier alleen het telefoonscherm. */
(function () {
  'use strict';
  var K = window.Kern, N = K.N, S = K.S, esc = K.esc, h = K.h, clock = K.clock, dayName = K.dayName, native = K.native, api = K.api, get = K.get,
    img = K.img, bg = K.bg, me = K.me, setProfile = K.setProfile, playPlex = K.playPlex, playMovie = K.playMovie, playEpisode = K.playEpisode,
    resume = K.resume, info = K.info, playLive = K.playLive, playCatchup = K.playCatchup, setWatched = K.setWatched, rating = K.rating, nextUp = K.nextUp, hideCont = K.hideCont;
  var $app = document.getElementById('app'), $tabs = document.getElementById('tabs');

  // ---------- meldingen en vensters ----------
  var toastT = 0;
  function toast(msg, ms) { var t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3000); }
  var sheetEl = null;
  // Venster van onderen met keuzes: items = [[tekst, functie], ...]
  function sheet(title, items, body) {
    closeSheet();
    var bgEl = h('div', { class: 'sheet-bg' }), s = h('div', { class: 'sheet' }, '<div class="grab"></div>' + (title ? '<h3>' + esc(title) + '</h3>' : ''));
    if (body) s.appendChild(body);
    (items || []).forEach(function (it) { var b = h('button', { class: 'it' }, esc(it[0])); b.onclick = function () { closeSheet(); it[1](); }; s.appendChild(b); });
    bgEl.onclick = closeSheet;
    document.body.appendChild(bgEl); document.body.appendChild(s); sheetEl = [bgEl, s];
  }
  function closeSheet() { if (!sheetEl) return false; sheetEl.forEach(function (e) { e.remove(); }); sheetEl = null; return true; }
  // Bij afspelen: kijkt iemand anders dit al? Dan vragen of je bij die verder wilt.
  function askWho(key) {
    if (S.device && S.device.locked) return Promise.resolve();
    return get('/api/watchers?key=' + encodeURIComponent(key) + '&profile=' + S.profile).then(function (w) {
      if (!w.length) return;
      return new Promise(function (resolve) {
        var first = w[0];
        sheet(first.name + ' kijkt dit. Verder als ' + first.name + '?', [['Ja, verder als ' + first.name, function () { setProfile(first.id); resolve(); }], ['Nee, als ' + me().name, resolve]]);
      });
    }, function () {});
  }
  K.ui.toast = toast; K.ui.askWho = askWho; K.ui.unpaired = function () { go('pair', {}, true); };

  // ---------- schermen, tabbladen en Terug ----------
  var screens = {}, stack = [], current = null;
  var TABS = [['home', 'Home', '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>'],
    ['live', 'Live', '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/>'],
    ['lib', 'Bibliotheek', '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.5 1-4 15-3.5-1z"/>'],
    ['search', 'Zoeken', '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>']];
  var SVG = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  function drawTabs() {
    $tabs.innerHTML = ''; $tabs.hidden = !S.profile;
    var root = (stack[0] || current || {}).name;
    TABS.forEach(function (t) {
      var b = h('button', { class: t[0] === root ? 'on' : '' }, SVG(t[2]) + '<span>' + t[1] + '</span>');
      b.onclick = function () { if (t[0] === root && !stack.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; } go(t[0], {}, true); };
      $tabs.appendChild(b);
    });
  }
  // go(naam, args): nieuwe pagina; root = true: opnieuw beginnen (tabblad, profiel, koppelen).
  function go(name, args, root) {
    closeSheet();
    if (root) stack = []; else if (current) { stack.push({ name: current.name, args: current.args, y: window.scrollY }); if (!N) history.pushState(null, ''); }
    current = { name: name, args: args || {} };
    render(0);
  }
  function render(y) {
    $app.innerHTML = ''; var el = screens[current.name](current.args); if (el) $app.appendChild(el);
    drawTabs(); window.scrollTo(0, y || 0);
  }
  // Terug: eerst een open venster dicht, dan een pagina terug, dan naar Home; op Home sluit de app.
  function popPage() { closeSheet(); var p = stack.pop(); current = { name: p.name, args: p.args }; render(p.y); }
  function back() {
    if (closeSheet()) return;
    if (stack.length) { if (N) popPage(); else history.back(); return; }   // webversie: via de browsergeschiedenis, zodat vegen terug ook werkt
    if (current && current.name !== 'home' && S.profile) return go('home', {}, true);
    if (N && N.closeApp) N.closeApp();
  }
  window.__back = back;
  // Webversie: terugvegen of de terugknop van de browser.
  if (!N) window.addEventListener('popstate', function () { if (stack.length) popPage(); });
  window.__resume = function () {};   // telefoon: geen "Wie kijkt er?" bij elk ontgrendelen

  // ---------- bouwstenen ----------
  function top(title, right) {
    var t = h('div', { class: 'top' }, '<h1>' + esc(title) + '</h1>');
    var av = h('button', { 'aria-label': 'Profiel' }, '<img class="av" alt="" src="' + esc(img(me().avatarUrl)) + '">'); av.onclick = profileSheet;
    t.appendChild(right || av); return t;
  }
  function backBar(title) {
    var t = h('div', { class: 'top' }), b = h('button', { class: 'back' }, SVG('<path d="M15 5l-7 7 7 7"/>') + '<span>' + esc(title || 'Terug') + '</span>');
    b.onclick = back; t.appendChild(b); return t;
  }
  function section(title, items, sub) {
    if (!items.length) return document.createTextNode('');
    var s = h('div', { class: 'sec' }, '<h2>' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</h2>'), r = h('div', { class: 'row' });
    items.forEach(function (i) { r.appendChild(i); }); s.appendChild(r); return s;
  }
  function tap(el, fn) { el.onclick = fn; return el; }
  function badges(o) {
    var b = (o.sources || []).map(function (s) { return '<i class="ic ' + s + '"></i>'; });
    return '<div class="badges">' + (b.length ? b.join('') : '<span class="nog">Niet bij jou</span>') + '</div>';
  }
  function poster(o, kind) {
    return tap(h('button', { class: 'poster' }, '<div class="th" style="' + bg(o.poster) + '">' + badges(o) + '</div><div class="t1">' + esc(o.title) + '</div><div class="t2">' + esc([o.year, rating(o)].filter(Boolean).join(' · ')) + '</div>'),
      function () { openTitle(o, kind); });
  }
  function openTitle(o, kind) {
    go('info', { type: kind === 'series' ? 'tv' : 'movie', tmdb: o.tmdb, title: o.title, plex: o.plex || null, vod: o.vod || null, vodKind: kind });
  }
  var cleanTitle = function (t) { return String(t || '').replace(/\s*\(\d{4}\)[\s.]*$/, ''); };
  function contCard(c, after) {
    var sub = c.next ? c.sub : [c.sub, c.left > 0 ? 'nog ' + c.left + ' min' : ''].filter(Boolean).join(' · ');
    var el = h('button', { class: 'wide' }, '<div class="th" style="' + bg(c.img || c.art || c.thumb) + '">' + (c.next ? '<span class="badge">Volgende</span>' : '') +
      (c.progress > 0.02 ? '<div class="bar"><i style="width:' + Math.round(c.progress * 100) + '%"></i></div>' : '') + '</div><div class="t1">' + esc(cleanTitle(c.title)) + '</div><div class="t2">' + esc(sub) + '</div>');
    return tap(el, function () { contSheet(c, after); });
  }
  // Verder kijken: kiezen wat je wilt, net als op de tv.
  function contSheet(c, after) {
    var items = [[c.next ? 'Afspelen: ' + c.sub : 'Verder kijken' + (c.left > 0 ? ' (nog ' + c.left + ' min)' : ''), function () { resume(c); }]];
    if (!c.next) items.push(['Vanaf het begin', function () { S.fromStart = true; resume(c); }]);
    items.push(['Markeer als bekeken', function () {
      setWatched([{ key: c.key, seriesKey: c.seriesId ? 'series:' + c.seriesId : '', kind: c.kind === 'movie' ? 'movie' : 'series', tmdb: c.tmdb || 0, season: c.season || 0, episode: c.episode || 0, meta: { title: c.title, sub: c.sub, img: c.img || c.art || '', tmdb: c.tmdb } }], true)
        .then(function () { toast('Op bekeken gezet'); if (after) after(); });
    }]);
    items.push(['Uit Verder kijken', function () { hideCont(c).then(function () { if (after) after(); }); }]);
    var isMovie = c.kind === 'movie', plexKey = String(c.key || '').indexOf('plex:') === 0 ? String(c.key).slice(5) : '';
    var info = isMovie ? { type: 'movie', tmdb: c.tmdb || 0, title: c.title, plex: plexKey ? { key: plexKey } : null, vod: !plexKey && c.id ? { id: c.id } : null, vodKind: 'movie' }
      : { type: 'tv', tmdb: 0, title: c.title, plex: c.show ? { key: c.show } : null, vod: c.seriesId ? { id: c.seriesId } : null, vodKind: 'series' };
    if (info.tmdb || info.plex || info.vod) items.push([isMovie ? 'Naar de film' : 'Naar de serie', function () { go('info', info); }]);
    sheet(cleanTitle(c.title), items);
  }
  function loading() { return h('div', { class: 'spin' }, 'Laden…'); }
  function profileSheet() {
    var w = h('div', { class: 'who' });
    S.profiles.forEach(function (p) {
      if (S.device && S.device.locked && p.id !== S.profile) return;
      w.appendChild(tap(h('button', { class: p.id === S.profile ? 'cur' : '' }, '<img alt="" src="' + esc(img(p.avatarUrl)) + '"><span>' + esc(p.name) + '</span>'), function () {
        closeSheet(); setProfile(p.id); S.ov = {}; go('home', {}, true);
      }));
    });
    sheet('Wie kijkt er?', [['Instellingen', function () { go('settings'); }]], w);
  }

  // ---------- Home ----------
  screens.home = function () {
    var el = h('div', { class: 'screen' }); el.appendChild(top('Home'));
    var cont = h('div'), news = h('div'); el.appendChild(cont); el.appendChild(news);
    var again = function () { go('home', {}, true); };
    get('/api/continue?profile=' + S.profile).then(function (l) { cont.appendChild(section('Verder kijken', l.map(function (c) { return contCard(c, again); }))); }).catch(function () {});
    news.appendChild(loading());
    get('/api/foryou?profile=' + S.profile).then(function (d) {
      news.innerHTML = d.now.length ? '' : '<div class="empty">Nu niets nieuws voor jou. Kijk in Bibliotheek of Live.</div>';
      news.appendChild(section('Nieuw voor jou', d.now.map(function (o) { return poster(o, o.kind); })));
    }).catch(function (e) { news.innerHTML = '<div class="empty">tv-serverr is nu niet bereikbaar. ' + esc(e.message) + '</div>'; });
    return el;
  };

  // ---------- Live ----------
  function liveCats() {
    if (S.cats && Date.now() - S.catsAt < 30 * 60e3) return Promise.resolve(S.cats);
    return get('/api/live/categories').then(function (c) { S.cats = c; S.catsAt = Date.now(); return c; });
  }
  screens.live = function (a) {
    var el = h('div', { class: 'screen' }); el.appendChild(top('Live'));
    var chips = h('div', { class: 'chips' }), list = h('div', { class: 'chs' }); el.appendChild(chips); el.appendChild(list); list.appendChild(loading());
    liveCats().then(function (cats) {
      var shown = cats.filter(function (c) { return c.channels.length; });
      var cat = shown.filter(function (c) { return c.id === (a.cat || S.liveCat); })[0] || shown.filter(function (c) { return c.id !== 'alle' && !c.parent; })[0] || shown[0];
      if (!cat) { list.innerHTML = '<div class="empty">Geen zenders.</div>'; return; }
      S.liveCat = cat.id;
      shown.forEach(function (c) { chips.appendChild(tap(h('button', { class: 'chip' + (c === cat ? ' on' : '') }, esc(c.name)), function () { S.liveCat = c.id; go('live', { cat: c.id }, true); })); });
      setTimeout(function () { var on = chips.querySelector('.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' }); }, 0);
      var chans = cat.channels.slice(0, 120), now = Date.now();
      get('/api/live/guide?ids=' + chans.map(function (c) { return c.id; }).join(',') + '&from=' + now + '&to=' + (now + 4 * 3600e3)).then(function (g) {
        var by = {}; g.forEach(function (r) { by[r.id] = r.programmes || []; });
        list.innerHTML = '';
        chans.forEach(function (ch) {
          var ps = by[ch.id] || [], cur = ps.filter(function (p) { return p.start <= now && p.end > now; })[0], nxt = ps.filter(function (p) { return p.start > now; })[0];
          var pct = cur ? Math.round((now - cur.start) / (cur.end - cur.start) * 100) : 0;
          var row = h('div', { class: 'ch' }, '<div class="lg" style="' + bg(ch.icon) + '">' + (ch.icon ? '' : ch.num) + '</div><div class="tx"><div class="nm">' + esc(ch.num + '  ' + ch.name) + '</div><div class="now">' + esc(cur ? cur.title : 'Geen gids') + '</div>' +
            (cur ? '<div class="pg"><i style="width:' + pct + '%"></i></div>' : '') + (nxt ? '<div class="nx">' + esc(clock(nxt.start) + '  ' + nxt.title) + '</div>' : '') + '</div>');
          var gd = h('button', { class: 'gd', 'aria-label': 'Gids' }, SVG('<path d="M9 5l7 7-7 7"/>'));
          gd.onclick = function (e) { e.stopPropagation(); go('channel', { ch: ch, cat: cat.id }); };
          row.appendChild(gd);
          row.onclick = function () { playLive(cat.id, ch); };
          list.appendChild(row);
        });
      }).catch(function (e) { list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    }).catch(function (e) { list.innerHTML = '<div class="empty">Live tv is nu niet bereikbaar. ' + esc(e.message) + '</div>'; });
    return el;
  };
  // Eén zender: wat er vandaag en gisteren was en straks komt. Afgelopen programma's terugkijken als de zender dat bewaart.
  screens.channel = function (a) {
    var ch = a.ch, el = h('div', { class: 'screen' }); el.appendChild(backBar('Live'));
    el.appendChild(h('div', { class: 'top', style: 'padding-top:0' }, '<h1>' + esc(ch.name) + '</h1>'));
    var day = a.day || 0, chips = h('div', { class: 'chips' }), list = h('div'); el.appendChild(chips); el.appendChild(list);
    [-1, 0, 1].forEach(function (k) {
      var t0 = new Date(); t0.setHours(0, 0, 0, 0); var d = t0.getTime() + k * 864e5;
      chips.appendChild(tap(h('button', { class: 'chip' + (k === day ? ' on' : '') }, esc(dayName(d + 12 * 36e5))), function () { a.day = k; go('channel', a, true); stack = [{ name: 'live', args: { cat: a.cat } }]; }));
    });
    var t0 = new Date(); t0.setHours(0, 0, 0, 0); var from = t0.getTime() + day * 864e5, now = Date.now();
    list.appendChild(loading());
    get('/api/live/guide?ids=' + ch.id + '&from=' + from + '&to=' + (from + 864e5)).then(function (g) {
      var ps = (g[0] || {}).programmes || []; list.innerHTML = '';
      if (!ps.length) { list.innerHTML = '<div class="empty">Geen gids voor deze dag.</div>'; return; }
      var liveRow = null;
      ps.forEach(function (p) {
        var live = p.start <= now && p.end > now, past = p.end <= now, canBack = past && ch.archive && p.start > now - ch.archive * 864e5;
        var r = h('button', { class: 'prog' + (live ? ' live' : past ? ' past' : ''), style: 'width:100%' }, '<span class="tm">' + clock(p.start) + '</span><span class="ti">' + esc(p.title) + (p.desc ? '<small>' + esc(p.desc.slice(0, 120)) + '</small>' : '') + '</span>' +
          '<span class="act">' + (live ? '● Nu' : canBack ? '↺ Terugkijken' : '') + '</span>');
        r.onclick = function () { if (live) playLive(a.cat, ch); else if (canBack) playCatchup(ch, p, a.cat); else if (past) toast('Deze zender bewaart dit programma niet'); else toast(dayName(p.start) + ' ' + clock(p.start) + ': ' + p.title); };
        if (live) liveRow = r;
        list.appendChild(r);
      });
      if (liveRow) setTimeout(function () { liveRow.scrollIntoView({ block: 'center' }); }, 0);
    }).catch(function (e) { list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    return el;
  };

  // ---------- Bibliotheek (films en series) ----------
  screens.lib = function (a) {
    var kind = a.kind || S.libKind || 'movie'; S.libKind = kind;
    var el = h('div', { class: 'screen' }); el.appendChild(top('Bibliotheek'));
    var chips = h('div', { class: 'chips' });
    [['movie', 'Films'], ['series', 'Series'], ['list', 'Mijn lijst']].forEach(function (k) {
      chips.appendChild(tap(h('button', { class: 'chip' + (k[0] === kind ? ' on' : '') }, k[1]), function () { go('lib', { kind: k[0] }, true); }));
    });
    el.appendChild(chips);
    var body = h('div'); el.appendChild(body); body.appendChild(loading());
    if (kind === 'list') {
      get('/api/mylist?profile=' + S.profile).then(function (l) {
        body.innerHTML = '';
        if (!l.length) { body.innerHTML = '<div class="empty">Je lijst is nog leeg. Zet titels erop via "+ Mijn lijst" op de infopagina.</div>'; return; }
        var g = h('div', { class: 'grid' }); body.appendChild(g);
        l.forEach(function (x) { var m = x.meta || {}; g.appendChild(tap(h('button', { class: 'poster' }, '<div class="th" style="' + bg(m.img) + '"></div><div class="t1">' + esc(m.title) + '</div>'), function () {
          go('info', { type: m.type || 'movie', tmdb: m.tmdb, title: m.title, plex: m.plex || null, vod: m.vod || null, vodKind: m.vodKind || (m.type === 'tv' ? 'series' : 'movie') }); })); });
      }).catch(function (e) { body.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
      return el;
    }
    var again = function () { go('lib', { kind: kind }, true); };
    Promise.all([get('/api/continue?profile=' + S.profile).catch(function () { return []; }), get('/api/catalog/' + kind + '/overview?profile=' + S.profile)]).then(function (r) {
      var o = r[1]; body.innerHTML = '';
      var mine = r[0].filter(function (c) { return c.kind === kind; });
      body.appendChild(section('Verder kijken', mine.map(function (c) { return contCard(c, again); })));
      body.appendChild(section('Nieuw', (o.newest || []).map(function (m) { return poster(m, kind); })));
      body.appendChild(section('Opnames', (o.recordings || []).map(function (m) { return poster(m, kind); })));
      // Genres: alles in dat genre als raster.
      var gs = h('div', { class: 'sec' }, '<h2>Genres</h2>'), gc = h('div', { class: 'chips', style: 'flex-wrap:wrap' });
      (o.genres || []).forEach(function (g) { gc.appendChild(tap(h('button', { class: 'chip' }, esc(g.name) + ' <span class="dim">' + g.count + '</span>'), function () { go('grid', { kind: kind, genre: g.name }); })); });
      gs.appendChild(gc); body.appendChild(gs);
      body.appendChild(tap(h('button', { class: 'btn', style: 'margin:10px 18px' }, 'Alle ' + (kind === 'movie' ? 'films' : 'series')), function () { go('grid', { kind: kind, genre: '' }); }));
    }).catch(function (e) { body.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    return el;
  };
  // Raster: alle titels (of één genre), nieuwste eerst; laadt vanzelf verder als je naar beneden scrolt.
  screens.grid = function (a) {
    var el = h('div', { class: 'screen' }); el.appendChild(backBar('Bibliotheek'));
    el.appendChild(h('div', { class: 'top', style: 'padding-top:0' }, '<h1>' + esc(a.genre || (a.kind === 'movie' ? 'Alle films' : 'Alle series')) + '</h1>'));
    var g = h('div', { class: 'grid' }), more = h('div', { class: 'spin' }, ''); el.appendChild(g); el.appendChild(more);
    var off = 0, total = 1e9, busy = false;
    function load() {
      if (busy || off >= total) return; busy = true; more.textContent = 'Laden…';
      get('/api/catalog/' + a.kind + '/browse?profile=' + S.profile + '&genre=' + encodeURIComponent(a.genre || '') + '&sort=nieuw&alles=1&offset=' + off).then(function (r) {
        total = r.total; off += r.items.length; busy = false; more.textContent = off < total ? '' : total + ' titels';
        r.items.forEach(function (m) { g.appendChild(poster(m, a.kind)); });
      }).catch(function (e) { busy = false; more.textContent = e.message; });
    }
    load();
    var onScroll = function () { if (!document.body.contains(g)) return window.removeEventListener('scroll', onScroll); if (window.innerHeight + window.scrollY > document.body.scrollHeight - 600) load(); };
    window.addEventListener('scroll', onScroll);
    return el;
  };

  // ---------- Zoeken ----------
  screens.search = function (a) {
    var el = h('div', { class: 'screen' }); el.appendChild(top('Zoeken'));
    var box = h('div', { class: 'search' }, '<input type="search" placeholder="Film, serie, zender of programma" enterkeyhint="search" autocomplete="off">'), out = h('div');
    el.appendChild(box); el.appendChild(out);
    var input = box.querySelector('input'), t = 0; input.value = a.q || '';
    function run() {
      var q = input.value.trim(); a.q = q; if (q.length < 2) { out.innerHTML = ''; return; }
      out.innerHTML = ''; out.appendChild(loading());
      get('/api/search?q=' + encodeURIComponent(q)).then(function (r) {
        if (input.value.trim() !== q) return; out.innerHTML = '';
        var g = r.guide || {};
        out.appendChild(section('Films en series', (r.titles || []).map(function (o) { return poster(o, o.kind); })));
        var hits = function (title, list, kind) {
          if (!list || !list.length) return;
          var s = h('div', { class: 'sec' }, '<h2>' + esc(title) + '</h2>');
          list.slice(0, 12).forEach(function (x) {
            var label = kind === 'live' ? '<span class="live">● NU</span> ' : kind === 'later' ? esc(dayName(x.start) + ' ' + clock(x.start)) + ' · ' : kind === 'past' ? '↺ ' + esc(dayName(x.start)) + ' · ' : '';
            var r2 = h('button', { class: 'hit', style: 'width:100%' }, '<div class="lg" style="' + bg(x.icon) + '"></div><div class="tx"><b>' + esc(kind === 'channels' ? x.name : x.title) + '</b><span>' + label + esc(x.name || '') + '</span></div>');
            var ch = { id: x.channel || x.id, name: x.name, archive: x.archive };
            r2.onclick = function () { if (kind === 'channels' || kind === 'live') playLive('alle', ch); else if (kind === 'past') playCatchup(ch, x, 'alle'); else toast(dayName(x.start) + ' ' + clock(x.start) + ' op ' + x.name); };
            s.appendChild(r2);
          });
          out.appendChild(s);
        };
        hits('Nu live', g.live, 'live'); hits('Zenders', g.channels, 'channels'); hits('Straks', g.later, 'later'); hits('Terugkijken', g.past, 'past');
        if (!out.children.length || !out.textContent.trim()) out.innerHTML = '<div class="empty">Niets gevonden voor "' + esc(q) + '".</div>';
      }).catch(function (e) { out.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    }
    input.oninput = function () { clearTimeout(t); t = setTimeout(run, 450); };
    input.onkeydown = function (e) { if (e.key === 'Enter') { input.blur(); run(); } };
    if (a.q) run(); else setTimeout(function () { input.focus(); }, 150);
    return el;
  };

  // ---------- Infopagina ----------
  screens.info = function (a) {
    var el = h('div', { class: 'screen' }), hero = h('div', { class: 'ihero' }), bk = tap(h('button', { class: 'back', 'aria-label': 'Terug' }, SVG('<path d="M15 5l-7 7 7 7"/>')), back);
    hero.appendChild(bk); el.appendChild(hero);
    var txt = h('div', { class: 'itx' }, '<h1>' + esc(a.title) + '</h1>'); el.appendChild(txt);
    var lower = h('div'); el.appendChild(lower);
    var series = a.type === 'tv';
    var src = a.plex ? 'plex:' + a.plex.key : a.vod ? (a.vodKind === 'movie' ? 'movie:' : 'series:') + a.vod.id : '';
    var showQ = series && (a.plex || a.vod) ? get('/api/show?profile=' + S.profile + (a.plex ? '&plex=' + a.plex.key : '&vod=' + a.vod.id)).catch(function () { return null; }) : Promise.resolve(null);
    showQ.then(function (show) {
      var id = a.tmdb || (show && show.tmdb) || 0;
      var idQ = id ? Promise.resolve(id) : get('/api/info-find?type=' + a.type + '&title=' + encodeURIComponent(a.title || '') + '&year=' + encodeURIComponent((a.plex && a.plex.year) || (a.vod && a.vod.year) || '')).then(function (r) { return r.id || 0; }, function () { return 0; });
      return idQ.then(function (tid) { a.tmdb = a.tmdb || tid; return Promise.all([tid ? get('/api/info/' + a.type + '/' + tid).catch(function () { return null; }) : null,
        get('/api/mylist?profile=' + S.profile).catch(function () { return []; }),
        !series && src ? get('/api/watched?profile=' + S.profile + '&key=' + encodeURIComponent(src)).catch(function () { return {}; }) : {}, show]); });
    }).then(function (r) {
      var d = r[0] || {}, seen = !!r[2].on, show = r[3], inList = r[1].some(function (x) { return x.key === (src || 'tmdb:' + a.type + a.tmdb); });
      var bgMain = d.backdrop || (show && show.backdrop) || (a.plex && a.plex.art) || (a.vod && a.vod.backdrop);
      var setBg = function (u) { if (u) hero.style.backgroundImage = "url('" + img(u).replace(/'/g, '%27') + "')"; };
      setBg(bgMain);
      var n = show ? show.seasons.length : 0;
      var meta = [d.year || (a.vod && a.vod.year), n ? n + ' seizoen' + (n > 1 ? 'en' : '') : d.runtime ? d.runtime + ' min' : '', d.age,
        d.ratings && d.ratings.imdb ? 'IMDb ' + String(d.ratings.imdb).replace('.', ',') : d.rating ? '★ ' + d.rating.toFixed(1).replace('.', ',') : '', (d.genres || []).slice(0, 2).join(' · ')].filter(Boolean);
      txt.innerHTML = '<h1>' + esc(d.title || a.title) + '</h1><div class="meta">' + meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div>' +
        '<p class="desc">' + esc(d.overview || (show && show.plot) || (a.plex && a.plex.summary) || (a.vod && a.vod.plot) || '') + '</p>';
      var bt = h('div', { class: 'btns' });
      function playEp(s, e) {
        if (a.plex) playPlex(e.key, { title: d.title || a.title, sub: 'S' + s.season + ' · afl. ' + e.num, img: e.img });
        else playEpisode({ id: a.vod.id, name: d.title || a.title, tmdb: a.tmdb, backdrop: show.backdrop, icon: a.vod.icon }, s.season, e);
      }
      function epItem(s, e) { return { key: e.skey, seriesKey: a.vod ? 'series:' + a.vod.id : '', kind: 'series', tmdb: a.tmdb || (show && show.tmdb) || 0, season: +s.season, episode: e.num, meta: { title: d.title || a.title, sub: 'S' + s.season + ' · afl. ' + e.num, img: e.img || '', tmdb: a.tmdb } }; }
      var srcBtn = function (cls, label, fn, main) { return tap(h('button', { class: 'btn' + (main ? ' main' : '') }, '<i class="ic ' + cls + '"></i>' + esc(label)), fn); };
      if (series && show) { var nx = nextUp(show); if (nx) bt.appendChild(srcBtn(a.plex ? 'plex' : 'iptv', nx.label + ' · S' + nx.s.season + ' afl. ' + nx.e.num, function () { playEp(nx.s, nx.e); }, true)); }
      else if (!series) {
        if (a.plex) bt.appendChild(srcBtn('plex', 'Afspelen via Plex', function () { playPlex(a.plex.key, a.plex); }, true));
        if (a.vod) bt.appendChild(srcBtn('iptv', 'Afspelen via IPTV', function () { playMovie(Object.assign({}, a.vod, { tmdb: a.vod.tmdb || a.tmdb || 0 })); }, !a.plex));
      }
      if (!a.plex && !a.vod) bt.appendChild(h('div', { class: 'dim' }, 'Nog niet te zien in Sjuul TV.'));
      var two = h('div', { class: 'two' });
      if (!series && src) two.appendChild(tap(h('button', { class: 'btn' }, seen ? '✓ Bekeken' : 'Bekeken'), function () {
        var b = this; seen = !seen; setWatched([{ key: src, kind: 'movie', meta: { title: d.title || a.title, img: d.backdrop || '', tmdb: a.tmdb, type: 'movie' } }], seen).then(function () { b.textContent = seen ? '✓ Bekeken' : 'Bekeken'; });
      }));
      two.appendChild(tap(h('button', { class: 'btn' }, inList ? '✓ Mijn lijst' : '+ Mijn lijst'), function () {
        var b = this; api('POST', '/api/mylist', { profile: S.profile, key: src || 'tmdb:' + a.type + a.tmdb, meta: { title: d.title || a.title, img: d.poster || '', type: a.type, tmdb: a.tmdb, plex: a.plex || null, vod: a.vod || null, vodKind: a.vodKind || '' } })
          .then(function (r2) { b.textContent = r2.inList ? '✓ Mijn lijst' : '+ Mijn lijst'; toast(r2.inList ? 'Op je lijst gezet' : 'Van je lijst gehaald'); });
      }));
      if (d.trailer) two.appendChild(tap(h('button', { class: 'btn' }, 'Trailer'), function () { if (N) N.openUrl('https://www.youtube.com/watch?v=' + d.trailer); }));
      bt.appendChild(two); txt.appendChild(bt);
      // Seizoenen en afleveringen
      if (series && show && show.seasons.length) {
        var st = a.st || (a.st = { season: Math.max(0, show.seasons.indexOf((nextUp(show) || {}).s)) });
        var pills = h('div', { class: 'chips', style: 'margin-top:18px' }), eps = h('div');
        show.seasons.forEach(function (s, i) { pills.appendChild(tap(h('button', { class: 'chip' }, 'Seizoen ' + esc(s.season) + (s.episodes.every(function (e) { return e.watched; }) ? ' ✓' : '')), function () { st.season = i; paint(); })); });
        lower.appendChild(pills); lower.appendChild(eps);
        var paint = function () {
          [].forEach.call(pills.children, function (p, i) { p.classList.toggle('on', i === st.season); });
          var s = show.seasons[st.season]; setBg((d.seasonArt || {})[s.season] || bgMain); eps.innerHTML = '';
          s.episodes.forEach(function (e) {
            var t = e.title && !/^(aflevering|episode)\s*\d+$/i.test(e.title) ? e.title : 'Aflevering ' + e.num;
            var row = h('button', { class: 'ep', style: 'width:100%;text-align:left' }, '<div class="th" style="' + bg(e.img || show.backdrop) + '">' + (!e.watched && e.progress > 0.03 ? '<div class="bar"><i style="width:' + Math.round(e.progress * 100) + '%"></i></div>' : '') + '</div>' +
              '<div class="tx"><b>' + e.num + '. ' + esc(t) + '</b><span>' + [e.dur ? Math.round(e.dur / 60) + ' min' : '', e.watched ? '✓ Bekeken' : ''].filter(Boolean).join(' · ') + '</span>' + (e.plot ? '<p>' + esc(e.plot) + '</p>' : '') + '</div>');
            row.onclick = function () { sheet('S' + s.season + ' afl. ' + e.num, [['Afspelen', function () { playEp(s, e); }], ['Vanaf het begin', function () { S.fromStart = true; playEp(s, e); }],
              [e.watched ? 'Markeer als niet bekeken' : 'Markeer als bekeken', function () { setWatched([epItem(s, e)], !e.watched).then(function () { e.watched = !e.watched; e.progress = 0; paint(); }); }]]); };
            eps.appendChild(row);
          });
        };
        paint();
      }
      // Extra's en trailers, cast, Over, en als laatste Meer zoals dit (zelfde volgorde als op de tv).
      var slot = {}; ['extras', 'vid', 'cast', 'over', 'rel'].forEach(function (k) { slot[k] = h('div'); lower.appendChild(slot[k]); });
      var wideCard = function (title, sub, pic, fn) { return tap(h('button', { class: 'wide' }, '<div class="th" style="' + bg(pic) + '"></div><div class="t1">' + esc(title) + '</div><div class="t2">' + esc(sub) + '</div>'), fn); };
      if (a.plex && a.plex.key) get('/api/plex/extras/' + a.plex.key).then(function (l) {
        slot.extras.appendChild(section("Extra's", l.map(function (x) { return wideCard(x.title, x.minutes ? x.minutes + ' min' : 'Extra', x.img, function () { playPlex(x.key, { title: x.title, sub: d.title || a.title }); }); })));
      }, function () {});
      slot.vid.appendChild(section('Trailers en meer', (d.videos || []).map(function (v) { return wideCard(v.name, v.type, v.img, function () { if (N) N.openUrl('https://www.youtube.com/watch?v=' + v.key); }); })));
      slot.cast.appendChild(section('Cast en crew', (d.cast || []).map(function (c) { return h('div', { class: 'cast' }, '<div class="ph" style="' + bg(c.photo) + '"></div><b>' + esc(c.name) + '</b><span>' + esc(c.role || '') + '</span>'); })));
      var story = d.story && d.story.text, plain = [d.overview, show && show.plot, a.plex && a.plex.summary, a.vod && a.vod.plot].filter(Boolean).sort(function (x, y) { return y.length - x.length; })[0] || '';
      var facts = [['Regie', d.director], ['Schrijvers', d.writers], ['Verschenen', d.date ? new Date(d.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''], ['Land', (d.countries || []).join(', ')], ['Leeftijd', d.age]].filter(function (f) { return f[1]; });
      if (story || plain || facts.length) {
        var ab = h('div', { class: 'sec' }, '<h2>Over</h2>'), card = h('div', { class: 'about' }, (story || plain).split(/\n\n+/).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + (story ? '<div class="src">Bron: Wikipedia</div>' : '') +
          (facts.length ? '<dl>' + facts.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('') + '</dl>' : ''));
        ab.appendChild(card); slot.over.appendChild(ab);
      }
      slot.rel.appendChild(section('Meer zoals dit', (d.related || []).map(function (x) {
        var type = String(x.id || '').indexOf('tv') === 0 ? 'tv' : 'movie';
        return tap(h('button', { class: 'poster' }, '<div class="th" style="' + bg(x.poster) + '">' + (x.sources ? badges(x) : '') + '</div><div class="t1">' + esc(x.title) + '</div><div class="t2">' + esc(x.year || '') + '</div>'), function () {
          go('info', { type: type, tmdb: x.tmdb, title: x.title, plex: x.plex || null, vod: x.vod || null, vodKind: type === 'tv' ? 'series' : 'movie' });
        });
      })));
    }).catch(function (e) { lower.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    return el;
  };

  // ---------- Instellingen ----------
  screens.settings = function () {
    var el = h('div', { class: 'screen' }); el.appendChild(backBar('Terug'));
    el.appendChild(h('div', { class: 'top', style: 'padding-top:0' }, '<h1>Instellingen</h1>'));
    var srv = info();
    var l = h('div', { class: 'list' }); el.appendChild(l);
    l.appendChild(h('div', { class: 'r' }, '<span>Versie</span><span class="v">Sjuul TV ' + esc(N ? N.appVersion() : 'webversie') + '</span>'));
    l.appendChild(h('div', { class: 'r' }, '<span>tv-serverr</span><span class="v">' + esc(srv.url || '') + '</span>'));
    l.appendChild(h('div', { class: 'r' }, '<span>Dit apparaat</span><span class="v">' + esc(S.device ? S.device.device : '') + '</span>'));
    var l2 = h('div', { class: 'list' }); el.appendChild(l2);
    // Webversie: bijwerken gaat vanzelf, want de pagina komt altijd vers van tv-serverr.
    if (N) l2.appendChild(tap(h('button', null, '<span>Zoeken naar een nieuwe versie</span><span class="v">›</span>'), function () {
      toast('Even kijken…');
      native('checkUpdate').then(function (t) {
        var u = JSON.parse(t); if (!u.newer) return toast('Je hebt de nieuwste versie (' + u.current + ')');
        toast('Sjuul TV ' + u.latest + ' wordt gedownload…', 8000);
        native('installUpdate').then(function (r) { toast(r === 'permission' ? 'Sta het installeren van apps toe en kies daarna opnieuw' : 'Bezig met bijwerken. De app gaat zo even dicht, open hem daarna opnieuw.', 8000); }, function (e) { toast('Bijwerken lukt niet: ' + e.message, 8000); });
      }, function (e) { toast('Zoeken lukt niet: ' + e.message); });
    }));
    l2.appendChild(tap(h('button', null, '<span>Ontkoppelen</span><span class="v">›</span>'), function () {
      sheet('Deze telefoon ontkoppelen?', [['Ja, ontkoppelen', function () { K.unpair().then(function () { S.profile = 0; go('pair', {}, true); }); }], ['Annuleren', function () {}]]);
    }));
    return el;
  };

  // ---------- Koppelen en wie kijkt er ----------
  screens.pair = function () {
    var el = h('div', { class: 'screen' }, '<div class="top"><h1>Sjuul TV koppelen</h1></div>');
    // Webversie: het adres is gewoon deze pagina; wel een naam, zodat je in beheer ziet welk apparaat het is.
    var f = h('div', { class: 'form' }, '<div class="dim">Open de beheerpagina van tv-serverr, kies "Nieuwe code" en typ die hier in. Onderweg: zet eerst je VPN naar huis aan.</div>' +
      (N ? '<label>Adres van tv-serverr</label><input id="u" inputmode="url" autocomplete="off">' : '<label>Naam van dit apparaat</label><input id="u" autocomplete="off" placeholder="Bijvoorbeeld iPad">') +
      '<label>Code</label><input id="c" inputmode="numeric" autocomplete="one-time-code"><div class="err" id="err"></div>');
    var go2 = h('button', { class: 'btn main' }, 'Koppelen'); f.appendChild(go2); el.appendChild(f);
    if (N) f.querySelector('#u').value = info().url || '';
    go2.onclick = function () {
      var u = f.querySelector('#u').value.trim(), c = f.querySelector('#c').value.trim(); f.querySelector('#err').textContent = '';
      (N ? K.pair(u, c, 'Telefoon') : K.pair('', c, u || 'Browser')).then(function () { boot(); }, function (e) { f.querySelector('#err').textContent = e.message; });
    };
    return el;
  };
  screens.who = function () {
    var el = h('div', { class: 'screen' }, '<div class="top"><h1>Wie kijkt er?</h1></div>'), w = h('div', { class: 'who' });
    S.profiles.forEach(function (p) { w.appendChild(tap(h('button', null, '<img alt="" src="' + esc(img(p.avatarUrl)) + '"><span>' + esc(p.name) + '</span>'), function () { setProfile(p.id); go('home', {}, true); })); });
    el.appendChild(w); return el;
  };

  // ---------- opstarten ----------
  function boot() {
    var srv = info();
    if (!srv.paired) return go('pair', {}, true);
    S.profile = srv.profile || 0;
    Promise.all([get('/api/whoami'), get('/api/profiles')]).then(function (r) {
      S.device = r[0]; S.profiles = r[1];
      if (S.device.profile && !S.profile) setProfile(S.device.profile);
      if (!S.profiles.some(function (p) { return p.id === S.profile; })) S.profile = 0;
      // Telefoon is van één persoon: één keer kiezen wie je bent, daarna meteen naar Home.
      go(S.profile ? 'home' : 'who', {}, true);
    }).catch(function (e) {
      if (e.message === 'NIET_GEKOPPELD') return;
      $tabs.hidden = true;
      $app.innerHTML = '<div class="top"><h1>Geen verbinding</h1></div><div class="empty">tv-serverr is niet bereikbaar. Ben je onderweg? Zet dan je VPN naar huis aan.<br><br>' + esc(e.message) + '</div>';
      var b = h('button', { class: 'btn main', style: 'margin:0 18px' }, 'Opnieuw proberen'); b.onclick = boot; $app.appendChild(b);
    });
  }
  boot();
})();

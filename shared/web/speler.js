/* Sjuul TV: de gedeelde speler. Eén knoppenbalk en één manier van werken op elk apparaat.
   Onder de knoppen zit per apparaat een motor: nu de videospeler van de browser (Safari op iPad en iPhone),
   die via de server HLS krijgt; later ook AVPlay (Samsung) en ExoPlayer (Android).
   Bediening: aanraken, of pijltjes, OK en terug. */
(function () {
  'use strict';
  var K = window.Kern, S = K.S, esc = K.esc, h = K.h, clock = K.clock, get = K.get, api = K.api;
  var el = null, v = null, cur = null, hideT = 0, tickT = 0, lastReport = 0, busy = false;

  // ---------- motor: videospeler van de browser, HLS via tv-serverr ----------
  // src: ondertekende /stream/-link. from: seconden vanaf het begin van de bron. Geeft de lengte terug (0 bij live).
  var hlsId = '';
  function load(src, from, live) {
    busy = true; spin(true);
    return api('POST', '/api/hls/start', { src: src, from: live ? 0 : Math.floor(from || 0), low: !!S.low }).then(function (r) {
      hlsId = r.id;
      v.src = r.url; v.play().catch(function () {});
      busy = false; return r.dur;
    }, function (e) { busy = false; spin(false); throw e; });
  }
  function stopEngine() {
    if (hlsId) { api('POST', '/api/hls/stop', { id: hlsId }).catch(function () {}); hlsId = ''; }
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  }

  // ---------- opbouw ----------
  var I = {
    play: '<path d="M8 5v14l11-7z" fill="currentColor"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>',
    back10: '<path d="M11 5L6 9l5 4" /><path d="M6 9h8a5 5 0 1 1 0 10h-3"/>', fwd30: '<path d="M13 5l5 4-5 4"/><path d="M18 9h-8a5 5 0 1 0 0 10h3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    talk: '<path d="M4 5h16v11H9l-5 4z"/>', restart: '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/>'
  };
  var svg = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  function btn(icon, label, fn, cls) { var b = h('button', { class: 'sb ' + (cls || ''), 'aria-label': label }, svg(I[icon])); b.onclick = function (e) { e.stopPropagation(); fn(); show(); }; return b; }

  function build() {
    el = h('div', { class: 'sp' });
    v = h('video', { playsinline: '', 'webkit-playsinline': '', preload: 'auto' });
    el.appendChild(v);
    el.appendChild(h('div', { class: 'sp-spin' }));
    var top = h('div', { class: 'sp-top' }, '<div class="sp-tt"><b></b><span></span></div>');
    top.appendChild(btn('close', 'Sluiten', close, 'x'));
    var mid = h('div', { class: 'sp-mid' }), bot = h('div', { class: 'sp-bot' }, '<div class="sp-bar"><i class="b"></i><i class="p"></i><s></s></div><div class="sp-time"><span class="l"></span><span class="r"></span></div>');
    var row = h('div', { class: 'sp-row' });
    bot.appendChild(row);
    el.appendChild(top); el.appendChild(mid); el.appendChild(bot);
    el.onclick = function () { if (el.classList.contains('osd')) hide(); else show(); };
    // Spoelen: over de balk schuiven, loslaten = daarheen.
    var bar = bot.querySelector('.sp-bar'), dragging = false;
    function frac(e) { var r = bar.getBoundingClientRect(), x = (e.touches ? e.touches[0] : e).clientX; return Math.min(1, Math.max(0, (x - r.left) / r.width)); }
    function drag(e) { if (!cur || cur.live) return; e.preventDefault(); e.stopPropagation(); dragging = frac(e); paintBar(dragging * cur.dur); show(); }
    bar.addEventListener('touchstart', drag, { passive: false }); bar.addEventListener('touchmove', drag, { passive: false });
    bar.addEventListener('mousedown', function (e) { drag(e); var mv = function (e2) { drag(e2); }, up = function () { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); end(); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); });
    function end() { if (dragging !== false) { var f = dragging; dragging = false; seekTo(f * cur.dur); } }
    bar.addEventListener('touchend', function (e) { e.stopPropagation(); end(); });
    bar.onclick = function (e) { e.stopPropagation(); };
    v.addEventListener('playing', function () { spin(false); paintPlay(); });
    v.addEventListener('waiting', function () { spin(true); });
    v.addEventListener('pause', paintPlay); v.addEventListener('play', paintPlay);
    v.addEventListener('ended', function () { if (cur && !cur.live) { report('stopped'); close(); } });
    v.addEventListener('error', function () { if (busy || !cur) return; spin(false); msg('Afspelen lukt niet. Probeer het opnieuw.'); });
    document.body.appendChild(el);
    document.addEventListener('keydown', key, true);
  }
  function spin(on) { if (el) el.classList.toggle('busy', !!on); }
  function msg(t) { K.ui.toast(t); }
  function paintPlay() {
    var p = el.querySelector('.sb.pp'); if (p) p.innerHTML = svg(v.paused ? I.play : I.pause);
    if (v.paused) show(true);
  }
  function show(stay) {
    el.classList.add('osd'); clearTimeout(hideT);
    if (!stay && !v.paused) hideT = setTimeout(hide, 4000);
  }
  function hide() { if (!v.paused) el.classList.remove('osd'); }

  // ---------- tijd en balk ----------
  function pos() { return cur ? cur.base + (v.currentTime || 0) : 0; }
  function fmt(s) { s = Math.max(0, Math.floor(s)); var hh = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60; return (hh ? hh + ':' + K.pad(m) : m) + ':' + K.pad(ss); }
  function paintBar(at) {
    var b = el.querySelector('.sp-bar'), l = el.querySelector('.sp-time .l'), r = el.querySelector('.sp-time .r');
    if (cur.live) {
      var p = cur.prog; if (!p) { b.style.visibility = 'hidden'; l.textContent = ''; r.textContent = ''; return; }
      b.style.visibility = ''; var now = Date.now();
      b.querySelector('.p').style.width = Math.min(100, (now - p.start) / (p.end - p.start) * 100) + '%'; b.querySelector('.b').style.width = '0';
      b.querySelector('s').style.left = Math.min(100, (now - p.start) / (p.end - p.start) * 100) + '%';
      l.textContent = clock(p.start); r.textContent = clock(p.end); return;
    }
    var d = cur.dur || 0; b.style.visibility = d ? '' : 'hidden'; if (!d) return;
    var f = Math.min(1, (at == null ? pos() : at) / d), buf = 0;
    try { if (v.buffered.length) buf = (cur.base + v.buffered.end(v.buffered.length - 1)) / d; } catch (e) {}
    b.querySelector('.p').style.width = f * 100 + '%'; b.querySelector('.b').style.width = Math.min(1, buf) * 100 + '%'; b.querySelector('s').style.left = f * 100 + '%';
    l.textContent = fmt(f * d); r.textContent = '-' + fmt(d - f * d);
  }
  function tick() {
    if (!cur) return;
    paintBar();
    if (!cur.live && Date.now() - lastReport > 10e3 && v.currentTime > 0) { lastReport = Date.now(); report(v.paused ? 'paused' : 'playing'); }
    if (cur.live && cur.prog && Date.now() > cur.prog.end) nowNext();
  }

  // ---------- spoelen ----------
  // Binnen wat al omgezet is: meteen. Verder weg of terug voor het begin: de server begint opnieuw vanaf dat punt.
  function seekTo(sec) {
    if (!cur || cur.live) return;
    sec = Math.max(0, Math.min(sec, (cur.dur || sec + 1) - 3));
    var rel = sec - cur.base, end = 0;
    try { end = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0; } catch (e) {}
    if (rel >= 0 && rel <= end - 2) { v.currentTime = rel; return; }
    cur.reseek(sec).then(function () { if (cur && cur.subs) useSubs(cur.subs); }, function (e) { msg('Spoelen lukt niet: ' + e.message); });
  }
  function skip(d) { seekTo(pos() + d); }

  // ---------- kijkstand naar de server, net als de Android-spelers ----------
  function report(state) {
    if (!cur || cur.live || !cur.item || !cur.dur) return;
    var it = cur.item;
    api('POST', '/api/progress', { profile: S.profile, key: it.key, seriesKey: it.seriesKey || '', kind: it.kind, plexKey: it.plexKey || (it.meta && it.meta.plexKey) || '',
      pos: Math.round(pos() * 1000), dur: Math.round(cur.dur * 1000), state: state, meta: it.meta || {}, tmdb: it.tmdb || 0, season: it.season || 0, episode: it.episode || 0 }).catch(function () {});
  }

  // ---------- ondertitels ----------
  function srtToVtt(t) { return 'WEBVTT\n\n' + String(t).replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2'); }
  function useSubs(text, label) {
    [].slice.call(v.querySelectorAll('track')).forEach(function (t) { t.remove(); });
    if (!text) return;
    // Bij spoelen begint de bron opnieuw; tijden schuiven mee met het beginpunt.
    var vtt = srtToVtt(text).replace(/(\d\d):(\d\d):(\d\d)\.(\d\d\d)/g, function (m, a, b, c, d) {
      var s = Math.max(0, (+a) * 3600 + (+b) * 60 + (+c) + (+d) / 1000 - cur.base);
      return K.pad(Math.floor(s / 3600)) + ':' + K.pad(Math.floor(s / 60) % 60) + ':' + K.pad(Math.floor(s % 60)) + '.' + ('00' + Math.round((s % 1) * 1000)).slice(-3);
    });
    var t = h('track', { kind: 'subtitles', label: label || 'Ondertitels', srclang: 'nl', default: '' });
    t.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    v.appendChild(t);
    setTimeout(function () { if (v.textTracks[0]) v.textTracks[0].mode = 'showing'; }, 50);
  }
  function rawText(path) { return fetch(path, { credentials: 'same-origin', headers: { 'X-Thuis': '1' } }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }); }
  function subsMenu() {
    var it = cur.item, items = [['Uit', function () { cur.subs = ''; useSubs(''); }]];
    (it.subs || []).filter(function (s) { return /srt|subrip/i.test(s.codec || 'srt'); }).forEach(function (s) {
      items.push([s.label || s.lang || 'Ondertitels', function () { rawText(s.url).then(function (t) { cur.subs = t; useSubs(t, s.label); }, function () { msg('Deze ondertitels lukken niet'); }); }]);
    });
    items.push(['Nederlands zoeken (OpenSubtitles)', function () {
      msg('Even zoeken…');
      get('/api/subs/search?kind=' + encodeURIComponent(it.kind || '') + '&title=' + encodeURIComponent(it.title || '') + '&tmdbId=' + (it.tmdb || 0) + '&season=' + (it.season || 0) + '&episode=' + (it.episode || 0)).then(function (l) {
        var nl = l.filter(function (x) { return x.lang === 'nl'; })[0];
        if (!nl) return msg('Geen Nederlandse ondertitels gevonden');
        return rawText('/api/subs/file/' + nl.fileId).then(function (t) { cur.subs = t; useSubs(t, 'Nederlands'); msg('Nederlandse ondertitels geladen'); });
      }).catch(function (e) { msg('Zoeken lukt niet: ' + e.message); });
    }]);
    K.ui.sheet('Ondertitels', items);
  }

  // ---------- live: zappen, zenderlijst, vanaf het begin ----------
  function nowNext() {
    var ch = cur.ch, id = ch.id;
    get('/api/live/nownext?ids=' + id).then(function (r) {
      if (!cur || !cur.live || cur.ch.id !== id) return;
      var now = Date.now(); cur.prog = (r[id] || []).filter(function (p) { return p.start <= now && p.end > now; })[0] || null;
      el.querySelector('.sp-tt span').textContent = cur.prog ? cur.prog.title : ''; paintBar();
    }).catch(function () {});
  }
  function zap(d) {
    var l = cur.list || [], i = l.map(function (c) { return c.id; }).indexOf(cur.ch.id);
    if (!l.length) return; tune(l[(i + d + l.length) % l.length]);
  }
  function tune(ch) {
    cur.ch = ch; cur.prog = null; cur.base = 0;
    el.querySelector('.sp-tt b').textContent = (ch.num ? ch.num + '  ' : '') + ch.name; el.querySelector('.sp-tt span').textContent = '';
    liveRow(); show(); nowNext();
    get('/api/live/url/' + ch.id).then(function (r) { return load(r.url, 0, true); }).catch(function (e) { msg('Deze zender lukt nu niet: ' + e.message); });
  }
  function channelList() {
    K.ui.sheet('Zenders', (cur.list || []).map(function (c) { return [(c.num ? c.num + '  ' : '') + c.name, function () { tune(c); }]; }));
  }
  // Terugkijken: vanaf het begin van een programma. Spoelen vraagt een nieuwe link vanaf dat moment.
  function catchup(ch, p, at) {
    cur.live = false; cur.ch = ch; cur.prog = p; cur.dur = (p.end - p.start) / 1000; cur.item = null;
    el.querySelector('.sp-tt b').textContent = ch.name; el.querySelector('.sp-tt span').textContent = '↺ ' + (p.title || '');
    function at2(sec) {
      return get('/api/live/catchup/' + ch.id + '?start=' + Math.round(p.start + sec * 1000) + '&end=' + p.end).then(function (r) { cur.base = sec; return load(r.url, 0, false); });
    }
    cur.reseek = at2;
    catchRow(); show();
    return at2(at || 0);
  }

  // ---------- knoppen per soort ----------
  function vodRow() {
    var row = el.querySelector('.sp-row'), mid = el.querySelector('.sp-mid'); row.innerHTML = ''; mid.innerHTML = '';
    mid.appendChild(btn('back10', '10 seconden terug', function () { skip(-10); }));
    mid.appendChild(btn('play', 'Afspelen of pauzeren', toggle, 'pp big'));
    mid.appendChild(btn('fwd30', '30 seconden verder', function () { skip(30); }));
    if (cur.item) row.appendChild(btn('talk', 'Ondertitels', subsMenu));
    paintPlay();
  }
  function catchRow() {
    vodRow();
    var row = el.querySelector('.sp-row');
    row.insertBefore(textBtn('● Live', function () { cur.live = true; cur.dur = 0; tune(cur.ch); }), row.firstChild);
  }
  function liveRow() {
    var row = el.querySelector('.sp-row'), mid = el.querySelector('.sp-mid'); row.innerHTML = ''; mid.innerHTML = '';
    mid.appendChild(btn('up', 'Vorige zender', function () { zap(-1); }));
    mid.appendChild(btn('play', 'Afspelen of pauzeren', toggle, 'pp big'));
    mid.appendChild(btn('down', 'Volgende zender', function () { zap(1); }));
    row.appendChild(textBtn('Zenders', channelList));
    if (cur.ch.archive) row.appendChild(textBtn('↺ Vanaf begin', function () { if (cur.prog) catchup(cur.ch, cur.prog, 0).catch(function (e) { msg(e.message); }); else msg('Geen programma bekend'); }));
    paintPlay();
  }
  function textBtn(t, fn) { var b = h('button', { class: 'st' }, esc(t)); b.onclick = function (e) { e.stopPropagation(); fn(); show(); }; return b; }
  function toggle() { if (v.paused) v.play().catch(function () {}); else v.pause(); }

  // ---------- openen en sluiten ----------
  function open() {
    if (!el) build();
    clearInterval(tickT); tickT = setInterval(tick, 1000);
    el.hidden = false; document.documentElement.classList.add('sp-open');
    if (!K.N) history.pushState({ speler: 1 }, '');   // terugvegen sluit de speler
    show();
  }
  function close(fromHistory) {
    if (!cur) return;
    // Webversie: via de browsergeschiedenis, die roept close(true) aan. Zo blijft terugvegen kloppen.
    if (!K.N && !fromHistory) return history.back();
    report('stopped'); stopEngine(); useSubs('');
    cur = null; clearInterval(tickT); el.hidden = true; document.documentElement.classList.remove('sp-open');
  }
  function key(e) {
    if (!cur || el.hidden) return;
    var k = e.key, used = true;
    if (k === 'Escape' || k === 'Backspace' || k === 'GoBack') { if (el.classList.contains('osd') && !v.paused) hide(); else close(); }
    else if (k === ' ' || k === 'Enter' || k === 'MediaPlayPause') { if (!el.classList.contains('osd')) show(); else if (k === ' ') toggle(); else used = false; }
    else if (k === 'ArrowLeft' && !cur.live) skip(-10);
    else if (k === 'ArrowRight' && !cur.live) skip(30);
    else if (k === 'ArrowUp' && cur.live) zap(-1);
    else if (k === 'ArrowDown' && cur.live) zap(1);
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); show(); }
  }

  // item zoals kern.js het samenstelt (Plex, IPTV-film, aflevering). offsetMs = waar je was.
  function vod(item) {
    open();
    cur = { item: item, live: false, base: 0, dur: 0 };
    cur.reseek = function (sec) { cur.base = sec; return load(item.url, sec, false); };
    el.querySelector('.sp-tt b').textContent = (item.meta && item.meta.title) || item.title || '';
    el.querySelector('.sp-tt span').textContent = (item.meta && item.meta.sub) || item.sub || '';
    vodRow();
    var from = Math.floor((item.offsetMs || 0) / 1000); cur.base = from;
    load(item.url, from, false).then(function (d) { cur.dur = d || 0; paintBar(); }, function (e) { msg('Afspelen lukt niet: ' + e.message); close(); });
  }
  // Live of terugkijken (start > 0). catId: de categorie waarin je zapt.
  function live(catId, chId, start, end, title) {
    open();
    cur = { live: true, base: 0, dur: 0, list: [], ch: { id: chId, name: '' } };
    var cats = S.cats ? Promise.resolve(S.cats) : get('/api/live/categories').then(function (c) { S.cats = c; S.catsAt = Date.now(); return c; });
    cats.then(function (cs) {
      var c = cs.filter(function (x) { return x.id === catId; })[0] || cs.filter(function (x) { return x.id === 'alle'; })[0] || cs[0] || { channels: [] };
      cur.list = c.channels;
      var ch = c.channels.filter(function (x) { return x.id === chId; })[0] || cur.ch;
      if (start) { cur.ch = ch; return catchup(ch, { start: start, end: end, title: title }, 0); }
      tune(ch);
    }).catch(function (e) { msg('Live tv lukt nu niet: ' + e.message); close(); });
  }

  window.Speler = { vod: vod, live: live, isOpen: function () { return !!cur; }, close: close };
})();

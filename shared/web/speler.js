/* Sjuul TV: de gedeelde speler. Ziet eruit en werkt precies als de spelers op de JBL (VodActivity en PlayerActivity):
   - film/aflevering: onderbalk met titel, voortgang en ronde knoppen; keuzekaart rechts (ondertitels, geluid, meer);
   - live: balk met zender, programma en tijden; knoppenrij na OK; zenderlijst links; gids als raster met het beeld rechtsboven.
   Onder de knoppen zit per apparaat een motor:
   - browser (iPad, iPhone): HLS van tv-serverr, die de bron omzet (staat hieronder);
   - Samsung (testapp): AVPlay, en straks Android: ExoPlayer. De schil van dat apparaat zet die klaar als window.SpelerMotor.
   Bediening: pijltjes, OK en terug, of aanraken. */
(function () {
  'use strict';
  var K = window.Kern, S = K.S, esc = K.esc, h = K.h, get = K.get, api = K.api;
  var el = null, E = null, cur = null, ev = {};
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var hhmm = function (t) { var d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };

  // ---------- talen ----------
  var LANG = { nl: 'Nederlands', nld: 'Nederlands', dut: 'Nederlands', en: 'Engels', eng: 'Engels', de: 'Duits', deu: 'Duits', ger: 'Duits', fr: 'Frans', fra: 'Frans', fre: 'Frans',
    es: 'Spaans', spa: 'Spaans', it: 'Italiaans', ita: 'Italiaans', da: 'Deens', dan: 'Deens', sv: 'Zweeds', swe: 'Zweeds', no: 'Noors', nor: 'Noors', tr: 'Turks', tur: 'Turks', pl: 'Pools', pol: 'Pools' };
  function lang(c) { c = String(c || '').toLowerCase(); return LANG[c] || (c && c !== 'und' ? c.toUpperCase() : ''); }
  var isNl = function (c) { return /^(nl|nld|dut)$/i.test(c || ''); };
  function trackLabel(t, i) { return [t.title, lang(t.lang)].filter(Boolean).join(' · ') || 'Spoor ' + (i + 1); }

  // ---------- motor van de browser: HLS via tv-serverr ----------
  // Elke motor: load(src, from, live, audio) -> Promise(lengte in s, 0 bij live), time(), buffered(), seek(s) -> Promise, paused(), play(), pause(), stop().
  // Optioneel: audio() [{label, lang, codec, on}], setAudio(i), rect(r) (beeld klein in de gids; null = schermvullend).
  function browserMotor(root) {
    var v = h('video', { playsinline: '', 'webkit-playsinline': '', preload: 'auto' }), base = 0, id = '', src = '', live = false, aud = [], ai = 0;
    root.insertBefore(v, root.firstChild);
    // Kan deze browser HEVC (H.265) afspelen? Zo niet, dan zet de server het beeld om naar H.264.
    var hevc = !!v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"');
    ['playing', 'waiting', 'pause', 'play', 'ended', 'error'].forEach(function (n) { v.addEventListener(n, function () { if (ev[n]) ev[n](); }); });
    // iPhone en iPad: afspelen mag alleen vlak na een tik. Het omzetten op de server duurt soms een paar seconden,
    // dan is die tik "verlopen" en blijft het beeld stilstaan. Daarom de video al bij de eerste tik vrijgeven.
    // Alleen zolang er niets speelt, anders zou elke tik de film pauzeren.
    function vrijgeven() { if (v.getAttribute('src')) return; var p = v.play(); if (p) p.catch(function () {}); v.pause(); }
    document.addEventListener('touchend', vrijgeven, true); document.addEventListener('click', vrijgeven, true);
    // Lukt starten toch niet, dan zeggen dat je zelf op afspelen moet tikken (in plaats van stil beeld).
    function start() { var p = v.play(); if (p) p.catch(function (e) { if (e && e.name === 'NotAllowedError' && ev.blocked) ev.blocked(); }); }
    function end() { try { return v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0; } catch (e) { return 0; } }
    // Chrome, Edge en Firefox: afspelen via hls.js (lib/, Apache-2.0). De eigen HLS-speler van Chrome ziet de lijst die nog groeit
    // als live tv en springt dan minuten vooruit. hls.js begint vooraan en blijft daar. iPad, iPhone en Safari spelen het zelf goed af.
    var ua = navigator.userAgent;
    var apple = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || (/Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox|Android/.test(ua));
    var useHls = !apple && !!(window.MediaSource || window.ManagedMediaSource), hls = null, laden = null;
    var pending = false, loads = 0, herstart = 0;
    function need() {
      if (!useHls || window.Hls) return Promise.resolve();
      return laden || (laden = new Promise(function (res) {
        var t = document.createElement('script'); t.src = 'lib/hls.light.min.js';
        t.onload = function () { if (!window.Hls || !Hls.isSupported()) useHls = false; res(); };
        t.onerror = function () { useHls = false; res(); };
        document.head.appendChild(t);
      }));
    }
    function attach(url) {
      if (hls) { hls.destroy(); hls = null; }
      if (!useHls) { v.src = url; return; }
      // Film: vooraan beginnen en nooit vooruit springen. Live: gewoon bij het nieuwste stuk.
      // liveMaxLatencyDurationCount staat standaard op oneindig: hls.js springt dan nooit zelf vooruit.
      hls = new Hls({ startPosition: live ? -1 : 0, maxBufferLength: 60, backBufferLength: 90 });
      hls.on(Hls.Events.ERROR, function (e, d) {
        if (!d.fatal) return;
        // Film of aflevering: sessie weg op de server (lang op pauze, server herstart)? Opnieuw beginnen op dezelfde plek.
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && !live && src && Date.now() - herstart > 20e3) { herstart = Date.now(); m.load(src, m.time(), false).catch(function () { if (ev.error) ev.error(); }); }
        else if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else if (ev.error) ev.error();
      });
      hls.loadSource(url); hls.attachMedia(v);
    }
    var m = {
      load: function (s, from, isLive, audio) {
        if (s !== src) ai = audio || 0;
        vrijgeven();   // nog binnen de tik die de speler opende
        // Spoelen of ander geluidsspoor: het oude beeld meteen stil, en de balk staat al op het nieuwe punt terwijl de server bezig is.
        if (v.getAttribute('src')) v.pause();
        src = s; live = !!isLive; base = live ? 0 : Math.floor(from || 0); pending = true;
        var mine = ++loads;
        return Promise.all([api('POST', '/api/hls/start', { src: s, from: base, low: !!S.low, audio: ai, hevc: hevc }), need()]).then(function (x) {
          var r = x[0];
          if (mine !== loads) return r.dur;   // intussen alweer verder gespoeld
          id = r.id; aud = r.audio || []; ai = r.audioIndex || 0; if (!live && r.start != null) base = +r.start;   // de server begint bij het sleutelbeeld
          attach(r.url); pending = false; start(); return r.dur;
        }, function (e) { if (mine === loads) pending = false; throw e; });
      },
      time: function () { return base + (pending ? 0 : v.currentTime || 0); },
      buffered: function () { try { return !pending && v.buffered.length ? base + v.buffered.end(v.buffered.length - 1) : 0; } catch (e) { return 0; } },
      // Binnen wat al omgezet is: meteen. Verder weg, of terug voor het beginpunt: de server begint opnieuw vanaf daar.
      seek: function (sec) { var rel = sec - base; if (!pending && rel >= 0 && rel <= end() - 2) { v.currentTime = rel; return Promise.resolve(); } return m.load(src, sec, false); },
      paused: function () { return v.paused; }, play: function () { v.play().catch(function () {}); }, pause: function () { v.pause(); },
      stop: function () { if (id) { api('POST', '/api/hls/stop', { id: id }).catch(function () {}); id = ''; } src = ''; if (hls) { hls.destroy(); hls = null; } v.pause(); v.removeAttribute('src'); v.load(); },
      audio: function () { return aud.map(function (t, i) { return { label: trackLabel(t, i), lang: t.lang, codec: t.codec, on: i === ai }; }); },
      setAudio: function (i) { ai = i; return m.load(src, live ? 0 : m.time(), live); },
      rect: function (r) { v.style.cssText = r ? 'left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px' : ''; }
    };
    return m;
  }

  // ---------- pictogrammen, gelijk aan Icons.kt ----------
  var ICON = {
    play: 'M8 5.5v13l10.5-6.5z', pause: 'M7 5h3.2v14H7zM13.8 5H17v14h-3.2z',
    subs: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z',
    audio: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
    more: 'M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z'
  };
  function shape(d) { return '<svg viewBox="0 0 24 24"><path fill="currentColor" d="' + d + '"/></svg>'; }
  // Spoelknop: open cirkel met pijlpunt en het aantal seconden in het midden.
  function skipIcon(sec, fwd) {
    var a = fwd ? 'M15.7 5.2A8 8 0 1 1 8.3 5.2' : 'M8.3 5.2A8 8 0 1 0 15.7 5.2', ax = fwd ? 8.3 : 15.7, d = fwd ? 1 : -1;
    return '<svg viewBox="0 0 24 24"><path d="' + a + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path fill="currentColor" d="M' + (ax + d * 2.6) + ' 5.2L' + (ax - d * 1.0) + ' 2.6L' + (ax - d * 1.0) + ' 7.8z"/>' +
      '<text x="12" y="15.3" text-anchor="middle" font-size="7.2" font-weight="600" fill="currentColor" font-family="Inter, system-ui, sans-serif">' + sec + '</text></svg>';
  }

  // ---------- opbouw ----------
  function build() {
    el = h('div', { class: 'sp' }, '<div class="sp-sub"></div><div class="sp-msg" hidden></div>' +
      // film: onderbalk (VodActivity)
      '<div class="sv-osd"><div class="sv-tt"></div><div class="sv-st"></div><div class="sv-bar"><i class="sp-bf"></i><i class="sp-pf"></i><s></s></div>' +
      '<div class="sv-times"><span class="sv-tl"></span><span class="sv-tr"></span></div><div class="sv-row"><div class="sv-mid"></div><div class="sv-end"></div></div></div>' +
      '<div class="sv-menu" hidden><div class="sv-mt"></div><div class="sv-ml"></div></div>' +
      // live: balk (PlayerActivity), zenderlijst, keuze live/vanaf begin
      '<div class="sl-bar"><div class="sl-chan"></div><div class="sl-now"></div><div class="sl-next"></div>' +
      '<div class="sl-time"><span class="sl-ta"></span><div class="sl-pg"><i></i></div><span class="sl-tb"></span></div><div class="sl-btns"></div></div>' +
      '<div class="sl-list" hidden><div class="sl-lt">Zenders</div><div class="sl-ll"></div></div>' +
      '<div class="sl-choice" hidden><span>● Live</span><span>↺ Vanaf begin</span></div>');
    E = window.SpelerMotor ? window.SpelerMotor(el, ev) : browserMotor(el);
    ev.playing = function () { if (cur) { msgOff('Laden…'); msgOff(TIK); paint(); } };
    ev.waiting = function () { if (cur && !cur.live) msg('Laden…', 0); };
    ev.pause = ev.play = function () { if (cur) paint(); };
    ev.ended = function () { if (cur && !cur.live) { report('stopped'); close(); } };
    var TIK = 'Tik op afspelen om te starten';
    ev.blocked = function () { if (cur) { msg(TIK, 0); paint(); } };
    ev.error = function () { if (cur) msg(cur.live ? 'Deze zender speelt nu niet af' : 'Dit speelt niet af', 0); };
    // Aanraken: tikken toont of verbergt de balk; de knoppen en lijsten reageren op een tik.
    el.addEventListener('click', function (e) {
      if (!cur || e.target.closest('button, .sv-menu, .sl-list, .sl-choice, .sl-guide')) return;
      if (cur.sync) return syncDone();
      if (cur.live) { if (el.classList.contains('bar-on')) barHide(); else { btnSel = 0; barShow(true); } }
      else if (el.classList.contains('osd-on')) osdHide(); else osdShow();
    });
    var bar = el.querySelector('.sv-bar'), drag = false;
    function frac(e) { var r = bar.getBoundingClientRect(), x = (e.touches ? e.touches[0] : e).clientX; return Math.min(1, Math.max(0, (x - r.left) / r.width)); }
    function move(e) { if (!cur || !cur.dur) return; e.preventDefault(); e.stopPropagation(); drag = frac(e); paintBar(drag * cur.dur); osdShow(); }
    function up() { if (drag !== false) { var f = drag; drag = false; seekTo(f * cur.dur); } }
    bar.addEventListener('touchstart', move, { passive: false }); bar.addEventListener('touchmove', move, { passive: false }); bar.addEventListener('touchend', up);
    bar.addEventListener('mousedown', function (e) { move(e); var mv = function (x) { move(x); }, u = function () { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', u); up(); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', u); });
    bar.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(el);
    document.addEventListener('keydown', key, true);
    document.addEventListener('keyup', keyUp, true);
    applyStyle();
  }

  // ---------- melding in het midden ----------
  var msgT = 0;
  function msg(t, ms) { var m = el.querySelector('.sp-msg'); m.textContent = t; m.hidden = false; clearTimeout(msgT); if (ms !== 0) msgT = setTimeout(function () { m.hidden = true; }, ms || 3000); }
  function msgOff(only) { var m = el.querySelector('.sp-msg'); if (!only || m.textContent === only) m.hidden = true; }

  // =====================================================================
  // FILM / AFLEVERING (gelijk aan VodActivity)
  // =====================================================================
  var osdT = 0, zone = -1;
  function vodButtons() {
    var mid = el.querySelector('.sv-row .sv-mid'), end = el.querySelector('.sv-row .sv-end');
    mid.innerHTML = ''; end.innerHTML = '';
    [skipIcon(10, false), shape(ICON.pause), skipIcon(30, true)].forEach(function (ic, i) { mid.appendChild(roundBtn(ic, i)); });
    [shape(ICON.subs), shape(ICON.audio), shape(ICON.more)].forEach(function (ic, i) { end.appendChild(roundBtn(ic, 3 + i)); });
  }
  function roundBtn(icon, i) { var b = h('button', { class: 'sp-rb' }, icon); b.onclick = function (e) { e.stopPropagation(); zone = i; press(i); osdShow(); }; return b; }
  function vodBtns() { return [].slice.call(el.querySelectorAll('.sv-row .sp-rb')); }
  function light() { el.querySelector('.sv-bar').classList.toggle('lit', zone < 0); vodBtns().forEach(function (b, i) { b.classList.toggle('lit', i === zone); }); }
  function osdShow() {
    el.classList.add('osd-on'); paint(); light();
    clearTimeout(osdT); if (!E.paused() && !menu) osdT = setTimeout(osdHide, 5000);
  }
  function osdHide() { clearTimeout(osdT); zone = -1; el.classList.remove('osd-on'); }
  function paintBar(at) {
    var d = cur.dur || 0, b = el.querySelector('.sv-bar'); if (!d) return;
    var f = Math.min(1, (at == null ? pos() : at) / d), buf = Math.min(1, ((cur.off || 0) + E.buffered()) / d);
    b.querySelector('.sp-pf').style.width = Math.max(f * 100, 0.3) + '%'; b.querySelector('.sp-bf').style.width = buf * 100 + '%'; b.querySelector('s').style.left = f * 100 + '%';
    el.querySelector('.sv-times .sv-tl').textContent = fmt(f * d); el.querySelector('.sv-times .sv-tr').textContent = '-' + fmt(d - f * d);
  }
  function press(i) { [function () { skip(-10); }, toggle, function () { skip(30); }, subtitleMenu, audioMenu, moreMenu][i](); }

  // Keuzekaart rechts boven de knoppen, met vinkje bij wat aan staat. OK kiest, Terug of links sluit.
  var menu = null;
  function openMenu(title, opts, sel) {
    var box = el.querySelector('.sv-menu'), l = box.querySelector('.sv-ml');
    box.querySelector('.sv-mt').textContent = title; l.innerHTML = '';
    opts.forEach(function (o, i) {
      var r = h('button', { class: 'sp-mi' }, '<span class="sp-ck">' + (o.on ? '✓' : '') + '</span><span class="sp-lb">' + esc(o.label) + '</span>');
      r.onclick = function (e) { e.stopPropagation(); menu.sel = i; menuOk(); };
      l.appendChild(r);
    });
    menu = { opts: opts, sel: Math.max(0, sel || 0) }; box.hidden = false; menuPaint();
    clearTimeout(osdT);
  }
  function menuPaint() { var rs = el.querySelectorAll('.sv-menu .sp-mi'); [].forEach.call(rs, function (r, i) { r.classList.toggle('kf', i === menu.sel); }); if (rs[menu.sel]) rs[menu.sel].scrollIntoView({ block: 'nearest' }); }
  function menuClose() { menu = null; el.querySelector('.sv-menu').hidden = true; if (cur && !cur.live && el.classList.contains('osd-on')) osdShow(); }
  function menuOk() { var a = menu.opts[menu.sel].act; menuClose(); if (a) a(); }

  function moreMenu() {
    openMenu('Meer', [
      { label: '5 minuten vooruit', act: function () { skip(300); } },
      { label: '5 minuten terug', act: function () { skip(-300); } },
      { label: 'Vanaf het begin', act: function () { seekTo(0); } },
      { label: 'Weergave ondertitels', act: function () { styleMenu(0); } }], 0);
  }
  function audioMenu() {
    var a = E.audio ? E.audio() : [];
    if (a.length < 2) return msg('Maar één geluidsspoor');
    openMenu('Geluid', a.map(function (t, i) { return { label: t.label, on: t.on, act: function () { Promise.resolve(E.setAudio(i)).then(function () { msg('Geluid: ' + t.label); }, function (e) { msg(e.message); }); } }; }),
      a.map(function (t) { return t.on; }).indexOf(true));
  }

  // ---------- ondertitels: de speler tekent ze zelf, zodat het met elke motor hetzelfde werkt ----------
  function parseSrt(t) {
    var sec = function (a) { var m = /(\d+):(\d\d):(\d\d)[,.](\d\d\d)/.exec(a); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : 0; };
    return String(t).replace(/\r/g, '').split(/\n\s*\n/).map(function (b) {
      var ls = b.trim().split('\n'), i = -1;
      for (var k = 0; k < ls.length; k++) if (ls[k].indexOf('-->') > 0) { i = k; break; }
      if (i < 0) return null; var ts = ls[i].split('-->');
      return { s: sec(ts[0]), e: sec(ts[1]), t: ls.slice(i + 1).join('\n').replace(/\{[^}]*\}/g, '') };
    }).filter(function (c) { return c && c.t; });
  }
  function useSubs(text, label) { cur.cues = text ? parseSrt(text) : null; cur.subLabel = text ? label : ''; cur.subOff = 0; subShown = null; }
  var subEl = null, subShown = null;
  function subs() {
    if (!subEl) subEl = el.querySelector('.sp-sub');
    var cue = null, p = pos() - (cur.subOff || 0);
    if (cur.cues) for (var i = 0; i < cur.cues.length; i++) { var c = cur.cues[i]; if (c.s <= p && c.e > p) { cue = c; break; } }
    if (cue === subShown) return; subShown = cue;
    // Alleen schuin, vet en onderstreept blijven over; de rest is gewone tekst.
    // Opmaak eerst over de hele ondertitel weghalen: een code als <font ...> loopt soms over twee regels.
    var t = cue ? esc(cue.t.replace(/\{\\[^}]*\}/g, '')).replace(/&lt;(\/?[ibu])&gt;/gi, '<$1>').replace(/&lt;\/?[a-z][^]*?&gt;/gi, '') : '';
    subEl.innerHTML = t ? t.split('\n').map(function (l) { return '<span>' + l + '</span>'; }).join('<br>') : '';
  }
  // Tekst van de server (ondertitels). Via de app of, in de webversie, rechtstreeks met de cookie.
  function rawText(method, path, body) {
    if (K.N) return K.native('srv', method, path, body ? JSON.stringify(body) : '');
    return fetch(path, { method: method, credentials: 'same-origin', headers: { 'X-Thuis': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.text().then(function (t) { if (!r.ok) { var m = t; try { m = JSON.parse(t).error; } catch (e) {} throw new Error(m); } return t; }); });
  }
  // Waar ondertitels vandaan kunnen komen: het bestand zelf en Plex (losse bestanden). OpenSubtitles komt erbij in het menu.
  function subSources() {
    var it = cur.item, l = [];
    ((cur.tracks || {}).subs || []).filter(function (s) { return s.text; }).forEach(function (s) {
      l.push({ lang: s.lang, label: [s.title, lang(s.lang)].filter(Boolean).join(' · ') || 'Ondertitels', load: function () { return rawText('POST', '/api/media/sub', { src: it.url, i: s.i }); } });
    });
    (it.subs || []).filter(function (s) { return /srt|subrip/i.test(s.codec || 'srt'); }).forEach(function (s) {
      l.push({ lang: s.lang, label: s.label || lang(s.lang) || 'Ondertitels', load: function () { return fetch(K.img(s.url)).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }); } });
    });
    return l;
  }
  function loadSub(src, quiet) {
    return src.load().then(function (t) { if (!cur) return; useSubs(t, src.label); if (!quiet) msg('Ondertitels: ' + src.label); }, function (e) { if (!quiet) msg('Ophalen lukt niet'); throw e; });
  }
  function osSearch() {
    var it = cur.item;
    return get('/api/subs/search?kind=' + encodeURIComponent(it.kind || '') + '&title=' + encodeURIComponent(it.title || '') + '&tmdbId=' + (it.tmdb || 0) + '&season=' + (it.season || 0) + '&episode=' + (it.episode || 0));
  }
  function osSource(r) {
    return { lang: r.lang, label: 'OpenSubtitles · ' + r.lang + ' · ' + String(r.release || '').slice(0, 40) + (r.hearing ? ' · SDH' : ''), load: function () { return rawText('GET', '/api/subs/file/' + r.fileId); } };
  }
  // Net als VodActivity: uit, wat er is, gelijkzetten, versies van OpenSubtitles en de weergave.
  function subtitleMenu() {
    if (!cur.item) return msg('Geen ondertitels bij deze uitzending');
    var opts = [{ label: 'Uit', on: !cur.cues, act: function () { useSubs(''); msg('Ondertitels uit'); } }];
    subSources().forEach(function (s) { opts.push({ label: s.label, on: cur.subLabel === s.label, act: function () { msg('Ondertitel ophalen…', 0); loadSub(s).catch(function () {}); } }); });
    if (cur.cues) opts.push({ label: 'Gelijkzetten (timing)', act: syncStart });
    (cur.os || []).forEach(function (r) { var s = osSource(r); opts.push({ label: s.label, on: cur.subLabel === s.label, act: function () { msg('Ondertitel ophalen…', 0); loadSub(s).catch(function () {}); } }); });
    if (!cur.os) opts.push({ label: 'Zoeken bij OpenSubtitles', act: function () {
      msg('Ondertitels zoeken…', 0);
      osSearch().then(function (l) { cur.os = l; msgOff(); if (!l.length) return msg('Niets gevonden bij OpenSubtitles'); subtitleMenu(); }, function (e) { msg('Ondertitels zoeken lukt niet: ' + String(e.message).slice(0, 60)); });
    } });
    opts.push({ label: 'Weergave: ' + styleSummary(), act: function () { styleMenu(0); } });
    openMenu('Ondertitels', opts, Math.max(0, opts.map(function (o) { return !!o.on; }).indexOf(true)));
  }
  // Zelf Nederlands kiezen, zoals VodActivity: uit het bestand of Plex; anders, als het geluid geen Nederlands is, OpenSubtitles.
  function autoSubs() {
    var mine = cur, nl = subSources().filter(function (s) { return isNl(s.lang); })[0];
    if (nl) return loadSub(nl, true).catch(function () {});
    var a = E.audio ? E.audio().filter(function (x) { return x.on; })[0] : null;
    if (a && isNl(a.lang)) return;
    osSearch().then(function (l) {
      if (cur !== mine) return; cur.os = l;
      var r = l.filter(function (x) { return isNl(x.lang); })[0]; if (!r) return;
      return loadSub(osSource(r), true).then(function () { if (cur === mine) msg('Nederlandse ondertitels geladen (geel of ondertitelknop = andere kiezen)'); });
    }).catch(function () {});
  }
  // Gelijkzetten: wacht op de volgende zin en druk op OK (of tik) zodra je hem hoort.
  function syncStart() {
    var p = pos() - (cur.subOff || 0), next = (cur.cues || []).filter(function (c) { return c.s > p + 2.5; })[0];
    if (!next) return msg('Geen volgende zin gevonden');
    cur.sync = next; osdHide();
    msg('Druk op OK zodra je dit hoort:\n\n“' + next.t.replace(/\n/g, ' ').slice(0, 120) + '”\n\n(Terug = stoppen)', 0);
  }
  function syncDone() {
    var c = cur.sync; cur.sync = null; msgOff();
    cur.subOff = pos() - 0.2 - c.s; subShown = null;   // 0,2 s eraf: je drukt altijd net na het horen
    var o = cur.subOff;
    msg('Ondertitels staan gelijk' + (Math.abs(o) < 0.05 ? '' : (o < 0 ? ' (%s s naar voren)' : ' (%s s naar achteren)').replace('%s', Math.abs(o).toFixed(1).replace('.', ','))));
  }
  function syncStop() { cur.sync = null; msgOff(); msg('Gelijkzetten gestopt'); }
  // Weergave: zelfde keuzes als SubStyle op Android, per apparaat bewaard.
  var STYLE = { size: [['Klein', 4.0], ['Normaal', 4.7], ['Groot', 5.6], ['Extra groot', 6.8]], weight: [['Normaal', 400], ['Medium', 500], ['Vet', 700]],
    bg: [['Schaduw'], ['Rand'], ['Zwarte balk'], ['Geel']], place: [['Laag', 4], ['Normaal', 8], ['Hoger', 15]] };
  var STYLENAME = { size: 'Grootte', weight: 'Dikte', bg: 'Achtergrond', place: 'Hoogte' };
  function style() { var s = { size: 1, weight: 1, bg: 0, place: 1 }; try { var o = JSON.parse(localStorage.getItem('sjuul-ondertitels') || '{}'); for (var k in s) if (o[k] >= 0 && o[k] < STYLE[k].length) s[k] = o[k]; } catch (e) {} return s; }
  function styleSummary() { var s = style(); return [STYLE.size[s.size][0], STYLE.weight[s.weight][0], STYLE.bg[s.bg][0]].join(' · '); }
  function applyStyle() {
    var s = style(), st = el.querySelector('.sp-sub');
    st.style.setProperty('--sub-size', STYLE.size[s.size][1] + 'vh'); st.style.setProperty('--sub-weight', STYLE.weight[s.weight][1]);
    st.style.setProperty('--sub-place', STYLE.place[s.place][1] + '%'); st.className = 'sp-sub bg' + s.bg;
  }
  function styleMenu(sel) {
    var s = style(), keys = Object.keys(STYLE);
    openMenu('Weergave ondertitels', keys.map(function (k, i) {
      return { label: STYLENAME[k] + ': ' + STYLE[k][s[k]][0], act: function () {
        s[k] = (s[k] + 1) % STYLE[k].length; try { localStorage.setItem('sjuul-ondertitels', JSON.stringify(s)); } catch (e) {}
        applyStyle(); subShown = null; styleMenu(i);
      } };
    }).concat([{ label: 'Klaar' }]), sel || 0);
  }

  // =====================================================================
  // LIVE EN TERUGKIJKEN (gelijk aan PlayerActivity)
  // =====================================================================
  var barT = 0, menuOpen = false, btnSel = 0, buttons = [];
  function barShow(withMenu) {
    menuOpen = !!withMenu; el.classList.add('bar-on'); el.classList.toggle('menu-on', menuOpen);
    if (menuOpen) { buttons = liveItems(); btnSel = Math.max(0, Math.min(btnSel, buttons.length - 1)); renderButtons(); }
    paint();
    clearTimeout(barT); barT = setTimeout(barHide, menuOpen ? 10000 : 5000);
  }
  function barHide() { clearTimeout(barT); menuOpen = false; if (el) el.classList.remove('bar-on', 'menu-on'); }
  function liveItems() {
    var ch = cur.ch, paused = E.paused() || cur.pausedAt, l = [];
    l.push([paused ? '▶  Verder' : '❚❚  Pauze', toggle]);
    if (!cur.replay && ch.archive && cur.prog && cur.prog.start < Date.now()) l.push(['↺  Vanaf begin', function () { replay(cur.prog, cur.prog.start); }]);
    if (cur.replay) l.push(['●  Terug naar live', function () { tune(ch); }]);
    l.push(['Zenders', function () { barHide(); listShow(); }]);
    l.push(['Gids', function () { barHide(); guideOpen(); }]);
    l.push(['Geluid', nextAudio]);
    l.push(['Ondertitels', function () { msg('Geen ondertitels bij deze uitzending'); }]);
    return l;
  }
  function renderButtons() {
    var r = el.querySelector('.sl-bar .sl-btns'); r.innerHTML = '';
    buttons.forEach(function (b, i) {
      var x = h('button', { class: 'sl-pill' + (i === btnSel ? ' on' : '') }, esc(b[0]));
      x.onclick = function (e) { e.stopPropagation(); btnSel = i; b[1](); if (cur && menuOpen && !list && !gd) barShow(true); };
      r.appendChild(x);
    });
    r.appendChild(h('span', { class: 'sl-hint' }, cur.replay ? '↑ ↓ zappen   ·   ← → spoelen (vasthouden = sneller)' : '↑ ↓ zappen   ·   terug = balk weg'));
  }
  function liveTexts() {
    var ch = cur.ch, b = el.querySelector('.sl-bar');
    b.querySelector('.sl-chan').textContent = (ch.num ? ch.num + '  ·  ' : '') + ch.name + '  ·  ' + (cur.replay ? 'terugkijken' : cur.pausedAt ? 'gepauzeerd' : 'live');
    if (cur.replay) { b.querySelector('.sl-now').textContent = '↺  ' + (cur.replay.title || ch.name); b.querySelector('.sl-next').textContent = ''; return; }
    b.querySelector('.sl-now').textContent = cur.prog ? cur.prog.title : ch.name;
    b.querySelector('.sl-next').textContent = cur.next ? 'Daarna ' + hhmm(cur.next.start) + '  ·  ' + cur.next.title : cur.noGuide ? 'Geen gids voor deze zender' : '';
  }
  function liveTime() {
    var p = cur.replay || cur.prog, b = el.querySelector('.sl-bar .sl-time');
    if (!p || !p.start || p.end <= p.start) { b.style.visibility = 'hidden'; return; }
    b.style.visibility = '';
    var at = cur.replay ? (seekT ? seekT.t : p.start + pos() * 1000) : (cur.pausedAt || Date.now());
    b.querySelector('.sl-ta').textContent = hhmm(p.start); b.querySelector('.sl-tb').textContent = hhmm(p.end);
    b.querySelector('.sl-pg i').style.width = Math.min(100, Math.max(0, (at - p.start) / (p.end - p.start) * 100)) + '%';
  }
  function nowNext() {
    var id = cur.ch.id;
    get('/api/live/nownext?ids=' + id).then(function (r) {
      if (!cur || cur.ch.id !== id || cur.replay) return;
      var l = r[id] || []; cur.prog = l[0] || null; cur.next = l[1] || null; cur.noGuide = !l.length; paint();
      if (menuOpen) { buttons = liveItems(); renderButtons(); }
    }).catch(function () {});
  }
  // Zappen; het vorige kanaal onthouden (knop Vorige zender).
  function zap(d) { var l = cur.list, i = l.map(function (c) { return c.id; }).indexOf(cur.ch.id); if (l.length) tune(l[(i + d + l.length) % l.length]); }
  function tune(ch) {
    if (cur.ch && cur.ch.id && cur.ch.id !== ch.id) cur.prev = cur.ch;
    cur.live = true; cur.ch = ch; cur.replay = null; cur.reseek = null; cur.prog = cur.next = null; cur.noGuide = false; cur.off = 0; cur.dur = 0; cur.pausedAt = 0;
    paint(); barShow(menuOpen); nowNext(); msg('Laden…', 0);
    get('/api/live/url/' + ch.id).then(function (r) { return E.load(r.url, 0, true, audioFor(ch)); }).then(function () { if (cur && cur.ch === ch) { msgOff('Laden…'); paint(); } })
      .catch(function (e) { msg('Deze zender speelt nu niet af\n' + e.message, 0); });
  }
  // Geluid: groen wisselt naar het volgende spoor en onthoudt dat per zender (zoals op de JBL).
  function audioFor(ch) { try { return +(JSON.parse(localStorage.getItem('sjuul-geluid-zender') || '{}')[ch.id] || 0); } catch (e) { return 0; } }
  function nextAudio() {
    var a = E.audio ? E.audio() : [];
    if (a.length < 2) return msg('Deze zender heeft maar één geluidsspoor');
    var i = (a.map(function (t) { return t.on; }).indexOf(true) + 1) % a.length;
    Promise.resolve(E.setAudio(i)).then(function () {
      try { var m = JSON.parse(localStorage.getItem('sjuul-geluid-zender') || '{}'); m[cur.ch.id] = i; localStorage.setItem('sjuul-geluid-zender', JSON.stringify(m)); } catch (e) {}
      msg('Geluid ' + (i + 1) + ' van ' + a.length + ': ' + [a[i].label, a[i].codec].filter(Boolean).join(' · '));
    }, function (e) { msg(e.message); });
  }
  // Pauze: bij live met terugkijken gaat het daarna verder waar je was; anders weer live.
  function toggle() {
    if (!cur) return;
    if (cur.live && !cur.replay) {
      if (cur.pausedAt) { var from = cur.pausedAt, p = cur.prog && cur.prog.start <= from ? cur.prog : { title: cur.ch.name, start: from, end: Date.now() + 3600e3 }; return replay(p, from); }
      if (cur.ch.archive) { cur.pausedAt = Date.now(); E.pause(); }
      else if (E.paused()) tune(cur.ch); else E.pause();
      return barShow(true);
    }
    if (E.paused()) E.play(); else E.pause();
    if (cur.live) barShow(true); else osdShow();
  }
  // Terugkijken vanaf from (kloktijd). De aanbieder werkt per minuut, dus afronden.
  function replay(p, from) {
    from -= from % 60e3;
    cur.replay = p; cur.pausedAt = 0; cur.dur = (p.end - p.start) / 1000;
    var go = function (t) { return get('/api/live/catchup/' + cur.ch.id + '?start=' + t + '&end=' + p.end).then(function (r) { cur.off = (t - p.start) / 1000; return E.load(r.url, 0, false, audioFor(cur.ch)); }); };
    paint(); barShow(menuOpen); msg('Laden…', 0);
    go(from).then(function () { msgOff('Laden…'); }, function (e) { msg('Terugkijken lukt niet: ' + e.message, 0); });
  }
  // Spoelen bij terugkijken: stappen van 1 minuut, vasthouden = 5 en daarna 10 minuten. Pas na loslaten laden.
  var seekT = null;
  function replaySeek(dir, repeat) {
    var r = cur.replay;
    if (!seekT) seekT = { t: r.start + pos() * 1000, n: 0 };
    seekT.n++;
    var step = (repeat > 12 ? 10 : repeat > 3 ? 5 : 1) * 60e3;
    seekT.t = Math.max(r.start, Math.min(Date.now(), seekT.t + dir * step));
    var diff = Math.round((seekT.t - (r.start + pos() * 1000)) / 60e3);
    msg((dir < 0 ? '◄◄  ' : '►►  ') + hhmm(seekT.t) + '   (' + (diff >= 0 ? '+' : '') + diff + ' min)', 0);
    barShow(false);
    clearTimeout(seekT.timer); seekT.timer = setTimeout(replaySeekDone, 900);
  }
  function replaySeekDone() {
    if (!seekT) return; var t = seekT.t; clearTimeout(seekT.timer); seekT = null; msgOff();
    if (Date.now() - t < 60e3) return tune(cur.ch);   // bijna bij nu: gewoon live
    replay(cur.replay, t);
  }
  // Zender intoetsen: cijfers verzamelen, na anderhalve seconde erheen.
  var digits = '', digitT = 0;
  function digit(n) {
    if (digits.length < 4) digits += n;
    msg(digits, 0); clearTimeout(digitT);
    digitT = setTimeout(function () {
      var want = +digits; digits = ''; msgOff();
      var all = (S.cats || []).reduce(function (a, c) { return a.concat(c.channels); }, []);
      var ch = cur.list.concat(all).filter(function (c) { return +c.num === want; })[0];
      if (ch) tune(ch); else msg('Zender ' + want + ' bestaat niet', 1500);
    }, 1500);
  }

  // ---------- zenderlijst links ----------
  var list = null;
  function listShow() {
    var box = el.querySelector('.sl-list'), l = box.querySelector('.sl-ll'); l.innerHTML = '';
    box.querySelector('.sl-lt').textContent = 'Zenders   ·   rechts = gids';
    cur.list.forEach(function (c) {
      var r = h('button', { class: 'sl-li' + (c.id === cur.ch.id ? ' sl-cur' : '') }, esc((c.num || '') + '   ' + c.name));
      r.onclick = function (e) { e.stopPropagation(); listHide(); tune(c); };
      l.appendChild(r);
    });
    list = { sel: Math.max(0, cur.list.map(function (c) { return c.id; }).indexOf(cur.ch.id)) };
    box.hidden = false; listPaint();
  }
  function listPaint() { var rs = el.querySelectorAll('.sl-list .sl-li'); [].forEach.call(rs, function (r, i) { r.classList.toggle('kf', i === list.sel); }); if (rs[list.sel]) rs[list.sel].scrollIntoView({ block: 'center' }); }
  function listHide() { list = null; if (el) el.querySelector('.sl-list').hidden = true; }

  // ---------- gids als raster (gelijk aan GuideView) ----------
  var gd = null, epgCache = {};
  var SPAN = 150 * 60e3, HALF = 30 * 60e3;
  function guideOpen() {
    if (!cur.list.length) return;
    listHide(); barHide();
    var now = Date.now(), row = Math.max(0, cur.list.map(function (c) { return c.id; }).indexOf(cur.ch.id));
    gd = { row: row, prog: 0, focus: now, win: now - now % HALF, box: h('div', { class: 'sl-guide' }) };
    gd.box.innerHTML = '<div class="gd-hd"><div class="gd-k"></div><div class="gd-t"></div><div class="gd-w"></div><div class="gd-d"></div></div><div class="gd-times"></div><div class="gd-rows"></div>' +
      '<div class="gd-hint">▲▼ zender   ◄► programma (ook terug in de tijd)   OK kijken   ↺ = terugkijken   Terug sluiten</div>' +
      '<div class="gd-tbtn"><button data-d="-1">◄</button><button data-d="1">►</button><button data-x="1">Sluiten</button></div>';
    [].forEach.call(gd.box.querySelectorAll('.gd-tbtn button'), function (b) { b.onclick = function (e) { e.stopPropagation(); if (b.getAttribute('data-x')) guideClose(); else guideMove(0, +b.getAttribute('data-d')); }; });
    el.appendChild(gd.box); el.classList.add('guide-on');
    previewRect();
    var t = Date.now(), need = cur.list.filter(function (c) { return !(epgCache[c.id] && t - epgCache[c.id].at < 10 * 60e3); });
    snap(); guidePaint();
    // Gids per zender: 20 uur terug en 6 uur vooruit, zoals op de JBL. In stukjes, zodat het snel zichtbaar is.
    var from = t - 20 * 3600e3;
    for (var i = 0; i < need.length; i += 25) (function (part) {
      get('/api/live/guide?ids=' + part.map(function (c) { return c.id; }).join(',') + '&from=' + from + '&to=' + (from + 26 * 3600e3)).then(function (g) {
        g.forEach(function (r) { epgCache[r.id] = { at: Date.now(), l: r.programmes || [] }; });
        part.forEach(function (c) { if (!epgCache[c.id]) epgCache[c.id] = { at: Date.now(), l: [] }; });
        if (gd) { snap(); guidePaint(); }
      }).catch(function () {});
    })(need.slice(i, i + 25));
  }
  // Het lopende beeld rechtsboven, net als op de JBL.
  function previewRect() {
    var w = el.clientWidth, hh = el.clientHeight, pw = w * 0.30;
    var r = { x: Math.round(w - pw - w * 0.04), y: Math.round(hh * 0.05), w: Math.round(pw), h: Math.round(pw * 9 / 16) };
    if (E.rect) E.rect(r);
    // Beeld onder de pagina (Android, Samsung): een gat in de gids op dezelfde plek.
    if (E.transparent && gd) { var g = h('div', { class: 'gd-hole' }); g.style.cssText = 'left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px'; gd.box.insertBefore(g, gd.box.firstChild); }
  }
  function guideClose() { if (!gd) return; gd.box.remove(); gd = null; el.classList.remove('guide-on'); if (E.rect) E.rect(null); }
  function progs(r) { var c = cur.list[r]; return c && epgCache[c.id] ? epgCache[c.id].l : []; }
  function snap() { var l = progs(gd.row), i = -1; for (var k = 0; k < l.length; k++) if (l[k].end > gd.focus) { i = k; break; } gd.prog = i < 0 ? Math.max(0, l.length - 1) : i; }
  function guideMove(dRow, dProg) {
    var n = cur.list.length;
    if (dRow) { gd.row = ((gd.row + dRow) % n + n) % n; snap(); }
    if (dProg) {
      var l = progs(gd.row);
      if (l.length) {
        gd.prog = Math.max(0, Math.min(l.length - 1, gd.prog + dProg));
        var p = l[gd.prog]; gd.focus = p.start + 1;
        if (p.start >= gd.win + SPAN - HALF) gd.win = p.start - HALF;
        if (p.start < gd.win) gd.win = p.start - p.start % HALF;
      }
    }
    guidePaint();
  }
  function guidePaint() {
    var b = gd.box, ch = cur.list[gd.row], p = progs(gd.row)[gd.prog], now = Date.now(), loading = !epgCache[ch.id];
    b.querySelector('.gd-k').textContent = ('Gids  ·  ' + (ch.num ? ch.num + '  ' : '') + ch.name).toUpperCase();
    b.querySelector('.gd-t').textContent = loading ? 'Gids laden…' : p ? p.title : ch.name;
    b.querySelector('.gd-w').textContent = p && p.start ? hhmm(p.start) + ' tot ' + hhmm(p.end) +
      (now >= p.start && now < p.end ? '  ·  NU' + (ch.archive ? '  ·  OK = kijken, of vanaf begin' : '') : p.start < now && ch.archive ? '  ·  TERUGKIJKEN' : p.start < now ? '  ·  geweest, niet terug te kijken' : '') : '';
    b.querySelector('.gd-d').textContent = p && p.desc ? p.desc : '';
    var times = b.querySelector('.gd-times'); times.innerHTML = '';
    for (var t = gd.win; t <= gd.win + SPAN; t += HALF) times.appendChild(h('span', { style: 'left:' + ((t - gd.win) / SPAN * 100) + '%' }, hhmm(t)));
    var rows = b.querySelector('.gd-rows'); rows.innerHTML = '';
    var rh = parseFloat(getComputedStyle(b).getPropertyValue('--row')) || 84, vis = Math.max(1, Math.floor((rows.clientHeight || rh * 7) / rh));
    var top = Math.max(0, Math.min(gd.row - Math.floor(vis / 2), cur.list.length - vis));
    for (var i = 0; i < vis; i++) {
      var r = top + i, c = cur.list[r]; if (!c) break;
      var line = h('div', { class: 'gd-gr' + (r === gd.row ? ' on' : '') }, '<div class="gd-nm">' + esc((c.num ? c.num + '  ' : '') + c.name) + '</div><div class="gd-bl"></div>');
      var bl = line.querySelector('.gd-bl'), l = progs(r);
      if (!l.length) bl.appendChild(h('span', { class: 'gd-none' }, epgCache[c.id] ? 'Geen gids' : '…'));
      l.forEach(function (pr, k) {
        if (pr.end <= gd.win || pr.start >= gd.win + SPAN) return;
        var x1 = (Math.max(pr.start, gd.win) - gd.win) / SPAN * 100, x2 = (Math.min(pr.end, gd.win + SPAN) - gd.win) / SPAN * 100;
        var blk = h('button', { class: 'gd-pb' + (r === gd.row && k === gd.prog ? ' kf' : now >= pr.start && now < pr.end ? ' now' : ''), style: 'left:' + x1 + '%;width:' + (x2 - x1) + '%' },
          '<span>' + esc((c.archive && pr.end <= now ? '↺ ' : '') + pr.title) + '</span>');
        blk.onclick = (function (rr, kk) { return function (e) { e.stopPropagation(); if (gd.row === rr && gd.prog === kk) guideOk(); else { gd.row = rr; gd.prog = kk; gd.focus = progs(rr)[kk].start + 1; guidePaint(); } }; })(r, k);
        bl.appendChild(blk);
      });
      line.querySelector('.gd-nm').onclick = (function (rr) { return function (e) { e.stopPropagation(); gd.row = rr; snap(); guidePaint(); }; })(r);
      rows.appendChild(line);
    }
    if (now >= gd.win && now <= gd.win + SPAN) rows.appendChild(h('div', { class: 'gd-now', style: 'left:calc(var(--name) + (100% - var(--name)) * ' + ((now - gd.win) / SPAN) + ')' }));
  }
  function guideOk() {
    var ch = cur.list[gd.row], p = progs(gd.row)[gd.prog], now = Date.now();
    guideClose();
    if (p && now >= p.start && now < p.end && ch.archive) return choiceShow(ch, p);
    if (!p || (now >= p.start && now < p.end)) return tune(ch);
    if (p.start < now && ch.archive && p.start > now - ch.archive * 864e5) { if (ch.id !== cur.ch.id) cur.prev = cur.ch; cur.ch = ch; cur.live = true; return replay(p, p.start); }
    tune(ch); msg(p.start < now ? 'Dit programma is niet terug te kijken' : 'Begint om ' + hhmm(p.start), 2500);
  }
  // Keuze bij een programma dat nu loopt: live kijken of vanaf het begin.
  var choice = null;
  function choiceShow(ch, p) {
    choice = { ch: ch, p: p, sel: 0 }; var box = el.querySelector('.sl-choice'); box.hidden = false;
    [].forEach.call(box.children, function (s, i) { s.onclick = function (e) { e.stopPropagation(); choice.sel = i; choiceOk(); }; });
    choicePaint();
  }
  function choicePaint() { [].forEach.call(el.querySelector('.sl-choice').children, function (s, i) { s.classList.toggle('on', i === choice.sel); }); }
  function choiceOk() {
    var c = choice; choice = null; el.querySelector('.sl-choice').hidden = true;
    if (c.ch.id !== cur.ch.id) cur.prev = cur.ch;
    if (c.sel === 1) { cur.ch = c.ch; cur.live = true; replay(c.p, c.p.start); } else tune(c.ch);
  }
  function choiceHide() { choice = null; if (el) el.querySelector('.sl-choice').hidden = true; }

  // =====================================================================
  // GEMEENSCHAPPELIJK
  // =====================================================================
  var tickT = 0, lastReport = 0;
  function pos() { return cur ? (cur.off || 0) + E.time() : 0; }
  function fmt(s) { s = Math.max(0, Math.floor(s)); var hh = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60; return (hh ? hh + ':' + pad2(m) : m) + ':' + pad2(ss); }
  function paint() {
    if (!cur) return;
    if (cur.live) { liveTexts(); liveTime(); return; }
    var p = el.querySelector('.sv-row .sv-mid .sp-rb:nth-child(2)'); if (p) p.innerHTML = shape(E.paused() ? ICON.play : ICON.pause);
    if (!hold) paintBar();
  }
  function tick() {
    if (!cur) return;
    subs();
    if (cur.live ? el.classList.contains('bar-on') : el.classList.contains('osd-on')) paint();
    if (!cur.live && Date.now() - lastReport > 10e3 && E.time() > 0) { lastReport = Date.now(); report(E.paused() ? 'paused' : 'playing'); }
    if (cur.live && !cur.replay && !cur.pausedAt && cur.prog && Date.now() > cur.prog.end) nowNext();
  }
  function seekTo(sec) {
    if (!cur || cur.live) return;
    sec = Math.max(0, cur.dur ? Math.min(sec, cur.dur - 3) : sec);
    E.seek(sec).catch(function (e) { msg('Spoelen lukt niet: ' + e.message); });
  }
  function skip(d) { seekTo(pos() + d); }
  var hold = null;   // film: knop vasthouden = steeds grotere stappen, pas laden na loslaten
  function holdStep(d) { if (!hold) hold = { t: pos(), n: 0 }; hold.n++; hold.t = Math.max(0, Math.min((cur.dur || 1e9) - 3, hold.t + d * Math.min(10 + hold.n * 5, 120))); paintBar(hold.t); osdShow(); }
  function holdEnd() { if (!hold) return; var t = hold.t; hold = null; seekTo(t); }
  function report(state) {
    if (!cur || cur.live || !cur.item || !cur.dur) return;
    var it = cur.item;
    api('POST', '/api/progress', { profile: S.profile, key: it.key, seriesKey: it.seriesKey || '', kind: it.kind, plexKey: it.plexKey || (it.meta && it.meta.plexKey) || '',
      pos: Math.round(pos() * 1000), dur: Math.round(cur.dur * 1000), state: state, meta: it.meta || {}, tmdb: it.tmdb || 0, season: it.season || 0, episode: it.episode || 0 }).catch(function () {});
  }

  // ---------- afstandsbediening: zelfde knoppen en volgorde als op de JBL ----------
  var C = { OK: 13, L: 37, U: 38, R: 39, D: 40, PP: 10252, PLAY: 415, PAUSE: 19, FF: 417, RW: 412, CHU: 427, CHD: 428, GREEN: 404, YELLOW: 405, PREV: 10190, INFO: 457, GUIDE: 458 };
  function key(e) {
    if (!cur || el.hidden || document.querySelector('.sheet, .overlay')) return;
    var c = e.keyCode, k = e.key;
    if (k === 'Enter') c = C.OK; else if (k === 'ArrowLeft') c = C.L; else if (k === 'ArrowUp') c = C.U; else if (k === 'ArrowRight') c = C.R; else if (k === 'ArrowDown') c = C.D;
    else if (k === ' ' || k === 'MediaPlayPause') c = C.PP; else if (k === 'a') c = C.GREEN; else if (k === 's') c = C.YELLOW; else if (k === 'g') c = C.GUIDE;
    if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); e.stopPropagation(); return back(); }
    if (handle(c, e.repeat) !== false) { e.preventDefault(); e.stopPropagation(); }
  }
  function keyUp(e) { if (hold && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) holdEnd(); }
  function handle(c, rep) {
    if (cur.sync) { if (c === C.OK) syncDone(); return; }
    if (menu) {
      if (c === C.U || c === C.D) { menu.sel = Math.max(0, Math.min(menu.opts.length - 1, menu.sel + (c === C.U ? -1 : 1))); menuPaint(); }
      else if (c === C.OK) menuOk(); else if (c === C.L) menuClose(); else return false;
      return;
    }
    if (!cur.live) return vodKey(c, rep);
    if (choice) { if (c === C.L || c === C.R) { choice.sel = 1 - choice.sel; choicePaint(); } else if (c === C.OK) choiceOk(); else return false; return; }
    if (gd) {
      if (c === C.U || c === C.CHU) guideMove(-1, 0); else if (c === C.D || c === C.CHD) guideMove(1, 0);
      else if (c === C.L) guideMove(0, -1); else if (c === C.R) guideMove(0, 1); else if (c === C.OK) guideOk(); else if (c === C.GUIDE) guideClose(); else return false;
      return;
    }
    if (c === C.GUIDE) return guideOpen();
    if (list) {
      if (c === C.U || c === C.D) { list.sel = Math.max(0, Math.min(cur.list.length - 1, list.sel + (c === C.U ? -1 : 1))); listPaint(); }
      else if (c === C.R) { listHide(); guideOpen(); }
      else if (c === C.OK) { var ch = cur.list[list.sel]; listHide(); tune(ch); } else return false;
      return;
    }
    if (menuOpen && el.classList.contains('bar-on')) {
      if (c === C.L) { btnSel = Math.max(0, btnSel - 1); renderButtons(); barShow(true); return; }
      if (c === C.R) { btnSel = Math.min(buttons.length - 1, btnSel + 1); renderButtons(); barShow(true); return; }
      if (c === C.OK) { if (!rep) buttons[btnSel][1](); if (cur && menuOpen && !list && !gd) barShow(true); return; }
    }
    if (c === C.U || c === C.CHU) zap(1);
    else if (c === C.D || c === C.CHD) zap(-1);
    else if (c === C.OK) { btnSel = 0; barShow(true); }
    else if (c === C.L || c === C.RW) { if (cur.replay) replaySeek(-1, rep && seekT ? seekT.n : 0); else barShow(false); }
    else if (c === C.R || c === C.FF) { if (cur.replay) replaySeek(1, rep && seekT ? seekT.n : 0); else barShow(false); }
    else if (c === C.PP || c === C.PLAY || c === C.PAUSE) toggle();
    else if (c === C.INFO) barShow(false);
    else if (c === C.PREV) { if (cur.prev) tune(cur.prev); }
    else if (c === C.GREEN) nextAudio();
    else if (c === C.YELLOW) msg('Geen ondertitels bij deze uitzending');
    else if (c >= 48 && c <= 57) digit(c - 48);
    else return false;
  }
  function vodKey(c, rep) {
    var shown = el.classList.contains('osd-on');
    if (c === C.PP || c === C.PLAY || c === C.PAUSE) press(1);
    else if (c === C.RW) press(0); else if (c === C.FF) press(2);
    else if (c === C.OK) { if (!shown || zone < 0) press(1); else press(zone); }
    else if (c === C.L || c === C.R) {
      var d = c === C.L ? -1 : 1;
      if (!shown || zone < 0) { zone = -1; if (rep) holdStep(d); else if (!hold) press(d < 0 ? 0 : 2); }
      else zone = Math.max(0, Math.min(5, zone + d));
    }
    else if (c === C.D) zone = 1;    // omlaag: naar de knoppen (begint op pauze)
    else if (c === C.U) zone = -1;   // omhoog: terug naar de balk
    else if (c === C.GREEN) return audioMenu();
    else if (c === C.YELLOW) return subtitleMenu();
    else if (c !== C.INFO) return false;
    if (!menu) osdShow();
  }
  // Terug, in dezelfde volgorde als op de JBL.
  function back() {
    if (!cur) return;
    if (cur.sync) return syncStop();
    if (menu) return menuClose();
    if (!cur.live) { if (el.classList.contains('osd-on')) return osdHide(); return close(); }
    if (choice) return choiceHide();
    if (gd) return guideClose();
    if (list) return listHide();
    if (menuOpen && el.classList.contains('bar-on')) return barHide();
    if (cur.replay || cur.pausedAt) return tune(cur.ch);
    close();
  }

  // ---------- openen en sluiten ----------
  function open(isLive) {
    if (!el) build();
    clearInterval(tickT); tickT = setInterval(tick, 250);
    el.hidden = false; el.className = 'sp ' + (isLive ? 'is-live' : 'is-vod') + (E.transparent ? ' native' : '');
    document.documentElement.classList.add('sp-open'); if (E.transparent) document.documentElement.classList.add('sp-native');
    if (!K.N) history.pushState({ speler: 1 }, '');   // webversie: terugvegen sluit de speler
  }
  function close(fromHistory) {
    if (!cur) return;
    // Webversie: via de browsergeschiedenis, die roept close(true) aan. Zo blijft terugvegen kloppen.
    if (!K.N && !fromHistory) return history.back();
    report('stopped'); E.stop(); guideClose(); listHide(); choiceHide(); if (menu) menuClose(); msgOff(); barHide(); osdHide();
    cur = null; hold = seekT = null; clearInterval(tickT); el.hidden = true; subShown = null; if (subEl) subEl.innerHTML = '';
    document.documentElement.classList.remove('sp-open', 'sp-native');
  }

  // Film of aflevering. item zoals kern.js het samenstelt; offsetMs = waar je was.
  function vod(item) {
    open(false);
    cur = { item: item, live: false, off: 0, dur: 0 };
    var mine = cur;
    el.querySelector('.sv-tt').textContent = String((item.meta && item.meta.title) || item.title || '').replace(/\s*\(\d{4}\)[\s.]*$/, '');
    el.querySelector('.sv-st').textContent = item.sub || (item.meta && item.meta.sub) || '';
    zone = -1; vodButtons(); osdShow(); msg('Laden…', 0);
    // Net als op de JBL: pas verder waar je was na meer dan een minuut.
    var from = (item.offsetMs || 0) > 60e3 ? Math.floor(item.offsetMs / 1000) : 0;
    var tr = api('POST', '/api/media/tracks', { src: item.url }).catch(function () { return { audio: [], subs: [] }; });
    E.load(item.url, from, false).then(function (d) {
      if (cur !== mine) return;
      cur.dur = d || 0; msgOff('Laden…'); paint();
      if (from && (!cur.dur || from < cur.dur * 0.95)) msg('Verder vanaf ' + fmt(from) + (item.resumeVia ? ' (gekeken via ' + item.resumeVia + ')' : ''));
      return tr.then(function (t) { if (cur !== mine) return; cur.tracks = t; autoSubs(); });
    }, function (e) { msg('Dit speelt niet af\n' + e.message, 0); });
  }
  // Live, of terugkijken als start > 0. catId: de categorie waarin je zapt.
  function live(catId, chId, start, end, title) {
    open(true);
    cur = { live: true, off: 0, dur: 0, list: [], ch: { id: chId, name: '' } };
    var cats = S.cats ? Promise.resolve(S.cats) : get('/api/live/categories').then(function (c) { S.cats = c; S.catsAt = Date.now(); return c; });
    cats.then(function (cs) {
      var c = cs.filter(function (x) { return x.id === catId; })[0] || cs.filter(function (x) { return x.id === 'alle'; })[0] || cs[0] || { channels: [] };
      var all = cs.reduce(function (l, x) { return l.concat(x.channels); }, []);
      cur.list = c.channels.length ? c.channels : all;
      var ch = cur.list.filter(function (x) { return String(x.id) === String(chId); })[0] || all.filter(function (x) { return String(x.id) === String(chId); })[0] || cur.ch;
      if (!start) return tune(ch);
      cur.ch = ch; replay({ title: title, start: start, end: end }, start);
    }).catch(function (e) { msg('Live tv lukt nu niet: ' + e.message, 0); });
  }

  // key: een knop die het apparaat zelf doorgeeft (Android: zenders, kleuren, gids), met dezelfde codes als hierboven.
  // stand(): voor testen en foutzoeken (positie, lengte, getoonde ondertitel).
  window.Speler = { vod: vod, live: live, isOpen: function () { return !!cur; }, back: back, close: close,
    stand: function () { return cur ? { pos: pos(), dur: cur.dur, live: !!cur.live, paused: E.paused(), sub: subShown ? subShown.t : '' } : null; },
    spoel: function (sec) { seekTo(sec); },
    key: function (c, rep) { if (cur && !el.hidden && !document.querySelector('.sheet, .overlay')) handle(c, rep); } };
})();

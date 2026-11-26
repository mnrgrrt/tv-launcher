/* Sjuul TV op Samsung (Tizen 6), testversie: de schil. Doet hier wat de Android-app op de andere tv doet:
   - window.Native: koppelen en praten met tv-serverr, apps openen, afspelen;
   - window.SpelerMotor: de Samsung-speler (AVPlay) onder de gedeelde knoppen van speler.js;
   - afstandsbediening: Terug, Afspelen/pauze, kanaal omhoog/omlaag.
   De schermen zelf (index.html, kern.js, thuis.js, speler.js) zitten in de map app/ van dit pakket,
   uit dezelfde testversie als de Android-app. Nieuwe versie = opnieuw installeren.
   Alleen de eigen sleutel van dit apparaat staat hier; alle andere sleutels en wachtwoorden blijven op de server. */
(function () {
  'use strict';
  var LS = window.localStorage;
  function url() { return LS.getItem('sjuul.url') || ''; }
  function key() { return LS.getItem('sjuul.key') || ''; }
  function cb(id, ok, data) { setTimeout(function () { if (window.__nativeCb) window.__nativeCb(id, ok, data == null ? '' : String(data)); }, 0); }
  function clean(u) { u = String(u || '').trim().replace(/\/+$/, ''); if (u && !/^https?:\/\//.test(u)) u = 'http://' + u; return u; }

  // ---------- Native: dezelfde namen als de Android-app ----------
  window.Native = {
    base: function () { return url(); },
    httpProxy: function () { return ''; },
    // Geen systeeminstellingen, inspreken of zelf bijwerken: dat regelt de Samsung zelf. Schermbeveiliging binnen Sjuul TV (appSaver).
    features: function () { return JSON.stringify({ apps: true, inputs: true, saver: false, appSaver: true, system: false, voice: false, update: false }); },
    // HDMI-ingangen met iets erop (bij het opstarten opgehaald, zie hieronder).
    getInputs: function () { return JSON.stringify(inputs.map(function (s) { return { id: 'HDMI' + s.number, port: s.number, label: 'HDMI ' + s.number, standby: false }; })); },
    // Naar een ingang: de bron van de tv omzetten en dan het gewone tv-beeld openen. De afstandsbediening werkt dan
    // weer op dat apparaat (Anynet+). Terug in Sjuul TV via Home en dan Sjuul TV.
    openInput: function (id) {
      var s = inputs.filter(function (x) { return 'HDMI' + x.number === id; })[0];
      var view = function () { try { tizen.application.launch('org.tizen.tv-viewer'); } catch (e) {} };
      try { if (s) tizen.tvwindow.setSource(s, view, view); else view(); } catch (e) { view(); }
    },
    metered: function () { return false; },
    appVersion: function () { try { return tizen.application.getAppInfo().version; } catch (e) { return ''; } },
    srvInfo: function () { return JSON.stringify({ paired: !!key(), profile: +LS.getItem('sjuul.profiel') || 0, url: url(), device: 'Samsung' }); },
    srvSetProfile: function (p) { LS.setItem('sjuul.profiel', String(p)); },
    srvUnpair: function () { LS.removeItem('sjuul.key'); LS.removeItem('sjuul.profiel'); },
    srvPair: function (id, u, code, name) {
      var base = clean(u) || url();
      fetch(base + '/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, name: name || 'Samsung' }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); })
        .then(function (j) { LS.setItem('sjuul.url', base); LS.setItem('sjuul.key', j.key); cb(id, true, ''); }, function (e) { cb(id, false, e.message); });
    },
    srv: function (id, method, path, body) {
      fetch(url() + path, { method: method, headers: { 'X-Thuis-Key': key(), 'Content-Type': 'application/json' }, body: body || undefined })
        .then(function (r) { return r.text().then(function (t) {
          if (r.status === 401) throw new Error('NIET_GEKOPPELD');
          if (!r.ok) { var m = t; try { m = JSON.parse(t).error || t; } catch (e) {} throw new Error(m); }
          cb(id, true, t);
        }); }).catch(function (e) { cb(id, false, e.message || 'Geen verbinding met tv-serverr'); });
    },
    // Afspelen: de gedeelde speler, met AVPlay eronder.
    // Apps van de Samsung zelf (Netflix, YouTube, ...).
    getApps: function (id) {
      try {
        tizen.application.getAppsInfo(function (l) {
          cb(id, true, JSON.stringify(l.filter(function (a) { return a.show && a.id.indexOf('SjuulTVapp') !== 0; })
            .map(function (a) { return { pkg: a.id, label: a.name, icon: a.iconPath || '', banner: '' }; })));
        }, function (e) { cb(id, false, e.message); });
      } catch (e) { cb(id, false, e.message); }
    },
    launch: function (pkg) { try { tizen.application.launch(pkg); } catch (e) {} },
    // Het eigen startscherm van Samsung (Smart Hub). Op nieuwere tv's heet dat com.samsung.tv.csfs; staat dat er niet,
    // dan zoeken we het in de lijst met apps (ook verborgen apps). Geeft false als er niets te openen is.
    samsungHome: function () {
      var id = homeId || 'com.samsung.tv.csfs';
      try { tizen.application.launch(id, null, function () { findHome(true); }); return true; } catch (e) { return findHome(true); }
    },
    // Trailers en YouTube: in de YouTube-app van Samsung.
    openUrl: function (u) {
      var m = /[?&]v=([\w-]{6,})/.exec(u || '');
      try {
        var data = m ? [new tizen.ApplicationControlData('PAYLOAD', [JSON.stringify({ values: 'v=' + m[1] })])] : [];
        tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', u, null, null, data), '111299001912');
      } catch (e) {}
    }
  };

  // Id van het Samsung-startscherm op deze tv, opgezocht bij het opstarten.
  var homeId = '';
  function findHome(open) {
    try {
      tizen.application.getAppsInfo(function (l) {
        var a = l.filter(function (x) { return /csfs|homescreen|smarthub|smart-hub/i.test(x.id); })[0];
        if (a) { homeId = a.id; if (open) try { tizen.application.launch(a.id); } catch (e) {} }
      });
      return true;
    } catch (e) { return false; }
  }
  findHome(false);

  // Taalnaam bij een spoor (zelfde lijst als de webversie, kort gehouden).
  var LANGNAMES = { nl:'Nederlands', nld:'Nederlands', dut:'Nederlands', en:'Engels', eng:'Engels', de:'Duits', deu:'Duits', ger:'Duits', fr:'Frans', fra:'Frans', fre:'Frans', es:'Spaans', spa:'Spaans', it:'Italiaans', ita:'Italiaans' };
  function langName(c) { c = String(c || '').toLowerCase(); return LANGNAMES[c] || (c && c !== 'und' ? c.toUpperCase() : ''); }

  var inputs = [];
  function loadInputs() {
    return new Promise(function (done) {
      // Wat er ook misgaat bij het uitlezen van de HDMI-bronnen: altijd done(), anders blijft het opstarten hangen.
      try {
        tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (v) {
          try { inputs = (v.connected || []).filter(function (s) { return s.type === 'HDMI'; }); } catch (e) {}
          done();
        }, function () { done(); });
      } catch (e) { done(); }
    });
  }

  // ---------- Samsung-speler (AVPlay) onder de knoppen ----------
  // Films en afleveringen: net als de webversie via HLS van tv-serverr (ffmpeg maakt er H.264/HEVC + AAC van,
  // ondertitels lezen mee). Deze oude browser kan die HLS zelf niet afspelen (geen bruikbare MediaSource), dus
  // AVPlay speelt de HLS van de server af. Live: rechtstreeks op de bron (sneller zappen).
  function srvHls(path, body) {
    return fetch(url() + path, { method: 'POST', headers: { 'X-Thuis-Key': key(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function stopHls(id) { if (id) try { fetch(url() + '/api/hls/stop', { method: 'POST', headers: { 'X-Thuis-Key': key(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) }); } catch (e) {} }
  window.SpelerMotor = function (root, ev) {
    var av = webapis.avplay, obj = document.createElement('object'), paused = false;
    obj.type = 'application/avplayer'; obj.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
    root.insertBefore(obj, root.firstChild);
    var base = 0, id = '', src = '', live = false, aud = [], ai = 0, loads = 0;
    function call(n) { if (ev[n]) ev[n](); }
    function shut() { try { av.stop(); } catch (e) {} try { av.close(); } catch (e) {} }
    function tracks() { try { return av.getTotalTrackInfo().filter(function (t) { return t.type === 'AUDIO'; }); } catch (e) { return []; } }
    // Eén bron in AVPlay openen en starten. mine = volgnummer, zodat een oude aanroep niets meer doet na snel spoelen.
    function open(mediaUrl, startAt, dur, mine, resolve, reject) {
      if (mine !== loads) { resolve(dur || 0); return; }
      try {
        av.open(mediaUrl);
        av.setDisplayRect(0, 0, 1920, 1080);
        av.setListener({
          onbufferingstart: function () { call('waiting'); }, onbufferingcomplete: function () { call('playing'); },
          onstreamcompleted: function () { call('ended'); }, onerror: function () { call('error'); }
        });
        base = startAt || 0;
        av.prepareAsync(function () {
          if (mine !== loads) { shut(); resolve(dur || 0); return; }
          av.play(); paused = false; call('playing');
          resolve(dur || (live ? 0 : Math.round((av.getDuration() || 0) / 1000)));
        }, function () { reject(new Error('Deze bron speelt niet af')); });
      } catch (e) { reject(new Error('Deze bron speelt niet af')); }
    }
    var m = {
      transparent: true,
      load: function (s, from, isLive, audio) {
        src = s; live = !!isLive; if (typeof audio === 'number') ai = audio;
        var mine = ++loads; shut(); stopHls(id); id = '';
        return new Promise(function (resolve, reject) {
          if (live) { aud = []; open(url() + s, 0, 0, mine, resolve, reject); return; }
          // Film of aflevering: eerst de HLS op de server starten (ondertekende /stream-link als bron), dan AVPlay.
          srvHls('/api/hls/start', { src: s, from: Math.floor(from || 0), hevc: true, audio: ai }).then(function (r) {
            if (mine !== loads) { resolve(r.dur || 0); return; }
            id = r.id; aud = r.audio || []; if (r.audioIndex != null) ai = r.audioIndex;
            open(url() + r.url, r.start || 0, r.dur || 0, mine, resolve, reject);
          }, function (e) { if (mine === loads) reject(e); });
        });
      },
      time: function () { try { return base + (av.getCurrentTime() || 0) / 1000; } catch (e) { return base; } },
      buffered: function () { return m.time(); },
      // Live: gewoon AVPlay. Film: binnen wat er is meteen, anders laat de server opnieuw beginnen vanaf dat punt.
      seek: function (sec) {
        if (live) return new Promise(function (res) { try { av.seekTo(Math.round(sec * 1000), res, res); } catch (e) { res(); } });
        var cur = m.time(), rel = sec - base;
        if (rel < 0 || Math.abs(sec - cur) > 120) return m.load(src, sec, false, ai).then(function () {});
        return new Promise(function (res) { try { av.seekTo(Math.round(rel * 1000), res, res); } catch (e) { res(); } });
      },
      paused: function () { return paused; },
      play: function () { try { av.play(); } catch (e) {} paused = false; call('play'); },
      pause: function () { try { av.pause(); } catch (e) {} paused = true; call('pause'); },
      stop: function () { shut(); stopHls(id); id = ''; },
      audio: function () {
        // Film: de sporen die de server doorgaf (daar wordt er één van gekozen). Live: de sporen in de AVPlay-stroom.
        if (!live) return aud.map(function (t, i) { return { label: t.title || langName(t.lang) || ('Spoor ' + (i + 1)), lang: t.lang, codec: t.codec, on: i === ai }; });
        var now = -1; try { now = (av.getCurrentStreamInfo().filter(function (t) { return t.type === 'AUDIO'; })[0] || {}).index; } catch (e) {}
        return tracks().map(function (t, i) {
          var x = {}; try { x = JSON.parse(t.extra_info); } catch (e) {}
          return { label: (x.language || 'Spoor ' + (i + 1)) + (x.channels ? ' \u00b7 ' + x.channels + ' kanalen' : ''), on: t.index === now };
        });
      },
      // Film: een ander geluidsspoor laat de server opnieuw omzetten. Live: in de stroom zelf wisselen.
      setAudio: function (i) {
        if (!live) { ai = i; return m.load(src, m.time(), false, i); }
        var t = tracks()[i]; if (t) try { av.setSelectTrack('AUDIO', t.index); } catch (e) {}
      }
    };
    return m;
  }

  // ---------- afstandsbediening ----------
  // Testversie: alle knoppen vragen die Samsung toestaat. Een knop waar Sjuul TV niets mee doet, toont kort zijn naam,
  // zodat we kunnen zien of bijvoorbeeld de knop rechtsboven bruikbaar is als Home.
  var names = {};
  try {
    var ks = tizen.tvinputdevice.getSupportedKeys();
    ks.forEach(function (k) { names[k.code] = k.name; });
    tizen.tvinputdevice.registerKeyBatch(ks.map(function (k) { return k.name; }));
  } catch (e) {}
  var KNOWN = { 13: 1, 37: 1, 38: 1, 39: 1, 40: 1, 10009: 1, 10252: 1, 415: 1, 19: 1, 417: 1, 412: 1, 427: 1, 428: 1 };
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 10009) {   // Terug: net als op de andere tv via de schermen zelf
      e.preventDefault(); e.stopPropagation();
      if (window.__back) window.__back();
      return;
    }
    if (!KNOWN[e.keyCode] && names[e.keyCode] && window.Kern) window.Kern.ui.toast('Knop: ' + names[e.keyCode] + ' (' + e.keyCode + ')', 5000);
  }, true);
  // Home: Samsung houdt die knop voor zichzelf. Kom je daarna terug in Sjuul TV, dan sta je weer op Home van Sjuul TV,
  // net als na Home op de andere tv. Wat speelde stopt.
  // Samsung houdt de pagina in leven als je de app verlaat. Bij terugkomen sta je anders nog op het laatste scherm
  // (bv. Films). Daarom op elk teken van "weer op de voorgrond" terug naar Home. We vangen meerdere signalen op,
  // want op de ene tv komt visibilitychange, op de andere pageshow of de app-control bij opnieuw openen.
  function naarVoorgrond() { if (window.__home) window.__home(); }
  function naarAchtergrond() { if (window.Speler && window.Speler.isOpen()) window.Speler.close(); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) naarAchtergrond(); else naarVoorgrond(); });
  window.addEventListener('pageshow', naarVoorgrond);
  try { window.addEventListener('appcontrol', naarVoorgrond); } catch (e) {}
  // Tizen: sommige toestellen melden terugkomen via de application-service.
  try {
    var apr = tizen.application.getCurrentApplication();
    if (apr && apr.addEventListener) apr.addEventListener('resume', naarVoorgrond);
  } catch (e) {}

  // ---------- oude browser van Tizen 6 (Chromium 76) ----------
  // De schermen gebruiken `gap` in flex-rijen en `aspect-ratio` op tegels. Die kent deze browser nog niet:
  // tegels en knoppen kwamen tegen elkaar aan en tegels werden plat. Hier rekenen we dat na in marges en hoogtes,
  // alleen als de browser het zelf niet kan. Op nieuwere Samsungs doet dit dus niets.
  var flexGap = (function () {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
    d.appendChild(document.createElement('div')); d.appendChild(document.createElement('div'));
    document.documentElement.appendChild(d); var ok = d.scrollHeight === 1; d.remove(); return ok;
  })();
  var ratio = window.CSS && CSS.supports && CSS.supports('aspect-ratio', '1 / 1');
  function px(v) { v = parseFloat(v); return isNaN(v) ? 0 : v; }
  function shown(c) { var s = getComputedStyle(c); return s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed'; }
  // Marge altijd vanaf de eigen marge van het element, zodat opnieuw rekenen (er komt een tegel bij) niets optelt.
  function base(el) { if (!el._gb) { var s = getComputedStyle(el); el._gb = { r: px(s.marginRight), b: px(s.marginBottom) }; } return el._gb; }
  function setGap(el) {
    var s = getComputedStyle(el);
    if (s.display !== 'flex' && s.display !== 'inline-flex') return;
    var rg = px(s.rowGap), cg = px(s.columnGap);
    if (!rg && !cg && !el._gapped) return;
    el._gapped = true;
    var col = s.flexDirection.indexOf('column') === 0, wrap = s.flexWrap !== 'nowrap';
    var items = [].filter.call(el.children, shown);
    items.forEach(function (c, i) {
      var b = base(c), last = i === items.length - 1;
      // Ruimte achter elk element behalve het laatste: zo blijft een `margin-left: auto` (klok, aantal titels) werken.
      c.style.marginRight = (b.r + (wrap || (!col && !last) ? cg : 0)) + 'px';
      c.style.marginBottom = (b.b + (wrap || (col && !last) ? rg : 0)) + 'px';
    });
    if (wrap) { var e = base(el); el.style.marginRight = (e.r - cg) + 'px'; el.style.marginBottom = (e.b - rg) + 'px'; }
  }
  // Tegels zonder hoogte: hoogte uit de breedte (16:9, afleveringen 16:10).
  // In een knop rekent deze browser `width: 100%` niet goed uit (de tegel werd zo smal als zijn inhoud),
  // dus de breedte nemen we zelf over van de knop eromheen.
  function setRatio(el) {
    if (!el.classList.contains('thumb')) return;
    var p = el.parentElement, w = el.offsetWidth;
    if (p && p.tagName === 'BUTTON') {
      var s = getComputedStyle(p);
      w = p.clientWidth - px(s.paddingLeft) - px(s.paddingRight);
      if (w > 0) el.style.width = w + 'px';
    }
    if (w > 0) el.style.height = Math.round(w / (el.closest('.ep') ? 1.6 : 16 / 9)) + 'px';
  }
  function fixTree(root) {
    if (root.nodeType !== 1) return;
    var all = [root].concat([].slice.call(root.querySelectorAll('*')));
    if (!ratio) all.forEach(setRatio);
    if (!flexGap) all.forEach(setGap);
  }
  if (!flexGap || !ratio) {
    new MutationObserver(function (list) {
      var added = [], parents = [];
      list.forEach(function (m) {
        [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) added.push(n); });
        if (parents.indexOf(m.target) < 0) parents.push(m.target);   // rij kreeg er een tegel bij of eraf
      });
      added.forEach(function (n) { if (n.isConnected) fixTree(n); });
      if (!flexGap) parents.forEach(function (n) { if (n.nodeType === 1 && n.isConnected) setGap(n); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---------- opstarten: eerst het adres van tv-serverr, dan de schermen ----------
  function opzet(msg) {
    var o = document.getElementById('opzet'), a = document.getElementById('adres'), b = document.getElementById('verder');
    o.hidden = false; if (msg) document.getElementById('uitleg').textContent = msg;
    if (url()) a.value = url();
    a.focus();
    o.onkeydown = function (e) {
      if (e.keyCode === 40 && document.activeElement === a) b.focus();
      else if (e.keyCode === 38 && document.activeElement === b) a.focus();
    };
    b.onclick = function () { LS.setItem('sjuul.url', clean(a.value)); o.hidden = true; start(); };
  }
  // Leest app/index.html en laadt de stijlen en scripts in dezelfde volgorde. Native en SpelerMotor staan dan al klaar.
  function start() {
    var base = url();
    if (!base) return opzet();
    fetch(base + '/api/health').then(function (r) { if (!r.ok) throw new Error(r.status); return loadInputs(); }).then(function () { return fetch('app/index.html'); }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html'), app = '';
      // Alles in de schermen (scripts, stijlen, services.json) is relatief aan app/, net als op de andere apparaten.
      var bs = document.createElement('base'); bs.href = 'app/'; document.head.insertBefore(bs, document.head.firstChild);
      // Eerst de stijlen helemaal laden: anders worden tegels gemeten voordat ze hun maat hebben.
      var css = [].map.call(doc.querySelectorAll('link[rel=stylesheet]'), function (l) {
        return new Promise(function (done) { var n = document.createElement('link'); n.rel = 'stylesheet'; n.href = app + l.getAttribute('href'); n.onload = n.onerror = done; document.head.appendChild(n); });
      });
      [].forEach.call(doc.body.children, function (n) { if (n.tagName !== 'SCRIPT') document.body.appendChild(document.importNode(n, true)); });
      var scripts = [].map.call(doc.querySelectorAll('script[src]'), function (s) { return app + s.getAttribute('src'); });
      Promise.all(css).then(function next() {
        var s = scripts.shift(); if (!s) return;
        var n = document.createElement('script'); n.src = s; n.onload = function () { next(); };
        n.onerror = function () { opzet('Een deel van Sjuul TV ontbreekt in dit pakket. Installeer de testversie opnieuw.'); };
        document.body.appendChild(n);
      });
    }).catch(function () { opzet('tv-serverr is niet bereikbaar op ' + base + '. Klopt het adres?'); });
  }
  document.addEventListener('DOMContentLoaded', start);
})();

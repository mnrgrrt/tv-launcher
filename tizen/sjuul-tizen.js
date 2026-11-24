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
    // Geen HDMI-tegels, schermbeveiliging, systeeminstellingen, inspreken of zelf bijwerken: dat regelt de Samsung zelf.
    features: function () { return JSON.stringify({ apps: true, inputs: true, saver: false, system: false, voice: false, update: false }); },
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
    playItem: function (json) { window.Speler.vod(JSON.parse(json)); },
    playLive: function (catId, id, start, end, title) { window.Speler.live(catId, id, start, end, title); },
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
    // Trailers en YouTube: in de YouTube-app van Samsung.
    openUrl: function (u) {
      var m = /[?&]v=([\w-]{6,})/.exec(u || '');
      try {
        var data = m ? [new tizen.ApplicationControlData('PAYLOAD', [JSON.stringify({ values: 'v=' + m[1] })])] : [];
        tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', u, null, null, data), '111299001912');
      } catch (e) {}
    }
  };

  var inputs = [];
  function loadInputs() {
    return new Promise(function (done) {
      try { tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (v) { inputs = (v.connected || []).filter(function (s) { return s.type === 'HDMI'; }); done(); }, function () { done(); }); }
      catch (e) { done(); }
    });
  }

  // ---------- Samsung-speler (AVPlay) onder de knoppen ----------
  window.SpelerMotor = function (root, ev) {
    var av = webapis.avplay, obj = document.createElement('object'), paused = false;
    obj.type = 'application/avplayer'; obj.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
    root.insertBefore(obj, root.firstChild);
    function call(n) { if (ev[n]) ev[n](); }
    function shut() { try { av.stop(); } catch (e) {} try { av.close(); } catch (e) {} }
    function tracks() { try { return av.getTotalTrackInfo().filter(function (t) { return t.type === 'AUDIO'; }); } catch (e) { return []; } }
    var m = {
      transparent: true,
      load: function (src, from, live) {
        return new Promise(function (resolve, reject) {
          shut();
          try {
            av.open(url() + src);   // ondertekende link van tv-serverr; geen sleutels in de link
            av.setDisplayRect(0, 0, 1920, 1080);
            av.setListener({
              onbufferingstart: function () { call('waiting'); }, onbufferingcomplete: function () { call('playing'); },
              onstreamcompleted: function () { call('ended'); }, onerror: function () { call('error'); }
            });
            av.prepareAsync(function () {
              var go = function () { av.play(); paused = false; call('playing'); resolve(live ? 0 : Math.round((av.getDuration() || 0) / 1000)); };
              if (!live && from > 0) av.seekTo(from * 1000, go, go); else go();
            }, function () { reject(new Error('Deze bron speelt niet af')); });
          } catch (e) { reject(new Error('Deze bron speelt niet af')); }
        });
      },
      time: function () { try { return (av.getCurrentTime() || 0) / 1000; } catch (e) { return 0; } },
      buffered: function () { return m.time(); },
      seek: function (sec) { return new Promise(function (res) { try { av.seekTo(Math.round(sec * 1000), res, res); } catch (e) { res(); } }); },
      paused: function () { return paused; },
      play: function () { try { av.play(); } catch (e) {} paused = false; call('play'); },
      pause: function () { try { av.pause(); } catch (e) {} paused = true; call('pause'); },
      stop: shut,
      audio: function () {
        var now = -1; try { now = (av.getCurrentStreamInfo().filter(function (t) { return t.type === 'AUDIO'; })[0] || {}).index; } catch (e) {}
        return tracks().map(function (t, i) {
          var x = {}; try { x = JSON.parse(t.extra_info); } catch (e) {}
          return { label: (x.language || 'Spoor ' + (i + 1)) + (x.channels ? ' · ' + x.channels + ' kanalen' : ''), on: t.index === now };
        });
      },
      setAudio: function (i) { var t = tracks()[i]; if (t) try { av.setSelectTrack('AUDIO', t.index); } catch (e) {} }
    };
    return m;
  };

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
  // Home: Samsung houdt die knop voor zichzelf. Kom je daarna terug in Sjuul TV, dan sta je op Home van Sjuul TV,
  // net als na Home op de andere tv. Wat speelde stopt.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (window.Speler && window.Speler.isOpen()) window.Speler.close(); return; }
    if (window.__home) window.__home();
  });

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
      [].forEach.call(doc.querySelectorAll('link[rel=stylesheet]'), function (l) { var n = document.createElement('link'); n.rel = 'stylesheet'; n.href = app + l.getAttribute('href'); document.head.appendChild(n); });
      [].forEach.call(doc.body.children, function (n) { if (n.tagName !== 'SCRIPT') document.body.appendChild(document.importNode(n, true)); });
      var scripts = [].map.call(doc.querySelectorAll('script[src]'), function (s) { return app + s.getAttribute('src'); });
      (function next() {
        var s = scripts.shift(); if (!s) return;
        var n = document.createElement('script'); n.src = s; n.onload = next;
        n.onerror = function () { opzet('Een deel van Sjuul TV ontbreekt in dit pakket. Installeer de testversie opnieuw.'); };
        document.body.appendChild(n);
      })();
    }).catch(function () { opzet('tv-serverr is niet bereikbaar op ' + base + '. Klopt het adres?'); });
  }
  document.addEventListener('DOMContentLoaded', start);
})();

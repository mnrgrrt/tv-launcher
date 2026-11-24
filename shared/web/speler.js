/* Sjuul TV: de gedeelde speler. Eén knoppenbalk en één manier van werken op elk apparaat, met alles wat de
   Android-spelers konden: gids en zenderlijst in beeld, live pauzeren, zappen met cijfers, versneld spoelen,
   geluidssporen, ondertitels (uit het bestand, van Plex of OpenSubtitles) met gelijkzetten en eigen weergave.
   Onder de knoppen zit per apparaat een motor:
   - browser (iPad, iPhone): HLS van tv-serverr, die de bron omzet (staat hieronder);
   - Samsung (testapp): AVPlay, en straks Android: ExoPlayer. De schil van dat apparaat zet die klaar als window.SpelerMotor.
   Bediening: aanraken, of pijltjes, OK en terug. */
(function () {
  'use strict';
  var K = window.Kern, S = K.S, esc = K.esc, h = K.h, clock = K.clock, dayName = K.dayName, get = K.get, api = K.api;
  var el = null, E = null, cur = null, hideT = 0, tickT = 0, lastReport = 0, foc = -1;
  var ev = {};   // wat de motor meldt: playing, waiting, pause, play, ended, error

  // ---------- namen van talen ----------
  var LANG = { nl: 'Nederlands', nld: 'Nederlands', dut: 'Nederlands', en: 'Engels', eng: 'Engels', de: 'Duits', deu: 'Duits', ger: 'Duits', fr: 'Frans', fra: 'Frans', fre: 'Frans',
    es: 'Spaans', spa: 'Spaans', it: 'Italiaans', ita: 'Italiaans', da: 'Deens', dan: 'Deens', sv: 'Zweeds', swe: 'Zweeds', no: 'Noors', nor: 'Noors', tr: 'Turks', tur: 'Turks', pl: 'Pools', pol: 'Pools' };
  function lang(c) { c = String(c || '').toLowerCase(); return LANG[c] || (c && c !== 'und' ? c.toUpperCase() : ''); }
  var isNl = function (c) { return /^(nl|nld|dut)$/i.test(c || ''); };
  function trackLabel(t, i) { return [lang(t.lang) || 'Spoor ' + (i + 1), t.title, t.channels > 2 ? t.channels + ' kanalen' : ''].filter(Boolean).join(' · '); }

  // ---------- motor van de browser: HLS via tv-serverr ----------
  // Elke motor heeft: load(src, from, live) -> Promise(lengte in s, 0 bij live), time(), buffered(), seek(s) -> Promise,
  // paused(), play(), pause(), stop(). src is een ondertekend serverpad (/stream/...). Optioneel: audio() en setAudio(i).
  function browserMotor(root) {
    var v = h('video', { playsinline: '', 'webkit-playsinline': '', preload: 'auto' }), base = 0, id = '', src = '', live = false, aud = [], ai = 0;
    root.insertBefore(v, root.firstChild);
    ['playing', 'waiting', 'pause', 'play', 'ended', 'error'].forEach(function (n) { v.addEventListener(n, function () { if (ev[n]) ev[n](); }); });
    function end() { try { return v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0; } catch (e) { return 0; } }
    var m = {
      load: function (s, from, isLive) {
        if (s !== src) ai = 0;
        src = s; live = !!isLive; base = live ? 0 : Math.floor(from || 0);
        return api('POST', '/api/hls/start', { src: s, from: base, low: !!S.low, audio: ai }).then(function (r) {
          id = r.id; aud = r.audio || []; ai = r.audioIndex || 0; v.src = r.url; v.play().catch(function () {}); return r.dur;
        });
      },
      time: function () { return base + (v.currentTime || 0); },
      buffered: function () { try { return v.buffered.length ? base + v.buffered.end(v.buffered.length - 1) : 0; } catch (e) { return 0; } },
      // Binnen wat al omgezet is: meteen. Verder weg, of terug voor het beginpunt: de server begint opnieuw vanaf daar.
      seek: function (sec) { var rel = sec - base; if (rel >= 0 && rel <= end() - 2) { v.currentTime = rel; return Promise.resolve(); } return m.load(src, sec, false); },
      paused: function () { return v.paused; }, play: function () { v.play().catch(function () {}); }, pause: function () { v.pause(); },
      stop: function () { if (id) { api('POST', '/api/hls/stop', { id: id }).catch(function () {}); id = ''; } src = ''; v.pause(); v.removeAttribute('src'); v.load(); },
      // Ander geluidsspoor: de server zet opnieuw om, vanaf waar je nu bent.
      audio: function () { return aud.map(function (t, i) { return { label: trackLabel(t, i), lang: t.lang, on: i === ai }; }); },
      setAudio: function (i) { ai = i; return m.load(src, live ? 0 : m.time(), live); }
    };
    return m;
  }

  // ---------- opbouw ----------
  var I = {
    play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>', pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" stroke="none"/>',
    back10: '<path d="M11 5L6 9l5 4" /><path d="M6 9h8a5 5 0 1 1 0 10h-3"/>', fwd30: '<path d="M13 5l5 4-5 4"/><path d="M18 9h-8a5 5 0 1 0 0 10h3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>'
  };
  var svg = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  function btn(icon, label, fn, cls) { var b = h('button', { class: 'sb ' + (cls || ''), 'aria-label': label }, svg(I[icon])); b.onclick = function (e) { e.stopPropagation(); fn(); show(); }; return b; }
  function textBtn(t, fn) { var b = h('button', { class: 'st' }, esc(t)); b.onclick = function (e) { e.stopPropagation(); fn(); show(); }; return b; }

  function build() {
    el = h('div', { class: 'sp' }, '<div class="sp-sub"></div><div class="sp-spin"></div><div class="sp-msg" hidden></div><div class="sp-num" hidden></div>');
    E = window.SpelerMotor ? window.SpelerMotor(el, ev) : browserMotor(el);
    if (E.transparent) el.classList.add('native');   // beeld zit onder de pagina (AVPlay, ExoPlayer)
    var top = h('div', { class: 'sp-top' }, '<div class="sp-tt"><b></b><span></span></div>');
    top.appendChild(btn('close', 'Sluiten', function () { close(); }, 'x'));
    var bot = h('div', { class: 'sp-bot' }, '<div class="sp-bar"><i class="b"></i><i class="p"></i><s></s></div><div class="sp-time"><span class="l"></span><span class="r"></span></div><div class="sp-row"></div>');
    el.appendChild(top); el.appendChild(h('div', { class: 'sp-mid' })); el.appendChild(bot);
    el.onclick = function () { if (cur && cur.sync) return syncDone(); if (el.classList.contains('osd')) hide(); else show(); };
    // Spoelen met aanraken of muis: over de balk schuiven, loslaten = daarheen.
    var bar = bot.querySelector('.sp-bar'), dragging = false;
    function frac(e) { var r = bar.getBoundingClientRect(), x = (e.touches ? e.touches[0] : e).clientX; return Math.min(1, Math.max(0, (x - r.left) / r.width)); }
    function drag(e) { if (!cur || cur.live || !cur.dur) return; e.preventDefault(); e.stopPropagation(); dragging = frac(e); paintBar(dragging * cur.dur); show(); }
    function release() { if (dragging !== false) { var f = dragging; dragging = false; seekTo(f * cur.dur); } }
    bar.addEventListener('touchstart', drag, { passive: false }); bar.addEventListener('touchmove', drag, { passive: false });
    bar.addEventListener('touchend', function (e) { e.stopPropagation(); release(); });
    bar.addEventListener('mousedown', function (e) {
      drag(e);
      var mv = function (e2) { drag(e2); }, up = function () { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); release(); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    bar.onclick = function (e) { e.stopPropagation(); };
    ev.playing = function () { spin(false); paintPlay(); };
    ev.waiting = function () { spin(true); };
    ev.pause = ev.play = paintPlay;
    ev.ended = function () { if (cur && !cur.live) { report('stopped'); close(); } };
    ev.error = function () { if (cur) { spin(false); msg('Afspelen lukt niet. Probeer het opnieuw.'); } };
    document.body.appendChild(el);
    document.addEventListener('keydown', key, true);
    document.addEventListener('keyup', keyUp, true);
    applyStyle();
  }
  function spin(on) { if (el) el.classList.toggle('busy', !!on); }
  function msg(t, ms) { K.ui.toast(t, ms); }
  function center(t) { var m = el.querySelector('.sp-msg'); m.hidden = !t; m.innerHTML = t || ''; }
  function paintPlay() {
    var p = el.querySelector('.sb.pp'); if (p) p.innerHTML = svg(E.paused() ? I.play : I.pause);
    if (E.paused()) show(true);
  }
  function show(stay) {
    el.classList.add('osd'); clearTimeout(hideT);
    if (!stay && !E.paused()) hideT = setTimeout(hide, foc >= 0 ? 8000 : 4000);
  }
  function hide() { if (E.paused()) return; el.classList.remove('osd'); setFocus(-1); }

  // ---------- tijd en balk ----------
  function pos() { return cur ? (cur.off || 0) + E.time() : 0; }
  function fmt(s) { s = Math.max(0, Math.floor(s)); var hh = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60; return (hh ? hh + ':' + K.pad(m) : m) + ':' + K.pad(ss); }
  function paintBar(at) {
    var b = el.querySelector('.sp-bar'), l = el.querySelector('.sp-time .l'), r = el.querySelector('.sp-time .r');
    var set = function (f, buf) { b.querySelector('.p').style.width = f * 100 + '%'; b.querySelector('.b').style.width = (buf || 0) * 100 + '%'; b.querySelector('s').style.left = f * 100 + '%'; };
    if (cur.live) {
      var p = cur.prog; b.style.visibility = p ? '' : 'hidden';
      if (!p) { l.textContent = ''; r.textContent = ''; return; }
      set(Math.min(1, ((cur.pausedAt || Date.now()) - p.start) / (p.end - p.start)));
      l.textContent = clock(p.start); r.textContent = clock(p.end); return;
    }
    var d = cur.dur || 0; b.style.visibility = d ? '' : 'hidden'; if (!d) { l.textContent = fmt(pos()); r.textContent = ''; return; }
    var f = Math.min(1, (at == null ? pos() : at) / d);
    set(f, Math.min(1, ((cur.off || 0) + E.buffered()) / d));
    l.textContent = fmt(f * d); r.textContent = '-' + fmt(d - f * d);
  }
  function tick() {
    if (!cur) return;
    if (!hold) paintBar();
    subs();
    if (!cur.live && Date.now() - lastReport > 10e3 && E.time() > 0) { lastReport = Date.now(); report(E.paused() ? 'paused' : 'playing'); }
    if (cur.live && cur.prog && Date.now() > cur.prog.end && !cur.pausedAt) nowNext();
  }

  // ---------- spoelen; knop vasthouden = steeds grotere stappen ----------
  var hold = null;
  function seekTo(sec) {
    if (!cur || cur.live) return;
    sec = Math.max(0, cur.dur ? Math.min(sec, cur.dur - 3) : sec);
    (cur.reseek ? cur.reseek(sec) : E.seek(sec)).catch(function (e) { msg('Spoelen lukt niet: ' + e.message); });
  }
  function skip(d) { seekTo(pos() + d); }
  function holdStep(d) {
    if (!hold) hold = { t: pos(), n: 0 };
    hold.n++; hold.t = Math.max(0, Math.min((cur.dur || 1e9) - 3, hold.t + d * Math.min(10 + hold.n * 5, 120)));
    paintBar(hold.t); show();
  }
  function holdEnd() { if (!hold) return; var t = hold.t; hold = null; seekTo(t); }

  // ---------- kijkstand naar de server, net als de Android-spelers ----------
  function report(state) {
    if (!cur || cur.live || !cur.item || !cur.dur) return;
    var it = cur.item;
    api('POST', '/api/progress', { profile: S.profile, key: it.key, seriesKey: it.seriesKey || '', kind: it.kind, plexKey: it.plexKey || (it.meta && it.meta.plexKey) || '',
      pos: Math.round(pos() * 1000), dur: Math.round(cur.dur * 1000), state: state, meta: it.meta || {}, tmdb: it.tmdb || 0, season: it.season || 0, episode: it.episode || 0 }).catch(function () {});
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
    subEl.innerHTML = cue ? cue.t.split('\n').map(function (l) { return '<span>' + esc(l).replace(/&lt;(\/?[ibu])&gt;/g, '<$1>') + '</span>'; }).join('<br>') : '';
  }
  // Tekst van de server (ondertitels). Via de app of, in de webversie, rechtstreeks met de cookie.
  function rawText(method, path, body) {
    if (K.N) return K.native('srv', method, path, body ? JSON.stringify(body) : '');
    return fetch(path, { method: method, credentials: 'same-origin', headers: { 'X-Thuis': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.text().then(function (t) { if (!r.ok) { var m = t; try { m = JSON.parse(t).error; } catch (e) {} throw new Error(m); } return t; }); });
  }
  // Waar ondertitels vandaan kunnen komen: het bestand zelf, Plex (los bestand), of OpenSubtitles.
  function subSources() {
    var it = cur.item, l = [];
    ((cur.tracks || {}).subs || []).filter(function (s) { return s.text; }).forEach(function (s) {
      l.push({ lang: s.lang, label: [lang(s.lang) || 'Ondertitels', s.title, 'in het bestand'].filter(Boolean).join(' · '), load: function () { return rawText('POST', '/api/media/sub', { src: it.url, i: s.i }); } });
    });
    (it.subs || []).filter(function (s) { return /srt|subrip/i.test(s.codec || 'srt'); }).forEach(function (s) {
      // Plex: een ondertekende link, die werkt zonder sleutel.
      l.push({ lang: s.lang, label: (s.label || lang(s.lang) || 'Ondertitels') + ' · Plex', load: function () { return fetch(K.img(s.url)).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }); } });
    });
    return l;
  }
  function loadSub(src, quiet) {
    if (!quiet) msg('Ondertitel ophalen…');
    return src.load().then(function (t) { if (!cur) return; useSubs(t, src.label); if (!quiet) msg('Ondertitels: ' + src.label); }, function (e) { if (!quiet) msg('Deze ondertitels lukken niet: ' + e.message); throw e; });
  }
  function osSearch() {
    var it = cur.item;
    return get('/api/subs/search?kind=' + encodeURIComponent(it.kind || '') + '&title=' + encodeURIComponent(it.title || '') + '&tmdbId=' + (it.tmdb || 0) + '&season=' + (it.season || 0) + '&episode=' + (it.episode || 0));
  }
  function osSource(r) {
    return { lang: r.lang, label: 'OpenSubtitles · ' + (lang(r.lang) || r.lang) + ' · ' + String(r.release || '').slice(0, 40) + (r.hearing ? ' · SDH' : ''), load: function () { return rawText('GET', '/api/subs/file/' + r.fileId); } };
  }
  function subsMenu() {
    if (!cur || !cur.item) return msg('Geen ondertitels bij deze uitzending');
    var items = [[(cur.cues ? '' : '✓ ') + 'Uit', function () { useSubs(''); msg('Ondertitels uit'); }]];
    subSources().forEach(function (s) { items.push([(cur.subLabel === s.label ? '✓ ' : '') + s.label, function () { loadSub(s).catch(function () {}); }]); });
    items.push(['Zoeken bij OpenSubtitles', function () {
      msg('Ondertitels zoeken…');
      osSearch().then(function (l) {
        if (!l.length) return msg('Niets gevonden bij OpenSubtitles');
        K.ui.sheet('OpenSubtitles', l.map(function (r) { var s = osSource(r); return [s.label, function () { loadSub(s).catch(function () {}); }]; }));
      }, function (e) { msg('Zoeken lukt niet: ' + e.message); });
    }]);
    if (cur.cues) items.push(['Gelijkzetten', syncStart]);
    items.push(['Weergave: ' + styleSummary(), styleMenu]);
    K.ui.sheet('Ondertitels', items);
  }
  // Zelf Nederlands kiezen, net als de Android-speler: uit het bestand of Plex; anders, als het geluid geen Nederlands is, OpenSubtitles.
  function autoSubs() {
    var it = cur.item, mine = cur;
    var nl = subSources().filter(function (s) { return isNl(s.lang); })[0];
    if (nl) return loadSub(nl, true).then(function () { if (cur === mine) msg('Ondertitels: ' + nl.label); }, function () {});
    var audio = E.audio ? E.audio().filter(function (a) { return a.on; })[0] : null;
    if (audio && isNl(audio.lang)) return;
    osSearch().then(function (l) {
      var r = l.filter(function (x) { return isNl(x.lang); })[0]; if (!r || cur !== mine) return;
      return loadSub(osSource(r), true).then(function () { if (cur === mine) msg('Nederlandse ondertitels geladen (Ondertitels = andere kiezen)', 5000); });
    }).catch(function () {});
  }
  // Gelijkzetten: wacht op de volgende zin en druk op OK (of tik) zodra je hem hoort.
  function syncStart() {
    var p = pos() - (cur.subOff || 0), next = (cur.cues || []).filter(function (c) { return c.s > p + 2.5; })[0];
    if (!next) return msg('Geen volgende zin gevonden');
    cur.sync = next; hide();
    center('Druk op OK zodra je dit hoort:<br><br>“' + esc(next.t.replace(/\n/g, ' ').slice(0, 120)) + '”<br><br><small>Terug = stoppen</small>');
  }
  function syncDone() {
    var c = cur.sync; cur.sync = null; center('');
    cur.subOff = pos() - c.s; subShown = null;
    var o = cur.subOff;
    msg('Ondertitels staan gelijk' + (Math.abs(o) < 0.05 ? '' : ' (' + Math.abs(o).toFixed(1).replace('.', ',') + ' s ' + (o > 0 ? 'later' : 'eerder') + ')'));
  }
  function syncStop() { cur.sync = null; center(''); msg('Gelijkzetten gestopt'); }

  // Weergave van ondertitels: per apparaat bewaard, zelfde keuzes als op Android.
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
  function styleMenu() {
    var s = style();
    K.ui.sheet('Weergave van ondertitels', Object.keys(STYLE).map(function (k) {
      return [STYLENAME[k] + ': ' + STYLE[k][s[k]][0], function () {
        s[k] = (s[k] + 1) % STYLE[k].length; try { localStorage.setItem('sjuul-ondertitels', JSON.stringify(s)); } catch (e) {}
        applyStyle(); subShown = null; setTimeout(styleMenu, 0);
      }];
    }));
  }
  // Geluidssporen: wat de motor kent.
  function audioMenu() {
    var a = E.audio ? E.audio() : [];
    if (a.length < 2) return msg(cur.live ? 'Deze zender heeft maar één geluidsspoor' : 'Maar één geluidsspoor');
    K.ui.sheet('Geluid', a.map(function (t, i) { return [(t.on ? '✓ ' : '') + t.label, function () { spin(true); Promise.resolve(E.setAudio(i)).then(function () { msg('Geluid: ' + t.label); }, function (e) { msg(e.message); }); }]; }));
  }

  // ---------- live: zappen, cijfers, pauzeren, vanaf het begin ----------
  function nowNext() {
    var id = cur.ch.id;
    get('/api/live/nownext?ids=' + id).then(function (r) {
      if (!cur || !cur.live || cur.ch.id !== id) return;
      var now = Date.now(); cur.prog = (r[id] || []).filter(function (p) { return p.start <= now && p.end > now; })[0] || null;
      el.querySelector('.sp-tt span').textContent = cur.prog ? cur.prog.title : ''; paintBar();
    }).catch(function () {});
  }
  function zap(d) {
    var l = cur.list || [], i = l.map(function (c) { return c.id; }).indexOf(cur.ch.id);
    if (l.length) tune(l[(i + d + l.length) % l.length]);
  }
  function tune(ch) {
    cur.live = true; cur.ch = ch; cur.prog = null; cur.off = 0; cur.dur = 0; cur.reseek = null; cur.pausedAt = 0; cur.item = null; cur.cues = null;
    el.querySelector('.sp-tt b').textContent = (ch.num ? ch.num + '  ' : '') + ch.name; el.querySelector('.sp-tt span').textContent = '';
    liveRow(); show(); nowNext(); spin(true);
    get('/api/live/url/' + ch.id).then(function (r) { return E.load(r.url, 0, true); }).then(function () { if (cur && cur.live) liveRow(); })
      .catch(function (e) { spin(false); msg('Deze zender lukt nu niet: ' + e.message); });
  }
  // Zender intoetsen: cijfers verzamelen, na anderhalve seconde erheen.
  var digits = '', digitT = 0;
  function digit(n) {
    digits = (digits + n).slice(-4); var box = el.querySelector('.sp-num'); box.hidden = false; box.textContent = digits;
    clearTimeout(digitT); digitT = setTimeout(function () {
      box.hidden = true; var want = digits; digits = '';
      var all = (S.cats || []).reduce(function (a, c) { return a.concat(c.channels); }, []);
      var ch = (cur.list || []).concat(all).filter(function (c) { return String(c.num) === want; })[0];
      if (ch) tune(ch); else msg('Geen zender ' + want);
    }, 1500);
  }
  // Pauzeren bij een zender die terugkijken bewaart: daarna verder waar je was (via terugkijken).
  function toggle() {
    if (!cur) return;
    if (cur.live && cur.ch.archive) {
      if (!E.paused()) { cur.pausedAt = Date.now(); E.pause(); paintBar(); return; }
      var at = cur.pausedAt; cur.pausedAt = 0;
      if (at && Date.now() - at > 15e3) {
        var p = cur.prog && cur.prog.start <= at ? cur.prog : { start: at, end: at + 3 * 3600e3, title: cur.ch.name };
        return catchup(cur.ch, p, (at - p.start) / 1000).catch(function (e) { msg(e.message); });
      }
    }
    if (E.paused()) E.play(); else E.pause();
  }
  // Terugkijken: de aanbieder geeft per beginmoment een nieuwe link. Spoelen = nieuwe link vanaf dat moment.
  function catchup(ch, p, at) {
    cur.live = false; cur.ch = ch; cur.prog = p; cur.dur = (p.end - p.start) / 1000; cur.item = null; cur.cues = null; cur.pausedAt = 0;
    el.querySelector('.sp-tt b').textContent = (ch.num ? ch.num + '  ' : '') + ch.name; el.querySelector('.sp-tt span').textContent = '↺ ' + (p.title || '');
    cur.reseek = function (sec) {
      return get('/api/live/catchup/' + ch.id + '?start=' + Math.round(p.start + sec * 1000) + '&end=' + p.end).then(function (r) { cur.off = sec; return E.load(r.url, 0, false); });
    };
    catchRow(); show(); spin(true);
    return cur.reseek(at || 0);
  }

  // ---------- zenderlijst en gids in beeld ----------
  // Links de zenders, rechts wat er op de gekozen zender was, is en komt. OK op een afgelopen programma = terugkijken.
  var gd = null;
  function guideOpen(col) {
    if (!cur.list || !cur.list.length) return msg('Geen zenders');
    var box = h('div', { class: 'sp-gd' }, '<div class="gl"></div><div class="gp"><div class="gh"></div><div class="gpl"></div></div>');
    box.onclick = function (e) { e.stopPropagation(); };
    el.appendChild(box); el.classList.add('gids'); hide();
    var i = Math.max(0, cur.list.map(function (c) { return c.id; }).indexOf(cur.ch.id));
    gd = { box: box, col: 0, ci: i, pi: -1, progs: [], forId: null };
    var gl = box.querySelector('.gl');
    cur.list.forEach(function (c, k) {
      var r = h('button', { class: 'gc' }, '<b>' + esc(c.num || '') + '</b><span>' + esc(c.name) + '</span>');
      r.onclick = function () { if (gd.ci === k && gd.col === 0) { guideClose(); tune(c); } else { gd.ci = k; gd.col = 0; guidePaint(); } };
      gl.appendChild(r);
    });
    guidePaint(); if (col) { gd.col = 1; guidePaint(); }
  }
  function guideClose() { if (!gd) return; gd.box.remove(); gd = null; el.classList.remove('gids'); }
  function guideProgs() {
    var ch = cur.list[gd.ci]; if (gd.forId === ch.id) return; gd.forId = ch.id; gd.progs = []; gd.pi = -1;
    var pl = gd.box.querySelector('.gpl'); pl.innerHTML = '<div class="gx">Laden…</div>';
    gd.box.querySelector('.gh').textContent = (ch.num ? ch.num + '  ' : '') + ch.name;
    var from = Date.now() - 20 * 3600e3, id = ch.id;
    get('/api/live/guide?ids=' + id + '&from=' + from + '&to=' + (from + 26 * 3600e3)).then(function (g) {
      if (!gd || gd.forId !== id) return;
      var now = Date.now(); gd.progs = ((g[0] || {}).programmes || []);
      gd.pi = Math.max(0, gd.progs.map(function (p) { return p.start <= now && p.end > now; }).indexOf(true));
      pl.innerHTML = gd.progs.length ? '' : '<div class="gx">Geen gids voor deze zender</div>';
      gd.progs.forEach(function (p, k) {
        var live = p.start <= now && p.end > now, past = p.end <= now, back = past && ch.archive && p.start > now - ch.archive * 864e5;
        var r = h('button', { class: 'gq' + (live ? ' live' : past ? ' past' : '') }, '<span class="t">' + esc((k === 0 || new Date(p.start).getDate() !== new Date(gd.progs[k - 1].start).getDate() ? dayName(p.start) + ' ' : '') + clock(p.start)) + '</span><b>' + esc(p.title) + '</b><span class="m">' + (live ? '● Nu' : back ? '↺ Terugkijken' : '') + '</span>');
        r.onclick = function () { gd.pi = k; gd.col = 1; guideAct(); };
        pl.appendChild(r);
      });
      guidePaint();
    }).catch(function (e) { if (gd) pl.innerHTML = '<div class="gx">' + esc(e.message) + '</div>'; });
  }
  function guidePaint() {
    var rows = gd.box.querySelectorAll('.gc'), qs = gd.box.querySelectorAll('.gq');
    [].forEach.call(rows, function (r, k) { r.classList.toggle('on', k === gd.ci); r.classList.toggle('kf', k === gd.ci && gd.col === 0); });
    if (rows[gd.ci]) rows[gd.ci].scrollIntoView({ block: 'center' });
    guideProgs();
    [].forEach.call(qs, function (r, k) { r.classList.toggle('kf', k === gd.pi && gd.col === 1); });
    if (qs[gd.pi]) qs[gd.pi].scrollIntoView({ block: 'center' });
  }
  function guideAct() {
    var ch = cur.list[gd.ci], p = gd.progs[gd.pi], now = Date.now(); if (!p) return;
    if (p.start <= now && p.end > now) { guideClose(); tune(ch); }
    else if (p.end <= now && ch.archive && p.start > now - ch.archive * 864e5) { guideClose(); catchup(ch, p, 0).catch(function (e) { msg(e.message); }); }
    else if (p.end <= now) msg('Deze zender bewaart dit programma niet');
    else msg(dayName(p.start) + ' ' + clock(p.start) + ': ' + p.title);
  }
  function guideKey(k) {
    var n = gd.col === 0 ? cur.list.length : gd.progs.length;
    if (k === 'ArrowUp' || k === 'ArrowDown') { var d = k === 'ArrowUp' ? -1 : 1; if (gd.col === 0) gd.ci = (gd.ci + d + n) % n; else gd.pi = Math.max(0, Math.min(n - 1, gd.pi + d)); guidePaint(); }
    else if (k === 'ArrowRight') { if (gd.col === 0 && gd.progs.length) { gd.col = 1; guidePaint(); } }
    else if (k === 'ArrowLeft') { if (gd.col === 1) { gd.col = 0; guidePaint(); } }
    else if (k === 'Enter') { if (gd.col === 0) { var c = cur.list[gd.ci]; guideClose(); tune(c); } else guideAct(); }
    else if (k === 'Back') { if (gd.col === 1) { gd.col = 0; guidePaint(); } else guideClose(); }
    else return false;
    return true;
  }

  // ---------- knoppen per soort ----------
  function rows(mid, row) {
    var m = el.querySelector('.sp-mid'), r = el.querySelector('.sp-row'); m.innerHTML = ''; r.innerHTML = '';
    mid.forEach(function (b) { m.appendChild(b); }); row.forEach(function (b) { r.appendChild(b); });
    if (E.audio && E.audio().length > 1) r.appendChild(textBtn('Geluid', audioMenu));
    foc = -1; paintPlay();
  }
  function vodRow(extra) {
    rows([btn('back10', '10 seconden terug', function () { skip(-10); }), btn('play', 'Afspelen of pauzeren', toggle, 'pp big'), btn('fwd30', '30 seconden verder', function () { skip(30); })],
      (extra || []).concat(cur.item ? [textBtn('Ondertitels', subsMenu)] : []));
  }
  function catchRow() { vodRow([textBtn('● Live', function () { tune(cur.ch); }), textBtn('Zenders', function () { guideOpen(0); }), textBtn('Gids', function () { guideOpen(1); })]); }
  function liveRow() {
    var row = [textBtn('Zenders', function () { guideOpen(0); }), textBtn('Gids', function () { guideOpen(1); })];
    if (cur.ch.archive) row.push(textBtn('↺ Vanaf begin', function () { if (cur.prog) catchup(cur.ch, cur.prog, 0).catch(function (e) { msg(e.message); }); else msg('Geen programma bekend'); }));
    rows([btn('down', 'Zender omlaag', function () { zap(-1); }), btn('play', 'Afspelen of pauzeren', toggle, 'pp big'), btn('up', 'Zender omhoog', function () { zap(1); })], row);
  }

  // ---------- afstandsbediening ----------
  // Balk weg: links/rechts spoelt (vasthouden = sneller), omhoog/omlaag zapt (live), omlaag = ondertitels (film),
  // OK toont de knoppen, cijfers kiezen een zender. Groen = geluid, geel = ondertitels.
  // Knop gekozen: links/rechts kiest een andere knop, OK drukt hem in, terug haalt de balk weg.
  function btns() { return [].slice.call(el.querySelectorAll('.sp-mid button, .sp-row button, .sp-top button')); }
  function setFocus(i) { foc = i; btns().forEach(function (x, k) { x.classList.toggle('kf', k === i); }); }
  function key(e) {
    if (!cur || el.hidden || document.querySelector('.sheet, .overlay')) return;   // keuzevenster open: dat regelt de toetsen zelf
    var k = e.key, c = e.keyCode;
    if (c === 13) k = 'Enter';
    if (cur.sync) { if (k === 'Enter') syncDone(); else if (k === 'Escape' || k === 'Backspace') syncStop(); else return; e.preventDefault(); e.stopPropagation(); return; }
    if (gd) { if (k === 'Escape' || k === 'Backspace') k = 'Back'; if (guideKey(k)) { e.preventDefault(); e.stopPropagation(); } return; }
    var picking = el.classList.contains('osd') && foc >= 0, n = btns().length;
    if (k === 'Enter') { if (picking) btns()[foc].click(); else { show(); setFocus(btns().indexOf(el.querySelector('.sb.pp'))); } }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      var d = k === 'ArrowLeft' ? -1 : 1;
      if (picking) setFocus((foc + d + n) % n);
      else if (!cur.live) { if (e.repeat) holdStep(d); else if (!hold) skip(d < 0 ? -10 : 30); }
    }
    else if ((k === 'ArrowUp' || c === 427) && cur.live) zap(1);
    else if ((k === 'ArrowDown' || c === 428) && cur.live) zap(-1);
    else if (k === 'ArrowDown' && !cur.live) subsMenu();
    else if (c >= 48 && c <= 57 && (cur.live || cur.ch)) digit(c - 48);
    else if (k === ' ' || k === 'MediaPlayPause' || c === 10252) toggle();
    else if (c === 415) { if (E.paused()) toggle(); } else if (c === 19) { if (!E.paused()) toggle(); }
    else if (c === 417 && !cur.live) skip(30); else if (c === 412 && !cur.live) skip(-10);
    else if (c === 404 || k === 'a') audioMenu();
    else if (c === 405 || k === 's') subsMenu();
    else if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); e.stopPropagation(); return back(); }
    else return;   // andere toetsen (zoals Terug op de Samsung) komen via de app bij back()
    e.preventDefault(); e.stopPropagation(); if (!gd) show();
  }
  function keyUp(e) { if (hold && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) holdEnd(); }
  // Terug: gelijkzetten stoppen, gids dicht, balk weg, dan de speler dicht.
  function back() {
    if (cur && cur.sync) return syncStop();
    if (gd) return guideKey('Back');
    if (el.classList.contains('osd') && !E.paused()) hide(); else close();
  }

  // ---------- openen en sluiten ----------
  function open() {
    if (!el) build();
    clearInterval(tickT); tickT = setInterval(tick, 250);
    el.hidden = false; document.documentElement.classList.add('sp-open'); if (E.transparent) document.documentElement.classList.add('sp-native');
    if (!K.N) history.pushState({ speler: 1 }, '');   // webversie: terugvegen sluit de speler
    show();
  }
  function close(fromHistory) {
    if (!cur) return;
    // Webversie: via de browsergeschiedenis, die roept close(true) aan. Zo blijft terugvegen kloppen.
    if (!K.N && !fromHistory) return history.back();
    report('stopped'); E.stop(); guideClose(); center('');
    cur = null; hold = null; clearInterval(tickT); el.hidden = true; subShown = null; if (subEl) subEl.innerHTML = '';
    document.documentElement.classList.remove('sp-open', 'sp-native');
  }

  // item zoals kern.js het samenstelt (Plex, IPTV-film, aflevering). offsetMs = waar je was.
  function vod(item) {
    open();
    cur = { item: item, live: false, off: 0, dur: 0 };
    var mine = cur;
    el.querySelector('.sp-tt b').textContent = String((item.meta && item.meta.title) || item.title || '').replace(/\s*\(\d{4}\)\s*$/, '');
    el.querySelector('.sp-tt span').textContent = (item.meta && item.meta.sub) || item.sub || '';
    vodRow(); spin(true);
    // Net als op Android: pas verder waar je was na meer dan een minuut.
    var from = (item.offsetMs || 0) > 60e3 ? Math.floor(item.offsetMs / 1000) : 0;
    var tr = api('POST', '/api/media/tracks', { src: item.url }).catch(function () { return { audio: [], subs: [] }; });
    E.load(item.url, from, false).then(function (d) {
      if (cur !== mine) return;
      cur.dur = d || 0; paintBar(); vodRow();
      if (from) msg('Verder vanaf ' + fmt(from) + (item.resumeVia ? ' (gekeken via ' + item.resumeVia + ')' : ''));
      return tr.then(function (t) { if (cur !== mine) return; cur.tracks = t; autoSubs(); });
    }, function (e) { msg('Afspelen lukt niet: ' + e.message); close(); });
  }
  // Live, of terugkijken als start > 0. catId: de categorie waarin je zapt.
  function live(catId, chId, start, end, title) {
    open();
    cur = { live: true, off: 0, dur: 0, list: [], ch: { id: chId, name: '' } };
    var cats = S.cats ? Promise.resolve(S.cats) : get('/api/live/categories').then(function (c) { S.cats = c; S.catsAt = Date.now(); return c; });
    cats.then(function (cs) {
      var c = cs.filter(function (x) { return x.id === catId; })[0] || cs.filter(function (x) { return x.id === 'alle'; })[0] || cs[0] || { channels: [] };
      cur.list = c.channels;
      var all = cs.reduce(function (l, x) { return l.concat(x.channels); }, []);
      var ch = c.channels.filter(function (x) { return x.id === chId; })[0] || all.filter(function (x) { return x.id === chId; })[0] || cur.ch;
      if (start) return catchup(ch, { start: start, end: end, title: title }, 0);
      tune(ch);
    }).catch(function (e) { msg('Live tv lukt nu niet: ' + e.message); close(); });
  }

  window.Speler = { vod: vod, live: live, isOpen: function () { return !!cur; }, back: back, close: close };
})();

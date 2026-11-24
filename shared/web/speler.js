/* Sjuul TV: de gedeelde speler. Eén knoppenbalk en één manier van werken op elk apparaat.
   Onder de knoppen zit per apparaat een motor:
   - browser (iPad, iPhone): HLS van tv-serverr, die de bron omzet (staat hieronder);
   - Android: ExoPlayer, dat de app klaarzet als window.SpelerMotor.
   Bediening: aanraken, of pijltjes, OK en terug. */
(function () {
  'use strict';
  var K = window.Kern, S = K.S, esc = K.esc, h = K.h, clock = K.clock, get = K.get, api = K.api;
  var el = null, E = null, cur = null, hideT = 0, tickT = 0, lastReport = 0, foc = -1;
  var ev = {};   // wat de motor meldt: playing, waiting, pause, play, ended, error

  // ---------- motor van de browser: HLS via tv-serverr ----------
  // Elke motor heeft: load(src, from, live) -> Promise(lengte in s, 0 bij live), time(), buffered(), seek(s) -> Promise,
  // paused(), play(), pause(), stop(). src is een ondertekend serverpad (/stream/...). Optioneel: audio(), setAudio(i).
  function browserMotor(root) {
    var v = h('video', { playsinline: '', 'webkit-playsinline': '', preload: 'auto' }), base = 0, id = '', src = '';
    root.insertBefore(v, root.firstChild);
    ['playing', 'waiting', 'pause', 'play', 'ended', 'error'].forEach(function (n) { v.addEventListener(n, function () { if (ev[n]) ev[n](); }); });
    function end() { try { return v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0; } catch (e) { return 0; } }
    var m = {
      load: function (s, from, live) {
        src = s; base = live ? 0 : Math.floor(from || 0);
        return api('POST', '/api/hls/start', { src: s, from: base, low: !!S.low }).then(function (r) { id = r.id; v.src = r.url; v.play().catch(function () {}); return r.dur; });
      },
      time: function () { return base + (v.currentTime || 0); },
      buffered: function () { try { return v.buffered.length ? base + v.buffered.end(v.buffered.length - 1) : 0; } catch (e) { return 0; } },
      // Binnen wat al omgezet is: meteen. Verder weg, of terug voor het beginpunt: de server begint opnieuw vanaf daar.
      seek: function (sec) { var rel = sec - base; if (rel >= 0 && rel <= end() - 2) { v.currentTime = rel; return Promise.resolve(); } return m.load(src, sec, false); },
      paused: function () { return v.paused; }, play: function () { v.play().catch(function () {}); }, pause: function () { v.pause(); },
      stop: function () { if (id) { api('POST', '/api/hls/stop', { id: id }).catch(function () {}); id = ''; } v.pause(); v.removeAttribute('src'); v.load(); }
    };
    return m;
  }

  // ---------- opbouw ----------
  var I = {
    play: '<path d="M8 5v14l11-7z" fill="currentColor"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>',
    back10: '<path d="M11 5L6 9l5 4" /><path d="M6 9h8a5 5 0 1 1 0 10h-3"/>', fwd30: '<path d="M13 5l5 4-5 4"/><path d="M18 9h-8a5 5 0 1 0 0 10h3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>'
  };
  var svg = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  function btn(icon, label, fn, cls) { var b = h('button', { class: 'sb ' + (cls || ''), 'aria-label': label }, svg(I[icon])); b.onclick = function (e) { e.stopPropagation(); fn(); show(); }; return b; }
  function textBtn(t, fn) { var b = h('button', { class: 'st' }, esc(t)); b.onclick = function (e) { e.stopPropagation(); fn(); show(); }; return b; }

  function build() {
    el = h('div', { class: 'sp' }, '<div class="sp-sub"></div><div class="sp-spin"></div>');
    E = window.SpelerMotor ? window.SpelerMotor(el, ev) : browserMotor(el);
    if (E.transparent) el.classList.add('native');   // beeld zit onder de pagina (ExoPlayer)
    var top = h('div', { class: 'sp-top' }, '<div class="sp-tt"><b></b><span></span></div>');
    top.appendChild(btn('close', 'Sluiten', function () { close(); }, 'x'));
    var bot = h('div', { class: 'sp-bot' }, '<div class="sp-bar"><i class="b"></i><i class="p"></i><s></s></div><div class="sp-time"><span class="l"></span><span class="r"></span></div><div class="sp-row"></div>');
    el.appendChild(top); el.appendChild(h('div', { class: 'sp-mid' })); el.appendChild(bot);
    el.onclick = function () { if (el.classList.contains('osd')) hide(); else show(); };
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
  }
  function spin(on) { if (el) el.classList.toggle('busy', !!on); }
  function msg(t) { K.ui.toast(t); }
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
      set(Math.min(1, (Date.now() - p.start) / (p.end - p.start)));
      l.textContent = clock(p.start); r.textContent = clock(p.end); return;
    }
    var d = cur.dur || 0; b.style.visibility = d ? '' : 'hidden'; if (!d) { l.textContent = fmt(pos()); r.textContent = ''; return; }
    var f = Math.min(1, (at == null ? pos() : at) / d);
    set(f, Math.min(1, ((cur.off || 0) + E.buffered()) / d));
    l.textContent = fmt(f * d); r.textContent = '-' + fmt(d - f * d);
  }
  function tick() {
    if (!cur) return;
    paintBar(); subs();
    if (!cur.live && Date.now() - lastReport > 10e3 && E.time() > 0) { lastReport = Date.now(); report(E.paused() ? 'paused' : 'playing'); }
    if (cur.live && cur.prog && Date.now() > cur.prog.end) nowNext();
  }

  // ---------- spoelen ----------
  function seekTo(sec) {
    if (!cur || cur.live) return;
    sec = Math.max(0, cur.dur ? Math.min(sec, cur.dur - 3) : sec);
    (cur.reseek ? cur.reseek(sec) : E.seek(sec)).catch(function (e) { msg('Spoelen lukt niet: ' + e.message); });
  }
  function skip(d) { seekTo(pos() + d); }

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
    }).filter(Boolean);
  }
  var subEl = null, subShown = null;
  function subs() {
    if (!subEl) subEl = el.querySelector('.sp-sub');
    var cue = null, p = pos();
    if (cur && cur.cues) for (var i = 0; i < cur.cues.length; i++) { var c = cur.cues[i]; if (c.s <= p && c.e > p) { cue = c; break; } }
    if (cue === subShown) return; subShown = cue;
    // Alleen schuin, vet en onderstreept blijven over; de rest is gewone tekst.
    subEl.innerHTML = cue ? cue.t.split('\n').map(function (l) { return '<span>' + esc(l).replace(/&lt;(\/?[ibu])&gt;/g, '<$1>') + '</span>'; }).join('<br>') : '';
  }
  // Tekst van de server (ondertitels). Via de app of, in de webversie, rechtstreeks met de cookie.
  function rawText(path) {
    return K.N ? K.native('srv', 'GET', path, '') : fetch(path, { credentials: 'same-origin', headers: { 'X-Thuis': '1' } }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
  }
  function subsMenu() {
    var it = cur.item, items = [['Uit', function () { cur.cues = null; }]];
    (it.subs || []).filter(function (s) { return /srt|subrip/i.test(s.codec || 'srt'); }).forEach(function (s) {
      // Plex-ondertitels: een ondertekende link, die werkt zonder sleutel.
      items.push([s.label || s.lang || 'Ondertitels', function () {
        fetch(K.img(s.url)).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (t) { cur.cues = parseSrt(t); }, function () { msg('Deze ondertitels lukken niet'); });
      }]);
    });
    items.push(['Nederlands zoeken (OpenSubtitles)', function () {
      msg('Even zoeken…');
      get('/api/subs/search?kind=' + encodeURIComponent(it.kind || '') + '&title=' + encodeURIComponent(it.title || '') + '&tmdbId=' + (it.tmdb || 0) + '&season=' + (it.season || 0) + '&episode=' + (it.episode || 0)).then(function (l) {
        var nl = l.filter(function (x) { return x.lang === 'nl'; })[0];
        if (!nl) return msg('Geen Nederlandse ondertitels gevonden');
        return rawText('/api/subs/file/' + nl.fileId).then(function (t) { cur.cues = parseSrt(t); msg('Nederlandse ondertitels geladen'); });
      }).catch(function (e) { msg('Zoeken lukt niet: ' + e.message); });
    }]);
    K.ui.sheet('Ondertitels', items);
  }
  // Geluidssporen: alleen als de motor ze kent (ExoPlayer).
  function audioMenu() {
    K.ui.sheet('Geluid', E.audio().map(function (a, i) { return [(a.on ? '✓ ' : '') + a.label, function () { E.setAudio(i); }]; }));
  }

  // ---------- live: zappen, zenderlijst, vanaf het begin ----------
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
    cur.live = true; cur.ch = ch; cur.prog = null; cur.off = 0; cur.dur = 0; cur.reseek = null;
    el.querySelector('.sp-tt b').textContent = (ch.num ? ch.num + '  ' : '') + ch.name; el.querySelector('.sp-tt span').textContent = '';
    liveRow(); show(); nowNext(); spin(true);
    get('/api/live/url/' + ch.id).then(function (r) { return E.load(r.url, 0, true); }).catch(function (e) { spin(false); msg('Deze zender lukt nu niet: ' + e.message); });
  }
  function channelList() {
    K.ui.sheet('Zenders', (cur.list || []).map(function (c) { return [(c.num ? c.num + '  ' : '') + c.name, function () { tune(c); }]; }));
  }
  // Terugkijken: de aanbieder geeft per beginmoment een nieuwe link. Spoelen = nieuwe link vanaf dat moment.
  function catchup(ch, p, at) {
    cur.live = false; cur.ch = ch; cur.prog = p; cur.dur = (p.end - p.start) / 1000; cur.item = null; cur.cues = null;
    el.querySelector('.sp-tt b').textContent = ch.name; el.querySelector('.sp-tt span').textContent = '↺ ' + (p.title || '');
    cur.reseek = function (sec) {
      return get('/api/live/catchup/' + ch.id + '?start=' + Math.round(p.start + sec * 1000) + '&end=' + p.end).then(function (r) { cur.off = sec; return E.load(r.url, 0, false); });
    };
    catchRow(); show(); spin(true);
    return cur.reseek(at || 0);
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
  function catchRow() { vodRow([textBtn('● Live', function () { tune(cur.ch); })]); }
  function liveRow() {
    var row = [textBtn('Zenders', channelList)];
    if (cur.ch.archive) row.push(textBtn('↺ Vanaf begin', function () { if (cur.prog) catchup(cur.ch, cur.prog, 0).catch(function (e) { msg(e.message); }); else msg('Geen programma bekend'); }));
    rows([btn('down', 'Zender omlaag', function () { zap(-1); }), btn('play', 'Afspelen of pauzeren', toggle, 'pp big'), btn('up', 'Zender omhoog', function () { zap(1); })], row);
  }
  function toggle() { if (E.paused()) E.play(); else E.pause(); }

  // ---------- afstandsbediening ----------
  // Balk weg: links/rechts spoelt (film), omhoog/omlaag zapt (live), OK toont de knoppen.
  // Knop gekozen: links/rechts kiest een andere knop, OK drukt hem in, terug haalt de balk weg.
  function btns() { return [].slice.call(el.querySelectorAll('.sp-mid button, .sp-row button, .sp-top button')); }
  function setFocus(i) { foc = i; btns().forEach(function (x, k) { x.classList.toggle('kf', k === i); }); }
  function key(e) {
    if (!cur || el.hidden || document.querySelector('.sheet, .overlay')) return;   // keuzevenster open: dat regelt de toetsen zelf
    var k = e.key, c = e.keyCode, picking = el.classList.contains('osd') && foc >= 0, n = btns().length;
    if (k === 'Enter' || c === 13) { if (picking) btns()[foc].click(); else { show(); setFocus(btns().indexOf(el.querySelector('.sb.pp'))); } }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { var d = k === 'ArrowLeft' ? -1 : 1; if (picking) setFocus((foc + d + n) % n); else if (!cur.live) skip(d < 0 ? -10 : 30); }
    else if ((k === 'ArrowUp' || c === 427) && cur.live) zap(1);
    else if ((k === 'ArrowDown' || c === 428) && cur.live) zap(-1);
    else if (k === ' ' || k === 'MediaPlayPause' || c === 10252) toggle();
    else if (c === 415) E.play(); else if (c === 19) E.pause();
    else if (c === 417 && !cur.live) skip(30); else if (c === 412 && !cur.live) skip(-10);
    else if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); e.stopPropagation(); return back(); }
    else return;   // andere toetsen (zoals Terug op Android) komen via de app bij back()
    e.preventDefault(); e.stopPropagation(); show();
  }
  // Terug: eerst de balk weg, dan de speler dicht.
  function back() { if (el.classList.contains('osd') && !E.paused()) hide(); else close(); }

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
    report('stopped'); E.stop();
    cur = null; clearInterval(tickT); el.hidden = true; subShown = null; if (subEl) subEl.innerHTML = '';
    document.documentElement.classList.remove('sp-open', 'sp-native');
  }

  // item zoals kern.js het samenstelt (Plex, IPTV-film, aflevering). offsetMs = waar je was.
  function vod(item) {
    open();
    cur = { item: item, live: false, off: 0, dur: 0 };
    el.querySelector('.sp-tt b').textContent = String((item.meta && item.meta.title) || item.title || '').replace(/\s*\(\d{4}\)\s*$/, '');
    el.querySelector('.sp-tt span').textContent = (item.meta && item.meta.sub) || item.sub || '';
    vodRow(); spin(true);
    E.load(item.url, Math.floor((item.offsetMs || 0) / 1000), false).then(function (d) { if (cur) { cur.dur = d || 0; paintBar(); } }, function (e) { msg('Afspelen lukt niet: ' + e.message); close(); });
  }
  // Live, of terugkijken als start > 0. catId: de categorie waarin je zapt.
  function live(catId, chId, start, end, title) {
    open();
    cur = { live: true, off: 0, dur: 0, list: [], ch: { id: chId, name: '' } };
    var cats = S.cats ? Promise.resolve(S.cats) : get('/api/live/categories').then(function (c) { S.cats = c; S.catsAt = Date.now(); return c; });
    cats.then(function (cs) {
      var c = cs.filter(function (x) { return x.id === catId; })[0] || cs.filter(function (x) { return x.id === 'alle'; })[0] || cs[0] || { channels: [] };
      cur.list = c.channels;
      var ch = c.channels.filter(function (x) { return x.id === chId; })[0] || cur.ch;
      if (start) return catchup(ch, { start: start, end: end, title: title }, 0);
      tune(ch);
    }).catch(function (e) { msg('Live tv lukt nu niet: ' + e.message); close(); });
  }

  window.Speler = { vod: vod, live: live, isOpen: function () { return !!cur; }, back: back, close: close };
})();

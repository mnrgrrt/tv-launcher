/* Sjuul TV: gedeelde kern voor tv en telefoon. Praat met tv-serverr (via de app), speelt af en houdt de kijkstand bij.
   Het scherm zelf (tv: thuis.js, telefoon: telefoon.js) geeft via Kern.ui door hoe het meldingen en vragen toont. */
(function () {
  'use strict';
  var N = window.Native || null;               // Android-brug; null in de webversie (iPad, iPhone, browser)
  // Wat het scherm zelf invult: meldingen, "wie kijkt er" bij afspelen, en wat er gebeurt als de koppeling weg is.
  var ui = { toast: function () {}, sheet: function () {}, askWho: function () { return Promise.resolve(); }, unpaired: function () {} };

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
  // ---------- server ----------
  var cbs = {}, cbId = 0;
  window.__nativeCb = function (id, ok, data) { var c = cbs[id]; delete cbs[id]; if (!c) return; if (ok) c.res(data); else c.rej(new Error(data)); };
  function native(fn) { var args = [].slice.call(arguments, 1); return new Promise(function (res, rej) { var id = ++cbId; cbs[id] = { res: res, rej: rej }; N[fn].apply(N, [id].concat(args)); }); }
  // Webversie: de server zet de sleutel in een cookie die deze pagina niet kan lezen; X-Thuis bewijst dat wij het zijn.
  function web(method, path, body) {
    return fetch(path, { method: method, credentials: 'same-origin', headers: { 'X-Thuis': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { if (r.status === 401) throw new Error('NIET_GEKOPPELD'); return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function api(method, path, body) {
    var p = N ? native('srv', method, path, body ? JSON.stringify(body) : '').then(function (t) { return t ? JSON.parse(t) : {}; }) : web(method, path, body);
    return p.catch(onApiError);
  }
  function onApiError(e) { if (e.message === 'NIET_GEKOPPELD') { if (N) N.srvUnpair(); ui.unpaired(); } throw e; }
  // Koppelen, ontkoppelen en wat we van dit apparaat weten: via de app, of in de webversie via de server en localStorage.
  var WEBPROF = 'sjuul-profiel';
  function info() {
    if (N) return JSON.parse(N.srvInfo());
    var p = 0; try { p = +localStorage.getItem(WEBPROF) || 0; } catch (e) {}
    return { paired: true, profile: p, url: location.origin, web: true };   // of het echt gekoppeld is, blijkt bij de eerste vraag aan de server
  }
  function pair(url, code, name) { return N ? native('srvPair', url, code, name) : web('POST', '/api/web/pair', { code: code, name: name }); }
  function unpair() { if (N) { N.srvUnpair(); return Promise.resolve(); } return web('POST', '/api/web/unpair').catch(function () {}); }
  var get = function (p) { return api('GET', p); };
  // Plaatjes en streams: serverpaden (met /) via de basis die de app opgeeft; http zo nodig via de app (Android blokkeert het anders).
  var BASE = N ? N.base() : '', HTTPPROXY = N && N.httpProxy ? N.httpProxy() : '';
  function img(u) {
    if (!u) return '';
    if (u.charAt(0) === '/') return BASE + u;
    if (u.indexOf('http://') === 0 && HTTPPROXY) return HTTPPROXY + encodeURIComponent(u);
    return u;
  }
  // Wat dit apparaat kan (apps, HDMI-ingangen, schermbeveiliging, systeeminstellingen, inspreken, zelf bijwerken).
  var can = N && N.features ? JSON.parse(N.features()) : {};
  function bg(u) { return u ? "background-image:url('" + img(u).replace(/'/g, '%27') + "')" : ''; }

  // ---------- toestand ----------
  var S = { profile: 0, profiles: [], device: null, svcList: [], apps: null, cats: null, ov: {}, art: {}, reminders: {} };

  try { S.reminders = JSON.parse(localStorage.getItem('thuis-herinneringen') || '{}'); } catch (e) {}
  // Lagere kwaliteit (720p) om data te sparen; de speler vraagt het de server bij het omzetten.
  try { S.low = localStorage.getItem('sjuul-laag') === '1'; } catch (e) {}
  if (N && N.metered && N.metered()) S.low = true;   // Android weet zelf of je op mobiel internet zit
  function me() { for (var i = 0; i < S.profiles.length; i++) if (S.profiles[i].id === S.profile) return S.profiles[i]; return S.profiles[0] || { id: 1, name: 'Samen', avatarUrl: '' }; }
  function setProfile(id) { S.profile = id; if (N) N.srvSetProfile(id); else try { localStorage.setItem(WEBPROF, String(id)); } catch (e) {} }


  // ---------- afspelen ----------
  // Waar was je? Ook als je dezelfde titel via de andere bron (Plex of IPTV) aan het kijken was.
  function position(key, tmdb, season, episode) {
    if (S.fromStart) { S.fromStart = false; return Promise.resolve({ pos: 0, via: '', fresh: true }); }
    return get('/api/position?profile=' + S.profile + '&key=' + encodeURIComponent(key) + '&tmdb=' + (tmdb || 0) + '&s=' + (season || 0) + '&e=' + (episode || 0))
      .then(function (r) { return { pos: r.pos || 0, via: r.via || '' }; }, function () { return { pos: 0, via: '' }; });
  }
  function start(item) {
    item.server = true; item.profile = S.profile;
    window.Speler.vod(item);
  }
  function playPlex(key, meta) {
    var k = 'plex:' + key;
    return ui.askWho(k).then(function () { return get('/api/plex/play/' + key); }).then(function (it) {
      return position(k, it.tmdb, it.season, it.episode).then(function (p) {
        if (p.fresh) it.offsetMs = 0; else if (p.pos > 0) it.offsetMs = p.pos;
        it.resumeVia = p.via;
        it.meta = Object.assign({ title: it.title, sub: it.sub, img: it.img, plexKey: key }, meta || {});
        start(it);
      });
    }).catch(function (e) { ui.toast('Afspelen lukt niet: ' + e.message); });
  }
  function playMovie(m) {   // IPTV-film uit de catalogus
    var k = 'movie:' + m.id;
    return ui.askWho(k).then(function () { return Promise.all([m.url ? Promise.resolve({ url: m.url }) : get('/api/vod/movie/url/' + m.id + '?ext=' + (m.ext || 'mp4')), position(k, m.tmdb)]); }).then(function (r) {
      start({ kind: 'movie', key: k, url: r[0].url, title: m.name || m.title, sub: m.year || '', tmdb: m.tmdb || 0, offsetMs: r[1].pos, resumeVia: r[1].via,
        meta: { title: m.name || m.title, sub: 'Film', img: m.backdrop || m.icon || m.img || '', id: m.id, ext: m.ext, tmdb: m.tmdb || 0 } });
    }).catch(function (e) { ui.toast('Afspelen lukt niet: ' + e.message); });
  }
  function playEpisode(series, season, ep) {   // IPTV-aflevering
    var k = 'series:' + ep.id, sk = 'series:' + series.id;
    return ui.askWho(sk).then(function () { return position(k, series.tmdb, season, ep.num); }).then(function (p) {
      start({ kind: 'series', key: k, seriesKey: sk, url: ep.url, title: series.name, sub: 'S' + season + ' · afl. ' + ep.num + (ep.title ? ' · ' + ep.title : ''),
        season: +season, episode: ep.num, tmdb: series.tmdb || 0, offsetMs: p.pos, resumeVia: p.via,
        meta: { title: series.name, sub: 'S' + season + ' · afl. ' + ep.num, img: ep.img || series.backdrop || series.icon || '', id: ep.id, ext: ep.ext, seriesId: series.id, tmdb: series.tmdb || 0 } });
    }).catch(function (e) { ui.toast('Afspelen lukt niet: ' + e.message); });
  }
  function resume(c) {      // tegel uit Verder kijken
    var key = String(c.key || '');
    if (key.indexOf('plex:') === 0) return playPlex(key.slice(5), c);
    if (key.indexOf('movie:') === 0) return playMovie({ id: c.id || key.slice(6), ext: c.ext, name: c.title, img: c.img, tmdb: c.tmdb });
    if (key.indexOf('series:') === 0) {
      var id = c.id || key.slice(7);
      return Promise.all([get('/api/vod/series/url/' + id + '?ext=' + (c.ext || 'mkv')), position(key, c.tmdb, c.season, c.episode)]).then(function (r) {
        start({ kind: 'series', key: key, seriesKey: 'series:' + c.seriesId, url: r[0].url, title: c.title, sub: c.sub, season: c.season, episode: c.episode, tmdb: c.tmdb || 0, offsetMs: r[1].pos, resumeVia: r[1].via, meta: c });
      });
    }
  }
  // Live en terugkijken gaan allebei naar de live-speler (daar kun je ook spoelen, pauzeren en zappen).
  function playLive(catId, ch) { window.Speler.live(catId || 'alle', ch.id, 0, 0, ''); }
  function playCatchup(ch, p, catId) { window.Speler.live(catId || 'alle', ch.id, p.start, p.end, p.title || ''); }
  // Gezien of niet gezien, ook in de andere bron (Plex of IPTV).
  function setWatched(items, on) {
    return api('POST', '/api/watched', { profile: S.profile, items: items, on: on }).then(function () { S.ov = {}; }, function (e) { ui.toast(e.message); throw e; });
  }
  function rating(o) { var r = o.imdbRating || o.vote || 0; return r ? '★ ' + r.toFixed(1).replace('.', ',') : ''; }
  function whereFrom(o) { return (o.sources || []).map(function (s) { return s === 'plex' ? 'Plex' : 'IPTV'; }).join(', '); }

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
  // Uit Verder kijken halen (zonder op bekeken te zetten).
  function hideCont(c) { return api('POST', '/api/continue/hide', { profile: S.profile, key: c.key }).then(function () { ui.toast('Weggehaald uit Verder kijken'); }, function (e) { ui.toast(e.message); }); }

  window.Kern = { N: N, can: can, ui: ui, info: info, pair: pair, unpair: unpair, S: S, esc: esc, h: h, pad: pad, clock: clock, dayName: dayName, native: native, api: api, get: get, img: img, bg: bg,
    me: me, setProfile: setProfile, position: position, start: start, playPlex: playPlex, playMovie: playMovie, playEpisode: playEpisode, resume: resume,
    playLive: playLive, playCatchup: playCatchup, setWatched: setWatched, rating: rating, whereFrom: whereFrom, nextUp: nextUp, hideCont: hideCont };
})();

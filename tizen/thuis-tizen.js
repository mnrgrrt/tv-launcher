/*
 * Thuis op Samsung (Tizen 6). Platformlaag voor het gedeelde startscherm (shared/web/index.html).
 * Doet hetzelfde als de Android-app, maar dan in JavaScript: Dispatcharr (Xtream), slimme categorieën,
 * TMDB, Plex, Jellyfin, films en series van IPTV, Radarr/Sonarr, en afspelen met de Samsung-speler (AVPlay).
 * Wordt in de <head> geladen, vóór het script van het startscherm. Dat ziet window.ThuisPlatform en gebruikt dit.
 */
(function () {
  'use strict';

  // ---------- instellingen ----------
  var KEY = 'thuis.settings';
  function settings() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function saveSettingsObj(o) {
    var cur = settings();
    Object.keys(o || {}).forEach(function (k) {
      var v = o[k] == null ? '' : String(o[k]);
      if (/Url$|^server$/.test(k)) v = v.trim().replace(/\/+$/, '');
      else if (k !== 'pass' && k !== 'osPass') v = v.trim();
      cur[k] = v;
    });
    localStorage.setItem(KEY, JSON.stringify(cur));
    Xt.reset();
  }
  function S(k) { return settings()[k] || ''; }
  function configured() { return !!(S('server') && S('user') && S('pass')); }

  // ---------- hulpjes ----------
  function enc(s) { return encodeURIComponent(s); }
  function http(url, opt) {
    opt = opt || {};
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest();
      x.open(opt.method || 'GET', url, true);
      x.timeout = opt.timeout || 15000;
      var h = opt.headers || {};
      Object.keys(h).forEach(function (k) { x.setRequestHeader(k, h[k]); });
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) res(x.responseText);
        else rej(new Error('fout ' + x.status));
      };
      x.onerror = function () { rej(new Error('geen verbinding')); };
      x.ontimeout = function () { rej(new Error('time-out')); };
      x.send(opt.body || null);
    });
  }
  function json(url, opt) { return http(url, opt).then(function (t) { return JSON.parse(t || 'null'); }); }
  function reply(cb, p) {
    p.then(function (v) { cb(true, typeof v === 'string' ? v : JSON.stringify(v)); },
           function (e) { cb(false, (e && e.message) || String(e)); });
  }
  // Maximaal n tegelijk
  function pool(items, n, fn) {
    var out = new Array(items.length), i = 0;
    function worker() {
      if (i >= items.length) return Promise.resolve();
      var k = i++;
      return Promise.resolve(fn(items[k], k)).then(function (v) { out[k] = v; }, function () { out[k] = null; }).then(worker);
    }
    var ws = []; for (var w = 0; w < Math.min(n, items.length); w++) ws.push(worker());
    return Promise.all(ws).then(function () { return out; });
  }
  function b64(s) {
    if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/=\s]+$/.test(s)) return s || '';
    try { var d = decodeURIComponent(escape(atob(s))); return /[\u0000-\u0008]/.test(d) ? s : d; } catch (e) { return s; }
  }
  var assets = {};
  function asset(name) { return assets[name] || (assets[name] = json(name)); }

  // ---------- Xtream (Dispatcharr) ----------
  var Xt = {
    channels: [], cats: {}, at: 0,
    reset: function () { this.channels = []; this.at = 0; },
    api: function (action, extra) {
      if (!configured()) return Promise.reject(new Error('Nog niet ingesteld'));
      return json(S('server') + '/player_api.php?username=' + enc(S('user')) + '&password=' + enc(S('pass')) +
        (action ? '&action=' + action : '') + (extra || ''), { timeout: 30000 });
    },
    load: function () {
      var self = this;
      if (self.channels.length && Date.now() - self.at < 6 * 3600e3) return Promise.resolve(self.channels);
      return self.api('get_live_categories').catch(function () { return []; }).then(function (cats) {
        self.cats = {}; (cats || []).forEach(function (c) { self.cats[c.category_id] = c.category_name; });
        return self.api('get_live_streams');
      }).then(function (arr) {
        self.channels = (arr || []).map(function (o, i) {
          return { id: +o.stream_id, num: +(o.num || i + 1), name: o.name || '', icon: o.stream_icon || '', cat: String(o.category_id || ''),
                   archive: o.tv_archive == 1 ? Math.max(1, +o.tv_archive_duration || 1) : 0 };
        }).sort(function (a, b) { return a.num - b.num; });
        self.at = Date.now();
        return self.channels;
      });
    },
    streamUrl: function (id) { return S('server') + '/live/' + enc(S('user')) + '/' + enc(S('pass')) + '/' + id + '.' + (S('format') || 'ts'); },
    shortEpg: function (id, limit) {
      return this.api('get_short_epg', '&stream_id=' + id + '&limit=' + (limit || 2)).then(function (o) {
        var now = Date.now();
        return ((o && o.epg_listings) || []).map(function (e) {
          return { title: b64(e.title), desc: b64(e.description), start: (+e.start_timestamp || 0) * 1000, end: (+e.stop_timestamp || 0) * 1000 };
        }).filter(function (p) { return !p.end || p.end > now; });
      });
    }
  };

  // ---------- slimme categorieën (zelfde regels als de Android-app) ----------
  var RULES_URL = 'https://raw.githubusercontent.com/mnrgrrt/tv-launcher/main/shared/categories.json';
  var DROP = { nl: 1, be: 1, vl: 1, uk: 1, hd: 1, fhd: 1, uhd: 1, sd: 1, '4k': 1, hevc: 1, h265: 1, h264: 1, '50fps': 1, backup: 1, raw: 1 };
  function norm(name) {
    var plain = (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return plain.split(/[^a-z0-9]+/).filter(function (t) { return t && !DROP[t]; }).join('');
  }
  function matches(n, p) { p = p.toLowerCase(); return p.slice(-1) === '*' ? n.indexOf(p.slice(0, -1)) === 0 : n === p; }
  var rules = null, rulesAt = 0;
  function loadRules() {
    if (rules && Date.now() - rulesAt < 3600e3) return Promise.resolve(rules);
    return http(RULES_URL, { timeout: 6000 }).then(function (t) { JSON.parse(t); localStorage.setItem('thuis.rules', t); return t; })
      .catch(function () { return localStorage.getItem('thuis.rules') || http('categories.json'); })
      .then(function (t) { rules = JSON.parse(t); rulesAt = Date.now(); return rules; });
  }
  function buildCats(all) {
    return loadRules().then(function (r) {
      var normed = all.map(function (c) { return [c, norm(c.name)]; });
      var out = [];
      (r.categories || []).forEach(function (c) {
        var inc = c.include || [], exc = c.exclude || [], groups = (c.groups || []).map(function (g) { return g.toLowerCase(); });
        var picked = [], seen = {};
        function ok(n) { return !exc.some(function (e) { return matches(n, e); }); }
        function add(ch) { if (!seen[ch.id]) { seen[ch.id] = 1; picked.push(ch); } }
        inc.forEach(function (p) {
          var hits = normed.filter(function (x) { return matches(x[1], p) && ok(x[1]); }).map(function (x) { return x[0]; });
          if (p.slice(-1) === '*') hits.forEach(add);
          else { var h = hits.filter(function (ch) { return !seen[ch.id]; })[0]; if (h) add(h); }
        });
        if (groups.length) {
          var ids = {};
          Object.keys(Xt.cats).forEach(function (id) { var g = Xt.cats[id].toLowerCase(); if (groups.some(function (x) { return g.indexOf(x) >= 0; })) ids[id] = 1; });
          normed.forEach(function (x) { if (ids[x[0].cat] && ok(x[1])) add(x[0]); });
        }
        out.push({ id: c.id, name: c.name, img: c.img || '', channels: picked, parent: c.parent || null, last: !!c.last });
      });
      out.filter(function (p) { return !p.parent; }).forEach(function (parent) {
        var kids = out.filter(function (k) { return k.parent === parent.id; });
        if (!kids.length) return;
        var inKids = {}; kids.forEach(function (k) { k.channels.forEach(function (ch) { inKids[ch.id] = 1; }); });
        var merged = parent.channels.slice(), m = {}; merged.forEach(function (ch) { m[ch.id] = 1; });
        kids.forEach(function (k) { k.channels.forEach(function (ch) { if (!m[ch.id]) { m[ch.id] = 1; merged.push(ch); } }); });
        parent.channels = merged;
        out.push({ id: parent.id + '-overig', name: 'Overige ' + parent.name.toLowerCase(), img: parent.img, parent: parent.id,
                   channels: merged.filter(function (ch) { return !inKids[ch.id]; }) });
      });
      if (r.alle !== false) out.push({ id: 'alle', name: 'Alle zenders', img: 'aurora', channels: all });
      return out;
    });
  }
  function channelJson(ch, epg) {
    var o = { id: ch.id, num: ch.num, name: ch.name, icon: ch.icon, cat: ch.cat };
    if (epg && epg[0]) o.now = { title: epg[0].title, desc: epg[0].desc, start: epg[0].start, end: epg[0].end };
    if (epg && epg[1]) o.next = { title: epg[1].title, start: epg[1].start };
    return o;
  }
  function withEpg(list) {
    return pool(list, 8, function (ch) { return Xt.shortEpg(ch.id, 2); }).then(function (res) {
      var m = {}; list.forEach(function (ch, i) { m[ch.id] = res[i] || []; }); return m;
    });
  }
  var lastCategoryChannels = [];

  // ---------- TMDB ----------
  var TMDB = 'https://api.themoviedb.org/3', TIMG = 'https://image.tmdb.org/t/p/';
  function tmdb(path) {
    var t = S('tmdbToken'), v3 = t.length <= 40 && t.indexOf('.') < 0;
    var url = TMDB + path + (v3 ? (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + t : '');
    return json(url, { headers: v3 ? { Accept: 'application/json' } : { Accept: 'application/json', Authorization: 'Bearer ' + t } });
  }
  var homeCache = null;
  function streamingHome() {
    if (!S('tmdbToken')) return Promise.resolve({ configured: false });
    if (homeCache && Date.now() - homeCache.at < 6 * 3600e3) return Promise.resolve(homeCache.v);
    return asset('services.json').then(function (sv) {
      var list = sv.services.filter(function (s) { return s.provider > 0 && s.key !== 'plex'; });
      function disc(type, p) {
        return tmdb('/discover/' + type + '?watch_region=NL&with_watch_providers=' + p + '&with_watch_monetization_types=flatrate&sort_by=popularity.desc&language=nl-NL&page=1&include_adult=false' +
          (type === 'tv' ? '&without_genres=10762,10751' : '&without_genres=10751,16'))
          .then(function (o) { return (o.results || []).filter(function (x) { return x.backdrop_path; }).map(function (x) { x._type = type; return x; }); })
          .catch(function () { return []; });
      }
      function item(o, key) {
        var tv = o._type === 'tv', date = tv ? o.first_air_date : o.release_date;
        return { id: (tv ? 'tv' : 'movie') + o.id, title: tv ? o.name : o.title, overview: o.overview, year: (date || '').slice(0, 4),
                 type: tv ? 'Serie' : 'Film', rating: o.vote_average || 0, backdrop: TIMG + 'w1280' + o.backdrop_path, thumb: TIMG + 'w780' + o.backdrop_path, service: key };
      }
      return pool(list, 4, function (s) {
        return Promise.all([disc('tv', s.provider), disc('movie', s.provider)]).then(function (r) {
          return [s.key, r[0].slice(0, 4).map(function (x) { return item(x, s.key); }).concat(r[1].slice(0, 2).map(function (x) { return item(x, s.key); }))];
        });
      }).then(function (per) {
        per = per.filter(Boolean);
        var svc = {}, picks = [], seen = {};
        per.forEach(function (p) { if (p[1][0]) svc[p[0]] = p[1][0]; });
        for (var r = 0; r < 6 && picks.length < 14; r++) per.forEach(function (p) { var it = p[1][r]; if (it && !seen[it.id] && picks.length < 14) { seen[it.id] = 1; picks.push(it); } });
        var v = { configured: true, services: svc, picks: picks };
        if (picks.length) homeCache = { at: Date.now(), v: v };
        return v;
      });
    });
  }

  // ---------- Plex ----------
  var PLEX_CLIENT = 'thuis-samsung';
  function plexGet(path) {
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    return json(S('plexUrl') + path + sep + 'X-Plex-Token=' + enc(S('plexToken')), {
      headers: { Accept: 'application/json', 'X-Plex-Client-Identifier': PLEX_CLIENT, 'X-Plex-Product': 'Thuis', 'X-Plex-Device-Name': 'Samsung' }
    }).then(function (o) { return (o && o.MediaContainer) || {}; });
  }
  function plexImg(path, w, h) {
    if (!path) return '';
    return S('plexUrl') + '/photo/:/transcode?width=' + w + '&height=' + h + '&minSize=1&upscale=1&url=' + enc(path) + '&X-Plex-Token=' + enc(S('plexToken'));
  }
  var GENRE = { action: 'Actie', actie: 'Actie', adventure: 'Avontuur', avontuur: 'Avontuur', animation: 'Animatie', animatie: 'Animatie',
    biography: 'Biografie', biografie: 'Biografie', comedy: 'Komedie', komedie: 'Komedie', crime: 'Misdaad', misdaad: 'Misdaad',
    documentary: 'Documentaire', documentaire: 'Documentaire', drama: 'Drama', family: 'Familie', familie: 'Familie', kids: 'Familie',
    fantasy: 'Fantasie', fantasie: 'Fantasie', history: 'Historisch', historisch: 'Historisch', horror: 'Horror', music: 'Muziek', muziek: 'Muziek',
    musical: 'Muziek', mystery: 'Mysterie', mysterie: 'Mysterie', romance: 'Romantiek', romantiek: 'Romantiek', 'science fiction': 'Sciencefiction',
    'sci-fi': 'Sciencefiction', sciencefiction: 'Sciencefiction', 'sci-fi & fantasy': 'Sciencefiction', thriller: 'Thriller', suspense: 'Thriller',
    war: 'Oorlog', oorlog: 'Oorlog', 'war & politics': 'Oorlog', western: 'Western', sport: 'Sport', reality: 'Reality', 'martial arts': 'Actie',
    'tv film': '', 'tv movie': '' };
  var KIDS = { Animatie: 1, Familie: 1 };
  function plexItem(m) {
    var ep = m.type === 'episode', dur = m.duration || 0, off = m.viewOffset || 0;
    return { key: String(m.ratingKey), type: m.type, title: ep ? m.grandparentTitle : m.title,
             sub: ep ? 'S' + m.parentIndex + ' · afl. ' + m.index + ' · ' + m.title : '', year: String(m.year || ''),
             rating: m.audienceRating || m.rating || 0, summary: m.summary || '',
             thumb: plexImg(ep ? (m.grandparentThumb || m.thumb) : m.thumb, 300, 450),
             art: plexImg((ep ? m.grandparentArt : '') || m.art, 1280, 720),
             progress: dur ? off / dur : 0, minutes: Math.round(dur / 60000) };
  }
  var Plex = {
    on: function () { return !!(S('plexUrl') && S('plexToken')); },
    sections: function () {
      if (!this.on()) return Promise.resolve([]);
      return plexGet('/library/sections').then(function (c) {
        return (c.Directory || []).filter(function (d) { return d.type === 'movie' || d.type === 'show'; })
          .map(function (d) { return { key: String(d.key), title: d.title, type: d.type }; });
      });
    },
    library: function (section) {
      return Promise.all([plexGet('/library/sections/' + section + '/all?sort=addedAt:desc'),
                          plexGet('/library/sections/' + section + '/onDeck').catch(function () { return {}; })]).then(function (r) {
        var items = r[0].Metadata || [], deck = r[1].Metadata || [], rows = [];
        if (deck.length) rows.push({ title: 'Verder kijken', items: deck.slice(0, 20).map(plexItem) });
        if (items.length) rows.push({ title: 'Nieuw toegevoegd', total: items.length, items: items.slice(0, 40).map(plexItem) });
        var by = {};
        items.forEach(function (m) {
          var names = {};
          (m.Genre || []).forEach(function (g) { var raw = g.tag || '', n = GENRE.hasOwnProperty(raw.toLowerCase()) ? GENRE[raw.toLowerCase()] : raw; if (n) names[n] = 1; });
          Object.keys(names).forEach(function (n) { (by[n] = by[n] || []).push(m); });
        });
        Object.keys(by).filter(function (n) { return by[n].length >= 3; })
          .sort(function (a, b) { return (KIDS[a] ? 1 : 0) - (KIDS[b] ? 1 : 0) || by[b].length - by[a].length; })
          .forEach(function (n) { rows.push({ title: n, total: by[n].length, items: by[n].slice(0, 40).map(plexItem) }); });
        return { total: items.length, rows: rows };
      });
    },
    show: function (key) {
      return Promise.all([plexGet('/library/metadata/' + key), plexGet('/library/metadata/' + key + '/allLeaves')]).then(function (r) {
        var meta = (r[0].Metadata || [])[0] || {}, seasons = {};
        (r[1].Metadata || []).forEach(function (e) {
          var d = e.duration || 0, o = e.viewOffset || 0;
          (seasons[e.parentIndex] = seasons[e.parentIndex] || []).push({ key: String(e.ratingKey), num: e.index, title: e.title,
            img: plexImg(e.thumb, 640, 360), plot: e.summary || '', dur: Math.round(d / 1000), progress: d ? o / d : 0, watched: (e.viewCount || 0) > 0 });
        });
        return { plot: meta.summary || '', backdrop: plexImg(meta.art, 1280, 720),
                 seasons: Object.keys(seasons).sort(function (a, b) { return a - b; }).map(function (s) { return { season: s, episodes: seasons[s] }; }) };
      });
    },
    tmdbOf: function (m) { var g = (m && m.Guid) || []; for (var i = 0; i < g.length; i++) if (/^tmdb:\/\//.test(g[i].id)) return +g[i].id.slice(7); return 0; },
    playItem: function (key) {
      var self = this;
      return plexGet('/library/metadata/' + key).then(function (c) {
        var m = (c.Metadata || [])[0]; if (!m) throw new Error('Niet gevonden in Plex');
        var part = (((m.Media || [])[0] || {}).Part || [])[0]; if (!part) throw new Error('Geen bestand');
        var ep = m.type === 'episode', tok = '?X-Plex-Token=' + enc(S('plexToken')), subs = [];
        (part.Stream || []).forEach(function (s) {
          if (s.streamType === 3 && s.key && /srt|subrip/i.test(s.codec || '')) subs.push({ url: S('plexUrl') + s.key + tok, lang: s.languageCode || '', label: s.displayTitle || '' });
        });
        var item = { kind: ep ? 'series' : 'movie', key: 'plex:' + key, plexKey: key, url: S('plexUrl') + part.key + tok,
                     title: ep ? m.grandparentTitle : m.title, sub: ep ? 'S' + m.parentIndex + ' · afl. ' + m.index + ' · ' + m.title : String(m.year || ''),
                     season: ep ? m.parentIndex : 0, episode: ep ? m.index : 0, tmdb: self.tmdbOf(m), offsetMs: m.viewOffset || 0, subs: subs };
        if (!ep) return item;
        return plexGet('/library/metadata/' + m.grandparentRatingKey).then(function (g) { item.tmdb = self.tmdbOf((g.Metadata || [])[0]); return item; }, function () { return item; });
      });
    },
    timeline: function (key, state, pos, dur) {
      plexGet('/:/timeline?ratingKey=' + key + '&key=' + enc('/library/metadata/' + key) + '&state=' + state + '&time=' + Math.round(pos) + '&duration=' + Math.round(dur)).catch(function () {});
      if (state === 'stopped' && dur > 0 && pos > dur * 0.9) plexGet('/:/scrobble?identifier=com.plexapp.plugins.library&key=' + key).catch(function () {});
    },
    deck: function () {
      if (!this.on()) return Promise.resolve([]);
      return plexGet('/library/onDeck?X-Plex-Container-Size=15').then(function (c) {
        var m = (c.Metadata || []).filter(function (x) { return x.type === 'movie' || x.type === 'episode'; })[0];
        if (!m) return [];
        var ep = m.type === 'episode', dur = m.duration || 0, off = m.viewOffset || 0, art = m.grandparentArt || m.art;
        return [{ source: 'plex', key: String(m.ratingKey), title: ep ? m.grandparentTitle : m.title,
                  sub: ep ? 'S' + m.parentIndex + ' · afl. ' + m.index + ' · ' + m.title : String(m.year || ''), overview: m.summary || '',
                  progress: dur ? off / dur : 0, left: dur && off ? Math.round((dur - off) / 60000) : -1,
                  backdrop: plexImg(art, 1920, 1080), thumb: plexImg(art, 780, 439), when: (m.lastViewedAt || m.addedAt || 0) * 1000 }];
      });
    }
  };

  // ---------- Jellyfin (één tegel in Verder kijken) ----------
  function jellyfin() {
    var base = S('jellyfinUrl'), key = S('jellyfinKey');
    if (!base || !key) return Promise.resolve([]);
    var h = { Authorization: 'MediaBrowser Client="Thuis", Device="Samsung", DeviceId="thuis-samsung", Version="1", Token="' + key + '"', Accept: 'application/json' };
    var types = 'IncludeItemTypes=Movie,Episode&Fields=Overview', label = '', user;
    function items(o) { return (o && o.Items) || o || []; }
    return json(base + '/Users', { headers: h }).then(function (us) {
      var admin = us.filter(function (u) { return u.Policy && u.Policy.IsAdministrator; })[0] || us[0];
      user = admin && admin.Id; if (!user) return [];
      return json(base + '/Users/' + user + '/Items/Resume?Limit=1&' + types + '&MediaTypes=Video', { headers: h }).then(items)
        .then(function (a) { return a.length ? a : json(base + '/Shows/NextUp?UserId=' + user + '&Limit=1&Fields=Overview', { headers: h }).then(items); })
        .then(function (a) { return a.length ? a : json(base + '/Users/' + user + '/Items?Recursive=true&SortBy=DatePlayed&SortOrder=Descending&Filters=IsPlayed&Limit=1&' + types, { headers: h }).then(items); })
        .then(function (a) { if (a.length) return a; label = 'Nieuw in Jellyfin'; return json(base + '/Users/' + user + '/Items/Latest?Limit=1&' + types, { headers: h }); });
    }).then(function (a) {
      return (a || []).slice(0, 1).map(function (m) {
        var ep = m.Type === 'Episode', art = ep ? (m.SeriesId || m.Id) : m.Id, ud = m.UserData || {}, t = m.RunTimeTicks || 0, p = ud.PlaybackPositionTicks || 0;
        var img = function (w) { return base + '/Items/' + art + '/Images/Backdrop?maxWidth=' + w + '&quality=85'; };
        return { source: 'jellyfin', key: m.Id, title: ep ? m.SeriesName : m.Name,
                 sub: [label, ep ? 'S' + m.ParentIndexNumber + ' · afl. ' + m.IndexNumber + ' · ' + m.Name : String(m.ProductionYear || '')].filter(Boolean).join(' · '),
                 overview: m.Overview || '', progress: t ? p / t : 0, left: t && p ? Math.round((t - p) / 6e8) : -1,
                 backdrop: img(1920), thumb: img(780), when: ud.LastPlayedDate ? Date.parse(ud.LastPlayedDate) : 0 };
      });
    });
  }

  // ---------- films en series van IPTV ----------
  var Vod = {
    categories: function (kind) {
      return Xt.api(kind === 'series' ? 'get_series_categories' : 'get_vod_categories').then(function (a) {
        return (a || []).map(function (c) { return { id: String(c.category_id), name: c.category_name }; })
          .sort(function (x, y) { return (/kind/i.test(x.name) ? 1 : 0) - (/kind/i.test(y.name) ? 1 : 0); });
      });
    },
    list: function (kind, cat) {
      var series = kind === 'series';
      return Xt.api(series ? 'get_series' : 'get_vod_streams', '&category_id=' + enc(cat)).then(function (a) {
        a = (a || []).slice().sort(function (x, y) { return (+(series ? y.last_modified : y.added) || 0) - (+(series ? x.last_modified : x.added) || 0); });
        return { total: a.length, items: a.slice(0, 40).map(function (o) {
          var bd = o.backdrop_path; bd = Array.isArray(bd) ? (bd[0] || '') : (bd || '');
          return { id: String(series ? o.series_id : o.stream_id), name: o.name, icon: series ? o.cover : o.stream_icon, backdrop: series ? bd : '',
                   rating: String(o.rating || ''), year: String(o.year || o.releaseDate || o.release_date || '').slice(0, 4), plot: o.plot || '', ext: o.container_extension || 'mp4' };
        }) };
      });
    },
    info: function (kind, id) {
      if (kind === 'series') return Xt.api('get_series_info', '&series_id=' + enc(id)).then(function (o) {
        var info = o.info || {}, eps = o.episodes || {}, bd = info.backdrop_path; bd = Array.isArray(bd) ? (bd[0] || '') : (bd || '');
        return { plot: info.plot || '', backdrop: bd, genre: info.genre || '', year: String(info.releaseDate || '').slice(0, 4),
                 seasons: Object.keys(eps).sort(function (a, b) { return a - b; }).map(function (s) {
                   return { season: s, episodes: eps[s].map(function (e) { var ei = e.info || {}; return { id: String(e.id), num: +e.episode_num, title: e.title, ext: e.container_extension || 'mkv', img: ei.movie_image || '', plot: ei.plot || '', dur: +ei.duration_secs || 0 }; }) };
                 }) };
      });
      return Xt.api('get_vod_info', '&vod_id=' + enc(id)).then(function (o) {
        var info = o.info || {}, bd = info.backdrop_path; bd = Array.isArray(bd) ? (bd[0] || '') : (bd || '');
        return { plot: info.plot || info.description || '', backdrop: bd, genre: info.genre || '', year: String(info.releasedate || '').slice(0, 4), duration: info.duration || '' };
      });
    },
    url: function (kind, id, ext) { return S('server') + '/' + (kind === 'series' ? 'series' : 'movie') + '/' + enc(S('user')) + '/' + enc(S('pass')) + '/' + id + '.' + (ext || 'mp4'); },
    pos: function (key) { return +localStorage.getItem('thuis.pos:' + key) || 0; },
    save: function (item, pos, dur) {
      var done = dur > 0 && pos > dur * 0.95;
      localStorage.setItem('thuis.pos:' + item.key, done ? 0 : pos);
      if (done) localStorage.removeItem('thuis.vodlast');
      else { item.pos = pos; item.dur = dur; item.when = Date.now(); localStorage.setItem('thuis.vodlast', JSON.stringify(item)); }
    },
    last: function () { try { return JSON.parse(localStorage.getItem('thuis.vodlast') || 'null'); } catch (e) { return null; } },
    cont: function () {
      var l = this.last(); if (!l) return [];
      return [{ source: 'iptv', key: l.key, title: l.title, sub: l.sub, overview: l.plot || '', progress: l.dur ? l.pos / l.dur : 0,
                left: l.dur ? Math.round((l.dur - l.pos) / 60000) : -1, backdrop: l.backdrop || l.img || '', thumb: l.backdrop || l.img || '', when: l.when }];
    }
  };

  // ---------- Radarr / Sonarr ----------
  function upcoming(kind) {
    var series = kind === 'series', base = S(series ? 'sonarrUrl' : 'radarrUrl'), key = S(series ? 'sonarrKey' : 'radarrKey');
    if (!base || !key) return Promise.resolve([]);
    var d = function (ms) { return new Date(ms).toISOString().slice(0, 10); }, now = Date.now();
    var range = 'start=' + d(now - 864e5) + '&end=' + d(now + (series ? 21 : 60) * 864e5);
    var fmt = function (t) { return new Date(t).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }); };
    var img = function (imgs, type) { var i = (imgs || []).filter(function (x) { return x.coverType === type; })[0]; return i ? i.remoteUrl || '' : ''; };
    return json(base + '/api/v3/calendar?' + range + (series ? '&includeSeries=true' : '') + '&unmonitored=false', { headers: { 'X-Api-Key': key } }).then(function (a) {
      var out = [], seen = {};
      (a || []).forEach(function (e) {
        if (series) {
          var s = e.series; if (!s) return; var t = Date.parse(e.airDateUtc); if (seen[s.title + d(t)]) return; seen[s.title + d(t)] = 1;
          out.push({ title: s.title, sub: 'S' + e.seasonNumber + ' · afl. ' + e.episodeNumber + ' · ' + (e.title || ''), when: t, date: fmt(t), hasFile: !!e.hasFile,
                     thumb: img(s.images, 'poster'), art: img(s.images, 'fanart'), summary: e.overview || s.overview || '' });
        } else {
          var pick = [['digitalRelease', 'digitaal'], ['physicalRelease', 'dvd/blu-ray'], ['inCinemas', 'bioscoop']].filter(function (x) { return e[x[0]]; })[0];
          if (!pick) return; var tm = Date.parse(e[pick[0]]);
          out.push({ title: e.title, sub: pick[1], when: tm, date: fmt(tm), hasFile: !!e.hasFile, year: String(e.year || ''),
                     thumb: img(e.images, 'poster'), art: img(e.images, 'fanart'), summary: e.overview || '' });
        }
      });
      return out.sort(function (x, y) { return x.when - y.when; }).slice(0, 40);
    });
  }

  // ---------- OpenSubtitles (Nederlandse ondertitels) ----------
  function findSubs(item) {
    var key = S('osKey'); if (!key) return Promise.resolve(null);
    var cacheKey = 'thuis.sub:' + item.key, cached = localStorage.getItem(cacheKey);
    if (cached) return Promise.resolve(cached);
    var H = { 'Api-Key': key, 'User-Agent': 'Thuis v1.0', Accept: 'application/json', 'Content-Type': 'application/json' };
    var tm = item.tmdb ? Promise.resolve(item.tmdb) : (S('tmdbToken') ? tmdb('/search/' + (item.kind === 'series' ? 'tv' : 'movie') + '?query=' + enc(item.title) + '&language=nl-NL')
      .then(function (o) { return ((o.results || [])[0] || {}).id || 0; }).catch(function () { return 0; }) : Promise.resolve(0));
    return tm.then(function (id) {
      var q = '/subtitles?languages=nl&order_by=download_count';
      if (item.kind === 'series') { q += id ? '&parent_tmdb_id=' + id : '&query=' + enc(item.title); if (item.season) q += '&season_number=' + item.season; if (item.episode) q += '&episode_number=' + item.episode; }
      else q += id ? '&tmdb_id=' + id : '&query=' + enc(item.title);
      return json('https://api.opensubtitles.com/api/v1' + q, { headers: H });
    }).then(function (o) {
      var f = o && o.data && o.data[0] && o.data[0].attributes.files[0]; if (!f) return null;
      var login = S('osUser') && S('osPass') ? json('https://api.opensubtitles.com/api/v1/login', { method: 'POST', headers: H, body: JSON.stringify({ username: S('osUser'), password: S('osPass') }) })
        .then(function (r) { return r.token; }).catch(function () { return null; }) : Promise.resolve(null);
      return login.then(function (tok) {
        var h2 = Object.assign({}, H); if (tok) h2.Authorization = 'Bearer ' + tok;
        return json('https://api.opensubtitles.com/api/v1/download', { method: 'POST', headers: h2, body: JSON.stringify({ file_id: f.file_id, sub_format: 'srt' }) });
      }).then(function (r) { return r && r.link ? http(r.link) : null; });
    }).then(function (txt) { if (txt) { try { localStorage.setItem(cacheKey, txt); } catch (e) {} } return txt; });
  }
  function parseSrt(txt) {
    var out = [];
    (txt || '').replace(/\r/g, '').split(/\n\n+/).forEach(function (b) {
      var m = b.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/); if (!m) return;
      var t = function (h, mi, s, ms) { return ((+h * 60 + +mi) * 60 + +s) * 1000 + +ms; };
      out.push({ a: t(m[1], m[2], m[3], m[4]), b: t(m[5], m[6], m[7], m[8]), text: b.split('\n').slice(b.split('\n')[0].indexOf('-->') >= 0 ? 1 : 2).join('\n').replace(/<[^>]+>/g, '') });
    });
    return out;
  }

  // ---------- speler (Samsung AVPlay) ----------
  var Player = (function () {
    var root, obj, bar, title, line, prog, center, subEl, active = false, mode = 'live', item = null, chans = [], idx = 0;
    var tick = null, hideT = null, lastReport = 0, srt = null, textOn = true, subsTried = false;
    function av() { return window.webapis && webapis.avplay; }
    function el(tag, css, parent) { var e = document.createElement(tag); e.style.cssText = css; (parent || root).appendChild(e); return e; }
    function build() {
      if (root) return;
      root = document.createElement('div');
      root.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:9999;display:none;background:transparent;font-family:Inter,system-ui,sans-serif;color:#fff';
      document.body.appendChild(root);
      obj = document.createElement('object'); obj.type = 'application/avplayer';
      obj.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px'; root.appendChild(obj);
      bar = el('div', 'position:absolute;left:0;right:0;bottom:0;padding:120px 72px 48px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.9));display:none');
      title = el('div', 'font:700 40px/1.2 sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', bar);
      line = el('div', 'font:400 26px/1.4 sans-serif;opacity:.8;margin-top:6px', bar);
      var pb = el('div', 'height:8px;border-radius:4px;background:rgba(255,255,255,.25);margin-top:14px;overflow:hidden', bar);
      prog = el('div', 'height:100%;width:0;background:#fff', pb);
      center = el('div', 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:22px 40px;border-radius:18px;background:rgba(0,0,0,.7);font:700 34px/1.3 sans-serif;text-align:center;display:none;white-space:pre-line');
      subEl = el('div', 'position:absolute;left:10%;right:10%;bottom:90px;text-align:center;font:600 44px/1.3 sans-serif;text-shadow:0 0 6px #000,0 2px 4px #000;white-space:pre-line');
    }
    function show(msg, ms) { center.textContent = msg; center.style.display = 'block'; clearTimeout(show.t); if (ms) show.t = setTimeout(function () { center.style.display = 'none'; }, ms); }
    function fmt(ms) { var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; s %= 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s; }
    function osd(keep) {
      bar.style.display = 'block'; clearTimeout(hideT);
      if (!keep) hideT = setTimeout(function () { bar.style.display = 'none'; }, 4500);
      update();
    }
    function update() {
      var a = av(); if (!a) return;
      if (mode === 'live') {
        var c = chans[idx] || {}, now = c.now || {};
        title.textContent = (c.num ? c.num + '  ' : '') + (c.name || '');
        line.textContent = now.title ? now.title + (now.start ? '  ·  ' + new Date(now.start).toTimeString().slice(0, 5) + ' tot ' + new Date(now.end).toTimeString().slice(0, 5) : '') : '';
        prog.style.width = now.start && now.end ? Math.max(0, Math.min(100, (Date.now() - now.start) / (now.end - now.start) * 100)) + '%' : '0';
      } else {
        var pos = 0, dur = 0; try { pos = a.getCurrentTime(); dur = a.getDuration(); } catch (e) {}
        title.textContent = item.title + (item.sub ? '  ·  ' + item.sub : '');
        line.textContent = dur ? fmt(pos) + ' / ' + fmt(dur) + '   ·   nog ' + fmt(dur - pos) + (a.getState() === 'PAUSED' ? '   ·   gepauzeerd' : '') : '';
        prog.style.width = dur ? pos / dur * 100 + '%' : '0';
      }
    }
    function tracks(type) {
      var a = av(); try { return (a.getTotalTrackInfo() || []).filter(function (t) { return t.type === type; }); } catch (e) { return []; }
    }
    function lang(t) { try { var x = JSON.parse(t.extra_info || '{}'); return (x.language || x.track_lang || '').toLowerCase(); } catch (e) { return ''; } }
    function preferDutch() {
      var au = tracks('AUDIO'), nl = au.filter(function (t) { return /^(nl|nld|dut)/.test(lang(t)); })[0];
      if (nl) try { av().setSelectTrack('AUDIO', nl.index); } catch (e) {}
      var tx = tracks('TEXT'), nlt = tx.filter(function (t) { return /^(nl|nld|dut)/.test(lang(t)); })[0];
      if (nlt) try { av().setSelectTrack('TEXT', nlt.index); } catch (e) {}
      // Geen NL-ondertitels en geen NL-geluid in een film? Dan OpenSubtitles.
      if (mode === 'vod' && !nlt && !srt && !nl && !subsTried) fetchSubs(false);
    }
    function fetchSubs(manual) {
      subsTried = true;
      var sidecar = (item.subs || []).filter(function (s) { return /^(nl|nld|dut)/i.test(s.lang); })[0];
      var p = sidecar ? http(sidecar.url) : findSubs(item);
      if (manual) show('Ondertitels zoeken…', 2000);
      p.then(function (txt) {
        if (!txt) { if (manual) show('Geen Nederlandse ondertitels gevonden', 3000); return; }
        srt = parseSrt(txt); textOn = true; show('Nederlandse ondertitels geladen', 3000);
      }, function (e) { if (manual) show('Ondertitels zoeken lukt niet: ' + e.message, 3500); });
    }
    function cycle(type) {
      var list = tracks(type);
      if (type === 'TEXT') {
        if (srt) { textOn = !textOn; subEl.textContent = ''; show(textOn ? 'Ondertitels aan' : 'Ondertitels uit', 2500); return; }
        if (!list.length) { if (!subsTried || true) fetchSubs(true); return; }
        textOn = !textOn;
        try { av().setSilentSubtitle(!textOn); } catch (e) {}
        subEl.textContent = ''; show(textOn ? 'Ondertitels aan' : 'Ondertitels uit', 2500); return;
      }
      if (list.length < 2) { show('Maar één geluidsspoor', 2500); return; }
      var cur = 0; try { var ci = av().getCurrentStreamInfo().filter(function (t) { return t.type === 'AUDIO'; })[0]; cur = list.map(function (t) { return t.index; }).indexOf(ci.index); } catch (e) {}
      var nx = list[(cur + 1) % list.length];
      try { av().setSelectTrack('AUDIO', nx.index); } catch (e) {}
      show('Geluid: ' + (lang(nx) || 'spoor ' + ((cur + 1) % list.length + 1)), 2500);
    }
    function report(state) {
      if (mode !== 'vod' || !item) return;
      var a = av(), pos = 0, dur = 0; try { pos = a.getCurrentTime(); dur = a.getDuration(); } catch (e) {}
      if (!dur) return;
      if (item.plexKey) Plex.timeline(item.plexKey, state, pos, dur);
      else if (state === 'stopped') Vod.save(item, pos, dur);
    }
    function open(url, startAt) {
      var a = av(); if (!a) { show('Speler niet beschikbaar', 3000); return; }
      try { a.stop(); a.close(); } catch (e) {}
      srt = null; subEl.textContent = '';
      a.open(url);
      a.setDisplayRect(0, 0, 1920, 1080);
      a.setListener({
        onbufferingstart: function () { show('Laden…'); },
        onbufferingcomplete: function () { center.style.display = 'none'; },
        onstreamcompleted: function () { report('stopped'); stop(); },
        onerror: function (e) { show((mode === 'live' ? 'Deze zender speelt niet' : 'Dit speelt niet af') + '\n' + e, 0); },
        onsubtitlechange: function (d, text) { if (!srt && textOn) { subEl.textContent = text || ''; clearTimeout(open.st); open.st = setTimeout(function () { subEl.textContent = ''; }, +d || 3000); } },
        oncurrentplaytime: function (t) {
          if (srt && textOn) { var cue = null; for (var i = 0; i < srt.length; i++) if (t >= srt[i].a && t <= srt[i].b) { cue = srt[i]; break; } subEl.textContent = cue ? cue.text : ''; }
        }
      });
      show('Laden…');
      a.prepareAsync(function () {
        if (startAt > 60000) { try { a.seekTo(startAt); show('Verder vanaf ' + fmt(startAt), 3000); } catch (e) {} }
        a.play(); preferDutch(); osd();
      }, function (e) { show('Kan niet openen\n' + e, 0); });
    }
    function start() {
      build(); active = true; subsTried = false; root.style.display = 'block';
      document.body.dataset.playing = '1';
      Array.prototype.forEach.call(document.body.children, function (c) { if (c !== root) { c.dataset.vis = c.style.visibility; c.style.visibility = 'hidden'; } });
      document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent';
      clearInterval(tick);
      tick = setInterval(function () {
        if (bar.style.display === 'block') update();
        if (mode === 'vod' && Date.now() - lastReport > 10000) { lastReport = Date.now(); var st = av().getState(); report(st === 'PAUSED' ? 'paused' : 'playing'); }
      }, 1000);
    }
    function stop() {
      if (!active) return;
      report('stopped');
      try { av().stop(); av().close(); } catch (e) {}
      active = false; clearInterval(tick); root.style.display = 'none'; bar.style.display = 'none';
      delete document.body.dataset.playing;
      Array.prototype.forEach.call(document.body.children, function (c) { if (c !== root) c.style.visibility = c.dataset.vis || ''; });
      document.documentElement.style.background = ''; document.body.style.background = '';
      if (window.__resume) window.__resume();
    }
    function zap(i) {
      if (!chans.length) return;
      idx = (i + chans.length) % chans.length;
      localStorage.setItem('thuis.lastChannel', chans[idx].id);
      open(Xt.streamUrl(chans[idx].id), 0); osd();
    }
    function key(e) {
      var c = e.keyCode, a = av();
      if (c === 10009 || c === 27 || c === 8) { stop(); return; }
      if (c === 404 || c === 71) { cycle('AUDIO'); return; }          // groen
      if (c === 405 || c === 83) { cycle('TEXT'); return; }           // geel
      if (c === 457) { osd(); return; }                               // info
      if (mode === 'live') {
        if (c === 38 || c === 427) zap(idx + 1);
        else if (c === 40 || c === 428) zap(idx - 1);
        else if (c === 13 || c === 37 || c === 39) osd();
        return;
      }
      try {
        if (c === 13 || c === 10252 || c === 415 || c === 19) { if (a.getState() === 'PAUSED') a.play(); else a.pause(); osd(a.getState() === 'PAUSED'); }
        else if (c === 37 || c === 412) { a.jumpBackward(10000); osd(); }
        else if (c === 39 || c === 417) { a.jumpForward(30000); osd(); }
        else if (c === 38) { a.jumpForward(300000); osd(); }
        else if (c === 40) { a.jumpBackward(300000); osd(); }
        else if (c === 413) { stop(); }
      } catch (err) {}
    }
    return {
      active: function () { return active; },
      key: key,
      live: function (list, id) {
        build(); mode = 'live'; chans = list; idx = Math.max(0, list.map(function (c) { return c.id; }).indexOf(id));
        start(); zap(idx);
      },
      vod: function (it) {
        build(); mode = 'vod'; item = it; start();
        var at = it.offsetMs != null && it.plexKey ? it.offsetMs : Vod.pos(it.key);
        open(it.url, at);
      }
    };
  })();

  // ---------- apps op de Samsung ----------
  var ORDER = ['netflix', 'prime', 'videoland', 'skyshowtime', 'withlove', 'youtube', 'npo', 'plex', 'ziggo'];
  function apps() {
    return new Promise(function (res) {
      try {
        tizen.application.getAppsInfo(function (list) {
          var out = list.filter(function (a) { return a.show && a.name && !/thuis/i.test(a.name); }).map(function (a) {
            return { label: a.name, pkg: a.id, icon: a.iconPath || '', banner: '' };
          });
          if (S('hdmiWebhook')) out.push({ label: 'Ziggo (HDMI)', pkg: 'hdmi:ziggo', icon: '', banner: '' });
          out.sort(function (x, y) {
            var i = ORDER.findIndex(function (o) { return x.label.toLowerCase().indexOf(o) >= 0; }), j = ORDER.findIndex(function (o) { return y.label.toLowerCase().indexOf(o) >= 0; });
            return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || x.label.localeCompare(y.label);
          });
          res(out);
        }, function () { res([]); });
      } catch (e) { res([]); }
    });
  }
  function launch(id) {
    if (/^hdmi:/.test(id)) {
      // Naar de HDMI-ingang van de Ziggo-box: via Home Assistant (de Samsung-integratie daar kan van bron wisselen).
      if (S('hdmiWebhook')) http(S('hdmiWebhook'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bron: 'ziggo' }) });
      return;
    }
    try { tizen.application.launch(id); } catch (e) {}
  }

  // ---------- het platform voor het startscherm ----------
  window.ThuisPlatform = {
    name: 'tizen',
    noJbl: true,
    liveCategories: function (cb) {
      if (!configured()) { cb(true, JSON.stringify({ configured: false })); return; }
      reply(cb, Xt.load().then(function (all) {
        return buildCats(all).then(function (cats) {
          var show = S('categories').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          var vis = cats.filter(function (c) { return !c.parent && c.channels.length && (!show.length || c.id === 'alle' || show.some(function (s) { return c.name.toLowerCase().indexOf(s) >= 0 || c.id === s; })); });
          return { configured: true, total: all.length, categories: vis.map(function (c) { return { id: c.id, name: c.name, img: c.img, count: c.channels.length, sample: c.channels.slice(0, 4).map(function (x) { return x.name; }) }; }) };
        });
      }));
    },
    liveCategory: function (catId, cb) {
      reply(cb, Xt.load().then(buildCats).then(function (cats) {
        var cat = cats.filter(function (c) { return c.id === catId; })[0];
        var kids = cats.filter(function (c) { return c.parent === catId && c.channels.length; }).sort(function (a, b) { return a.last - b.last; });
        var out = { name: cat ? cat.name : '' };
        if (kids.length) {
          var all = []; kids.forEach(function (k) { all = all.concat(k.channels.slice(0, 60)); });
          lastCategoryChannels = cat ? cat.channels : all;
          return withEpg(all).then(function (epg) {
            out.groups = kids.map(function (k) { return { id: k.id, name: k.name, channels: k.channels.slice(0, 60).map(function (ch) { return channelJson(ch, epg[ch.id]); }) }; });
            return out;
          });
        }
        var list = (cat ? cat.channels : []).slice(0, 150);
        lastCategoryChannels = list;
        return withEpg(list).then(function (epg) { out.channels = list.map(function (ch) { return channelJson(ch, epg[ch.id]); }); return out; });
      }));
    },
    apps: function (cb) { reply(cb, apps()); },
    test: function (cb) { reply(cb, Xt.api(null).then(function (o) { var u = o && o.user_info; if (!u || u.auth == 0) throw new Error('Inloggen mislukt'); return u; })); },
    getSettings: function () { var s = settings(); if (!s.format) s.format = 'ts'; return s; },
    saveSettings: function (o) { saveSettingsObj(o); },
    play: function (id, cat) {
      id = +id;
      Xt.load().then(function (all) {
        var list = cat && lastCategoryChannels.length ? lastCategoryChannels : all;
        if (!list.some(function (c) { return c.id === id; })) list = all;
        // Gids-info meenemen voor de infobalk
        withEpg([list.filter(function (c) { return c.id === id; })[0]]).then(function (epg) {
          Player.live(list.map(function (c) { return c.id === id && epg[id] ? Object.assign({}, c, { now: epg[id][0] }) : c; }), id);
        });
      });
    },
    playLast: function () {
      Xt.load().then(function (all) { var id = +localStorage.getItem('thuis.lastChannel') || (all[0] && all[0].id); if (id) Player.live(all, id); });
    },
    launch: launch,
    systemSettings: function () {},
    checkUpdate: function (cb) { cb(true, JSON.stringify({ newer: false, current: 'Samsung', latest: 'Samsung' })); },
    installUpdate: function (cb) { cb(false, 'Bijwerken gaat op de Samsung via een nieuw app-pakket'); },
    streamingHome: function (cb) { reply(cb, streamingHome()); },
    continueWatching: function (cb) {
      var errors = [];
      reply(cb, Promise.all([
        Plex.deck().catch(function (e) { errors.push('Plex: ' + e.message); return []; }),
        jellyfin().catch(function (e) { errors.push('Jellyfin: ' + e.message); return []; })
      ]).then(function (r) {
        var all = r[0].concat(r[1]).concat(Vod.cont()).sort(function (a, b) { return (b.when || 0) - (a.when || 0); });
        return { items: all.slice(0, 20), errors: errors };
      }));
    },
    openMedia: function (src, key) {
      if (src === 'iptv') { var l = Vod.last(); if (l) Player.vod(l); return; }
      if (src === 'plex') { window.ThuisPlatform.plexPlay(key); return; }
      // Jellyfin-app openen als die er is
      apps().then(function (list) { var j = list.filter(function (a) { return /jellyfin/i.test(a.label); })[0]; if (j) launch(j.pkg); });
    },
    jbl: function (pkg, cb) { cb(false, 'niet nodig op de Samsung'); },
    vodCategories: function (kind, cb) { reply(cb, Vod.categories(kind)); },
    vodList: function (kind, cat, cb) { reply(cb, Vod.list(kind, cat)); },
    vodInfo: function (kind, id, cb) { reply(cb, Vod.info(kind, id)); },
    playVod: function (o) {
      o.url = Vod.url(o.kind, o.id, o.ext); o.key = o.kind + ':' + o.id;
      Player.vod(o);
    },
    plexSections: function (cb) { reply(cb, Plex.sections()); },
    plexLibrary: function (sec, cb) { reply(cb, Plex.library(sec)); },
    plexShow: function (key, cb) { reply(cb, Plex.show(key)); },
    plexPlay: function (key) { Plex.playItem(key).then(function (it) { Player.vod(it); }, function () {}); },
    arrUpcoming: function (kind, cb) { reply(cb, upcoming(kind)); }
  };

  // ---------- toetsen van de Samsung-afstandsbediening ----------
  try {
    tizen.tvinputdevice.registerKeyBatch(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward',
      'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'ChannelUp', 'ChannelDown', 'Info']);
  } catch (e) {}
  window.addEventListener('keydown', function (e) {
    if (Player.active()) { e.preventDefault(); e.stopImmediatePropagation(); Player.key(e); return; }
    if (e.keyCode === 10009) {
      // Terug: eerst binnen Thuis terug, op het startscherm zelf niets doen.
      e.preventDefault(); e.stopImmediatePropagation();
      if (window.__back) window.__back();
    }
  }, true);
})();

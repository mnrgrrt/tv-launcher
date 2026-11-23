// tv-serverr: één server voor alle tv's in huis.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { db, S, setSettings, publicSettings, uncache } from './db.js';
import * as auth from './auth.js';
import * as xtream from './xtream.js';
import { build as categories } from './categories.js';
import * as epg from './epg.js';
import * as tmdb from './tmdb.js';
import * as plex from './plex.js';
import * as subs from './subs.js';
import * as profiles from './profiles.js';
import * as catalog from './catalog.js';
import * as taste from './taste.js';
import * as youtube from './youtube.js';
import * as searches from './searches.js';
import * as photos from './photos.js';
import { pipe, target } from './proxy.js';
import { pool } from './http.js';
import { status } from './status.js';

const PORT = +process.env.PORT || 8484;
const WEB = path.resolve(new URL('../../shared/web', import.meta.url).pathname);
const PUBLIC = path.resolve(new URL('../public', import.meta.url).pathname);
const VERSION = process.env.THUIS_VERSION || 'dev';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const ipOf = req => (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
async function body(req) {
  let n = 0; const parts = [];
  for await (const c of req) { n += c.length; if (n > 5e6) throw Object.assign(new Error('Te groot'), { status: 413 }); parts.push(c); }
  const t = Buffer.concat(parts).toString('utf8'); return t ? JSON.parse(t) : {};
}
function file(res, root, rel) {
  const f = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return false;
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=300' });
  fs.createReadStream(f).pipe(res); return true;
}

// ---------- routes ----------
const routes = [];
const on = (method, pattern, level, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), level, fn });

// Open: alleen wat nodig is om te koppelen.
on('GET', '/api/health', 'open', () => ({ ok: true, name: 'tv-serverr', version: VERSION }));
on('POST', '/api/pair', 'open', async ({ req, b }) => ({ key: auth.pair(b.code, b.name, ipOf(req)) }));

// Inloggen beheer
const COOKIE = (v, age) => `tvs=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
on('GET', '/api/session', 'open', ({ req }) => { const u = auth.userFor(req); return { user: u ? u.name : null, setup: !auth.hasUsers() }; });
on('POST', '/api/setup', 'open', ({ req, res, b }) => {
  const s = auth.setup(b.pin, b.name, b.password, ipOf(req)); auth.audit(s.name, 'eerste account aangemaakt');
  res.setHeader('Set-Cookie', COOKIE(s.token, s.maxAge)); return { user: s.name };
});
on('POST', '/api/login', 'open', ({ req, res, b }) => {
  const s = auth.login(b.name, b.password, ipOf(req)); res.setHeader('Set-Cookie', COOKIE(s.token, s.maxAge)); return { user: s.name };
});
on('POST', '/api/logout', 'open', ({ req, res }) => { auth.logout(req); res.setHeader('Set-Cookie', COOKIE('', 0)); return { ok: true }; });

// Beheer (ingelogd)
on('GET', '/api/admin/settings', 'admin', async () => ({ settings: publicSettings(), epg: epg.epgStatus(), devices: auth.devices(), profiles: profiles.list(),
  users: auth.users(), log: auth.auditLog(), status: await status() }));
on('POST', '/api/admin/settings', 'admin', ({ b, me }) => { setSettings(b); uncache(''); auth.audit(me.name, 'koppelingen aangepast: ' + Object.keys(b).join(', ')); return { ok: true }; });
on('POST', '/api/admin/code', 'admin', ({ me }) => { auth.audit(me.name, 'koppelcode aangevraagd'); return { code: auth.newCode(), minutes: 10 }; });
on('DELETE', '/api/admin/devices/:id', 'admin', ({ p, me }) => { auth.unpair(p.id); auth.audit(me.name, 'tv ontkoppeld #' + p.id); return { ok: true }; });
on('POST', '/api/admin/devices/:id', 'admin', ({ p, b, me }) => { auth.setDevice(p.id, b); auth.audit(me.name, 'apparaat aangepast #' + p.id); return auth.devices(); });
on('POST', '/api/admin/profiles/:id/move', 'admin', ({ p, b }) => { profiles.move(p.id, +b.dir); return profiles.list(); });
on('POST', '/api/admin/profiles/:id/plex', 'admin', ({ p, b, me }) => { profiles.setPlexDeck(p.id, !!b.on); auth.audit(me.name, `Verder kijken van Plex ${b.on ? 'aan' : 'uit'} voor profiel #${p.id}`); return profiles.list(); });
on('POST', '/api/admin/profiles/:id/admin', 'admin', ({ p, b, me }) => { profiles.setAdmin(p.id, !!b.admin); auth.audit(me.name, `"mag alles" ${b.admin ? 'aan' : 'uit'} voor profiel #${p.id}`); return profiles.list(); });
on('POST', '/api/admin/profiles/:id/avatar', 'admin', ({ p, b }) => { profiles.setAvatar(p.id, b.avatar); return profiles.list(); });
on('POST', '/api/admin/profiles/:id/photo', 'admin', ({ p, b, me }) => { profiles.savePhoto(p.id, b.data); auth.audit(me.name, 'foto geüpload voor profiel #' + p.id); return profiles.list(); });
// Kijkgeschiedenis (Netflix-export) voor de smaak van een profiel. Alleen titels worden bewaard.
on('POST', '/api/admin/profiles/:id/history', 'admin', ({ p, b, me }) => {
  const n = taste.importCsv(p.id, b.csv); auth.audit(me.name, `kijkgeschiedenis toegevoegd voor profiel #${p.id} (${n} titels)`); return { titles: n };
});
on('GET', '/api/admin/photos', 'admin', () => photos.list());
on('POST', '/api/admin/photos', 'admin', ({ b, me }) => { const l = photos.add(b.data, b.by); auth.audit(me.name, 'foto toegevoegd voor Thuis'); return l; });
on('DELETE', '/api/admin/photos/:file', 'admin', ({ p, me }) => { const l = photos.remove(p.file); auth.audit(me.name, 'foto weggehaald: ' + p.file); return l; });
on('POST', '/api/admin/profiles', 'admin', ({ b, me }) => { profiles.save(b); auth.audit(me.name, 'profiel opgeslagen: ' + b.name); return profiles.list(); });
on('DELETE', '/api/admin/profiles/:id', 'admin', ({ p, me }) => { profiles.remove(p.id); auth.audit(me.name, 'profiel verwijderd #' + p.id); return profiles.list(); });
on('POST', '/api/admin/users', 'admin', ({ b, me }) => { auth.addUser(b.name, b.password); auth.audit(me.name, 'beheerder toegevoegd: ' + b.name); return auth.users(); });
on('DELETE', '/api/admin/users/:id', 'admin', ({ p, me }) => { auth.removeUser(p.id, me); auth.audit(me.name, 'beheerder verwijderd #' + p.id); return auth.users(); });
on('POST', '/api/admin/password', 'admin', ({ b, me }) => { auth.changePw(me, b.old, b.password); auth.audit(me.name, 'eigen wachtwoord gewijzigd'); return { ok: true }; });
on('POST', '/api/admin/epg', 'admin', () => { epg.refresh(); return { started: true }; });
on('POST', '/api/admin/channels', 'admin', async ({ me }) => {
  const { channels } = await xtream.channels(true); uncache('vod:'); epg.refresh(); status(true);
  auth.audit(me.name, 'zenders ververst'); return { channels: channels.length };
});
// Bijwerken: de server zet alleen een seintje neer; het updatescript buiten de container doet de rest.
const FLAG = path.join(process.env.THUIS_DATA || '/data', 'update-now');
on('GET', '/api/admin/update', 'admin', () => ({ version: VERSION, requested: fs.existsSync(FLAG) }));
on('POST', '/api/admin/update', 'admin', ({ me }) => { fs.writeFileSync(FLAG, String(Date.now())); auth.audit(me.name, 'bijwerken aangevraagd'); return { ok: true }; });
on('GET', '/api/admin/status', 'admin', () => status(true));

// Gekoppelde tv's
on('GET', '/api/whoami', 'device', ({ dev }) => ({ device: dev.name, version: VERSION, profile: dev.profile || 0, locked: !!dev.locked, ask: dev.ask || 'samen', view: dev.view || '' }));
// Op de tv zelf: standaardprofiel en vraag-instelling kiezen, behalve als het apparaat vastgezet is.
on('POST', '/api/device', 'device', ({ dev, b }) => {
  // Weergave mag altijd; profiel en vragen alleen als het apparaat niet vastgezet is.
  if (dev.locked && (b.profile != null || b.ask != null)) throw Object.assign(new Error('Dit apparaat is vastgezet op een profiel'), { status: 403 });
  auth.setDevice(dev.id, { profile: b.profile, ask: b.ask, view: b.view }); return { ok: true };
});
on('GET', '/api/avatars', 'device', () => JSON.parse(fs.readFileSync(path.join(PUBLIC, 'avatars/index.json'), 'utf8')));
// Foto's bovenaan Thuis
on('GET', '/api/photos', 'device', () => photos.list());
on('POST', '/api/profiles/:id/avatar', 'device', ({ dev, p, b }) => {
  if (dev.locked && +p.id !== dev.profile) throw Object.assign(new Error('Niet toegestaan op dit apparaat'), { status: 403 });
  profiles.setAvatar(p.id, b.avatar); return profiles.list();
});
on('GET', '/api/watchers', 'device', ({ q }) => profiles.watchers(q.get('key') || '', +q.get('profile') || 0));
on('GET', '/api/profiles', 'device', ({ dev }) => profiles.list().filter(p => !dev.locked || p.id === dev.profile));
on('POST', '/api/profiles/:id/prefs', 'device', ({ p, b }) => { profiles.setPrefs(p.id, b); return { ok: true }; });

on('GET', '/api/live/categories', 'device', async () => (await categories()).map(c => ({ ...c, channels: c.channels.map(ch => ({ ...ch, url: auth.sign(`/stream/live/${ch.id}`) })) })));
on('GET', '/api/live/nownext', 'device', async ({ q }) => {
  const ids = new Set((q.get('ids') || '').split(',').map(Number));
  const { channels } = await xtream.channels();
  return xtream.nowNext(channels.filter(c => ids.has(c.id)).slice(0, 60), epg.nowNextFor);
});
on('GET', '/api/status', 'device', async () => { const st = await status(); return Object.fromEntries(Object.entries(st.sources).map(([k, v]) => [k, v.ok])); });
on('GET', '/api/live/guide', 'device', async ({ q }) => {
  const ids = new Set((q.get('ids') || '').split(',').map(Number));
  const { channels } = await xtream.channels();
  const chs = channels.filter(c => ids.has(c.id)).slice(0, 100);
  const from = +q.get('from') || Date.now() - 3600e3, to = Math.min(+q.get('to') || from + 6 * 3600e3, from + 26 * 3600e3);
  const g = epg.grid([...new Set(chs.map(c => c.epgId).filter(Boolean))], from, to);
  return chs.map(c => ({ id: c.id, archive: c.archive, programmes: g[c.epgId] || [] }));
});
// Terugkijken: begintijd in Nederlandse tijd, zoals de aanbieder hem verwacht.
on('GET', '/api/live/catchup/:id', 'device', ({ p, q }) => {
  const start = +q.get('start'), end = +q.get('end') || start + 3600e3;
  if (!start || start > Date.now()) throw Object.assign(new Error('Dit programma is nog niet geweest'), { status: 400 });
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(start));
  const stamp = f.replace(' ', ':').replace(/:(\d{2})$/, '-$1');      // 2026-11-22:20-00
  const minutes = Math.min(Math.ceil((end - start) / 60000) + 10, 600);  // 10 minuten marge voor uitloop
  return { url: auth.sign(`/stream/timeshift/${+p.id}/${stamp}/${minutes}`) };
});
on('GET', '/api/live/url/:id', 'device', ({ p }) => ({ url: auth.sign(`/stream/live/${+p.id}`) }));

// services = de diensten van dit profiel (de tv weet welke er op het apparaat staan); leeg = alle diensten.
on('GET', '/api/home', 'device', async ({ q }) => ({ picks: await tmdb.home(svcOf(q)).catch(() => ({})) }));
// Nieuw voor jou: nieuw uit alle bronnen, wat bij de smaak van dit profiel past bovenaan.
on('GET', '/api/foryou', 'device', async ({ q }) => {
  const prof = +q.get('profile') || 1;
  const l = await catalog.forYou(svcOf(q), catalog.prefsOf(profileOf(prof)), taste.forProfile(prof, taste.lookup));
  return { now: l.now.map(o => withSources(o.kind)(o)), later: l.later };
});
on('GET', '/api/services/logos', 'device', () => tmdb.logos().catch(() => ({})));
on('GET', '/api/art/:type/:id', 'device', ({ p }) => tmdb.art(p.type === 'tv' ? 'tv' : 'movie', +p.id).catch(() => ({})));
// Info van een titel. Bij Gerelateerd zetten we erbij of we het zelf hebben (Plex of IPTV), zodat de tegel dat laat zien.
on('GET', '/api/info/:type/:id', 'device', async ({ p }) => {
  const type = p.type === 'tv' ? 'tv' : 'movie', kind = type === 'tv' ? 'series' : 'movie';
  const d = await tmdb.details(type, +p.id), c = await catalog.items(kind).catch(() => null);
  const related = d.related.map(x => { const o = c && c.byTmdb.get(x.tmdb); return o ? { ...x, sources: o.sources, plex: o.plex || null, vod: o.vod ? withVod(kind, o.vod) : null } : x; });
  return { ...d, related };
});
on('GET', '/api/person/:id', 'device', ({ p }) => tmdb.person(+p.id));
on('GET', '/api/plex/extras/:key', 'device', ({ p }) => plex.extras(+p.key));

// Films en series: Plex en IPTV samen (richting C: slimme rijen, genres, collecties en een raster met filters).
const withSources = kind => o => ({ ...o, vod: o.vod ? withVod(kind, o.vod) : null });
// services = de diensten van het profiel (de tv weet welke apps er staan); de voorkeuren (minimumcijfer, genres overslaan) komen uit het profiel.
const svcOf = q => (q.get('services') || '').split(',').filter(Boolean);
const profileOf = id => profiles.list().find(x => x.id === id);
on('GET', '/api/catalog/:kind/overview', 'device', async ({ p, q }) => {
  const o = await catalog.overview(kindOf(p.kind), svcOf(q), catalog.prefsOf(profileOf(+q.get('profile'))));
  return { ...o, newest: o.newest.map(withSources(p.kind)) };
});
on('GET', '/api/catalog/:kind/browse', 'device', async ({ p, q }) => {
  const f = Object.fromEntries(['genre', 'src', 'cat', 'sort', 'alles', 'offset'].map(k => [k, q.get(k) || '']));
  const o = await catalog.browse(kindOf(p.kind), f, svcOf(q), catalog.prefsOf(profileOf(+q.get('profile'))));
  return { ...o, items: o.items.map(withSources(p.kind)) };
});
on('GET', '/api/streaming/:kind', 'device', ({ p, q }) => tmdb.serviceRows(kindOf(p.kind) === 'series' ? 'tv' : 'movie', (q.get('services') || '').split(',').filter(Boolean)));
on('GET', '/api/vod/:kind/url/:id', 'device', ({ p, q }) => ({ url: auth.sign(`/stream/${kindOf(p.kind)}/${+p.id}.${safeExt(q.get('ext'))}`) }));

on('GET', '/api/plex/play/:key', 'device', ({ p }) => plex.playItem(+p.key));

// Zoeken: de gids (zenders, nu, straks, terug) en films en series. Dezelfde titel uit Plex, IPTV en
// streamingdiensten wordt één regel met alle plekken waar hij staat.
on('GET', '/api/search', 'device', async ({ q }) => {
  const s = (q.get('q') || '').trim(); if (s.length < 2) return {};
  const [own, guide, web, yt] = await Promise.all([catalog.search(s).catch(() => []), epg.searchGuide(s).catch(() => ({})), tmdb.search(s).catch(() => []),
    youtube.search(s).catch(() => ({ live: [], upcoming: [] }))]);
  const titles = own.map(o => ({ ...withSources(o.kind)(o), services: [] }));
  const byTmdb = new Map(titles.filter(t => t.tmdb).map(t => [(t.kind === 'series' ? 'tv' : 'movie') + t.tmdb, t]));
  // Bij welke dienst staat het? Alleen voor de bovenste treffers, anders wordt het traag.
  await pool(web.slice(0, 10), 5, async h => {
    const services = await tmdb.providers(h.media_type, h.id), have = byTmdb.get(h.media_type + h.id);
    if (have) { have.services = services; if (!have.poster) have.poster = tmdb.item(h, '').poster; return; }
    if (services.length) titles.push({ ...tmdb.item(h, ''), kind: h.media_type === 'tv' ? 'series' : 'movie', sources: [], services });
  });
  return { guide, titles, youtube: yt };
});
// Laatst gezocht (per profiel)
on('GET', '/api/searches', 'device', ({ q }) => searches.list(+q.get('profile') || 1));
on('POST', '/api/searches', 'device', ({ b }) => { searches.add(+b.profile || 1, b.q); return { ok: true }; });
on('DELETE', '/api/searches', 'device', ({ q }) => { searches.remove(+q.get('profile') || 1, q.get('q') || ''); return searches.list(+q.get('profile') || 1); });

on('GET', '/api/subs/search', 'device', ({ q }) => subs.search(Object.fromEntries(q)));
on('GET', '/api/subs/file/:id', 'device', async ({ res, p }) => { send(res, 200, await subs.download(+p.id), 'application/x-subrip; charset=utf-8'); });

on('POST', '/api/progress', 'device', ({ b }) => { profiles.progress(+b.profile || 1, b); return { ok: true }; });
on('GET', '/api/position', 'device', ({ q }) => ({ pos: profiles.position(+q.get('profile') || 1, q.get('key') || '') }));
on('GET', '/api/continue', 'device', async ({ q }) => (await profiles.continueWatching(+q.get('profile') || 1)).map(withUrl));
on('POST', '/api/continue/hide', 'device', ({ b }) => { profiles.hide(+b.profile || 1, String(b.key || '')); return { ok: true }; });
on('POST', '/api/watched', 'device', ({ b }) => { profiles.setWatched(+b.profile || 1, Array.isArray(b.items) ? b.items : [], !!b.on); return { ok: true }; });
on('GET', '/api/watched', 'device', ({ q }) => q.get('key') ? { on: profiles.isWatched(+q.get('profile') || 1, q.get('key')) } : profiles.watchedList(+q.get('profile') || 1));
on('GET', '/api/show', 'device', ({ q }) => {
  const plexKey = +q.get('plex') || 0, vodId = +q.get('vod') || 0;
  if (!plexKey && !vodId) throw Object.assign(new Error('Geen serie opgegeven'), { status: 400 });
  return profiles.showState(+q.get('profile') || 1, plexKey ? { plex: plexKey } : { vod: vodId });
});
on('GET', '/api/mylist', 'device', ({ q }) => profiles.mylist(+q.get('profile') || 1));
on('POST', '/api/mylist', 'device', ({ b }) => ({ inList: profiles.toggleList(+b.profile || 1, b.key, b.meta) }));
on('GET', '/api/favorites', 'device', ({ q }) => profiles.favorites(+q.get('profile') || 1));
on('PUT', '/api/favorites', 'device', ({ b }) => { profiles.setFavorites(+b.profile || 1, b.channels); return { ok: true }; });

const kindOf = k => (k === 'series' ? 'series' : 'movie');
const safeExt = e => (/^\w{2,5}$/.test(e || '') ? e : 'mp4');
const withVod = (kind, i) => ({ ...i, url: kindOf(kind) === 'movie' ? auth.sign(`/stream/movie/${+i.id}.${safeExt(i.ext)}`) : '' });
const withUrl = i => (i.kind === 'series' && i.id && !String(i.key).startsWith('plex:') ? { ...i, url: auth.sign(`/stream/series/${+i.id}.${safeExt(i.ext)}`) } : i);

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), ip = ipOf(req);
  try {
    // Streams en plaatjes: alleen met een geldige handtekening.
    if (u.pathname.startsWith('/stream/') || u.pathname.startsWith('/img/')) {
      if (!['GET', 'HEAD'].includes(req.method) || !auth.verify(req.url)) return send(res, 403, { error: 'Link ongeldig of verlopen' });
      const t = target(u.pathname, u.searchParams); if (!t) return send(res, 404, { error: 'Onbekend' });
      return pipe(req, res, t.url, t.headers);
    }
    if (u.pathname.startsWith('/api/')) {
      const r = routes.find(r => r.method === req.method && r.re.test(u.pathname));
      if (!r) return send(res, 404, { error: 'Onbekend' });
      let dev = null;
      if (r.level === 'device') { dev = auth.deviceFor(req.headers['x-thuis-key'], ip); if (!dev) return send(res, 401, { error: 'Deze tv is niet gekoppeld' }); }
      let me = null;
      if (r.level === 'admin') {
        me = auth.userFor(req); if (!me) return send(res, 401, { error: 'Niet ingelogd' });
        // Extra header: een andere website kan die niet meesturen zonder dat de browser eerst toestemming vraagt.
        if (req.method !== 'GET' && req.headers['x-thuis'] !== '1') return send(res, 403, { error: 'Geweigerd' });
      }
      const b = ['POST', 'PUT'].includes(req.method) ? await body(req) : {};
      const out = await r.fn({ req, res, dev, me, b, q: u.searchParams, p: r.re.exec(u.pathname).groups || {} });
      if (!res.headersSent) send(res, 200, out ?? {});
      return;
    }
    if (u.pathname.startsWith('/photo/')) {
      const f = profiles.photoPath(u.pathname.slice(7));
      if (!f || !auth.verify(req.url) || !fs.existsSync(f)) return send(res, 404, { error: 'Onbekend' });
      return file(res, path.dirname(f), path.basename(f));
    }
    if (u.pathname.startsWith('/avatars/') && file(res, PUBLIC, u.pathname)) return;
    if (u.pathname.startsWith('/achtergrond/') && file(res, photos.DIR, u.pathname.slice(13))) return;
    if (u.pathname === '/beheer' || u.pathname === '/') { res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"); if (file(res, PUBLIC, 'beheer.html')) return; }
    if (u.pathname.startsWith('/app/') && file(res, WEB, u.pathname.slice(5) || 'index.html')) return;
    send(res, 404, 'Niet gevonden', 'text/plain; charset=utf-8');
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Fout' });
    if (!e.status) console.error(new Date().toISOString(), req.method, u.pathname, e.message);
  }
});
server.listen(PORT, () => console.log(`tv-serverr ${VERSION} luistert op poort ${PORT}`));

// Gids bij start en elke 6 uur verversen.
setTimeout(() => epg.refresh(), 5000);
setInterval(() => epg.refresh(), 6 * 3600e3);
// TMDB-gegevens (genres, cijfers) voor alle titels: rustig op de achtergrond.
// Daarna elk uur, tot alles binnen is; ook de IMDb-cijfers (binnen de daglimiet van OMDb).
setTimeout(() => catalog.enrich().catch(() => {}), 120e3);
setInterval(() => catalog.enrich().catch(() => {}), 3600e3);
process.on('SIGTERM', () => { server.close(); db.close(); process.exit(0); });

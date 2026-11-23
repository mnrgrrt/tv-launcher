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
import * as vod from './vod.js';
import * as arr from './arr.js';
import * as subs from './subs.js';
import * as profiles from './profiles.js';
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
on('POST', '/api/admin/profiles/:id/avatar', 'admin', ({ p, b }) => { profiles.setAvatar(p.id, b.avatar); return profiles.list(); });
on('POST', '/api/admin/profiles/:id/photo', 'admin', ({ p, b, me }) => { profiles.savePhoto(p.id, b.data); auth.audit(me.name, 'foto geüpload voor profiel #' + p.id); return profiles.list(); });
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
on('GET', '/api/whoami', 'device', ({ dev }) => ({ device: dev.name, version: VERSION, profile: dev.profile || 0, locked: !!dev.locked, ask: dev.ask || 'samen' }));
// Op de tv zelf: standaardprofiel en vraag-instelling kiezen, behalve als het apparaat vastgezet is.
on('POST', '/api/device', 'device', ({ dev, b }) => {
  if (dev.locked) throw Object.assign(new Error('Dit apparaat is vastgezet op een profiel'), { status: 403 });
  auth.setDevice(dev.id, { profile: b.profile, ask: b.ask }); return { ok: true };
});
on('GET', '/api/avatars', 'device', () => JSON.parse(fs.readFileSync(path.join(PUBLIC, 'avatars/index.json'), 'utf8')));
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
on('GET', '/api/live/grid', 'device', async ({ q }) => {
  const ids = new Set((q.get('ids') || '').split(',').map(Number));
  const from = +q.get('from') || Date.now() - 3600e3, to = +q.get('to') || from + 4 * 3600e3;
  const { channels } = await xtream.channels();
  const list = channels.filter(c => ids.has(c.id) && c.epgId);
  const byEpg = epg.grid([...new Set(list.map(c => c.epgId))], from, Math.min(to, from + 26 * 3600e3));
  return Object.fromEntries(list.map(c => [c.id, byEpg[c.epgId] || []]));
});
on('GET', '/api/live/guide', 'device', async ({ q }) => {
  const ids = new Set((q.get('ids') || '').split(',').map(Number));
  const { channels } = await xtream.channels();
  const chs = channels.filter(c => ids.has(c.id)).slice(0, 100);
  const from = +q.get('from') || Date.now() - 3600e3, to = Math.min(+q.get('to') || from + 6 * 3600e3, from + 26 * 3600e3);
  const g = epg.grid([...new Set(chs.map(c => c.epgId).filter(Boolean))], from, to);
  return chs.map(c => ({ id: c.id, archive: c.archive, programmes: g[c.epgId] || [] }));
});
on('GET', '/api/live/url/:id', 'device', ({ p }) => ({ url: auth.sign(`/stream/live/${+p.id}`) }));

on('GET', '/api/home', 'device', async ({ q }) => {
  const prof = +q.get('profile') || 1;
  const [picks, cont, films, series] = await Promise.all([
    tmdb.home().catch(() => ({})), profiles.continueWatching(prof).catch(() => []),
    arr.upcoming('movie').catch(() => []), arr.upcoming('series').catch(() => [])]);
  return { picks, continue: cont.map(withUrl), upcoming: [...films, ...series].sort((a, b) => a.when - b.when).slice(0, 30) };
});
on('GET', '/api/info/:type/:id', 'device', ({ p }) => tmdb.details(p.type === 'tv' ? 'tv' : 'movie', +p.id));

on('GET', '/api/vod/:kind/overview', 'device', ({ p }) => vod.overview(kindOf(p.kind)).then(o => ({ ...o, newest: o.newest.map(i => withVod(p.kind, i)) })));
on('GET', '/api/vod/:kind/browse', 'device', ({ p, q }) => vod.browse(kindOf(p.kind), q.get('by'), q.get('value')).then(o => ({ ...o, items: o.items.map(i => withVod(p.kind, i)) })));
on('GET', '/api/vod/:kind/info/:id', 'device', async ({ p }) => {
  const kind = kindOf(p.kind), o = await vod.info(kind, p.id);
  if (kind === 'series') o.seasons.forEach(s => s.episodes.forEach(e => { e.url = auth.sign(`/stream/series/${+e.id}.${safeExt(e.ext)}`); }));
  return o;
});
on('GET', '/api/vod/:kind/url/:id', 'device', ({ p, q }) => ({ url: auth.sign(`/stream/${kindOf(p.kind)}/${+p.id}.${safeExt(q.get('ext'))}`) }));

on('GET', '/api/plex/sections', 'device', () => plex.sections());
on('GET', '/api/plex/library/:section', 'device', ({ p }) => plex.library(+p.section));
on('GET', '/api/plex/show/:key', 'device', ({ p }) => plex.show(+p.key));
on('GET', '/api/plex/play/:key', 'device', ({ p }) => plex.playItem(+p.key));
on('GET', '/api/upcoming/:kind', 'device', ({ p }) => arr.upcoming(kindOf(p.kind)));

on('GET', '/api/search', 'device', async ({ q }) => {
  const s = (q.get('q') || '').trim(); if (s.length < 2) return {};
  const [px, films, series, guide, web] = await Promise.all([
    plex.search(s).catch(() => []), vod.search('movie', s).catch(() => []), vod.search('series', s).catch(() => []),
    epg.searchGuide(s).catch(() => ({})), tmdb.search(s).catch(() => [])]);
  // Bij welke dienst staat het? Alleen voor de bovenste treffers, anders wordt het traag.
  const streaming = (await pool(web.slice(0, 10), 5, async h => ({ ...tmdb.item(h, ''), services: await tmdb.providers(h.media_type, h.id) }))).filter(Boolean);
  return { plex: px, films: films.map(i => withVod('movie', i)), series: series.map(i => withVod('series', i)), guide, streaming };
});

on('GET', '/api/subs/search', 'device', ({ q }) => subs.search(Object.fromEntries(q)));
on('GET', '/api/subs/file/:id', 'device', async ({ res, p }) => { send(res, 200, await subs.download(+p.id), 'application/x-subrip; charset=utf-8'); });

on('POST', '/api/progress', 'device', ({ b }) => { profiles.progress(+b.profile || 1, b); return { ok: true }; });
on('GET', '/api/position', 'device', ({ q }) => ({ pos: profiles.position(+q.get('profile') || 1, q.get('key') || '') }));
on('POST', '/api/watched', 'device', ({ b }) => { profiles.setWatched(+b.profile || 1, b.key, !!b.watched); return { ok: true }; });
on('GET', '/api/continue', 'device', async ({ q }) => (await profiles.continueWatching(+q.get('profile') || 1)).map(withUrl));
on('GET', '/api/series-state', 'device', ({ q }) => profiles.seriesState(+q.get('profile') || 1, q.get('series') || ''));
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
process.on('SIGTERM', () => { server.close(); db.close(); process.exit(0); });

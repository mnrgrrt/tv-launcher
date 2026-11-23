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
  for await (const c of req) { n += c.length; if (n > 1e6) throw Object.assign(new Error('Te groot'), { status: 413 }); parts.push(c); }
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

// Beheer (pincode)
on('GET', '/api/admin/settings', 'admin', () => ({ settings: publicSettings(), epg: epg.epgStatus(), devices: auth.devices(), profiles: profiles.list() }));
on('POST', '/api/admin/settings', 'admin', ({ b }) => { setSettings(b); uncache(''); return { ok: true }; });
on('POST', '/api/admin/code', 'admin', () => ({ code: auth.newCode(), minutes: 10 }));
on('DELETE', '/api/admin/devices/:id', 'admin', ({ p }) => { auth.unpair(p.id); return { ok: true }; });
on('POST', '/api/admin/profiles', 'admin', ({ b }) => { profiles.save(b); return profiles.list(); });
on('DELETE', '/api/admin/profiles/:id', 'admin', ({ p }) => { profiles.remove(p.id); return profiles.list(); });
on('POST', '/api/admin/epg', 'admin', () => { epg.refresh(); return { started: true }; });

// Gekoppelde tv's
on('GET', '/api/whoami', 'device', ({ dev }) => ({ device: dev.name, version: VERSION }));
on('GET', '/api/profiles', 'device', () => profiles.list().map(({ prefs, ...p }) => ({ ...p, prefs })));
on('POST', '/api/profiles/:id/prefs', 'device', ({ p, b }) => { profiles.setPrefs(p.id, b); return { ok: true }; });

on('GET', '/api/live/categories', 'device', async () => (await categories()).map(c => ({ ...c, channels: c.channels.map(ch => ({ ...ch, url: auth.sign(`/stream/live/${ch.id}`) })) })));
on('GET', '/api/live/nownext', 'device', async ({ q }) => {
  const ids = new Set((q.get('ids') || '').split(',').map(Number));
  const { channels } = await xtream.channels();
  return xtream.nowNext(channels.filter(c => ids.has(c.id)).slice(0, 60), epg.nowNextFor);
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
      if (r.level === 'admin' && !auth.adminOk(req.headers['x-thuis-pin'], ip)) return send(res, 401, { error: 'Pincode onjuist' });
      const b = ['POST', 'PUT'].includes(req.method) ? await body(req) : {};
      const out = await r.fn({ req, res, dev, b, q: u.searchParams, p: r.re.exec(u.pathname).groups || {} });
      if (!res.headersSent) send(res, 200, out ?? {});
      return;
    }
    if (u.pathname === '/beheer' || u.pathname === '/') { if (file(res, PUBLIC, 'beheer.html')) return; }
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

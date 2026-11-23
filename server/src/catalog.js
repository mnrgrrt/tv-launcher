// Films en series uit Plex, IPTV en de streamingdiensten samen: één tegel per titel, met alle plekken waar hij staat.
// Elke titel krijgt bij TMDB genres, een cijfer en het aantal stemmen; daarmee sorteren ("Beste eerst") en filteren ("Alleen goed").
import { db } from './db.js';
import { plain, pool } from './http.js';
import * as plex from './plex.js';
import * as vod from './vod.js';
import * as tmdb from './tmdb.js';
import * as omdb from './omdb.js';
import * as arr from './arr.js';
import { genreName, KIDS } from './plex.js';

db.exec(`DROP TABLE IF EXISTS tmdbgenres;
  CREATE TABLE IF NOT EXISTS tmdbinfo (type TEXT, id INTEGER, genres TEXT, vote REAL, votes INTEGER, pop REAL, imdb TEXT, at INTEGER, PRIMARY KEY (type, id));
  CREATE TABLE IF NOT EXISTS tmdbmatch (type TEXT, name TEXT, year TEXT, id INTEGER, PRIMARY KEY (type, name, year));`);

const norm = t => plain(t).replace(/\(\d{4}\)/g, ' ').replace(/\b(4k|uhd|fhd|hd|multi|nl|subs?)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const cleanTitle = t => (t || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
const yearIn = t => (/\((\d{4})\)\s*$/.exec(t || '') || [])[1] || '';
// Opnames als "Rondo - S08E15" in een filmbibliotheek zijn afleveringen.
export const EPISODE = /^(.*?)[\s._-]*\bS(\d{1,2})E(\d{1,3})\b/i;
const PAGE = 90, typeOf = kind => (kind === 'series' ? 'tv' : 'movie');

// ---------- de gezamenlijke catalogus ----------
const mem = {};
/** Alles van één soort uit Plex en IPTV, samengevoegd en aangevuld met TMDB. Een kwartier in het geheugen. */
export async function items(kind) {
  const c = mem[kind]; if (c && Date.now() - c.at < 15 * 60e3) return c;
  const series = kind === 'series', type = typeOf(kind);
  const [movieLib, showLib, iptv] = await Promise.all([
    libs('movie'), series ? libs('show') : Promise.resolve([]), vod.all(kind).catch(() => ({ items: [], cats: [] }))]);
  const info = new Map(db.prepare('SELECT * FROM tmdbinfo WHERE type = ?').all(type).map(r => [r.id, r]));
  const match = new Map(db.prepare('SELECT name, year, id FROM tmdbmatch WHERE type = ?').all(type).map(r => [r.name + '|' + r.year, r.id]));
  const byKey = new Map(), list = [];
  const add = (o, src) => {
    const k = o.tmdb ? 't' + o.tmdb : 'n' + norm(o.title) + '|' + o.year;
    const have = byKey.get(k);
    if (!have) { const e = { ...o, sources: [src], services: [] }; byKey.set(k, e); list.push(e); return; }
    if (!have.sources.includes(src)) have.sources.push(src);
    have.genres = [...new Set([...have.genres, ...o.genres])];
    have.added = Math.max(have.added, o.added);
    have.plex = have.plex || o.plex; have.vod = have.vod || o.vod; have.cats = [...(have.cats || []), ...(o.cats || [])];
    if (!have.poster) have.poster = o.poster;
  };
  const plexGenres = m => [...new Set((m.Genre || []).map(g => genreName(g.tag || '')).filter(Boolean))];
  const shows = new Map();
  for (const m of movieLib) {
    const ep = EPISODE.exec(m.title || '');
    if (ep) {   // aflevering in de filmbibliotheek: bij Series als één tegel per programma
      if (!series) continue;
      const name = ep[1].trim(), it = plex.item(m), s = shows.get(name) || { title: name, year: it.year, poster: it.thumb, added: 0, genres: [], plexEps: [] };
      s.plexEps.push({ key: it.key, season: +ep[2], num: +ep[3], title: m.title, img: it.art, progress: it.progress });
      s.added = Math.max(s.added, it.added); shows.set(name, s); continue;
    }
    if (series) continue;
    const it = plex.item(m);
    add({ title: it.title, year: it.year, tmdb: it.tmdb, poster: it.thumb, added: it.added, genres: plexGenres(m), plex: it, plexRating: it.rating }, 'plex');
  }
  for (const m of showLib) { const it = plex.item(m); add({ title: it.title, year: it.year, tmdb: it.tmdb, poster: it.thumb, added: it.added, genres: plexGenres(m), plex: it }, 'plex'); }
  for (const s of shows.values()) { s.plexEps.sort((a, b) => a.season - b.season || a.num - b.num); list.push({ ...s, sources: ['plex'], services: [] }); }
  for (const m of iptv.items) {
    const title = cleanTitle(m.name), year = m.year || yearIn(m.name);
    add({ title, year, tmdb: m.tmdb || match.get(norm(title) + '|' + year) || 0, poster: m.icon, added: m.added, genres: m.genres, cats: [m.cat], vod: m }, 'iptv');
  }
  const scores = omdb.known();
  for (const o of list) {
    const i = o.tmdb && info.get(o.tmdb);
    if (i) { if (!o.genres.length) o.genres = JSON.parse(i.genres); o.vote = i.vote; o.votes = i.votes; o.pop = i.pop; o.imdb = i.imdb; }
    const r = o.imdb && scores.get(o.imdb); if (r) { o.imdbRating = r.rating; o.imdbVotes = r.votes; }
  }
  list.sort((a, b) => b.added - a.added);
  mem[kind] = { at: Date.now(), list, cats: iptv.cats, byTmdb: new Map(list.filter(o => o.tmdb).map(o => [o.tmdb, o])) };
  return mem[kind];
}
async function libs(type) {
  try { return (await Promise.all((await plex.sections()).filter(s => s.type === type).map(s => plex.all(s.key)))).flat(); } catch { return []; }
}

/** Catalogus voor één profiel: eigen titels plus wat er op zijn diensten staat. */
async function forProfile(kind, services) {
  const c = await items(kind), type = typeOf(kind);
  const extra = new Map();
  for (const s of tmdb.services().filter(s => services.includes(s.key) && s.provider > 0)) {
    for (const x of await tmdb.serviceCatalog(type, s.provider).catch(() => [])) {
      const own = c.byTmdb.get(x.tmdb), e = extra.get(x.tmdb) || (own ? { ...own, services: [] } : { ...x, services: [] });
      if (!e.services.includes(s.key)) e.services.push(s.key);
      extra.set(x.tmdb, e);
    }
  }
  if (!extra.size) return c.list;
  return [...c.list.map(o => extra.get(o.tmdb) || o), ...[...extra.values()].filter(e => !c.byTmdb.has(e.tmdb))];
}

// ---------- kwaliteit en voorkeuren ----------
/** Cijfer om op te sorteren: IMDb als we dat hebben, anders TMDB, gewogen naar het aantal stemmen. */
export function score(o) {
  const r = o.imdbRating || o.vote || o.plexRating || 0, v = o.imdbVotes || o.votes || 0;
  return (v / (v + 400)) * r + (400 / (v + 400)) * 6;
}
/** Goed genoeg? Wat in je eigen Plex staat heb je zelf gekozen, dat telt altijd. */
const good = (o, min) => !min || o.sources.includes('plex') || ((o.imdbRating || o.vote) >= min && (o.imdbVotes || o.votes) >= 200);
const allowed = (o, skip) => !skip.length || !o.genres.some(g => skip.includes(g));
/** Voorkeuren van een profiel: minimumcijfer (standaard 6,5; 0 = alles) en genres die je overslaat. */
export function prefsOf(p) {
  const min = p?.prefs?.minRating; return { min: min === 0 ? 0 : +min || 6.5, skip: p?.prefs?.skipGenres || [] };
}

// ---------- pagina's ----------
/** Bovenkant van Films of Series: nieuw, genres en collecties (met Binnenkort). */
export async function overview(kind, services, prefs) {
  const list = (await forProfile(kind, services)).filter(o => allowed(o, prefs.skip)), c = mem[kind];
  const own = list.filter(o => o.sources.length);
  const g = {};
  list.filter(o => good(o, prefs.min)).forEach(o => o.genres.forEach(n => { (g[n] = g[n] || []).push(o); }));
  const genres = Object.keys(g).filter(n => g[n].length >= 5)
    .sort((a, b) => (KIDS.has(a) - KIDS.has(b)) || g[b].length - g[a].length)
    .map(n => ({ name: n, count: g[n].length, posters: [...g[n]].sort((a, b) => score(b) - score(a)).filter(o => o.poster).slice(0, 4).map(o => o.poster) }));
  const coll = [], tile = (id, name, l) => l.length && coll.push({ id, name, count: l.length, posters: l.filter(o => o.poster).slice(0, 4).map(o => o.poster) });
  const soon = await upcoming(kind);
  tile('soon', 'Binnenkort', soon);
  tile('src:plex', 'Pas toegevoegd aan Plex', own.filter(o => o.sources.includes('plex')));
  tile('src:iptv', 'Nieuw bij IPTV', own.filter(o => o.sources.includes('iptv')));
  const perCat = {}; own.forEach(o => (o.cats || []).forEach(x => { (perCat[x] = perCat[x] || []).push(o); }));
  c.cats.filter(x => (perCat[x.id] || []).length >= 5).forEach(x => tile('cat:' + x.id, x.name, perCat[x.id]));
  return { total: list.length, newest: own.filter(o => good(o, prefs.min)).slice(0, 30), genres, collections: coll };
}

/** Bladeren. f = { genre, src ('plex', 'iptv' of een dienst), cat, sort ('beste', 'nieuw', 'az', 'jaar'), alles (1 = ook matige titels), offset }. */
export async function browse(kind, f, services, prefs) {
  if (f.cat === 'soon') { const l = await upcoming(kind); return { total: l.length, offset: 0, items: l }; }
  let list = (await forProfile(kind, services)).filter(o => allowed(o, prefs.skip));
  if (f.alles !== '1') list = list.filter(o => good(o, prefs.min));
  if (f.genre) list = list.filter(o => o.genres.includes(f.genre));
  if (f.src === 'plex' || f.src === 'iptv') list = list.filter(o => o.sources.includes(f.src));
  else if (f.src) list = list.filter(o => o.services.includes(f.src));
  if (f.cat) list = list.filter(o => (o.cats || []).includes(f.cat));
  const sort = f.sort || 'beste';
  if (sort === 'beste') list = [...list].sort((a, b) => score(b) - score(a));
  else if (sort === 'az') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'nl'));
  else if (sort === 'jaar') list = [...list].sort((a, b) => (+b.year || 0) - (+a.year || 0));
  else list = [...list].sort((a, b) => b.added - a.added);
  const offset = Math.max(0, +f.offset || 0);
  return { total: list.length, offset, items: list.slice(offset, offset + PAGE) };
}

/** Binnenkort (Radarr/Sonarr): alleen wat er nog niet is. */
async function upcoming(kind) {
  const l = await arr.upcoming(kind).catch(() => []);
  return l.filter(u => !u.hasFile).map(u => ({ title: u.title, year: u.date, tmdb: u.tmdb, poster: u.thumb, genres: [], sources: [], services: [], soon: u.sub }));
}

/** Zoeken op titel in films en series (eigen titels). */
export async function search(q) {
  const words = norm(q).split(' ').filter(Boolean); if (!words.length) return [];
  const hit = o => { const n = norm(o.title); return words.every(w => n.includes(w)); };
  const [films, series] = await Promise.all([items('movie'), items('series')]);
  return [...films.list.filter(hit).slice(0, 30).map(o => ({ ...o, kind: 'movie' })), ...series.list.filter(hit).slice(0, 30).map(o => ({ ...o, kind: 'series' }))];
}

/** Nieuw voor jou: nieuw in Plex en IPTV, net uit en populair, en nieuw bij je diensten. Wat bij je smaak past bovenaan. */
export async function forYou(services, prefs, taste) {
  const out = new Map(), now = Date.now();
  const put = (o, kind) => { const k = kind + (o.tmdb || norm(o.title)); if (!out.has(k)) out.set(k, { ...o, kind }); };
  for (const kind of ['movie', 'series']) {
    const all = await forProfile(kind, services);
    all.filter(o => o.sources.length && o.added > now - 45 * 86400e3).slice(0, 60).forEach(o => put(o, kind));
    all.filter(o => o.services.length && o.added > now - 120 * 86400e3).forEach(o => put(o, kind));
    const c = mem[kind];
    for (const t of await tmdb.trending(typeOf(kind)).catch(() => [])) put(c.byTmdb.get(t.tmdb) || t, kind);
  }
  const fresh = o => Math.max(0, 1 - (now - (o.added || 0)) / (180 * 86400e3));
  const l = [...out.values()].filter(o => allowed(o, prefs.skip) && good(o, prefs.min) && o.poster)
    .map(o => ({ o, s: (taste(o.genres) * 4) + score(o) / 2 + fresh(o) * 2 }))
    .sort((a, b) => b.s - a.s).map(x => x.o);
  // Wat nergens te zien is (niet in Plex, IPTV of je diensten) apart, zodat je niet denkt dat je het kunt kijken.
  const can = o => o.sources.length || o.services.length;
  return { now: l.filter(can).slice(0, 40), later: l.filter(o => !can(o)).slice(0, 20) };
}

// ---------- aanvullen op de achtergrond ----------
let busy = false;
/** Titels zonder TMDB-nummer op naam opzoeken, en van alle titels genres, cijfer en IMDb-nummer ophalen. Rustig, 4 tegelijk. */
export async function enrich() {
  if (busy) return; busy = true;
  let left = 0;
  try {
    for (const kind of ['movie', 'series']) {
      const type = typeOf(kind), c = await items(kind);
      const tried = new Set(db.prepare('SELECT name, year FROM tmdbmatch WHERE type = ?').all(type).map(r => r.name + '|' + r.year));
      const names = c.list.filter(o => !o.tmdb && o.vod && !tried.has(norm(o.title) + '|' + o.year)).slice(0, 2000);
      const putMatch = db.prepare('INSERT OR REPLACE INTO tmdbmatch (type, name, year, id) VALUES (?, ?, ?, ?)');
      await pool(names, 4, async o => { const id = await tmdb.findId(type, o.title, o.year).catch(() => null); if (id !== null) putMatch.run(type, norm(o.title), o.year, id); });
      delete mem[kind];
      const c2 = await items(kind), have = new Set(db.prepare('SELECT id FROM tmdbinfo WHERE type = ?').all(type).map(r => r.id));
      const todo = [...new Set(c2.list.filter(o => o.tmdb && !have.has(o.tmdb)).map(o => o.tmdb))];
      left += Math.max(0, todo.length - 3000);
      const put = db.prepare('INSERT OR REPLACE INTO tmdbinfo (type, id, genres, vote, votes, pop, imdb, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      await pool(todo.slice(0, 3000), 4, async id => {
        const i = await tmdb.info(type, id).catch(() => null);
        if (i) put.run(type, id, JSON.stringify(i.genres), i.vote, i.votes, i.pop, i.imdb, Date.now());
      });
      delete mem[kind];
    }
    // IMDb-cijfers: eerst de bekendste titels.
    const ids = db.prepare("SELECT imdb FROM tmdbinfo WHERE imdb != '' ORDER BY votes DESC").all().map(r => r.imdb);
    await omdb.fill(ids);
  } finally { busy = false; }
  return left;
}

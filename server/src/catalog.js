// Films en series uit Plex en IPTV samen: één tegel per titel, met de bronnen erbij.
import { db } from './db.js';
import { plain, pool } from './http.js';
import * as plex from './plex.js';
import * as vod from './vod.js';
import { genresOf } from './tmdb.js';
import { genreName, KIDS } from './plex.js';

// Genres die we bij TMDB opzochten voor IPTV-titels zonder genre.
db.exec('CREATE TABLE IF NOT EXISTS tmdbgenres (type TEXT, id INTEGER, genres TEXT, PRIMARY KEY (type, id))');

const norm = t => plain(t).replace(/\(\d{4}\)/g, ' ').replace(/\b(4k|uhd|fhd|hd|multi|nl|subs?)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const cleanTitle = t => (t || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
const yearIn = t => (/\((\d{4})\)\s*$/.exec(t || '') || [])[1] || '';
const PAGE = 90;

const mem = {};
/** Alle titels van één soort ('movie' of 'series'), samengevoegd. Een half uur in het geheugen. */
export async function items(kind) {
  const c = mem[kind]; if (c && Date.now() - c.at < 30 * 60e3) return c.list;
  const series = kind === 'series', type = series ? 'tv' : 'movie';
  const [plexItems, iptv] = await Promise.all([
    plex.sections().then(secs => Promise.all(secs.filter(s => s.type === (series ? 'show' : 'movie')).map(s => plex.all(s.key)))).then(a => a.flat()).catch(() => []),
    vod.all(kind).catch(() => ({ items: [], cats: [] }))]);
  const known = new Map(db.prepare('SELECT id, genres FROM tmdbgenres WHERE type = ?').all(type).map(r => [r.id, JSON.parse(r.genres)]));
  const byKey = new Map(), list = [];
  const add = (o, src) => {
    const k = o.tmdb ? 't' + o.tmdb : 'n' + norm(o.title) + '|' + o.year;
    const have = byKey.get(k);
    if (!have) { const e = { ...o, sources: [src] }; byKey.set(k, e); list.push(e); return; }
    if (!have.sources.includes(src)) have.sources.push(src);
    have.genres = [...new Set([...have.genres, ...o.genres])];
    have.added = Math.max(have.added, o.added);
    have.plex = have.plex || o.plex; have.vod = have.vod || o.vod; have.cats = [...(have.cats || []), ...(o.cats || [])];
    if (!have.poster) have.poster = o.poster;
  };
  for (const m of plexItems) {
    const it = plex.item(m);
    add({ title: it.title, year: it.year, tmdb: it.tmdb, poster: it.thumb, added: it.added,
      genres: [...new Set((m.Genre || []).map(g => genreName(g.tag || '')).filter(Boolean))], plex: it }, 'plex');
  }
  for (const m of iptv.items) {
    const genres = m.genres.length ? m.genres : (m.tmdb && known.get(m.tmdb) || []);
    add({ title: cleanTitle(m.name), year: m.year || yearIn(m.name), tmdb: m.tmdb, poster: m.icon, added: m.added, genres, cats: [m.cat], vod: m }, 'iptv');
  }
  list.sort((a, b) => b.added - a.added);
  mem[kind] = { at: Date.now(), list, cats: iptv.cats };
  return list;
}

/** Wat de pagina Films of Series bovenaan nodig heeft: nieuw, genres en collecties. */
export async function overview(kind) {
  const list = await items(kind), cats = mem[kind].cats;
  const g = {};
  list.forEach(o => o.genres.forEach(n => { (g[n] = g[n] || []).push(o); }));
  const genres = Object.keys(g).filter(n => g[n].length >= 5)
    .sort((a, b) => (KIDS.has(a) - KIDS.has(b)) || g[b].length - g[a].length)
    .map(n => ({ name: n, count: g[n].length, posters: g[n].filter(o => o.poster).slice(0, 4).map(o => o.poster) }));
  const coll = [];
  const plexN = list.filter(o => o.sources.includes('plex')), iptvN = list.filter(o => o.sources.includes('iptv'));
  if (plexN.length) coll.push({ id: 'src:plex', name: 'Pas toegevoegd aan Plex', count: plexN.length, posters: plexN.slice(0, 4).map(o => o.poster) });
  if (iptvN.length) coll.push({ id: 'src:iptv', name: 'Nieuw bij IPTV', count: iptvN.length, posters: iptvN.slice(0, 4).map(o => o.poster) });
  // Categorieën van de IPTV-aanbieder (bijvoorbeeld "Netflix-films", "Nederlands")
  const perCat = {}; iptvN.forEach(o => (o.cats || []).forEach(c => { (perCat[c] = perCat[c] || []).push(o); }));
  cats.filter(c => (perCat[c.id] || []).length >= 5).forEach(c => coll.push({ id: 'cat:' + c.id, name: c.name, count: perCat[c.id].length, posters: perCat[c.id].slice(0, 4).map(o => o.poster) }));
  return { total: list.length, newest: list.slice(0, 30), genres, collections: coll };
}

/** Bladeren met filters. f = { genre, src ('plex'/'iptv'), cat, sort ('nieuw', 'az', 'jaar'), offset }. */
export async function browse(kind, f) {
  let list = await items(kind);
  if (f.genre) list = list.filter(o => o.genres.includes(f.genre));
  if (f.src === 'plex' || f.src === 'iptv') list = list.filter(o => o.sources.includes(f.src));
  if (f.cat) list = list.filter(o => (o.cats || []).includes(f.cat));
  if (f.sort === 'az') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'nl'));
  else if (f.sort === 'jaar') list = [...list].sort((a, b) => (+b.year || 0) - (+a.year || 0));
  const offset = Math.max(0, +f.offset || 0);
  return { total: list.length, offset, items: list.slice(offset, offset + PAGE) };
}

/** Zoeken op titel in films en series. */
export async function search(q) {
  const words = norm(q).split(' ').filter(Boolean); if (!words.length) return [];
  const hit = o => { const n = norm(o.title); return words.every(w => n.includes(w)); };
  const [films, series] = await Promise.all([items('movie'), items('series')]);
  return [...films.filter(hit).slice(0, 30).map(o => ({ ...o, kind: 'movie' })), ...series.filter(hit).slice(0, 30).map(o => ({ ...o, kind: 'series' }))];
}

/** Op de achtergrond: genres opzoeken voor IPTV-titels die er geen hebben. Rustig, en hooguit 1500 per keer. */
export async function enrich() {
  for (const kind of ['movie', 'series']) {
    const type = kind === 'series' ? 'tv' : 'movie';
    const { items: all } = await vod.all(kind).catch(() => ({ items: [] }));
    const done = new Set(db.prepare('SELECT id FROM tmdbgenres WHERE type = ?').all(type).map(r => r.id));
    const todo = [...new Set(all.filter(o => !o.genres.length && o.tmdb && !done.has(o.tmdb)).map(o => o.tmdb))].slice(0, 1500);
    if (!todo.length) continue;
    const ins = db.prepare('INSERT OR REPLACE INTO tmdbgenres (type, id, genres) VALUES (?, ?, ?)');
    await pool(todo, 3, async id => {
      const names = await genresOf(type, id).catch(() => null);
      if (names) ins.run(type, id, JSON.stringify([...new Set(names.map(genreName).filter(Boolean))]));
    });
    delete mem[kind];
  }
}

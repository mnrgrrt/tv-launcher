// Plex: bibliotheken per genre, series, afspelen met kijkstand terug naar Plex.
import { S } from './db.js';
import { json, enc } from './http.js';
import { sign } from './auth.js';

const CLIENT = 'tv-serverr';
export const on = () => !!(S('plexUrl') && S('plexToken'));
async function get(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const o = await json(`${S('plexUrl')}${path}${sep}X-Plex-Token=${enc(token || S('plexToken'))}`, {
    headers: { Accept: 'application/json', 'X-Plex-Client-Identifier': CLIENT, 'X-Plex-Product': 'Thuis', 'X-Plex-Device-Name': 'tv-serverr' }, what: 'Plex' });
  return (o && o.MediaContainer) || {};
}
// Plaatjes lopen via de server (/img), zodat de tv geen Plex-token nodig heeft.
export const img = (path, w, h) => path ? sign(`/img/plex?u=${enc(path)}&w=${w}&h=${h}`, 24 * 7) : '';
export function photoUrl(path, w, h) {
  return `${S('plexUrl')}/photo/:/transcode?width=${w}&height=${h}&minSize=1&upscale=1&url=${enc(path)}&X-Plex-Token=${enc(S('plexToken'))}`;
}

export const GENRE = { action: 'Actie', actie: 'Actie', adventure: 'Avontuur', avontuur: 'Avontuur', animation: 'Animatie', animatie: 'Animatie',
  biography: 'Biografie', biografie: 'Biografie', comedy: 'Komedie', komedie: 'Komedie', crime: 'Misdaad', misdaad: 'Misdaad',
  documentary: 'Documentaire', documentaire: 'Documentaire', drama: 'Drama', family: 'Familie', familie: 'Familie', kids: 'Familie',
  fantasy: 'Fantasie', fantasie: 'Fantasie', history: 'Historisch', historisch: 'Historisch', horror: 'Horror', music: 'Muziek', muziek: 'Muziek',
  musical: 'Muziek', mystery: 'Mysterie', mysterie: 'Mysterie', romance: 'Romantiek', romantiek: 'Romantiek', 'science fiction': 'Sciencefiction',
  'sci-fi': 'Sciencefiction', sciencefiction: 'Sciencefiction', 'sci-fi & fantasy': 'Sciencefiction', thriller: 'Thriller', suspense: 'Thriller',
  war: 'Oorlog', oorlog: 'Oorlog', 'war & politics': 'Oorlog', western: 'Western', sport: 'Sport', reality: 'Reality', 'martial arts': 'Actie',
  'tv film': '', 'tv movie': '' };
export const KIDS = new Set(['Animatie', 'Familie']);
export const genreName = raw => (Object.prototype.hasOwnProperty.call(GENRE, raw.toLowerCase()) ? GENRE[raw.toLowerCase()] : raw);

const tmdbOf = m => { for (const g of m?.Guid || []) if (/^tmdb:\/\//.test(g.id)) return +g.id.slice(7); return 0; };

export function item(m) {
  const ep = m.type === 'episode', dur = m.duration || 0, off = m.viewOffset || 0;
  return { key: String(m.ratingKey), source: 'plex', type: m.type, title: ep ? m.grandparentTitle : m.title,
    sub: ep ? `S${m.parentIndex} · afl. ${m.index} · ${m.title}` : '', year: String(m.year || ''),
    rating: m.audienceRating || m.rating || 0, summary: m.summary || '', tmdb: tmdbOf(m),
    thumb: img(ep ? (m.grandparentThumb || m.thumb) : m.thumb, 300, 450),
    art: img((ep ? m.grandparentArt : '') || m.art, 1280, 720),
    progress: dur ? off / dur : 0, minutes: Math.round(dur / 60000), added: (m.addedAt || 0) * 1000 };
}

export async function sections() {
  if (!on()) return [];
  const c = await get('/library/sections');
  return (c.Directory || []).filter(d => d.type === 'movie' || d.type === 'show').map(d => ({ key: String(d.key), title: d.title, type: d.type }));
}
export async function all(section) { return (await get(`/library/sections/${section}/all?sort=addedAt:desc&includeGuids=1`)).Metadata || []; }

export async function library(section) {
  const [items, deck] = await Promise.all([all(section), get(`/library/sections/${section}/onDeck`).then(c => c.Metadata || []).catch(() => [])]);
  const rows = [];
  if (deck.length) rows.push({ title: 'Verder kijken', items: deck.slice(0, 20).map(item) });
  if (items.length) rows.push({ title: 'Nieuw toegevoegd', total: items.length, items: items.slice(0, 40).map(item) });
  const by = {};
  for (const m of items) {
    const names = new Set((m.Genre || []).map(g => genreName(g.tag || '')).filter(Boolean));
    names.forEach(n => (by[n] = by[n] || []).push(m));
  }
  Object.keys(by).filter(n => by[n].length >= 3)
    .sort((a, b) => (KIDS.has(a) - KIDS.has(b)) || by[b].length - by[a].length)
    .forEach(n => rows.push({ title: n, total: by[n].length, items: by[n].slice(0, 40).map(item) }));
  return { total: items.length, rows };
}

export async function show(key) {
  const [meta, leaves] = await Promise.all([get(`/library/metadata/${key}`), get(`/library/metadata/${key}/allLeaves`)]);
  const m = (meta.Metadata || [])[0] || {}, seasons = {};
  for (const e of leaves.Metadata || []) {
    const d = e.duration || 0, o = e.viewOffset || 0;
    (seasons[e.parentIndex] = seasons[e.parentIndex] || []).push({ key: String(e.ratingKey), num: e.index, title: e.title,
      img: img(e.thumb, 640, 360), plot: e.summary || '', dur: Math.round(d / 1000), progress: d ? o / d : 0, watched: (e.viewCount || 0) > 0 });
  }
  return { plot: m.summary || '', backdrop: img(m.art, 1280, 720), tmdb: tmdbOf(m),
    seasons: Object.keys(seasons).sort((a, b) => a - b).map(s => ({ season: s, episodes: seasons[s] })) };
}

/** Wat de speler nodig heeft. De bestandslink bevat het Plex-token; die blijft in het thuisnetwerk. */
export async function playItem(key) {
  const c = await get(`/library/metadata/${key}`);
  const m = (c.Metadata || [])[0]; if (!m) throw new Error('Niet gevonden in Plex');
  const part = (((m.Media || [])[0] || {}).Part || [])[0]; if (!part) throw new Error('Geen bestand');
  const ep = m.type === 'episode';
  // Via de server: het Plex-token gaat nooit naar de tv.
  const subs = (part.Stream || []).filter(s => s.streamType === 3 && s.key)
    .map(s => ({ url: sign(`/stream/plex?p=${enc(s.key)}`), lang: s.languageCode || '', label: s.displayTitle || '', codec: s.codec || '' }));
  let tmdb = tmdbOf(m);
  if (ep) tmdb = tmdbOf((await get(`/library/metadata/${m.grandparentRatingKey}`).catch(() => ({}))).Metadata?.[0]) || 0;
  return { kind: ep ? 'series' : 'movie', key: 'plex:' + key, plexKey: key, url: sign(`/stream/plex?p=${enc(part.key)}`),
    title: ep ? m.grandparentTitle : m.title, sub: ep ? `S${m.parentIndex} · afl. ${m.index} · ${m.title}` : String(m.year || ''),
    seriesKey: ep ? 'plex:' + m.grandparentRatingKey : '', season: ep ? m.parentIndex : 0, episode: ep ? m.index : 0,
    tmdb, offsetMs: m.viewOffset || 0, subs, img: img(ep ? m.thumb : m.art, 1280, 720) };
}

export function timeline(key, state, pos, dur) {
  get(`/:/timeline?ratingKey=${key}&key=${enc('/library/metadata/' + key)}&state=${state}&time=${Math.round(pos)}&duration=${Math.round(dur)}`).catch(() => {});
  if (state === 'stopped' && dur > 0 && pos > dur * 0.9) get(`/:/scrobble?identifier=com.plexapp.plugins.library&key=${key}`).catch(() => {});
}

export async function deck() {
  if (!on()) return [];
  const c = await get('/library/onDeck?X-Plex-Container-Size=20');
  return (c.Metadata || []).filter(x => x.type === 'movie' || x.type === 'episode').map(item);
}

export async function search(q) {
  if (!on()) return [];
  const hubs = (await get(`/hubs/search?query=${enc(q)}&limit=20`)).Hub || [];
  return hubs.flatMap(h => h.Metadata || []).filter(m => ['movie', 'show', 'episode'].includes(m.type)).slice(0, 30).map(item);
}

/** Alle TMDB-nummers in je Plex: om te weten wat je al hebt. */
export async function tmdbIndex() {
  const out = new Map();
  for (const s of await sections()) for (const m of await all(s.key)) { const t = tmdbOf(m); if (t) out.set(`${s.type === 'show' ? 'tv' : 'movie'}:${t}`, String(m.ratingKey)); }
  return out;
}

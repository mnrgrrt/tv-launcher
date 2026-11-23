// TMDB: voorstellen, zoeken, informatiepagina's.
import fs from 'node:fs';
import { S, cached } from './db.js';
import { json, enc, pool } from './http.js';

const API = 'https://api.themoviedb.org/3';
export const TIMG = 'https://image.tmdb.org/t/p/';
export const services = () => JSON.parse(fs.readFileSync(new URL('../../shared/web/services.json', import.meta.url), 'utf8')).services;

export function tmdb(path) {
  const t = S('tmdbToken'); if (!t) return Promise.reject(new Error('Geen TMDB-sleutel'));
  const v3 = t.length <= 40 && !t.includes('.');
  const url = API + path + (v3 ? (path.includes('?') ? '&' : '?') + 'api_key=' + t : '');
  return json(url, { headers: v3 ? { Accept: 'application/json' } : { Accept: 'application/json', Authorization: 'Bearer ' + t }, what: 'TMDB' });
}

export function item(o, key) {
  const tv = (o._type || o.media_type) === 'tv', date = tv ? o.first_air_date : o.release_date;
  return { id: (tv ? 'tv' : 'movie') + o.id, tmdb: o.id, type: tv ? 'Serie' : 'Film', title: tv ? o.name : o.title, overview: o.overview || '',
    year: (date || '').slice(0, 4), rating: o.vote_average || 0,
    backdrop: o.backdrop_path ? TIMG + 'w1280' + o.backdrop_path : '', thumb: o.backdrop_path ? TIMG + 'w780' + o.backdrop_path : '',
    poster: o.poster_path ? TIMG + 'w342' + o.poster_path : '', service: key };
}

/** Populair bij één dienst (NL, in het abonnement), zonder kinderprogramma's. type = 'tv' of 'movie'. */
export function byService(type, provider) {
  return cached(`tmdb:svc:${type}:${provider}`, 6 * 3600e3, () =>
    tmdb(`/discover/${type}?watch_region=NL&with_watch_providers=${provider}&with_watch_monetization_types=flatrate&sort_by=popularity.desc&language=nl-NL&page=1&include_adult=false` +
      (type === 'tv' ? '&without_genres=10762,10751' : '&without_genres=10751,16'))
      .then(o => (o.results || []).filter(x => x.backdrop_path || x.poster_path).map(x => item({ ...x, _type: type }, ''))));
}
const streamingServices = () => services().filter(s => s.provider > 0 && s.key !== 'plex');

/** Voor jou: om en om van de gekozen diensten (of alle diensten als er niets gekozen is). */
export async function home(keys) {
  if (!S('tmdbToken')) return { configured: false };
  const list = streamingServices().filter(s => !keys || !keys.length || keys.includes(s.key));
  const per = (await pool(list, 4, async s => {
    const [tv, mv] = await Promise.all([byService('tv', s.provider).catch(() => []), byService('movie', s.provider).catch(() => [])]);
    return [s.key, [...tv.filter(x => x.backdrop).slice(0, 4), ...mv.filter(x => x.backdrop).slice(0, 2)].map(x => ({ ...x, service: s.key }))];
  })).filter(Boolean);
  const picks = [], seen = new Set();
  for (let r = 0; r < 6 && picks.length < 14; r++) per.forEach(([, l]) => { const it = l[r]; if (it && !seen.has(it.id) && picks.length < 14) { seen.add(it.id); picks.push(it); } });
  return { configured: true, picks };
}

/** Rijen per dienst voor de pagina Films of Series. */
export async function serviceRows(type, keys) {
  if (!S('tmdbToken')) return [];
  const list = streamingServices().filter(s => keys.includes(s.key));
  return (await pool(list, 4, async s => ({ service: s.key, name: s.name, items: (await byService(type, s.provider)).map(x => ({ ...x, service: s.key })) })))
    .filter(r => r && r.items.length);
}

/** Genres van één titel (Engelse namen, die vertalen we zelf). Voor IPTV-titels zonder genre. */
export async function genresOf(type, id) {
  const d = await tmdb(`/${type}/${id}?language=en-US`);
  return (d.genres || []).map(g => g.name);
}

/** Bij welke van jouw diensten (NL, abonnement) staat dit? */
export async function providers(type, id) {
  const byProvider = new Map(streamingServices().map(s => [s.provider, s.key]));
  const r = await tmdb(`/${type}/${id}/watch/providers`).catch(() => null);
  const flat = r?.results?.NL?.flatrate || [];
  return flat.map(p => byProvider.get(p.provider_id)).filter(Boolean);
}

export async function search(q) {
  const res = await tmdb(`/search/multi?query=${enc(q)}&language=nl-NL&include_adult=false`);
  return (res.results || []).filter(h => h.media_type === 'tv' || h.media_type === 'movie').slice(0, 14);
}

/** Alles voor de informatiepagina: details, acteurs, trailer, vergelijkbaar, diensten. */
export function details(type, id) {
  return cached(`tmdb:d:${type}:${id}`, 24 * 3600e3, async () => {
    const d = await tmdb(`/${type}/${id}?language=nl-NL&append_to_response=credits,videos,similar,release_dates,content_ratings,external_ids&include_video_language=nl,en`);
    const tv = type === 'tv';
    const trailer = (d.videos?.results || []).find(v => v.site === 'YouTube' && v.type === 'Trailer');
    let age = '';
    if (tv) age = (d.content_ratings?.results || []).find(r => r.iso_3166_1 === 'NL')?.rating || '';
    else age = ((d.release_dates?.results || []).find(r => r.iso_3166_1 === 'NL')?.release_dates || []).map(x => x.certification).find(Boolean) || '';
    return {
      tmdb: d.id, type: tv ? 'tv' : 'movie', title: tv ? d.name : d.title, original: tv ? d.original_name : d.original_title,
      year: (tv ? d.first_air_date : d.release_date || '').slice(0, 4), overview: d.overview || '', tagline: d.tagline || '',
      runtime: tv ? (d.episode_run_time || [])[0] || 0 : d.runtime || 0, rating: d.vote_average || 0, age,
      genres: (d.genres || []).map(g => g.name),
      backdrop: d.backdrop_path ? TIMG + 'original' + d.backdrop_path : '', poster: d.poster_path ? TIMG + 'w500' + d.poster_path : '',
      director: tv ? (d.created_by || []).map(c => c.name).join(', ') : (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name).join(', '),
      cast: (d.credits?.cast || []).slice(0, 15).map(c => ({ id: c.id, name: c.name, role: c.character, photo: c.profile_path ? TIMG + 'w185' + c.profile_path : '' })),
      trailer: trailer ? trailer.key : '',
      seasons: tv ? (d.seasons || []).filter(s => s.season_number > 0).map(s => ({ n: s.season_number, episodes: s.episode_count, year: (s.air_date || '').slice(0, 4) })) : [],
      tvdb: d.external_ids?.tvdb_id || 0, imdb: d.external_ids?.imdb_id || '',
      similar: (d.similar?.results || []).slice(0, 12).map(x => item({ ...x, _type: type }, '')),
      services: await providers(type, id)
    };
  });
}

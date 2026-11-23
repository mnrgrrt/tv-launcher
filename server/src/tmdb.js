// TMDB: voorstellen, zoeken, informatiepagina's.
import fs from 'node:fs';
import { S, cached } from './db.js';
import { json, enc } from './http.js';
import { genreName } from './plex.js';
import { ratings } from './omdb.js';

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

// TMDB-genres (Engelse namen); genreName in plex.js maakt er de Nederlandse namen van.
const GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie',
  53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics' };
export const genresFromIds = ids => [...new Set((ids || []).map(i => genreName(GENRES[i] || '')).filter(Boolean))];

/** Een titel als catalogus-item: met genres, cijfer en aantal stemmen. */
export function catItem(x, type) {
  const tv = type === 'tv';
  return { title: tv ? x.name : x.title, year: ((tv ? x.first_air_date : x.release_date) || '').slice(0, 4), tmdb: x.id,
    poster: x.poster_path ? TIMG + 'w342' + x.poster_path : '', genres: genresFromIds(x.genre_ids), vote: x.vote_average || 0, votes: x.vote_count || 0,
    pop: x.popularity || 0, added: Date.parse((tv ? x.first_air_date : x.release_date) || '') || 0, sources: [], services: [] };
}

/** Net uit (films en series), ook als we ze nog nergens hebben. */
export function trending(type) {
  return cached(`tmdb:trend:${type}`, 6 * 3600e3, async () => {
    const r = await Promise.all([1, 2].map(p => tmdb(`/trending/${type}/week?language=nl-NL&page=${p}`).catch(() => ({ results: [] }))));
    return r.flatMap(x => x.results || []).filter(x => x.poster_path).map(x => catItem(x, type));
  });
}

/** Mooiste achtergrond (zonder tekst erin) en het titellogo, voor de grote afbeelding op Thuis. Een week bewaard. */
export function art(type, id) {
  return cached(`tmdb:art:${type}:${id}`, 7 * 86400e3, async () => {
    const r = await tmdb(`/${type}/${id}/images?include_image_language=nl,en,null`);
    const bds = (r.backdrops || []).filter(b => b.width >= 1920);
    const bd = bds.filter(b => !b.iso_639_1).sort((a, b) => b.vote_average - a.vote_average)[0] || bds[0];
    const logos = r.logos || [];
    const logo = logos.find(l => l.iso_639_1 === 'nl') || logos.find(l => l.iso_639_1 === 'en') || logos[0];
    return { backdrop: bd ? TIMG + 'original' + bd.file_path : '', logo: logo ? TIMG + 'w500' + logo.file_path : '' };
  });
}

/** Genres, cijfer, stemmen en IMDb-nummer van één titel. */
export async function info(type, id) {
  const d = await tmdb(`/${type}/${id}?language=en-US&append_to_response=external_ids`);
  return { genres: [...new Set((d.genres || []).map(g => genreName(g.name)).filter(Boolean))], vote: d.vote_average || 0, votes: d.vote_count || 0,
    pop: d.popularity || 0, imdb: d.external_ids?.imdb_id || d.imdb_id || '' };
}
/** Een titel op naam (en jaar) zoeken; 0 als er niets is. */
export async function findId(type, name, year) {
  const r = await tmdb(`/search/${type}?query=${enc(name)}${year ? (type === 'tv' ? '&first_air_date_year=' : '&year=') + year : ''}&include_adult=false`);
  return (r.results || [])[0]?.id || 0;
}
/** Zoeken over films en series heen (voor de kijkgeschiedenis van Netflix). */
export async function findAny(name) {
  const r = await tmdb(`/search/multi?query=${enc(name)}&include_adult=false`);
  const h = (r.results || []).find(x => x.media_type === 'tv' || x.media_type === 'movie');
  return h ? { type: h.media_type, id: h.id, genres: genresFromIds(h.genre_ids) } : null;
}

/** Waar iemand in speelde of wat iemand maakte: de bekendste titels eerst. Een dag bewaard. */
export function person(id) {
  return cached(`tmdb:p:${id}`, 24 * 3600e3, async () => {
    const d = await tmdb(`/person/${id}?language=nl-NL&append_to_response=combined_credits`);
    const seen = new Set(), list = [...(d.combined_credits?.cast || []), ...(d.combined_credits?.crew || []).filter(c => c.job === 'Director')]
      .filter(x => (x.media_type === 'movie' || x.media_type === 'tv') && x.poster_path && !seen.has(x.media_type + x.id) && seen.add(x.media_type + x.id))
      .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 60);
    return { name: d.name || '', photo: d.profile_path ? TIMG + 'w342' + d.profile_path : '', items: list.map(x => item({ ...x, _type: x.media_type }, '')) };
  });
}

/** Logo's van de diensten (vierkante icoontjes van TMDB), per sleutel uit services.json. Een week bewaard. */
export function logos() {
  return cached('tmdb:logos', 7 * 86400e3, async () => {
    const l = (await Promise.all(['movie', 'tv'].map(t => tmdb(`/watch/providers/${t}?watch_region=NL`).then(r => r.results || [], () => [])))).flat();
    const byId = new Map(l.map(p => [p.provider_id, p.logo_path]));
    return Object.fromEntries(streamingServices().filter(s => byId.get(s.provider)).map(s => [s.key, TIMG + 'w92' + byId.get(s.provider)]));
  });
}
const streamingServices = () => services().filter(s => s.provider > 0 && s.key !== 'plex');


/** Alles voor de informatiepagina: details, acteurs, trailer, vergelijkbaar, diensten. */
export function details(type, id) {
  return cached(`tmdb:d2:${type}:${id}`, 24 * 3600e3, async () => {
    const d = await tmdb(`/${type}/${id}?language=nl-NL&append_to_response=credits,videos,similar,recommendations,release_dates,content_ratings,external_ids,watch/providers,images&include_image_language=nl,en,null&include_video_language=nl,en`);
    const tv = type === 'tv', mine = new Map(streamingServices().map(s => [s.provider, s.key]));
    const yt = (d.videos?.results || []).filter(v => v.site === 'YouTube');
    const trailer = yt.find(v => v.type === 'Trailer');
    // Trailers en extra's (achter de schermen, fragmenten): trailers eerst, Nederlands voor Engels.
    const ORDER = ['Trailer', 'Teaser', 'Featurette', 'Behind the Scenes', 'Clip'];
    const videos = yt.filter(v => ORDER.includes(v.type)).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || (b.iso_639_1 === 'nl') - (a.iso_639_1 === 'nl'))
      .slice(0, 12).map(v => ({ key: v.key, name: v.name, type: v.type, img: `https://i.ytimg.com/vi/${v.key}/hqdefault.jpg` }));
    const related = (d.recommendations?.results || []).length ? d.recommendations.results : (d.similar?.results || []);
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
      cast: (d.credits?.cast || []).slice(0, 15).map(c => ({ id: c.id, name: c.name, role: c.character, photo: c.profile_path ? TIMG + 'w185' + c.profile_path : '' }))
        .concat((d.credits?.crew || []).filter(c => c.job === 'Director').slice(0, 2).map(c => ({ id: c.id, name: c.name, role: 'Regie', photo: c.profile_path ? TIMG + 'w185' + c.profile_path : '' }))),
      trailer: trailer ? trailer.key : '',
      seasons: tv ? (d.seasons || []).filter(s => s.season_number > 0).map(s => ({ n: s.season_number, episodes: s.episode_count, year: (s.air_date || '').slice(0, 4) })) : [],
      tvdb: d.external_ids?.tvdb_id || 0, imdb: d.external_ids?.imdb_id || '',
      date: tv ? d.first_air_date || '' : d.release_date || '', status: d.status || '',
      language: d.original_language || '', countries: (d.production_countries || d.origin_country || []).map(c => c.iso_3166_1 || c).slice(0, 3),
      writers: [...new Set((d.credits?.crew || []).filter(c => ['Screenplay', 'Writer', 'Novel', 'Story'].includes(c.job)).map(c => c.name))].slice(0, 3).join(', '),
      companies: (d.production_companies || d.networks || []).slice(0, 3).map(c => c.name).join(', '),
      images: (d.images?.backdrops || []).filter(b => !b.iso_639_1).slice(0, 12).map(b => TIMG + 'w780' + b.file_path),
      videos, related: related.filter(x => x.poster_path).slice(0, 16).map(x => item({ ...x, _type: type }, '')),
      // Alle diensten met een abonnement in Nederland; key is gezet als Thuis de dienst kent.
      services: (d['watch/providers']?.results?.NL?.flatrate || []).map(p => ({ key: mine.get(p.provider_id) || '', name: p.provider_name, logo: p.logo_path ? TIMG + 'w92' + p.logo_path : '' })),
      ratings: await ratings(d.external_ids?.imdb_id || '').catch(() => null)
    };
  });
}

// Films en series van IPTV: de hele catalogus (6 uur bewaard) en informatie per titel.
import { cached } from './db.js';
import { api } from './xtream.js';
import { genreName } from './plex.js';

const bd = b => Array.isArray(b) ? (b[0] || '') : (b || '');
const genres = raw => [...new Set((raw || '').split(/[,/|;]/).map(g => g.trim()).filter(Boolean).map(genreName).filter(Boolean))];

export function all(kind) {
  const series = kind === 'series';
  return cached(`vod:${kind}`, 6 * 3600e3, async () => {
    const cats = (await api(series ? 'get_series_categories' : 'get_vod_categories') || []).map(c => ({ id: String(c.category_id), name: c.category_name }));
    const items = (await api(series ? 'get_series' : 'get_vod_streams') || []).map(o => ({
      id: String(series ? o.series_id : o.stream_id), name: (o.name || '').replace(/^\s*\[[A-Z]{2}\]\s*|^\s*[A-Z]{2}\s*[|:-]\s*/, ''),
      icon: series ? o.cover || '' : o.stream_icon || '', backdrop: series ? bd(o.backdrop_path) : '',
      rating: String(o.rating || ''), year: String(o.year || o.releaseDate || o.release_date || '').slice(0, 4), plot: o.plot || '',
      ext: o.container_extension || 'mp4', cat: String(o.category_id || ''), genres: genres(o.genre), tmdb: +(o.tmdb || o.tmdb_id || 0),
      added: +(series ? o.last_modified : o.added) || 0
    })).sort((a, b) => b.added - a.added);
    return { cats, items };
  });
}

export async function info(kind, id) {
  if (kind === 'series') {
    const o = await api('get_series_info', `&series_id=${encodeURIComponent(id)}`);
    const i = o.info || {}, eps = o.episodes || {};
    return { plot: i.plot || '', backdrop: bd(i.backdrop_path), genre: i.genre || '', year: String(i.releaseDate || '').slice(0, 4), tmdb: +(i.tmdb || i.tmdb_id || 0),
      seasons: Object.keys(eps).sort((a, b) => a - b).map(s => ({ season: s, episodes: eps[s].map(e => {
        const ei = e.info || {}; return { id: String(e.id), num: +e.episode_num, title: e.title, ext: e.container_extension || 'mkv', img: ei.movie_image || '', plot: ei.plot || '', dur: +ei.duration_secs || 0 }; }) })) };
  }
  const o = await api('get_vod_info', `&vod_id=${encodeURIComponent(id)}`);
  const i = o.info || {};
  return { plot: i.plot || i.description || '', backdrop: bd(i.backdrop_path), genre: i.genre || '', year: String(i.releasedate || '').slice(0, 4),
    duration: i.duration || '', tmdb: +(i.tmdb_id || i.tmdb || 0) };
}

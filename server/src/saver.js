// Beelden voor de schermbeveiliging van Thuis, plus het weer voor onder de klok.
// Bronnen: film (beelden van je eigen films en series), album1..3 (eigen foto's), kunst (Art Institute of Chicago, CC0).
import { S, cached } from './db.js';
import { json, enc, pool } from './http.js';
import * as photos from './photos.js';
import * as catalog from './catalog.js';
import { art } from './tmdb.js';

export const SOURCES = ['film', 'album1', 'album2', 'album3', 'kunst'];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Beelden van je eigen titels: eerst de grote TMDB-achtergrond, anders die van Plex of IPTV. */
async function film() {
  const tag = (l, type) => l.map(o => ({ o, type }));
  const all = [...tag((await catalog.items('movie')).list, 'movie'), ...tag((await catalog.items('series')).list, 'tv')];
  const pick = shuffle(all.filter(({ o }) => o.tmdb || (o.plex && o.plex.art) || (o.vod && o.vod.backdrop))).slice(0, 40);
  const out = await pool(pick, 4, async ({ o, type }) => {
    const big = o.tmdb && S('tmdbToken') ? (await art(type, o.tmdb).catch(() => ({}))).backdrop : '';
    const url = big || (o.plex && o.plex.art) || (o.vod && o.vod.backdrop) || '';
    return url ? { url, by: o.title + (o.year ? ' (' + o.year + ')' : '') } : null;
  });
  return out.filter(Boolean);
}

/** Schilderijen in het publieke domein (CC0). Liggende werken, zodat ze het scherm vullen. */
function kunst() {
  return cached('saver:kunst2', 86400e3, async () => {
    const q = ['landscape', 'sea', 'garden', 'impressionism', 'river', 'city'], out = [];
    for (const term of q) {
      const r = await json('https://api.artic.edu/api/v1/artworks/search?q=' + enc(term) +
        '&query[bool][must][0][term][is_public_domain]=true&query[bool][must][1][term][artwork_type_title.keyword]=Painting' +
        '&fields=title,artist_title,date_display,image_id,thumbnail&limit=60',
        { headers: { 'AIC-User-Agent': 'tv-serverr (Thuis)' }, what: 'Art Institute of Chicago' }).catch(() => null);
      for (const a of (r && r.data) || []) {
        const t = a.thumbnail || {};
        if (!a.image_id || !t.width || t.width < t.height * 1.25) continue;
        out.push({ url: `https://www.artic.edu/iiif/2/${a.image_id}/full/1686,/0/default.jpg`,
          by: [a.artist_title, a.title, a.date_display].filter(Boolean).join('. ') + '. The Art Institute of Chicago' });
      }
    }
    return [...new Map(out.map(o => [o.url, o])).values()];
  });
}

/** Alle beelden voor de gekozen bronnen, door elkaar. */
export async function images(srcs) {
  const want = [...new Set(String(srcs || 'film').split(','))].filter(s => SOURCES.includes(s));
  const lists = await Promise.all(want.map(s => (s === 'film' ? film() : s === 'kunst' ? kunst() : Promise.resolve(photos.list(+s.slice(5)))).catch(() => [])));
  return shuffle(lists.flat().map(p => ({ url: p.url, by: p.by || '' }))).slice(0, 80);
}

// ---------- weer (Open-Meteo, geen sleutel nodig) ----------
const WMO = { 0: 'Helder', 1: 'Vrijwel helder', 2: 'Half bewolkt', 3: 'Bewolkt', 45: 'Mist', 48: 'Mist', 51: 'Motregen', 53: 'Motregen', 55: 'Motregen',
  61: 'Lichte regen', 63: 'Regen', 65: 'Zware regen', 66: 'IJzel', 67: 'IJzel', 71: 'Lichte sneeuw', 73: 'Sneeuw', 75: 'Zware sneeuw', 77: 'Sneeuw',
  80: 'Buien', 81: 'Buien', 82: 'Zware buien', 85: 'Sneeuwbuien', 86: 'Sneeuwbuien', 95: 'Onweer', 96: 'Onweer', 99: 'Onweer' };

export async function weather() {
  const place = S('weatherPlace'); if (!place) return null;
  const geo = await cached('weer:plaats:' + place, 30 * 86400e3, async () => {
    const r = await json('https://geocoding-api.open-meteo.com/v1/search?count=1&language=nl&name=' + enc(place), { what: 'weer' });
    const g = r && r.results && r.results[0]; return g ? { lat: g.latitude, lon: g.longitude, name: g.name } : null;
  });
  if (!geo) return null;
  return cached('weer:nu:' + geo.lat + ',' + geo.lon, 20 * 60e3, async () => {
    const r = await json(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code` +
      '&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=Europe%2FAmsterdam', { what: 'weer' });
    const c = r.current || {}, d = r.daily || {};
    return { place: geo.name, temp: Math.round(c.temperature_2m), text: WMO[c.weather_code] || '',
      max: Math.round((d.temperature_2m_max || [])[0]), min: Math.round((d.temperature_2m_min || [])[0]) };
  });
}

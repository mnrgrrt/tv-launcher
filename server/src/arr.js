// Radarr en Sonarr: binnenkort.
import { S } from './db.js';
import { json } from './http.js';

const img = (imgs, type) => (imgs || []).find(x => x.coverType === type)?.remoteUrl || '';
const day = ms => new Date(ms).toISOString().slice(0, 10);
const label = t => new Date(t).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' });

export async function upcoming(kind) {
  const series = kind === 'series', base = S(series ? 'sonarrUrl' : 'radarrUrl'), key = S(series ? 'sonarrKey' : 'radarrKey');
  if (!base || !key) return [];
  const now = Date.now(), range = `start=${day(now - 864e5)}&end=${day(now + (series ? 21 : 60) * 864e5)}`;
  const a = await json(`${base}/api/v3/calendar?${range}${series ? '&includeSeries=true' : ''}&unmonitored=false`, { headers: { 'X-Api-Key': key }, what: series ? 'Sonarr' : 'Radarr' });
  const out = [], seen = new Set();
  for (const e of a || []) {
    if (series) {
      const s = e.series; if (!s) continue; const t = Date.parse(e.airDateUtc), k = s.title + day(t);
      if (seen.has(k)) continue; seen.add(k);
      out.push({ title: s.title, sub: `S${e.seasonNumber} · afl. ${e.episodeNumber} · ${e.title || ''}`, when: t, date: label(t), hasFile: !!e.hasFile,
        thumb: img(s.images, 'poster'), art: img(s.images, 'fanart'), summary: e.overview || s.overview || '', tmdb: s.tmdbId || 0 });
    } else {
      const pick = [['digitalRelease', 'digitaal'], ['physicalRelease', 'dvd/blu-ray'], ['inCinemas', 'bioscoop']].find(x => e[x[0]]);
      if (!pick) continue; const t = Date.parse(e[pick[0]]);
      out.push({ title: e.title, sub: pick[1], when: t, date: label(t), hasFile: !!e.hasFile, year: String(e.year || ''),
        thumb: img(e.images, 'poster'), art: img(e.images, 'fanart'), summary: e.overview || '', tmdb: e.tmdbId || 0 });
    }
  }
  return out.sort((x, y) => x.when - y.when).slice(0, 40);
}

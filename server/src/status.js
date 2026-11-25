// Is elke bron bereikbaar? Voor de beheerpagina en voor een melding op de tv.
import { S } from './db.js';
import { http, json, enc } from './http.js';
import * as fanart from './fanart.js';

const checks = {
  dispatcharr: () => !S('server') ? null : http(`${S('server')}/player_api.php?username=${enc(S('user'))}&password=${enc(S('pass'))}`, { timeout: 6000, what: 'Dispatcharr' }),
  plex: () => !S('plexUrl') ? null : http(`${S('plexUrl')}/identity`, { timeout: 6000, what: 'Plex' }),
  radarr: () => !S('radarrUrl') ? null : http(`${S('radarrUrl')}/api/v3/system/status`, { headers: { 'X-Api-Key': S('radarrKey') }, timeout: 6000, what: 'Radarr' }),
  sonarr: () => !S('sonarrUrl') ? null : http(`${S('sonarrUrl')}/api/v3/system/status`, { headers: { 'X-Api-Key': S('sonarrKey') }, timeout: 6000, what: 'Sonarr' }),
  tmdb: () => !S('tmdbToken') ? null : http(`https://api.themoviedb.org/3/configuration?api_key=${enc(S('tmdbToken'))}`, { timeout: 6000, what: 'TMDB' }),
  // OMDb geeft ook bij een foute sleutel soms 200; dan staat Response op False.
  // Hooguit eens per uur: elke proef kost dagtegoed (1000 per dag).
  omdb: () => !S('omdbKey') ? null : hourly('omdb', () => json(`https://www.omdbapi.com/?i=tt0111161&apikey=${enc(S('omdbKey'))}`, { timeout: 6000, what: 'OMDb' })
    .then(r => { if (r?.Response !== 'True') throw new Error(r?.Error || 'OMDb weigert de sleutel'); })),
  fanart: () => !S('fanartKey') ? null : fanart.test().then(r => { if (!r.ok) throw new Error(r.error); }),
  opensubtitles: () => !S('osKey') ? null : http('https://api.opensubtitles.com/api/v1/infos/formats', { headers: { 'Api-Key': S('osKey'), 'User-Agent': 'Thuis v1.0' }, timeout: 6000, what: 'OpenSubtitles' }),
  youtube: () => !S('youtubeKey') ? null : http(`https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet&hl=nl&key=${enc(S('youtubeKey'))}`, { timeout: 6000, what: 'YouTube' })
};
let last = { at: 0, sources: {} };
const hours = new Map();   // naam -> { at, p }: dezelfde uitkomst (goed of fout) een uur lang
function hourly(name, fn) { const h = hours.get(name); if (h && Date.now() - h.at < 3600e3) return h.p; const p = fn(); p.catch(() => {}); hours.set(name, { at: Date.now(), p }); return p; }

export async function status(force = false) {
  if (!force && Date.now() - last.at < 60e3) return last;
  const sources = {};
  await Promise.all(Object.entries(checks).map(async ([k, fn]) => {
    const t = Date.now();
    try { const r = await fn(); sources[k] = r === null ? { ok: false, error: 'niet ingesteld' } : { ok: true, ms: Date.now() - t }; }
    catch (e) { sources[k] = { ok: false, error: e.message }; }
  }));
  last = { at: Date.now(), sources: Object.fromEntries(Object.keys(checks).map(k => [k, sources[k]])) };   // vaste volgorde op de beheerpagina
  return last;
}

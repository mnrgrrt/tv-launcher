// Is elke bron bereikbaar? Voor de beheerpagina en voor een melding op de tv.
import { S } from './db.js';
import { http, enc } from './http.js';

const checks = {
  dispatcharr: () => !S('server') ? null : http(`${S('server')}/player_api.php?username=${enc(S('user'))}&password=${enc(S('pass'))}`, { timeout: 6000, what: 'Dispatcharr' }),
  plex: () => !S('plexUrl') ? null : http(`${S('plexUrl')}/identity`, { timeout: 6000, what: 'Plex' }),
  radarr: () => !S('radarrUrl') ? null : http(`${S('radarrUrl')}/api/v3/system/status`, { headers: { 'X-Api-Key': S('radarrKey') }, timeout: 6000, what: 'Radarr' }),
  sonarr: () => !S('sonarrUrl') ? null : http(`${S('sonarrUrl')}/api/v3/system/status`, { headers: { 'X-Api-Key': S('sonarrKey') }, timeout: 6000, what: 'Sonarr' }),
  tmdb: () => !S('tmdbToken') ? null : http(`https://api.themoviedb.org/3/configuration?api_key=${enc(S('tmdbToken'))}`, { timeout: 6000, what: 'TMDB' })
};
let last = { at: 0, sources: {} };

export async function status(force = false) {
  if (!force && Date.now() - last.at < 60e3) return last;
  const sources = {};
  await Promise.all(Object.entries(checks).map(async ([k, fn]) => {
    const t = Date.now();
    try { const r = await fn(); sources[k] = r === null ? { ok: false, error: 'niet ingesteld' } : { ok: true, ms: Date.now() - t }; }
    catch (e) { sources[k] = { ok: false, error: e.message }; }
  }));
  last = { at: Date.now(), sources };
  return last;
}

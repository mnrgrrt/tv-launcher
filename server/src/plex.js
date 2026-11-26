// Plex: bibliotheken per genre, series, afspelen met kijkstand terug naar Plex.
import { S } from './db.js';
import { http, json, enc } from './http.js';
import { sign } from './auth.js';

const CLIENT = 'tv-serverr';
export const on = () => !!(S('plexUrl') && S('plexToken'));
const HEAD = { Accept: 'application/json', 'X-Plex-Client-Identifier': CLIENT, 'X-Plex-Product': 'Sjuul TV', 'X-Plex-Device-Name': 'tv-serverr' };
// token: van het Plex-profiel dat bij een Sjuul TV-profiel hoort. Zonder token: het hoofdaccount van de server.
async function get(path, method = 'GET', token = S('plexToken')) {
  const sep = path.includes('?') ? '&' : '?';
  const o = await json(`${S('plexUrl')}${path}${sep}X-Plex-Token=${enc(token)}`, { method, headers: HEAD, what: 'Plex' });
  return (o && o.MediaContainer) || {};
}

// ---------- Plex-profielen (Plex Home) ----------
// plex.tv geeft bij deze oude adressen soms XML terug, ook als je om JSON vraagt. Daarom beide lezen.
async function plexTv(path, method = 'GET', token = S('plexToken')) {
  const t = await http('https://plex.tv' + path, { method, headers: { ...HEAD, 'X-Plex-Token': token }, what: 'plex.tv' });
  if (/^\s*</.test(t)) return { xml: t };
  return t ? JSON.parse(t) : {};
}
const attrs = tag => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"')]));
const truthy = v => v === true || v === 1 || v === '1' || v === 'true';

/** De profielen in Plex Home. admin = het hoofdaccount; pin = er hoort een pincode bij. */
export async function homeUsers() {
  if (!on()) throw Object.assign(new Error('Plex is nog niet ingesteld'), { status: 400 });
  const r = await plexTv('/api/home/users');
  const list = r.xml ? [...r.xml.matchAll(/<User\s[^>]*>/g)].map(m => attrs(m[0])) : (r.users || r.MediaContainer?.User || []);
  return list.map(u => ({ id: String(u.id), uuid: String(u.uuid || ''), name: u.title || u.username || 'Plex-profiel', admin: truthy(u.admin), pin: truthy(u.protected) }));
}

/** Token voor één Plex-profiel op deze server. Bij een pincode moet die erbij. */
export async function profileToken(id, pin = '') {
  const r = await plexTv(`/api/home/users/${enc(id)}/switch${pin ? '?pin=' + enc(pin) : ''}`, 'POST')
    .catch(e => { throw /fout 40[13]/.test(e.message) ? Object.assign(new Error('Plex gaf geen toegang. Klopt de pincode?'), { status: 400 }) : e; });
  const user = r.xml ? attrs((/<user\s[^>]*>/i.exec(r.xml) || [''])[0]) : r;
  const tok = user.authenticationToken || user.authToken;
  if (!tok) throw Object.assign(new Error('Plex gaf geen toegang. Klopt de pincode?'), { status: 400 });
  // Het token van het Plex-account is niet altijd hetzelfde als dat voor deze server. Zoek de server op.
  let server = tok;
  try {
    const me = (await get('/identity')).machineIdentifier;
    const res = await plexTv('/api/v2/resources?includeHttps=1', 'GET', tok);
    const hit = Array.isArray(res) && res.find(x => x.clientIdentifier === me);
    if (hit && hit.accessToken) server = hit.accessToken;
  } catch {}
  await get('/library/onDeck?X-Plex-Container-Size=1', 'GET', server);   // werkt het echt?
  return server;
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
  'action & adventure': 'Actie', soap: 'Drama', geschiedenis: 'Historisch', 'tv film': '', 'tv movie': '', news: '', talk: '' };
export const KIDS = new Set(['Animatie', 'Familie']);
export const genreName = raw => (Object.prototype.hasOwnProperty.call(GENRE, raw.toLowerCase()) ? GENRE[raw.toLowerCase()] : raw);

const tmdbOf = m => { for (const g of m?.Guid || []) if (/^tmdb:\/\//.test(g.id)) return +g.id.slice(7); return 0; };

export function item(m) {
  const ep = m.type === 'episode', dur = m.duration || 0, off = m.viewOffset || 0;
  return { key: String(m.ratingKey), source: 'plex', type: m.type, title: ep ? m.grandparentTitle : m.title,
    sub: ep ? `S${m.parentIndex} · afl. ${m.index} · ${m.title}` : '', show: ep ? String(m.grandparentRatingKey || '') : '', year: String(m.year || ''),
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

/** Seizoenen en afleveringen. Gezien en kijkstand zijn van het Plex-profiel van token. */
export async function show(key, token) {
  const [meta, leaves] = await Promise.all([get(`/library/metadata/${key}?includeGuids=1`, 'GET', token), get(`/library/metadata/${key}/allLeaves`, 'GET', token)]);
  const m = (meta.Metadata || [])[0] || {}, seasons = {};
  for (const e of leaves.Metadata || []) {
    const d = e.duration || 0, o = e.viewOffset || 0;
    (seasons[e.parentIndex] = seasons[e.parentIndex] || []).push({ key: String(e.ratingKey), num: e.index, title: e.title,
      img: img(e.thumb, 640, 360), plot: e.summary || '', dur: Math.round(d / 1000), progress: d ? o / d : 0, watched: (e.viewCount || 0) > 0 });
  }
  return { plot: m.summary || '', backdrop: img(m.art, 1280, 720), tmdb: tmdbOf(m),
    seasons: Object.keys(seasons).sort((a, b) => a - b).map(s => ({ season: s, episodes: seasons[s] })) };
}

/** Wat de speler nodig heeft. offsetMs is van het Plex-profiel van token (geen token: niet verder kijken via Plex). */
export async function playItem(key, token) {
  const c = await get(`/library/metadata/${key}?includeGuids=1`, 'GET', token || S('plexToken'));
  const m = (c.Metadata || [])[0]; if (!m) throw new Error('Niet gevonden in Plex');
  const part = (((m.Media || [])[0] || {}).Part || [])[0]; if (!part) throw new Error('Geen bestand');
  const ep = m.type === 'episode';
  // Via de server: het Plex-token gaat nooit naar de tv.
  const subs = (part.Stream || []).filter(s => s.streamType === 3 && s.key)
    .map(s => ({ url: sign(`/stream/plex?p=${enc(s.key)}`), lang: s.languageCode || '', label: s.displayTitle || '', codec: s.codec || '' }));
  let tmdb = tmdbOf(m);
  if (ep) tmdb = tmdbOf((await get(`/library/metadata/${m.grandparentRatingKey}?includeGuids=1`).catch(() => ({}))).Metadata?.[0]) || 0;
  return { kind: m.type === 'clip' ? 'clip' : ep ? 'series' : 'movie', key: 'plex:' + key, plexKey: key, url: sign(`/stream/plex?p=${enc(part.key)}`),
    title: ep ? m.grandparentTitle : m.title, sub: ep ? `S${m.parentIndex} · afl. ${m.index} · ${m.title}` : String(m.year || ''),
    seriesKey: ep ? 'plex:' + m.grandparentRatingKey : '', season: ep ? m.parentIndex : 0, episode: ep ? m.index : 0,
    tmdb, offsetMs: token ? m.viewOffset || 0 : 0, subs, img: img(ep ? m.thumb : m.art, 1280, 720) };
}

/** Extra's bij een titel in Plex (trailers, achter de schermen). Spelen direct af via de gewone speler. */
export async function extras(key) {
  const c = await get(`/library/metadata/${key}/extras`).catch(() => ({}));
  return (c.Metadata || []).slice(0, 20).map(m => ({ key: String(m.ratingKey), title: m.title, sub: m.subtype || 'extra', img: img(m.thumb, 640, 360), minutes: Math.round((m.duration || 0) / 60000) }));
}

/** TMDB-nummer (bij een aflevering dat van de serie) met seizoen en aflevering, voor het koppelen aan IPTV. */
export async function ident(key) {
  const m = ((await get(`/library/metadata/${key}?includeGuids=1`)).Metadata || [])[0]; if (!m) return null;
  if (m.type !== 'episode') return { tmdb: tmdbOf(m), season: 0, episode: 0 };
  const show = ((await get(`/library/metadata/${m.grandparentRatingKey}?includeGuids=1`).catch(() => ({}))).Metadata || [])[0];
  return { tmdb: tmdbOf(show), season: m.parentIndex || 0, episode: m.index || 0 };
}

// Kijkstand, gezien en "verder kijken" in Plex zelf: altijd met het token van het Plex-profiel.
export function timeline(token, key, state, pos, dur) {
  if (!on() || !token) return;
  get(`/:/timeline?ratingKey=${key}&key=${enc('/library/metadata/' + key)}&state=${state}&time=${Math.round(pos)}&duration=${Math.round(dur)}`, 'GET', token).catch(() => {});
  if (state === 'stopped' && dur > 0 && pos > dur * 0.9) get(`/:/scrobble?identifier=com.plexapp.plugins.library&key=${key}`, 'GET', token).catch(() => {});
}
export function setWatched(token, key, yes) { if (on() && token) get(`/:/${yes ? 'scrobble' : 'unscrobble'}?identifier=com.plexapp.plugins.library&key=${enc(key)}`, 'GET', token).catch(() => {}); }
export function removeFromDeck(token, key) { if (on() && token) get(`/actions/removeFromContinueWatching?ratingKey=${enc(key)}`, 'PUT', token).catch(() => {}); }
export async function deck(token) {
  if (!on() || !token) return [];
  const c = await get('/library/onDeck?X-Plex-Container-Size=20', 'GET', token);
  return (c.Metadata || []).filter(x => x.type === 'movie' || x.type === 'episode').map(item);
}

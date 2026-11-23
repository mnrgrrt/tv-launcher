// Profielen, kijkstand per profiel, Mijn lijst en favoriete zenders.
import { db } from './db.js';
import * as plex from './plex.js';
import * as vod from './vod.js';
import fs from 'node:fs';
import path from 'node:path';
import { sign } from './auth.js';

// Avatar per profiel: een nummer uit de vaste set (public/avatars) of een eigen foto.
try { db.exec("ALTER TABLE profiles ADD COLUMN avatar TEXT DEFAULT ''"); } catch {}
db.exec('CREATE TABLE IF NOT EXISTS history (profile INTEGER, title TEXT, type TEXT, tmdb INTEGER, genres TEXT, PRIMARY KEY (profile, title))');
db.exec('CREATE TABLE IF NOT EXISTS searches (profile INTEGER, q TEXT, n INTEGER, last INTEGER, PRIMARY KEY (profile, q))');
// Opnames als "Rondo - S08E15" uit een filmbibliotheek zijn afleveringen.
const EPISODE = /\bS\d{1,2}E\d{1,3}\b/i;
// Verder kijken: zelf weggehaalde titels komen pas terug als je ze opnieuw kijkt.
try { db.exec('ALTER TABLE progress ADD COLUMN hidden INTEGER DEFAULT 0'); } catch {}
// Zelfde titel in Plex en IPTV herkennen: TMDB-nummer (bij series dat van de serie) plus seizoen en aflevering.
for (const c of ['tmdb', 'season', 'episode']) try { db.exec(`ALTER TABLE progress ADD COLUMN ${c} INTEGER DEFAULT 0`); } catch {}
const ident = p => ({ tmdb: Math.max(0, parseInt(p.tmdb ?? p.meta?.tmdb) || 0), season: Math.max(0, parseInt(p.season) || 0), episode: Math.max(0, parseInt(p.episode) || 0) });
const srcName = key => (String(key).startsWith('plex:') ? 'Plex' : 'IPTV');
// Terugkijken loopt via de live-speler en heeft geen kijkstand meer.
db.prepare("DELETE FROM progress WHERE key LIKE 'catchup:%'").run();
const PHOTOS = path.join(process.env.THUIS_DATA || '/data', 'photos');
fs.mkdirSync(PHOTOS, { recursive: true });
const photoFile = id => fs.readdirSync(PHOTOS).find(f => f.startsWith(`p${+id}.`));
export function avatarUrl(p) {
  if (p.avatar === 'photo') { const f = photoFile(p.id); if (f) return sign(`/photo/${f}?v=${fs.statSync(path.join(PHOTOS, f)).mtimeMs | 0}`, 24 * 30); }
  const n = +p.avatar || ((p.id * 7) % 73) + 1;           // nog niets gekozen: vast plaatje op basis van het profiel
  return `/avatars/${n}.svg`;
}
export const photoPath = f => (/^p\d+\.(jpg|png|webp)$/.test(f) ? path.join(PHOTOS, f) : null);
const MAGIC = [['jpg', [0xff, 0xd8, 0xff]], ['png', [0x89, 0x50, 0x4e, 0x47]], ['webp', [0x52, 0x49, 0x46, 0x46]]];
/** Eigen foto opslaan (base64). Alleen jpg, png of webp, maximaal 3 MB. */
export function savePhoto(id, b64) {
  const buf = Buffer.from(String(b64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length || buf.length > 3 * 1024 * 1024) throw Object.assign(new Error('Foto te groot (max 3 MB)'), { status: 400 });
  const kind = MAGIC.find(([, m]) => m.every((b, i) => buf[i] === b));
  if (!kind) throw Object.assign(new Error('Alleen jpg, png of webp'), { status: 400 });
  const old = photoFile(id); if (old) fs.rmSync(path.join(PHOTOS, old));
  fs.writeFileSync(path.join(PHOTOS, `p${+id}.${kind[0]}`), buf);
  db.prepare("UPDATE profiles SET avatar = 'photo' WHERE id = ?").run(+id);
}

export const list = () => db.prepare(`SELECT id, name, color, admin, plex_user, prefs, avatar,
    (SELECT COUNT(*) FROM history h WHERE h.profile = profiles.id) history FROM profiles ORDER BY sort, id`).all()
  .map(p => ({ ...p, admin: !!p.admin, prefs: JSON.parse(p.prefs || '{}'), avatarUrl: avatarUrl(p) }));
/** Profiel een plek omhoog (-1) of omlaag (+1). Samen blijft altijd vooraan. */
export function move(id, dir) {
  const ids = list().map(p => p.id).filter(x => x !== 1);
  const i = ids.indexOf(+id), j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  db.prepare('UPDATE profiles SET sort = 0 WHERE id = 1').run();
  ids.forEach((x, k) => db.prepare('UPDATE profiles SET sort = ? WHERE id = ?').run(k + 1, x));
}
/** Verder kijken van Plex zelf tonen bij dit profiel, aan of uit. */
export const setPlexDeck = (id, on) => db.prepare('UPDATE profiles SET plex_user = ? WHERE id = ?').run(on ? '1' : '', +id);
/** "Mag alles" aan of uit. */
export const setAdmin = (id, on) => db.prepare('UPDATE profiles SET admin = ? WHERE id = ?').run(on ? 1 : 0, +id);
export function setAvatar(id, avatar) {
  const v = String(avatar) === 'photo' ? 'photo' : String(Math.max(1, Math.min(73, +avatar || 1)));
  db.prepare('UPDATE profiles SET avatar = ? WHERE id = ?').run(v, +id);
}
export function save(p) {
  if (p.id) db.prepare('UPDATE profiles SET name = ?, color = ?, admin = ?, plex_user = ?, prefs = ?, sort = ? WHERE id = ?')
    .run(p.name, p.color || '#3DDBB0', p.admin ? 1 : 0, p.plex_user || '', JSON.stringify(p.prefs || {}), +p.sort || 0, +p.id);
  else db.prepare('INSERT INTO profiles (name, color, admin, plex_user, prefs, sort) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM profiles))')
    .run(p.name, p.color || '#3DDBB0', p.admin ? 1 : 0, p.plex_user || '', JSON.stringify(p.prefs || {}));
}
export const remove = id => {
  if (+id === 1) return;                     // Samen blijft altijd
  for (const t of ['profiles', 'progress', 'mylist', 'favorites', 'history', 'searches']) db.prepare(`DELETE FROM ${t} WHERE ${t === 'profiles' ? 'id' : 'profile'} = ?`).run(+id);
  const f = photoFile(id); if (f) fs.rmSync(path.join(PHOTOS, f));
  db.prepare('UPDATE devices SET profile = 0, locked = 0 WHERE profile = ?').run(+id);
};
export function setPrefs(id, prefs) {
  const cur = JSON.parse(db.prepare('SELECT prefs FROM profiles WHERE id = ?').get(+id)?.prefs || '{}');
  db.prepare('UPDATE profiles SET prefs = ? WHERE id = ?').run(JSON.stringify({ ...cur, ...prefs }), +id);
}

/** Kijkstand opslaan. Bij 95% telt hij als gezien. */
export function progress(profile, p) {
  if (p.kind === 'clip') return;   // extra's (trailers e.d.) komen niet in Verder kijken
  const watched = p.dur > 0 && p.pos >= p.dur * 0.95 ? 1 : 0;
  const id = ident(p);
  db.prepare(`INSERT INTO progress (profile, key, series_key, kind, pos, dur, watched, meta, updated, tmdb, season, episode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile, key) DO UPDATE SET pos = excluded.pos, dur = excluded.dur, watched = MAX(progress.watched, excluded.watched), meta = excluded.meta, updated = excluded.updated, series_key = excluded.series_key, hidden = 0,
      tmdb = CASE WHEN excluded.tmdb > 0 THEN excluded.tmdb ELSE progress.tmdb END, season = CASE WHEN excluded.tmdb > 0 THEN excluded.season ELSE progress.season END, episode = CASE WHEN excluded.tmdb > 0 THEN excluded.episode ELSE progress.episode END`)
    .run(+profile, p.key, p.seriesKey || '', p.kind || '', Math.round(p.pos || 0), Math.round(p.dur || 0), watched, JSON.stringify(p.meta || {}), Date.now(), id.tmdb, id.season, id.episode);
  if (p.plexKey) plex.timeline(p.plexKey, p.state || (watched ? 'stopped' : 'playing'), p.pos, p.dur);
}
/** Waar ben je gebleven? Eerst bij deze bron; anders bij dezelfde titel via de andere bron (Plex of IPTV), 10 seconden eerder. */
export function position(profile, key, tmdb = 0, season = 0, episode = 0) {
  const r = db.prepare('SELECT pos, dur, watched, updated FROM progress WHERE profile = ? AND key = ?').get(+profile, key);
  if (r && (r.watched || r.pos > 30000)) return { pos: r.watched ? 0 : r.pos, via: '' };
  if (+tmdb > 0) {
    const o = db.prepare(`SELECT key, pos, updated FROM progress WHERE profile = ? AND key != ? AND tmdb = ? AND season = ? AND episode = ? AND watched = 0 AND pos > 30000
      ORDER BY updated DESC LIMIT 1`).get(+profile, key, +tmdb, +season, +episode);
    if (o && (!r || o.updated > r.updated)) return { pos: Math.max(0, o.pos - 10000), via: srcName(o.key) };
  }
  return { pos: r && !r.watched ? r.pos : 0, via: '' };
}
/** Afleveringen die je via welke bron dan ook gezien hebt: "seizoen:aflevering" voor een serie (TMDB-nummer). */
export const watchedEps = (profile, tmdb) => +tmdb > 0 ? new Set(db.prepare('SELECT season, episode FROM progress WHERE profile = ? AND tmdb = ? AND watched = 1 AND season > 0')
  .all(+profile, +tmdb).map(r => r.season + ':' + r.episode)) : new Set();
export const seriesState = (profile, seriesKey) => db.prepare('SELECT key, pos, dur, watched, updated FROM progress WHERE profile = ? AND series_key = ?').all(+profile, seriesKey);
/** Verder kijken voor dit profiel: één tegel per serie of film; afgeronde aflevering = volgende. */
export async function continueWatching(profile) {
  const rows = db.prepare('SELECT * FROM progress WHERE profile = ? AND updated > ? ORDER BY updated DESC LIMIT 200').all(+profile, Date.now() - 60 * 86400e3);
  const seen = new Set(), out = [];
  for (const r of rows) {
    const group = r.series_key || r.key, same = r.tmdb > 0 ? (r.kind === 'movie' ? 'm' : 's') + r.tmdb : '';
    if (seen.has(group) || (same && seen.has(same))) continue; seen.add(group); seen.add(r.key); if (same) seen.add(same);
    if (r.hidden) continue;
    const meta = JSON.parse(r.meta || '{}'), kind = r.kind === 'movie' && !EPISODE.test(meta.title || '') ? 'movie' : 'series';
    if (!r.watched && r.pos > 30000) { out.push({ ...meta, kind, key: r.key, progress: r.dur ? r.pos / r.dur : 0, left: r.dur ? Math.round((r.dur - r.pos) / 60000) : -1, when: r.updated, resume: true }); continue; }
    if (r.watched && r.series_key && r.series_key.startsWith('series:')) {
      const next = await nextEpisode(profile, r.series_key).catch(() => null);
      if (next) out.push({ ...meta, ...next, when: r.updated, next: true });
    }
  }
  // Wat Plex zelf als "verder kijken" heeft (dat is van het Plex-account van de server, dus van één persoon):
  // alleen bij Samen en bij profielen waar dat op de beheerpagina aan staat. Anders zien alle profielen hetzelfde.
  if (usesPlex(profile)) try {
    (await plex.deck()).slice(0, 8).forEach(p => {
      if (seen.has('plex:' + p.key) || (p.show && seen.has('plex:' + p.show))) return;
      out.push({ ...p, kind: p.type === 'movie' && !EPISODE.test(p.title) ? 'movie' : 'series', key: 'plex:' + p.key, when: p.added, resume: true });
    });
  } catch {}
  return out.sort((a, b) => (b.when || 0) - (a.when || 0)).slice(0, 20);
}

/** Hoort het Plex-account van de server bij dit profiel? (Samen, en profielen waar dat in beheer aan staat.) */
export const usesPlex = profile => +profile === 1 || db.prepare('SELECT plex_user FROM profiles WHERE id = ?').get(+profile)?.plex_user === '1';

/** Gezien of niet gezien zetten. items = [{ key, seriesKey, kind, meta }]. Bij Plex ook in Plex, als het Plex-account van dit profiel is. */
export function setWatched(profile, items, yes) {
  const put = db.prepare(`INSERT INTO progress (profile, key, series_key, kind, pos, dur, watched, meta, updated, tmdb, season, episode) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile, key) DO UPDATE SET pos = 0, watched = excluded.watched, updated = excluded.updated, hidden = 0,
      tmdb = CASE WHEN excluded.tmdb > 0 THEN excluded.tmdb ELSE progress.tmdb END, season = CASE WHEN excluded.tmdb > 0 THEN excluded.season ELSE progress.season END, episode = CASE WHEN excluded.tmdb > 0 THEN excluded.episode ELSE progress.episode END,
      series_key = CASE WHEN excluded.series_key = '' THEN progress.series_key ELSE excluded.series_key END,
      meta = CASE WHEN excluded.meta = '{}' THEN progress.meta ELSE excluded.meta END`);
  for (const it of (items || []).slice(0, 500)) {
    const key = String(it.key || ''); if (!/^(plex|movie|series):\d+$/.test(key)) continue;
    const id = ident(it);
    put.run(+profile, key, String(it.seriesKey || ''), String(it.kind || ''), yes ? 1 : 0, JSON.stringify(it.meta || {}).slice(0, 4000), Date.now(), id.tmdb, id.season, id.episode);
    // Ook de andere bron van dezelfde titel (of aflevering) gelijkzetten.
    if (id.tmdb > 0) db.prepare('UPDATE progress SET watched = ?, pos = 0, updated = ? WHERE profile = ? AND key != ? AND tmdb = ? AND season = ? AND episode = ?').run(yes ? 1 : 0, Date.now(), +profile, key, id.tmdb, id.season, id.episode);
    if (key.startsWith('plex:') && usesPlex(profile)) plex.setWatched(key.slice(5), yes);
  }
}
export const isWatched = (profile, key) => !!db.prepare('SELECT watched FROM progress WHERE profile = ? AND key = ?').get(+profile, key)?.watched;
/** Wat dit profiel heeft gezien, nieuwste eerst. */
export const watchedList = profile => db.prepare('SELECT key, kind, meta, updated FROM progress WHERE profile = ? AND watched = 1 ORDER BY updated DESC LIMIT 300')
  .all(+profile).map(r => ({ ...JSON.parse(r.meta || '{}'), key: r.key, kind: r.kind, when: r.updated }));

/** Seizoenen en afleveringen van een serie, met gezien en kijkstand van dit profiel. src = { plex } of { vod }. */
export async function showState(profile, src) {
  const mine = new Map(db.prepare("SELECT key, pos, dur, watched FROM progress WHERE profile = ? AND (key LIKE 'plex:%' OR key LIKE 'series:%')").all(+profile).map(r => [r.key, r]));
  const own = usesPlex(profile);
  const d = src.plex ? await plex.show(+src.plex) : await vod.info('series', +src.vod);
  const other = watchedEps(profile, d.tmdb);   // gezien via de andere bron
  for (const s of d.seasons) for (const e of s.episodes) {
    const key = src.plex ? 'plex:' + e.key : 'series:' + e.id, r = mine.get(key);
    e.skey = key;
    if (src.vod) e.url = sign(`/stream/series/${+e.id}.${/^[a-z0-9]{2,4}$/.test(e.ext) ? e.ext : 'mkv'}`);
    const plexWatched = src.plex && own && e.watched, plexProg = src.plex && own ? e.progress : 0;
    e.watched = !!(r ? r.watched : plexWatched) || other.has(+s.season + ':' + e.num);
    e.progress = r ? (r.watched ? 0 : r.dur ? r.pos / r.dur : 0) : plexProg;
  }
  return d;
}

/** Uit Verder kijken halen (de hele serie). Bij Plex ook uit "Verder kijken" van Plex zelf. */
export function hide(profile, key) {
  const row = db.prepare('SELECT series_key FROM progress WHERE profile = ? AND key = ?').get(+profile, key);
  if (row) db.prepare("UPDATE progress SET hidden = 1 WHERE profile = ? AND (key = ? OR (series_key != '' AND series_key = ?))").run(+profile, key, row.series_key || key);
  else db.prepare('INSERT INTO progress (profile, key, series_key, kind, pos, dur, watched, meta, updated, hidden) VALUES (?, ?, \'\', \'\', 0, 0, 0, \'{}\', ?, 1)').run(+profile, key, Date.now());
  const t = db.prepare('SELECT tmdb, kind FROM progress WHERE profile = ? AND key = ?').get(+profile, key);
  if (t && t.tmdb > 0) db.prepare('UPDATE progress SET hidden = 1 WHERE profile = ? AND tmdb = ?').run(+profile, t.tmdb);
  if (key.startsWith('plex:')) plex.removeFromDeck(key.slice(5));
}

/** Eerstvolgende niet-geziene aflevering van een IPTV-serie. */
export async function nextEpisode(profile, seriesKey) {
  const id = seriesKey.slice('series:'.length);
  const info = await vod.info('series', id);
  const done = new Set(seriesState(profile, seriesKey).filter(r => r.watched).map(r => r.key)), viaOther = watchedEps(profile, info.tmdb);
  for (const s of info.seasons) for (const e of s.episodes) if (viaOther.has(+s.season + ':' + e.num)) done.add('series:' + e.id);
  // De eerste na de laatst geziene (zoals de infopagina); overgeslagen afleveringen tellen niet.
  const all = info.seasons.flatMap(s => s.episodes.map(e => ({ s, e }))), last = all.findLastIndex(x => done.has('series:' + x.e.id));
  for (const { s, e } of all.slice(last + 1)) {
    const key = 'series:' + e.id;
    if (!done.has(key)) return { key, kind: 'series', id: e.id, ext: e.ext, seriesId: id, season: +s.season, episode: e.num,
      sub: `Volgende: S${s.season} · afl. ${e.num}`, img: e.img || info.backdrop, progress: 0 };
  }
  return null;
}

export const mylist = profile => db.prepare('SELECT key, meta, added FROM mylist WHERE profile = ? ORDER BY added DESC').all(+profile).map(r => ({ ...JSON.parse(r.meta || '{}'), key: r.key }));
export function toggleList(profile, key, meta) {
  const has = db.prepare('SELECT 1 FROM mylist WHERE profile = ? AND key = ?').get(+profile, key);
  if (has) db.prepare('DELETE FROM mylist WHERE profile = ? AND key = ?').run(+profile, key);
  else db.prepare('INSERT INTO mylist (profile, key, meta, added) VALUES (?, ?, ?, ?)').run(+profile, key, JSON.stringify(meta || {}), Date.now());
  return !has;
}
export const favorites = profile => db.prepare('SELECT channel FROM favorites WHERE profile = ? ORDER BY sort').all(+profile).map(r => r.channel);
export function setFavorites(profile, ids) {
  db.prepare('DELETE FROM favorites WHERE profile = ?').run(+profile);
  const st = db.prepare('INSERT INTO favorites (profile, channel, sort) VALUES (?, ?, ?)');
  (ids || []).forEach((c, i) => st.run(+profile, +c, i));
}

/** Wie kijkt deze serie of film nog meer? Voor "Verder als Floor?". Meest recente eerst. */
export function watchers(key, except = 0) {
  return db.prepare(`SELECT p.id, p.name, p.avatar, MAX(g.updated) updated, SUM(g.watched) done FROM progress g JOIN profiles p ON p.id = g.profile
    WHERE (g.series_key = ? OR g.key = ?) AND g.profile != ? AND g.updated > ? GROUP BY p.id ORDER BY updated DESC`)
    .all(key, key, +except, Date.now() - 90 * 86400e3).map(r => ({ id: r.id, name: r.name, avatarUrl: avatarUrl(r), updated: r.updated }));
}

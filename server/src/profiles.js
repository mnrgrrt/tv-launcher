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
  const watched = p.dur > 0 && p.pos >= p.dur * 0.95 ? 1 : 0;
  db.prepare(`INSERT INTO progress (profile, key, series_key, kind, pos, dur, watched, meta, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile, key) DO UPDATE SET pos = excluded.pos, dur = excluded.dur, watched = MAX(progress.watched, excluded.watched), meta = excluded.meta, updated = excluded.updated, series_key = excluded.series_key, hidden = 0`)
    .run(+profile, p.key, p.seriesKey || '', p.kind || '', Math.round(p.pos || 0), Math.round(p.dur || 0), watched, JSON.stringify(p.meta || {}), Date.now());
  if (p.plexKey) plex.timeline(p.plexKey, p.state || (watched ? 'stopped' : 'playing'), p.pos, p.dur);
}
export function position(profile, key) {
  const r = db.prepare('SELECT pos, dur, watched FROM progress WHERE profile = ? AND key = ?').get(+profile, key);
  return r && !r.watched ? r.pos : 0;
}
export const seriesState = (profile, seriesKey) => db.prepare('SELECT key, pos, dur, watched, updated FROM progress WHERE profile = ? AND series_key = ?').all(+profile, seriesKey);
/** Verder kijken voor dit profiel: één tegel per serie of film; afgeronde aflevering = volgende. */
export async function continueWatching(profile) {
  const rows = db.prepare('SELECT * FROM progress WHERE profile = ? AND updated > ? ORDER BY updated DESC LIMIT 200').all(+profile, Date.now() - 60 * 86400e3);
  const seen = new Set(), out = [];
  for (const r of rows) {
    const group = r.series_key || r.key; if (seen.has(group)) continue; seen.add(group); seen.add(r.key);
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
  const usesPlex = +profile === 1 || db.prepare('SELECT plex_user FROM profiles WHERE id = ?').get(+profile)?.plex_user === '1';
  if (usesPlex) try {
    (await plex.deck()).slice(0, 8).forEach(p => {
      if (seen.has('plex:' + p.key) || (p.show && seen.has('plex:' + p.show))) return;
      out.push({ ...p, kind: p.type === 'movie' && !EPISODE.test(p.title) ? 'movie' : 'series', key: 'plex:' + p.key, when: p.added, resume: true });
    });
  } catch {}
  return out.sort((a, b) => (b.when || 0) - (a.when || 0)).slice(0, 20);
}

/** Uit Verder kijken halen (de hele serie). Bij Plex ook uit "Verder kijken" van Plex zelf. */
export function hide(profile, key) {
  const row = db.prepare('SELECT series_key FROM progress WHERE profile = ? AND key = ?').get(+profile, key);
  if (row) db.prepare("UPDATE progress SET hidden = 1 WHERE profile = ? AND (key = ? OR (series_key != '' AND series_key = ?))").run(+profile, key, row.series_key || key);
  else db.prepare('INSERT INTO progress (profile, key, series_key, kind, pos, dur, watched, meta, updated, hidden) VALUES (?, ?, \'\', \'\', 0, 0, 0, \'{}\', ?, 1)').run(+profile, key, Date.now());
  if (key.startsWith('plex:')) plex.removeFromDeck(key.slice(5));
}

/** Eerstvolgende niet-geziene aflevering van een IPTV-serie. */
export async function nextEpisode(profile, seriesKey) {
  const id = seriesKey.slice('series:'.length);
  const info = await vod.info('series', id);
  const done = new Set(seriesState(profile, seriesKey).filter(r => r.watched).map(r => r.key));
  for (const s of info.seasons) for (const e of s.episodes) {
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

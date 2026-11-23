// Profielen, kijkstand per profiel, Mijn lijst en favoriete zenders.
import { db } from './db.js';
import * as plex from './plex.js';
import * as vod from './vod.js';
import fs from 'node:fs';
import path from 'node:path';
import { sign } from './auth.js';

// Avatar per profiel: een nummer uit de vaste set (public/avatars) of een eigen foto.
try { db.exec("ALTER TABLE profiles ADD COLUMN avatar TEXT DEFAULT ''"); } catch {}
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

export const list = () => db.prepare('SELECT id, name, color, admin, plex_user, prefs, avatar FROM profiles ORDER BY sort, id').all()
  .map(p => ({ ...p, admin: !!p.admin, prefs: JSON.parse(p.prefs || '{}'), avatarUrl: avatarUrl(p) }));
export function setAvatar(id, avatar) {
  const v = String(avatar) === 'photo' ? 'photo' : String(Math.max(1, Math.min(73, +avatar || 1)));
  db.prepare('UPDATE profiles SET avatar = ? WHERE id = ?').run(v, +id);
}
export function save(p) {
  if (p.id) db.prepare('UPDATE profiles SET name = ?, color = ?, admin = ?, plex_user = ?, prefs = ?, sort = ? WHERE id = ?')
    .run(p.name, p.color || '#3DDBB0', p.admin ? 1 : 0, p.plex_user || '', JSON.stringify(p.prefs || {}), +p.sort || 0, +p.id);
  else db.prepare('INSERT INTO profiles (name, color, admin, plex_user, prefs, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .run(p.name, p.color || '#3DDBB0', p.admin ? 1 : 0, p.plex_user || '', JSON.stringify(p.prefs || {}), +p.sort || 0);
}
export const remove = id => {
  if (+id === 1) return;                     // Samen blijft altijd
  for (const t of ['profiles', 'progress', 'mylist', 'favorites']) db.prepare(`DELETE FROM ${t} WHERE ${t === 'profiles' ? 'id' : 'profile'} = ?`).run(+id);
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
    ON CONFLICT(profile, key) DO UPDATE SET pos = excluded.pos, dur = excluded.dur, watched = MAX(progress.watched, excluded.watched), meta = excluded.meta, updated = excluded.updated, series_key = excluded.series_key`)
    .run(+profile, p.key, p.seriesKey || '', p.kind || '', Math.round(p.pos || 0), Math.round(p.dur || 0), watched, JSON.stringify(p.meta || {}), Date.now());
  if (p.plexKey) plex.timeline(p.plexKey, p.state || (watched ? 'stopped' : 'playing'), p.pos, p.dur);
}
export function position(profile, key) {
  const r = db.prepare('SELECT pos, dur, watched FROM progress WHERE profile = ? AND key = ?').get(+profile, key);
  return r && !r.watched ? r.pos : 0;
}
export const seriesState = (profile, seriesKey) => db.prepare('SELECT key, pos, dur, watched, updated FROM progress WHERE profile = ? AND series_key = ?').all(+profile, seriesKey);
export function setWatched(profile, key, watched) {
  db.prepare(`INSERT INTO progress (profile, key, watched, updated, pos, dur) VALUES (?, ?, ?, ?, 0, 0) ON CONFLICT(profile, key) DO UPDATE SET watched = excluded.watched, pos = 0, updated = excluded.updated`)
    .run(+profile, key, watched ? 1 : 0, Date.now());
}

/** Verder kijken voor dit profiel: één tegel per serie of film; afgeronde aflevering = volgende. */
export async function continueWatching(profile) {
  const rows = db.prepare('SELECT * FROM progress WHERE profile = ? AND updated > ? ORDER BY updated DESC LIMIT 200').all(+profile, Date.now() - 60 * 86400e3);
  const seen = new Set(), out = [];
  for (const r of rows) {
    const group = r.series_key || r.key; if (seen.has(group)) continue; seen.add(group);
    const meta = JSON.parse(r.meta || '{}');
    if (!r.watched && r.pos > 30000) { out.push({ ...meta, key: r.key, progress: r.dur ? r.pos / r.dur : 0, left: r.dur ? Math.round((r.dur - r.pos) / 60000) : -1, when: r.updated, resume: true }); continue; }
    if (r.watched && r.series_key && r.series_key.startsWith('series:')) {
      const next = await nextEpisode(profile, r.series_key).catch(() => null);
      if (next) out.push({ ...meta, ...next, when: r.updated, next: true });
    }
  }
  // Plex-tegels (eigen kijkstand van Plex) voor het profiel Samen of als er geen eigen Plex-gebruiker is
  try { (await plex.deck()).slice(0, 6).forEach(p => { if (!seen.has('plex:' + p.key)) out.push({ ...p, key: 'plex:' + p.key, when: p.added, resume: true }); }); } catch {}
  return out.sort((a, b) => (b.when || 0) - (a.when || 0)).slice(0, 20);
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

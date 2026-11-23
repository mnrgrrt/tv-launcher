// Opslag: één SQLite-bestand (node:sqlite, geen extra pakketten).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.THUIS_DATA || '/data';
fs.mkdirSync(DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DIR, 'thuis.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT DEFAULT '#3DDBB0',
    admin INTEGER DEFAULT 0, plex_user TEXT DEFAULT '', prefs TEXT DEFAULT '{}', sort INTEGER DEFAULT 0);
  -- Kijkstand per profiel per item (film, aflevering). series_key groepeert afleveringen.
  CREATE TABLE IF NOT EXISTS progress (
    profile INTEGER, key TEXT, series_key TEXT, kind TEXT, pos INTEGER, dur INTEGER,
    watched INTEGER DEFAULT 0, meta TEXT, updated INTEGER,
    PRIMARY KEY (profile, key));
  CREATE INDEX IF NOT EXISTS progress_series ON progress(profile, series_key);
  CREATE TABLE IF NOT EXISTS mylist (profile INTEGER, key TEXT, meta TEXT, added INTEGER, PRIMARY KEY (profile, key));
  CREATE TABLE IF NOT EXISTS favorites (profile INTEGER, channel INTEGER, sort INTEGER, PRIMARY KEY (profile, channel));
  CREATE TABLE IF NOT EXISTS programmes (
    channel TEXT, start INTEGER, stop INTEGER, title TEXT, descr TEXT, cat TEXT, plain TEXT);
  CREATE INDEX IF NOT EXISTS programmes_time ON programmes(start, stop);
  CREATE INDEX IF NOT EXISTS programmes_channel ON programmes(channel, start);
  CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT, at INTEGER);
`);
// Nieuwe versie? Eerst een kopie van de database (de laatste 5 blijven bewaard).
{
  const ver = process.env.THUIS_VERSION || 'dev';
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  const prev = db.prepare("SELECT value FROM settings WHERE key = '_version'").get()?.value;
  if (prev && prev !== ver) {
    const bdir = path.join(DIR, 'backup'); fs.mkdirSync(bdir, { recursive: true });
    const f = path.join(bdir, `thuis-${new Date().toISOString().slice(0, 10)}-v${prev}.db`);
    try { if (!fs.existsSync(f)) db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`); } catch (e) { console.error('backup mislukt:', e.message); }
    fs.readdirSync(bdir).filter(n => n.endsWith('.db')).sort().reverse().slice(5).forEach(n => fs.rmSync(path.join(bdir, n)));
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(ver);
}
if (!db.prepare('SELECT COUNT(*) n FROM profiles').get().n) {
  db.prepare("INSERT INTO profiles (name, color, admin, sort) VALUES ('Samen', '#3DDBB0', 1, 0)").run();
}

// ---------- instellingen ----------
const ENV = {
  server: 'THUIS_XTREAM_URL', user: 'THUIS_XTREAM_USER', pass: 'THUIS_XTREAM_PASS', format: 'THUIS_XTREAM_FORMAT',
  tmdbToken: 'THUIS_TMDB', plexUrl: 'THUIS_PLEX_URL', plexToken: 'THUIS_PLEX_TOKEN',
  osKey: 'THUIS_OPENSUBTITLES_KEY', osUser: 'THUIS_OPENSUBTITLES_USER', osPass: 'THUIS_OPENSUBTITLES_PASS',
  radarrUrl: 'THUIS_RADARR_URL', radarrKey: 'THUIS_RADARR_KEY', sonarrUrl: 'THUIS_SONARR_URL', sonarrKey: 'THUIS_SONARR_KEY',
  categories: 'THUIS_CATEGORIES', haWebhook: 'THUIS_HA_WEBHOOK'
};
export const SECRET = ['pass', 'tmdbToken', 'plexToken', 'osKey', 'osPass', 'radarrKey', 'sonarrKey'];
export function S(k) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
  if (row && row.value !== '') return row.value;
  return process.env[ENV[k]] || (k === 'format' ? 'ts' : '');
}
export function setSettings(o) {
  const st = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(o || {})) {
    if (!(k in ENV)) continue;
    let val = v == null ? '' : String(v);
    if (/Url$|^server$/.test(k)) val = val.trim().replace(/\/+$/, ''); else if (!/pass$|Pass$/.test(k)) val = val.trim();
    st.run(k, val);
  }
}
/** Instellingen voor het scherm: geheimen alleen als "staat ingesteld". */
export function publicSettings() {
  const o = {};
  for (const k of Object.keys(ENV)) o[k] = SECRET.includes(k) ? (S(k) ? '••••' : '') : S(k);
  return o;
}

// ---------- kleine cache in de database ----------
export async function cached(key, maxAgeMs, fn) {
  const row = db.prepare('SELECT value, at FROM cache WHERE key = ?').get(key);
  if (row && Date.now() - row.at < maxAgeMs) return JSON.parse(row.value);
  const v = await fn();
  db.prepare('INSERT INTO cache (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at')
    .run(key, JSON.stringify(v), Date.now());
  return v;
}
export function uncache(prefix) { db.prepare('DELETE FROM cache WHERE key LIKE ?').run(prefix + '%'); }

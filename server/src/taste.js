// Smaak per profiel: welke genres iemand kijkt. Uit wat er in Thuis gekeken is, Mijn lijst en een eenmalig
// geïmporteerde kijkgeschiedenis (Netflix). Alleen titels en genres worden bewaard, het bestand zelf niet.
import { db } from './db.js';
import { pool } from './http.js';
import * as tmdb from './tmdb.js';

db.exec('CREATE TABLE IF NOT EXISTS history (profile INTEGER, title TEXT, type TEXT, tmdb INTEGER, genres TEXT, PRIMARY KEY (profile, title))');

export const count = profile => db.prepare('SELECT COUNT(*) n FROM history WHERE profile = ?').get(+profile).n;
export const forget = profile => db.prepare('DELETE FROM history WHERE profile = ?').run(+profile);

/** Netflix-export ("Title","Date"). Series staan er als "Serie: Seizoen 1: Aflevering"; we houden de naam van de serie. */
export function importCsv(profile, csv) {
  const titles = new Set();
  for (const line of String(csv || '').split(/\r?\n/).slice(1)) {
    const m = /^"((?:[^"]|"")*)"/.exec(line.trim()); if (!m) continue;
    const t = m[1].replace(/""/g, '"').split(/:\s+(Seizoen|Season|Deel|Part|Limited Series|Miniserie|Volume|Chapter|Hoofdstuk)\b/i)[0].split(': ')[0].trim();
    if (t && t.length < 120) titles.add(t);
  }
  const list = [...titles].slice(0, 600);
  const have = new Set(db.prepare('SELECT title FROM history WHERE profile = ?').all(+profile).map(r => r.title));
  const ins = db.prepare('INSERT OR REPLACE INTO history (profile, title, type, tmdb, genres) VALUES (?, ?, ?, ?, ?)');
  // Op de achtergrond opzoeken; de beheerpagina hoeft niet te wachten.
  pool(list.filter(t => !have.has(t)), 3, async t => {
    const h = await tmdb.findAny(t).catch(() => null);
    ins.run(+profile, t, h ? h.type : '', h ? h.id : 0, JSON.stringify(h ? h.genres : []));
  });
  return list.length;
}

/** Hoe goed past een rij genres bij dit profiel? 0 (niet) tot 1 (precies). */
export function forProfile(profile, lookup) {
  const w = {}; let total = 0;
  const add = (genres, n) => (genres || []).forEach(g => { w[g] = (w[g] || 0) + n; total += n; });
  for (const r of db.prepare('SELECT genres FROM history WHERE profile = ?').all(+profile)) add(JSON.parse(r.genres || '[]'), 1);
  for (const r of db.prepare('SELECT meta, kind FROM progress WHERE profile = ? AND updated > ?').all(+profile, Date.now() - 180 * 86400e3)) {
    const m = JSON.parse(r.meta || '{}'); if (m.tmdb) add(lookup(r.kind === 'movie' ? 'movie' : 'tv', +m.tmdb), 2);
  }
  for (const r of db.prepare('SELECT meta FROM mylist WHERE profile = ?').all(+profile)) {
    const m = JSON.parse(r.meta || '{}'); if (m.tmdb) add(lookup(m.type === 'tv' ? 'tv' : 'movie', +m.tmdb), 3);
  }
  if (!total) return () => 0;
  const top = Math.max(...Object.values(w));
  return genres => (genres || []).reduce((s, g) => Math.max(s, (w[g] || 0) / top), 0);
}
/** Genres van een titel uit wat we al weten (TMDB-gegevens van de catalogus). */
export const lookup = (type, id) => JSON.parse(db.prepare('SELECT genres FROM tmdbinfo WHERE type = ? AND id = ?').get(type, id)?.genres || '[]');

// OMDb: IMDb-cijfer en Rotten Tomatoes. Elke score een week bewaard; de gratis sleutel geeft 1000 opvragingen per dag.
import { db, S } from './db.js';
import { json, enc } from './http.js';

db.exec('CREATE TABLE IF NOT EXISTS omdb (imdb TEXT PRIMARY KEY, rating REAL, votes INTEGER, rt TEXT, at INTEGER)');
db.exec('CREATE TABLE IF NOT EXISTS omdb_dag (dag TEXT PRIMARY KEY, used INTEGER)');
// Het dagtegoed bijhouden in de database: anders begint de teller na elke herstart opnieuw en is het tegoed zo op.
const WEEK = 7 * 86400e3, DAY_LIMIT = 900;
const today = () => new Date().toISOString().slice(0, 10);   // OMDb telt per dag in UTC
const usedToday = () => db.prepare('SELECT used FROM omdb_dag WHERE dag = ?').get(today())?.used || 0;
const spend = (n = 1) => db.prepare('INSERT INTO omdb_dag (dag, used) VALUES (?, ?) ON CONFLICT(dag) DO UPDATE SET used = used + ?').run(today(), n, n);
const budget = () => usedToday() < DAY_LIMIT;

/** Uit de bewaarde scores (zonder op te vragen). */
export const known = () => new Map(db.prepare('SELECT imdb, rating, votes FROM omdb WHERE rating > 0').all().map(r => [r.imdb, r]));

/** IMDb en Rotten Tomatoes voor één titel; vraagt op als hij er nog niet (of te oud) is. */
export async function ratings(imdb) {
  if (!imdb || !S('omdbKey')) return null;
  const row = db.prepare('SELECT * FROM omdb WHERE imdb = ?').get(imdb);
  if (row && Date.now() - row.at < WEEK) return { imdb: row.rating, votes: row.votes, rt: row.rt };
  if (!budget()) return row ? { imdb: row.rating, votes: row.votes, rt: row.rt } : null;
  spend();
  const o = await json(`https://www.omdbapi.com/?i=${enc(imdb)}&apikey=${enc(S('omdbKey'))}`, { what: 'OMDb' })
    .catch(e => { if (/limit/i.test(e.message)) spend(DAY_LIMIT); throw e; });   // OMDb zegt zelf dat het op is: de rest van de dag niet meer
  const r = { imdb: parseFloat(o?.imdbRating) || 0, votes: parseInt(String(o?.imdbVotes || '').replace(/\D/g, '')) || 0,
    rt: (o?.Ratings || []).find(x => x.Source === 'Rotten Tomatoes')?.Value || '' };
  db.prepare('INSERT OR REPLACE INTO omdb (imdb, rating, votes, rt, at) VALUES (?, ?, ?, ?, ?)').run(imdb, r.imdb, r.votes, r.rt, Date.now());
  return r;
}

/** 's Nachts aanvullen: titels met een IMDb-nummer zonder score, zolang er budget is. */
export async function fill(imdbIds) {
  if (!S('omdbKey')) return;
  const have = new Set(db.prepare('SELECT imdb FROM omdb').all().map(r => r.imdb));
  for (const id of imdbIds) { if (!budget()) break; if (!have.has(id)) await ratings(id).catch(() => null); }
}

// Laatst gezocht, per profiel. Alleen zoekopdrachten waarop daarna echt iets gekozen is.
import { db } from './db.js';

db.exec('CREATE TABLE IF NOT EXISTS searches (profile INTEGER, q TEXT, n INTEGER, last INTEGER, PRIMARY KEY (profile, q))');
export const list = profile => db.prepare('SELECT q FROM searches WHERE profile = ? ORDER BY n DESC, last DESC LIMIT 12').all(+profile).map(r => r.q);
export function add(profile, q) {
  q = String(q || '').trim().toLowerCase().slice(0, 60); if (q.length < 2) return;
  db.prepare('INSERT INTO searches (profile, q, n, last) VALUES (?, ?, 1, ?) ON CONFLICT(profile, q) DO UPDATE SET n = n + 1, last = excluded.last').run(+profile, q, Date.now());
  // Niet eindeloos: de 40 meest gebruikte blijven.
  db.prepare('DELETE FROM searches WHERE profile = ? AND q NOT IN (SELECT q FROM searches WHERE profile = ? ORDER BY n DESC, last DESC LIMIT 40)').run(+profile, +profile);
}
export const remove = (profile, q) => (q ? db.prepare('DELETE FROM searches WHERE profile = ? AND q = ?').run(+profile, q) : db.prepare('DELETE FROM searches WHERE profile = ?').run(+profile));

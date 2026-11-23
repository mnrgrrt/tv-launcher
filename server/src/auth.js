// Beveiliging: alleen gekoppelde tv's, beheer met pincode.
import crypto from 'node:crypto';
import { db } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, key_hash TEXT UNIQUE, created INTEGER, last_seen INTEGER, last_ip TEXT);`);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const same = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Koppelcodes: 6 cijfers, 10 minuten geldig, één keer te gebruiken.
const codes = new Map();
export function newCode() {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  codes.set(code, Date.now() + 10 * 60e3);
  return code;
}
// Te vaak een verkeerde code of pin: even wachten.
const fails = new Map();
function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 5 && Date.now() - f.at < 15 * 60e3; }
function fail(ip) { const f = fails.get(ip) || { n: 0, at: 0 }; fails.set(ip, { n: f.n + 1, at: Date.now() }); }

export function pair(code, name, ip) {
  if (tooMany(ip)) throw Object.assign(new Error('Te vaak geprobeerd, wacht een kwartier'), { status: 429 });
  const until = codes.get(String(code));
  if (!until || until < Date.now()) { fail(ip); throw Object.assign(new Error('Code onbekend of verlopen'), { status: 403 }); }
  codes.delete(String(code));
  const key = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO devices (name, key_hash, created, last_seen, last_ip) VALUES (?, ?, ?, ?, ?)').run(String(name || 'tv').slice(0, 40), sha(key), Date.now(), Date.now(), ip);
  return key;
}

export function deviceFor(key, ip) {
  if (!key) return null;
  const d = db.prepare('SELECT id, name FROM devices WHERE key_hash = ?').get(sha(key));
  if (d) db.prepare('UPDATE devices SET last_seen = ?, last_ip = ? WHERE id = ?').run(Date.now(), ip, d.id);
  return d || null;
}
export const devices = () => db.prepare('SELECT id, name, created, last_seen, last_ip FROM devices ORDER BY created').all();
export const unpair = id => db.prepare('DELETE FROM devices WHERE id = ?').run(+id);

export function adminOk(pin, ip) {
  const want = process.env.THUIS_ADMIN_PIN || '';
  if (!want) return false;               // zonder pincode in de instellingen is beheer dicht
  if (tooMany(ip)) return false;
  if (same(String(pin || ''), want)) return true;
  fail(ip); return false;
}

// Ondertekende links voor plaatjes en streams: de speler en <img> kunnen geen sleutel meesturen,
// dus krijgen ze een link die alleen de server kan maken en die na een tijd verloopt.
function secret() {
  let s = db.prepare("SELECT value FROM settings WHERE key = '_sign'").get()?.value;
  if (!s) { s = crypto.randomBytes(32).toString('hex'); db.prepare("INSERT INTO settings (key, value) VALUES ('_sign', ?)").run(s); }
  return s;
}
let SIGN = null;
const mac = s => crypto.createHmac('sha256', SIGN || (SIGN = secret())).update(s).digest('base64url').slice(0, 32);
/** path bevat al eventuele ?-parameters. Geldig: standaard 12 uur (lang genoeg voor een film met pauze). */
export function sign(path, hours = 12) {
  // Afgerond op het uur, zodat dezelfde link even hetzelfde blijft (beter voor de plaatjescache).
  const exp = Math.ceil((Date.now() / 1000 + hours * 3600) / 3600) * 3600;
  const base = path + (path.includes('?') ? '&' : '?') + 'exp=' + exp;
  return base + '&sig=' + mac(base);
}
export function verify(urlPath) {
  const i = urlPath.lastIndexOf('&sig='); if (i < 0) return false;
  const base = urlPath.slice(0, i), sig = urlPath.slice(i + 5);
  const exp = +(/[?&]exp=(\d+)/.exec(base)?.[1] || 0);
  return exp * 1000 > Date.now() && same(sig, mac(base));
}

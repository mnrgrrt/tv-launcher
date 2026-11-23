// Beveiliging: alleen gekoppelde tv's, beheer met pincode.
import crypto from 'node:crypto';
import { db } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, key_hash TEXT UNIQUE, created INTEGER, last_seen INTEGER, last_ip TEXT);`);
// Per apparaat: standaardprofiel (0 = geen, dan "Wie kijkt er?") en of wisselen mag.
try { db.exec('ALTER TABLE devices ADD COLUMN profile INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE devices ADD COLUMN locked INTEGER DEFAULT 0'); } catch {}
try { db.exec("ALTER TABLE devices ADD COLUMN ask TEXT DEFAULT 'samen'"); } catch {}   // vraag bij starten: altijd | samen | nooit
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
  const d = db.prepare('SELECT id, name, profile, locked, ask FROM devices WHERE key_hash = ?').get(sha(key));
  if (d) db.prepare('UPDATE devices SET last_seen = ?, last_ip = ? WHERE id = ?').run(Date.now(), ip, d.id);
  return d || null;
}
export const devices = () => db.prepare('SELECT id, name, created, last_seen, last_ip, profile, locked, ask FROM devices ORDER BY created').all().map(d => ({ ...d, locked: !!d.locked }));
export function setDevice(id, o) {
  const cur = db.prepare('SELECT name, profile, locked, ask FROM devices WHERE id = ?').get(+id); if (!cur) return;
  const ask = ['altijd', 'samen', 'nooit'].includes(o.ask) ? o.ask : cur.ask;
  db.prepare('UPDATE devices SET name = ?, profile = ?, locked = ?, ask = ? WHERE id = ?').run(
    o.name != null ? String(o.name).slice(0, 40) : cur.name, o.profile != null ? +o.profile : cur.profile, o.locked != null ? (o.locked ? 1 : 0) : cur.locked, ask, +id);
}
export const unpair = id => db.prepare('DELETE FROM devices WHERE id = ?').run(+id);

// ---------- beheerders: naam + wachtwoord, sessie via cookie ----------
db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE COLLATE NOCASE, hash TEXT, created INTEGER, last_login INTEGER);
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER, expires INTEGER, ip TEXT);
  CREATE TABLE IF NOT EXISTS log (at INTEGER, who TEXT, what TEXT);`);
const SESSION_DAYS = 30;

function hashPw(pw) { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); }
function checkPw(pw, stored) {
  const [salt, h] = (stored || ':').split(':');
  if (!salt || !h) return false;
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(got, Buffer.from(h, 'hex'));
}
const err = (msg, status) => Object.assign(new Error(msg), { status });
function goodPw(pw) { if (String(pw || '').length < 8) throw err('Wachtwoord moet minstens 8 tekens hebben', 400); }

export const hasUsers = () => db.prepare('SELECT COUNT(*) n FROM users').get().n > 0;
export const users = () => db.prepare('SELECT id, name, created, last_login FROM users ORDER BY name').all();

/** Eerste account: alleen zolang er nog geen is, en alleen met de pincode uit de installatie. */
export function setup(pin, name, pw, ip) {
  if (hasUsers()) throw err('Er is al een account', 403);
  if (tooMany(ip)) throw err('Te vaak geprobeerd, wacht een kwartier', 429);
  const want = process.env.THUIS_ADMIN_PIN || '';
  if (!want || !same(String(pin || ''), want)) { fail(ip); throw err('Pincode onjuist', 401); }
  addUser(name, pw);
  return login(name, pw, ip);
}
export function addUser(name, pw) {
  name = String(name || '').trim(); if (!name) throw err('Naam ontbreekt', 400); goodPw(pw);
  try { db.prepare('INSERT INTO users (name, hash, created) VALUES (?, ?, ?)').run(name, hashPw(String(pw)), Date.now()); }
  catch { throw err('Die naam bestaat al', 400); }
}
export function removeUser(id, me) {
  if (+id === me.id) throw err('Je kunt jezelf niet verwijderen', 400);
  db.prepare('DELETE FROM users WHERE id = ?').run(+id); db.prepare('DELETE FROM sessions WHERE user_id = ?').run(+id);
}
export function changePw(me, oldPw, newPw) {
  const u = db.prepare('SELECT hash FROM users WHERE id = ?').get(me.id);
  if (!checkPw(oldPw, u?.hash)) throw err('Huidig wachtwoord klopt niet', 400);
  goodPw(newPw); db.prepare('UPDATE users SET hash = ? WHERE id = ?').run(hashPw(String(newPw)), me.id);
}

export function login(name, pw, ip) {
  if (tooMany(ip)) throw err('Te vaak geprobeerd, wacht een kwartier', 429);
  const u = db.prepare('SELECT id, name, hash FROM users WHERE name = ?').get(String(name || '').trim());
  // Ook bij een onbekende naam rekenen, zodat je aan de tijd niet ziet of een naam bestaat.
  const ok = checkPw(String(pw || ''), u ? u.hash : hashPw('x'));
  if (!u || !ok) { fail(ip); throw err('Naam of wachtwoord klopt niet', 401); }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires, ip) VALUES (?, ?, ?, ?)').run(sha(token), u.id, Date.now() + SESSION_DAYS * 86400e3, ip);
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), u.id);
  return { token, name: u.name, maxAge: SESSION_DAYS * 86400 };
}
const cookie = (req, n) => { const m = new RegExp('(?:^|;\\s*)' + n + '=([a-f0-9]{64})').exec(req.headers.cookie || ''); return m ? m[1] : ''; };
export function userFor(req) {
  const t = cookie(req, 'tvs'); if (!t) return null;
  return db.prepare('SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?').get(sha(t), Date.now()) || null;
}
export function logout(req) { const t = cookie(req, 'tvs'); if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t)); }

export function audit(who, what) {
  db.prepare('INSERT INTO log (at, who, what) VALUES (?, ?, ?)').run(Date.now(), who, what);
  db.prepare('DELETE FROM log WHERE at < ?').run(Date.now() - 180 * 86400e3);
}
export const auditLog = () => db.prepare('SELECT at, who, what FROM log ORDER BY at DESC LIMIT 30').all();

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

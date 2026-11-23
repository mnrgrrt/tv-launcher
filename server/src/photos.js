// Eigen foto's in drie albums, te vullen op de beheerpagina.
// Album 1 staat ook bovenaan Thuis en begint met een startset (public/achtergrond).
// Albums 2 en 3 zijn alleen voor de schermbeveiliging. De tv krijgt alleen ondertekende links.
import fs from 'node:fs';
import path from 'node:path';
import { sign } from './auth.js';

const DATA = process.env.THUIS_DATA || '/data';
const SEED = path.resolve(new URL('../public/achtergrond', import.meta.url).pathname);
export const ALBUMS = [1, 2, 3];
const dir = n => path.join(DATA, n === 1 ? 'achtergrond' : 'album' + n);   // album 1 houdt zijn oude map
const index = n => path.join(dir(n), 'index.json');

for (const n of ALBUMS) {
  if (fs.existsSync(index(n))) continue;
  fs.mkdirSync(dir(n), { recursive: true });
  if (n === 1) for (const f of fs.readdirSync(SEED)) fs.copyFileSync(path.join(SEED, f), path.join(dir(n), f));
  else fs.writeFileSync(index(n), JSON.stringify({ photos: [] }));
}

const album = n => { n = +n; if (!ALBUMS.includes(n)) throw Object.assign(new Error('Onbekend album'), { status: 400 }); return n; };
const read = n => JSON.parse(fs.readFileSync(index(n), 'utf8'));
const write = (n, o) => fs.writeFileSync(index(n), JSON.stringify(o, null, 1));
const safe = f => /^[\w.-]+\.jpg$/.test(f || '');

export const list = (n = 1) => { n = album(n); return read(n).photos.map(p => ({ file: p.file, url: sign(`/foto/${n}/${p.file}`, 24), by: p.by })); };
export const counts = () => Object.fromEntries(ALBUMS.map(n => [n, read(n).photos.length]));

/** Pad van een foto voor /foto/<album>/<bestand>, of null. */
export function file(n, f) {
  if (!ALBUMS.includes(+n) || !safe(f)) return null;
  const p = path.join(dir(+n), f);
  return fs.existsSync(p) ? p : null;
}

/** Nieuwe foto (jpg, al verkleind door de beheerpagina). */
export function add(n, b64, by) {
  n = album(n);
  const buf = Buffer.from(String(b64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length || buf.length > 4 * 1024 * 1024) throw Object.assign(new Error('Foto te groot (max 4 MB)'), { status: 400 });
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw Object.assign(new Error('Alleen jpg'), { status: 400 });
  const f = `f${Date.now()}.jpg`;
  fs.writeFileSync(path.join(dir(n), f), buf);
  const o = read(n); o.photos.push({ file: f, by: String(by || '').trim().slice(0, 60) }); write(n, o);
  return list(n);
}
export function remove(n, f) {
  n = album(n);
  const o = read(n), i = o.photos.findIndex(p => p.file === f);
  if (i < 0) return list(n);
  if (n === 1 && o.photos.length <= 1) throw Object.assign(new Error('Album 1 staat ook bovenaan Thuis: er moet minstens één foto blijven'), { status: 400 });
  o.photos.splice(i, 1); write(n, o);
  if (safe(f)) fs.rmSync(path.join(dir(n), f), { force: true });
  return list(n);
}

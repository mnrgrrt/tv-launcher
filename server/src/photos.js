// Foto's bovenaan Thuis. Staan in /data/achtergrond, zodat je ze op de beheerpagina kunt toevoegen en weghalen.
// Bij de eerste start komt de startset uit public/achtergrond erin.
import fs from 'node:fs';
import path from 'node:path';

export const DIR = path.join(process.env.THUIS_DATA || '/data', 'achtergrond');
const SEED = path.resolve(new URL('../public/achtergrond', import.meta.url).pathname);
const INDEX = path.join(DIR, 'index.json');
if (!fs.existsSync(INDEX)) {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(SEED)) fs.copyFileSync(path.join(SEED, f), path.join(DIR, f));
}
const read = () => JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const write = o => fs.writeFileSync(INDEX, JSON.stringify(o, null, 1));

export const list = () => read().photos.map(p => ({ file: p.file, url: '/achtergrond/' + p.file, by: p.by }));

/** Nieuwe foto (jpg, al verkleind door de beheerpagina). */
export function add(b64, by) {
  const buf = Buffer.from(String(b64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length || buf.length > 4 * 1024 * 1024) throw Object.assign(new Error('Foto te groot (max 4 MB)'), { status: 400 });
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw Object.assign(new Error('Alleen jpg'), { status: 400 });
  const file = `f${Date.now()}.jpg`;
  fs.writeFileSync(path.join(DIR, file), buf);
  const o = read(); o.photos.push({ file, by: String(by || '').trim().slice(0, 60) }); write(o);
  return list();
}
export function remove(file) {
  const o = read(), i = o.photos.findIndex(p => p.file === file);
  if (i < 0) return list();
  if (o.photos.length <= 1) throw Object.assign(new Error('Er moet minstens één foto blijven'), { status: 400 });
  o.photos.splice(i, 1); write(o);
  if (/^[\w.-]+\.jpg$/.test(file)) fs.rmSync(path.join(DIR, file), { force: true });
  return list();
}

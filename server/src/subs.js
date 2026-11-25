// OpenSubtitles: zoeken en downloaden. De sleutel blijft op de server.
import fs from 'node:fs';
import path from 'node:path';
import { S } from './db.js';
import { json, http, enc } from './http.js';
import { tmdb } from './tmdb.js';

const API = 'https://api.opensubtitles.com/api/v1';
const DIR = path.join(process.env.THUIS_DATA || '/data', 'subs');
fs.mkdirSync(DIR, { recursive: true });
const H = () => ({ 'Api-Key': S('osKey'), 'User-Agent': 'Thuis v1.0', Accept: 'application/json', 'Content-Type': 'application/json' });
let token = { v: '', at: 0 };

async function login() {
  if (!S('osUser') || !S('osPass')) return '';
  if (token.v && Date.now() - token.at < 20 * 3600e3) return token.v;
  const r = await json(`${API}/login`, { method: 'POST', headers: H(), body: JSON.stringify({ username: S('osUser'), password: S('osPass') }), what: 'OpenSubtitles' });
  token = { v: r.token, at: Date.now() };
  return token.v;
}

/** Vingerafdruk van het bestand zoals OpenSubtitles die kent: lengte + som van de eerste en laatste 64 KB (64-bit woorden).
 *  Ondertitels met dezelfde vingerafdruk horen bij precies deze uitgave en lopen dus gelijk. */
const hashes = new Map();
export async function movieHash(url, headers = {}) {
  if (hashes.has(url)) return hashes.get(url);
  const K = 65536;
  const part = async range => {
    const r = await fetch(url, { headers: { ...headers, Range: range, 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(15e3) });
    if (r.status !== 206) throw new Error('Geen deelverzoek mogelijk');
    return { buf: Buffer.from(await r.arrayBuffer()), total: +String(r.headers.get('content-range') || '').split('/')[1] };
  };
  const a = await part(`bytes=0-${K - 1}`);
  if (!a.total || a.total < 2 * K || a.buf.length !== K) throw new Error('Bestand te klein');
  const b = await part(`bytes=${a.total - K}-${a.total - 1}`);
  let h = BigInt(a.total);
  for (const buf of [a.buf, b.buf]) for (let i = 0; i + 8 <= buf.length; i += 8) h = (h + buf.readBigUInt64LE(i)) & 0xffffffffffffffffn;
  const hex = h.toString(16).padStart(16, '0');
  hashes.set(url, hex); if (hashes.size > 300) hashes.delete(hashes.keys().next().value);
  return hex;
}

export async function search({ kind, title, tmdbId, season, episode, languages = 'nl,en', hash = '' }) {
  if (!S('osKey')) return [];
  let id = +tmdbId || 0;
  if (!id && S('tmdbToken')) id = ((await tmdb(`/search/${kind === 'series' ? 'tv' : 'movie'}?query=${enc(title)}&language=nl-NL`).catch(() => ({}))).results || [])[0]?.id || 0;
  let q = `/subtitles?languages=${languages}&order_by=download_count`;
  if (kind === 'series') { q += id ? `&parent_tmdb_id=${id}` : `&query=${enc(title)}`; if (season) q += `&season_number=${season}`; if (episode) q += `&episode_number=${episode}`; }
  else q += id ? `&tmdb_id=${id}` : `&query=${enc(title)}`;
  // Met vingerafdruk: ondertitels voor precies dit bestand komen bovenaan (per taal), daarna de meest gedownloade.
  const o = await json(API + q + (/^[0-9a-f]{16}$/.test(hash) ? `&moviehash=${hash}` : ''), { headers: H(), what: 'OpenSubtitles' });
  return (o?.data || []).map(d => d.attributes).filter(a => a.files?.[0])
    .sort((x, y) => (y.moviehash_match ? 1 : 0) - (x.moviehash_match ? 1 : 0) || (y.download_count || 0) - (x.download_count || 0)).slice(0, 10).map(a => ({
      fileId: a.files[0].file_id, lang: a.language, release: a.release || a.files[0].file_name || '', downloads: a.download_count, hearing: !!a.hearing_impaired, match: !!a.moviehash_match }));
}

/** Eén download (kost dagtegoed), daarna bewaard. Geeft de srt-tekst terug. */
export async function download(fileId) {
  const f = path.join(DIR, `${+fileId}.srt`);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const tok = await login().catch(() => '');
  const h = H(); if (tok) h.Authorization = 'Bearer ' + tok;
  const r = await json(`${API}/download`, { method: 'POST', headers: h, body: JSON.stringify({ file_id: +fileId, sub_format: 'srt' }), what: 'OpenSubtitles' });
  if (!r?.link) throw new Error('Geen downloadlink');
  const txt = await http(r.link, { what: 'ondertitel' });
  fs.writeFileSync(f, txt);
  return txt;
}

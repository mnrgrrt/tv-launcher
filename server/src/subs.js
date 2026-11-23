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

export async function search({ kind, title, tmdbId, season, episode, languages = 'nl,en' }) {
  if (!S('osKey')) return [];
  let id = +tmdbId || 0;
  if (!id && S('tmdbToken')) id = ((await tmdb(`/search/${kind === 'series' ? 'tv' : 'movie'}?query=${enc(title)}&language=nl-NL`).catch(() => ({}))).results || [])[0]?.id || 0;
  let q = `/subtitles?languages=${languages}&order_by=download_count`;
  if (kind === 'series') { q += id ? `&parent_tmdb_id=${id}` : `&query=${enc(title)}`; if (season) q += `&season_number=${season}`; if (episode) q += `&episode_number=${episode}`; }
  else q += id ? `&tmdb_id=${id}` : `&query=${enc(title)}`;
  const o = await json(API + q, { headers: H(), what: 'OpenSubtitles' });
  return (o?.data || []).map(d => d.attributes).filter(a => a.files?.[0]).slice(0, 10).map(a => ({
    fileId: a.files[0].file_id, lang: a.language, release: a.release || a.files[0].file_name || '', downloads: a.download_count, hearing: !!a.hearing_impaired }));
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

// Streams en plaatjes doorgeven, zodat wachtwoorden en tokens op de server blijven.
import { Readable } from 'node:stream';
import { S } from './db.js';
import { enc } from './http.js';
import { streamUrl } from './xtream.js';
import { photoUrl } from './plex.js';

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control'];

export async function pipe(req, res, url, extraHeaders = {}) {
  const ctl = new AbortController();
  req.on('close', () => ctl.abort());
  const headers = { ...extraHeaders };
  if (req.headers.range) headers.Range = req.headers.range;
  let up;
  try { up = await fetch(url, { headers, signal: ctl.signal, redirect: 'follow' }); }
  catch (e) { if (!res.headersSent) { res.writeHead(502); res.end('Bron niet bereikbaar'); } return; }
  const out = {};
  PASS.forEach(h => { const v = up.headers.get(h); if (v) out[h] = v; });
  res.writeHead(up.status, out);
  if (!up.body || req.method === 'HEAD') return res.end();
  Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
}

/** /stream/live/123 · /stream/movie/123.mkv · /stream/series/123.mkv · /stream/plex?p=/library/parts/... */
export function target(path, q) {
  let m;
  if ((m = /^\/stream\/live\/(\d+)$/.exec(path))) return { url: streamUrl(m[1]) };
  if ((m = /^\/stream\/timeshift\/(\d+)\/(\d{4}-\d{2}-\d{2}:\d{2}-\d{2})\/(\d{1,4})$/.exec(path)))
    return { url: `${S('server')}/timeshift/${enc(S('user'))}/${enc(S('pass'))}/${m[3]}/${m[2]}/${m[1]}.ts` };
  if ((m = /^\/stream\/(movie|series)\/(\d+)\.(\w{2,5})$/.exec(path)))
    return { url: `${S('server')}/${m[1]}/${enc(S('user'))}/${enc(S('pass'))}/${m[2]}.${m[3]}` };
  if (path === '/stream/plex') {
    const p = q.get('p') || '';
    if (!/^\/library\/(parts|streams)\//.test(p)) return null;     // alleen bestanden, niets anders uit Plex
    return { url: S('plexUrl') + p, headers: { 'X-Plex-Token': S('plexToken') } };
  }
  if (path === '/img/plex') {
    const u = q.get('u') || '';
    if (!/^\/library\//.test(u)) return null;
    return { url: photoUrl(u, +q.get('w') || 300, +q.get('h') || 450) };
  }
  return null;
}

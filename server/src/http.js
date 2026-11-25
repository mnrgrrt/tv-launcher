// Hulpjes voor uitgaande verzoeken.
export async function http(url, opt = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opt.timeout || 20000);
  try {
    const r = await fetch(url, { method: opt.method || 'GET', headers: opt.headers || {}, body: opt.body, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) {
      // De melding van de dienst zelf erbij (bv. OMDb: "Request limit reached!"), kort en zonder adressen.
      let why = ''; try { const j = JSON.parse(text); why = String(j.Error || j.error || j.message || j.status_message || ''); } catch {}
      why = why.replace(/\w+:\/\/\S+/g, '').trim().slice(0, 80);
      throw new Error(`fout ${r.status}${opt.what ? ' bij ' + opt.what : ''}${why ? ': ' + why : ''}`);
    }
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('time-out' + (opt.what ? ' bij ' + opt.what : ''));
    // "fetch failed" zegt niets: geef de echte oorzaak (bv. ECONNREFUSED, ENOTFOUND) en het adres zonder wachtwoord.
    if (e.cause) throw new Error(`${opt.what || 'verbinding'} niet bereikbaar (${e.cause.code || e.cause.message}) op ${url.replace(/\?.*$/, '').replace(/\/\/[^/]*@/, '//')}`);
    throw e;
  } finally { clearTimeout(t); }
}
export async function json(url, opt) { const t = await http(url, opt); return t ? JSON.parse(t) : null; }
export const enc = encodeURIComponent;

/** Maximaal n tegelijk. */
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch { out[k] = null; } } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
export function b64(s) {
  if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/=\s]+$/.test(s)) return s || '';
  try { const d = Buffer.from(s, 'base64').toString('utf8'); return /[\u0000-\u0008�]/.test(d) ? s : d; } catch { return s; }
}
/** Zonder accenten, kleine letters: voor zoeken en vergelijken. */
export function plain(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

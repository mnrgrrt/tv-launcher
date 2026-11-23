// Dispatcharr (Xtream Codes): zenders, gids, films en series.
import { S, cached } from './db.js';
import { json, enc, b64, pool } from './http.js';

export function configured() { return !!(S('server') && S('user') && S('pass')); }
export function api(action, extra = '') {
  if (!configured()) return Promise.reject(new Error('Dispatcharr is nog niet ingesteld'));
  return json(`${S('server')}/player_api.php?username=${enc(S('user'))}&password=${enc(S('pass'))}` +
    (action ? `&action=${action}` : '') + extra, { timeout: 60000, what: 'Dispatcharr' });
}

let live = { at: 0, channels: [], cats: {} };
export async function channels(force = false) {
  if (!force && live.channels.length && Date.now() - live.at < 6 * 3600e3) return live;
  const cats = await api('get_live_categories').catch(() => []);
  const map = {}; (cats || []).forEach(c => { map[c.category_id] = c.category_name; });
  const arr = await api('get_live_streams');
  const list = (arr || []).map((o, i) => ({
    id: +o.stream_id, num: +(o.num || i + 1), name: o.name || '', icon: o.stream_icon || '', cat: String(o.category_id || ''),
    epgId: o.epg_channel_id || '', archive: o.tv_archive == 1 ? Math.max(1, +o.tv_archive_duration || 1) : 0
  })).sort((a, b) => a.num - b.num);
  live = { at: Date.now(), channels: list, cats: map };
  return live;
}

export function streamUrl(id) { return `${S('server')}/live/${enc(S('user'))}/${enc(S('pass'))}/${id}.${S('format') || 'ts'}`; }

export async function shortEpg(id, limit = 2) {
  const o = await api('get_short_epg', `&stream_id=${id}&limit=${limit}`);
  const now = Date.now();
  return ((o && o.epg_listings) || []).map(e => ({
    title: b64(e.title), desc: b64(e.description), start: (+e.start_timestamp || 0) * 1000, end: (+e.stop_timestamp || 0) * 1000
  })).filter(p => !p.end || p.end > now);
}

/** Nu/straks voor een rij zenders: eerst uit de eigen gids-index, anders kort opvragen. */
export async function nowNext(list, fromIndex) {
  const out = {};
  const missing = [];
  for (const ch of list) { const p = fromIndex ? fromIndex(ch) : null; if (p && p.length) out[ch.id] = p; else missing.push(ch); }
  const res = await pool(missing, 8, ch => shortEpg(ch.id, 2));
  missing.forEach((ch, i) => { out[ch.id] = res[i] || []; });
  return out;
}

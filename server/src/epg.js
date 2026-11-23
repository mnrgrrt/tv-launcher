// De hele gids (XMLTV van Dispatcharr) in de database, zodat zoeken en nu/straks snel zijn.
import { db, S } from './db.js';
import { http, enc, plain } from './http.js';
import { channels, configured } from './xtream.js';

// Plaatje per programma (als de gids er een heeft), voor de tegels bij Nu live.
try { db.exec('ALTER TABLE programmes ADD COLUMN img TEXT'); } catch {}

let status = { at: 0, count: 0, error: '' };
export function epgStatus() { return status; }

const unesc = s => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').trim();
// XMLTV-tijd: 20261123203000 +0100
function t(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/.exec(s || ''); if (!m) return 0;
  const tz = m[7] ? (m[7][0] === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(3)) : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - tz * 60000;
}

let retries = 0, retryTimer = null;
const KEEP_DAYS = 8;   // een week terug, plus een dag marge

export async function refresh() {
  if (!configured()) return;
  clearTimeout(retryTimer);
  try {
    const xml = await http(`${S('server')}/xmltv.php?username=${enc(S('user'))}&password=${enc(S('pass'))}`, { timeout: 300000, what: 'gids' });
    const from = Date.now() - KEEP_DAYS * 86400e3, until = Date.now() + 7 * 86400e3;
    const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    const attr = (a, n) => { const m = new RegExp(n + '="([^"]*)"').exec(a); return m ? m[1] : ''; };
    const tag = (b, n) => { const m = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`).exec(b); return m ? unesc(m[1]) : ''; };
    const rows = [], first = new Map();
    let m;
    while ((m = re.exec(xml))) {
      const start = t(attr(m[1], 'start')), stop = t(attr(m[1], 'stop')), ch = attr(m[1], 'channel');
      if (!ch || stop < from || start > until) continue;
      const title = tag(m[2], 'title'), desc = tag(m[2], 'desc'), cat = [...m[2].matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/g)].map(x => unesc(x[1])).join(', ');
      const icon = /<icon\b[^>]*src="(https?:[^"]+)"/.exec(m[2]);
      rows.push([ch, start, stop, title, desc, cat, plain(`${title} ${cat} ${desc}`), icon ? unesc(icon[1]) : '']);
      if (!first.has(ch) || start < first.get(ch)) first.set(ch, start);
    }
    if (!rows.length) throw new Error('gids is leeg');
    // Oude programma's bewaren: per zender alleen vervangen vanaf het eerste programma in de nieuwe gids.
    const del = db.prepare('DELETE FROM programmes WHERE channel = ? AND start >= ?');
    const ins = db.prepare('INSERT INTO programmes (channel, start, stop, title, descr, cat, plain, img) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    for (const [ch, start] of first) del.run(ch, start);
    for (const r of rows) ins.run(...r);
    db.prepare('DELETE FROM programmes WHERE stop < ?').run(from);
    db.exec('COMMIT');
    const total = db.prepare('SELECT COUNT(*) n, MIN(start) oldest FROM programmes').get();
    status = { at: Date.now(), count: total.n, oldest: total.oldest, fresh: rows.length, error: '' };
    retries = 0;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    status = { ...status, error: e.message, failedAt: Date.now() };
    // Bijvoorbeeld net na een herstart, als Dispatcharr nog niet klaar is: over 2 minuten opnieuw.
    if (retries++ < 15) retryTimer = setTimeout(refresh, 120e3);
  }
}

/** Nu en straks voor één zender uit de index (leeg als de zender geen gids-id heeft). */
export function nowNextFor(ch) {
  if (!ch.epgId) return null;
  const rows = db.prepare('SELECT title, descr, start, stop, img FROM programmes WHERE channel = ? AND stop > ? ORDER BY start LIMIT 2').all(ch.epgId, Date.now());
  return rows.map(r => ({ title: r.title, desc: r.descr, start: r.start, end: r.stop, img: r.img || '' }));
}

// Onderwerpen: één woord zoekt ook op bekende namen. Die namen tellen alleen in de titel of de categorie,
// want in omschrijvingen staan ze te vaak terloops. Woorden met een dubbele betekenis staan er bewust niet in.
const TOPICS = {
  wielrennen: ['wielren', 'cycling', 'tour de france', 'giro', 'vuelta', 'veldrit', 'cyclocross', 'parijs-roubaix'],
  voetbal: ['voetbal', 'football', 'soccer', 'eredivisie', 'champions league', 'premier league', 'la liga', 'serie a', 'bundesliga', 'europa league', 'keuken kampioen'],
  basketbal: ['basketbal', 'basketball', 'nba', 'euroleague'],
  formule1: ['formule 1', 'formula 1', 'f1', 'grand prix'],
  tennis: ['tennis', 'atp', 'wta', 'roland garros', 'wimbledon', 'us open', 'australian open'],
  darts: ['darts', 'pdc'],
  schaatsen: ['schaats', 'speed skating'],
  muziek: ['muziek', 'music', 'videoclip', 'concert', 'top 40'],
  nieuws: ['nieuws', 'journaal', 'news'],
  documentaire: ['documentaire', 'documentary', 'docu']
};
const ALIAS = { basketball: 'basketbal', f1: 'formule1', clips: 'muziek' };
/** Bij welk onderwerp hoort deze zoekvraag? Ook als hij nog niet af is ("wielrenne"). */
export function topic(q) {
  const p = plain(q).replace(/\s+/g, '');
  if (ALIAS[p]) return TOPICS[ALIAS[p]];
  if (TOPICS[p]) return TOPICS[p];
  if (p.length < 5) return null;
  const k = Object.keys(TOPICS).find(k => k.startsWith(p) || p.startsWith(k));
  return k ? TOPICS[k] : null;
}

/** Zoeken in de gids: zenders, nu live, straks en terugkijken. Beste treffers eerst, dubbele uitzendingen één keer. */
export async function searchGuide(q) {
  const lit = plain(q).trim(), syn = topic(q) || [];
  if (lit.length < 2) return { channels: [], live: [], later: [], past: [] };
  const { channels: all } = await channels();
  const byEpg = new Map(); all.forEach(ch => { if (ch.epgId && !byEpg.has(ch.epgId)) byEpg.set(ch.epgId, ch); });
  const synSql = syn.map(() => '(lower(title) LIKE ? OR lower(cat) LIKE ?)').join(' OR ');
  const now = Date.now();
  const rows = db.prepare(`SELECT channel, start, stop, title, descr, cat, img FROM programmes WHERE (plain LIKE ?${synSql ? ' OR ' + synSql : ''}) AND stop > ? AND start < ? LIMIT 1500`)
    .all(`%${lit}%`, ...syn.flatMap(w => [`%${w}%`, `%${w}%`]), now - 7 * 86400e3, now + 2 * 86400e3);
  const score = r => {
    const t = plain(r.title), c = plain(r.cat);
    if (t.includes(lit)) return 4;
    if (syn.some(w => t.includes(w))) return 3;
    if (c.includes(lit) || syn.some(w => c.includes(w))) return 2;
    return 1;
  };
  const groups = { live: [], later: [], past: [] }, seen = new Map();
  for (const r of rows) {
    const ch = byEpg.get(r.channel); if (!ch) continue;
    const live = r.start <= now && r.stop > now, later = r.start > now, past = !live && !later;
    if (past && !(ch.archive && r.start > now - ch.archive * 86400e3)) continue;
    // Zelfde programma op meerdere zenders (bijvoorbeeld HD en gewoon): één regel, laagste zendernummer.
    const k = plain(r.title) + '|' + r.start, have = seen.get(k);
    if (have) { have.more++; if (ch.num < have.num) Object.assign(have, { channel: ch.id, num: ch.num, name: ch.name, icon: ch.icon, archive: ch.archive }); continue; }
    const item = { channel: ch.id, num: ch.num, name: ch.name, icon: ch.icon, archive: ch.archive, title: r.title, desc: r.descr, cat: r.cat, img: r.img || '',
      start: r.start, end: r.stop, score: score(r), more: 0 };
    seen.set(k, item); groups[live ? 'live' : later ? 'later' : 'past'].push(item);
  }
  groups.live.sort((a, b) => b.score - a.score || a.num - b.num);
  groups.later.sort((a, b) => b.score - a.score || a.start - b.start);
  groups.past.sort((a, b) => b.score - a.score || b.start - a.start);
  const chans = all.filter(ch => plain(ch.name).includes(lit)).slice(0, 30)
    .map(ch => ({ channel: ch.id, num: ch.num, name: ch.name, icon: ch.icon, archive: ch.archive }));
  return { channels: chans, live: groups.live.slice(0, 60), later: groups.later.slice(0, 60), past: groups.past.slice(0, 60) };
}

/** Gids voor een rij zenders in een tijdvak (voor het rooster in de app). */
export function grid(epgIds, from, to) {
  if (!epgIds.length) return {};
  const q = db.prepare(`SELECT channel, start, stop, title, descr, cat FROM programmes WHERE channel IN (${epgIds.map(() => '?').join(',')}) AND stop > ? AND start < ? ORDER BY start`);
  const out = {};
  for (const r of q.all(...epgIds, from, to)) (out[r.channel] = out[r.channel] || []).push({ title: r.title, desc: r.descr, cat: r.cat, start: r.start, end: r.stop });
  return out;
}

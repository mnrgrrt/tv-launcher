// De hele gids (XMLTV van Dispatcharr) in de database, zodat zoeken en nu/straks snel zijn.
import { db, S } from './db.js';
import { http, enc, plain } from './http.js';
import { channels, configured } from './xtream.js';

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

export async function refresh() {
  if (!configured()) return;
  try {
    const xml = await http(`${S('server')}/xmltv.php?username=${enc(S('user'))}&password=${enc(S('pass'))}`, { timeout: 300000, what: 'gids' });
    const from = Date.now() - 3 * 86400e3, until = Date.now() + 3 * 86400e3;
    const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    const attr = (a, n) => { const m = new RegExp(n + '="([^"]*)"').exec(a); return m ? m[1] : ''; };
    const tag = (b, n) => { const m = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`).exec(b); return m ? unesc(m[1]) : ''; };
    const ins = db.prepare('INSERT INTO programmes (channel, start, stop, title, descr, cat, plain) VALUES (?, ?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN'); db.exec('DELETE FROM programmes');
    let m, n = 0;
    while ((m = re.exec(xml))) {
      const start = t(attr(m[1], 'start')), stop = t(attr(m[1], 'stop'));
      if (stop < from || start > until) continue;
      const title = tag(m[2], 'title'), desc = tag(m[2], 'desc'), cat = [...m[2].matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/g)].map(x => unesc(x[1])).join(', ');
      ins.run(attr(m[1], 'channel'), start, stop, title, desc, cat, plain(`${title} ${cat} ${desc}`));
      n++;
    }
    db.exec('COMMIT');
    status = { at: Date.now(), count: n, error: '' };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    status = { ...status, error: e.message };
  }
}

/** Nu en straks voor één zender uit de index (leeg als de zender geen gids-id heeft). */
export function nowNextFor(ch) {
  if (!ch.epgId) return null;
  const rows = db.prepare('SELECT title, descr, start, stop FROM programmes WHERE channel = ? AND stop > ? ORDER BY start LIMIT 2').all(ch.epgId, Date.now());
  return rows.map(r => ({ title: r.title, desc: r.descr, start: r.start, end: r.stop }));
}

// Onderwerpen: één woord zoekt ook op de bekende namen eromheen.
const TOPICS = {
  wielrennen: ['wielren', 'cycling', 'tour de france', 'giro', 'vuelta', 'veldrit', 'cyclocross', 'klassieker', 'parijs-roubaix', 'ronde van'],
  voetbal: ['voetbal', 'football', 'soccer', 'eredivisie', 'champions league', 'premier league', 'la liga', 'serie a', 'bundesliga', 'europa league', 'kkd', 'keuken kampioen'],
  basketbal: ['basketbal', 'basketball', 'nba', 'euroleague'],
  basketball: ['basketbal', 'basketball', 'nba', 'euroleague'],
  formule1: ['formule 1', 'formula 1', 'f1', 'grand prix', 'grande premio'],
  f1: ['formule 1', 'formula 1', ' f1', 'grand prix'],
  tennis: ['tennis', 'atp', 'wta', 'roland garros', 'wimbledon', 'us open', 'australian open'],
  darts: ['darts', 'pdc'],
  schaatsen: ['schaats', 'speed skating', 'world cup schaatsen'],
  muziek: ['muziek', 'music', 'clips', 'videoclip', 'concert', 'hits', 'top 40'],
  clips: ['clips', 'videoclip', 'music video', 'hits'],
  nieuws: ['nieuws', 'journaal', 'news'],
  documentaire: ['documentaire', 'documentary', 'docu']
};
export function terms(q) {
  const p = plain(q).trim();
  return TOPICS[p.replace(/\s+/g, '')] || [p];
}

/** Zoeken in de gids: nu live, straks, terugkijken. */
export async function searchGuide(q) {
  const words = terms(q);
  if (!words.length || !words[0]) return { live: [], later: [], past: [] };
  const { channels: all } = await channels();
  const byEpg = new Map(); all.forEach(ch => { if (ch.epgId && !byEpg.has(ch.epgId)) byEpg.set(ch.epgId, ch); });
  const where = words.map(() => 'plain LIKE ?').join(' OR ');
  const now = Date.now();
  const rows = db.prepare(`SELECT channel, start, stop, title, descr, cat FROM programmes WHERE (${where}) AND stop > ? AND start < ? ORDER BY start LIMIT 400`)
    .all(...words.map(w => `%${w}%`), now - 3 * 86400e3, now + 3 * 86400e3);
  const live = [], later = [], past = [];
  for (const r of rows) {
    const ch = byEpg.get(r.channel); if (!ch) continue;
    const item = { channel: ch.id, num: ch.num, name: ch.name, icon: ch.icon, title: r.title, desc: r.descr, cat: r.cat, start: r.start, end: r.stop, archive: ch.archive };
    if (r.start <= now && r.stop > now) live.push(item);
    else if (r.start > now) { if (r.start < now + 2 * 86400e3) later.push(item); }
    else if (ch.archive && r.start > now - ch.archive * 86400e3) past.push(item);
  }
  past.reverse();
  // Ook zenders zelf op naam
  const p = plain(q);
  const chans = all.filter(ch => plain(ch.name).includes(p)).slice(0, 30)
    .map(ch => ({ channel: ch.id, num: ch.num, name: ch.name, icon: ch.icon }));
  return { channels: chans, live: live.slice(0, 40), later: later.slice(0, 40), past: past.slice(0, 40) };
}

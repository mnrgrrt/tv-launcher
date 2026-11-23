// Slimme zenderindeling, zelfde regels als altijd (shared/categories.json op GitHub).
import fs from 'node:fs';
import { http } from './http.js';
import { channels } from './xtream.js';

const RULES_URL = 'https://raw.githubusercontent.com/mnrgrrt/tv-launcher/main/shared/categories.json';
const LOCAL = new URL('../../shared/categories.json', import.meta.url);
const DROP = new Set(['nl', 'be', 'vl', 'uk', 'hd', 'fhd', 'uhd', 'sd', '4k', 'hevc', 'h265', 'h264', '50fps', 'backup', 'raw']);

export function norm(name) {
  return (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(t => t && !DROP.has(t)).join('');
}
const matches = (n, p) => (p = p.toLowerCase(), p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : n === p);

let rules = null, rulesAt = 0;
async function loadRules() {
  if (rules && Date.now() - rulesAt < 3600e3) return rules;
  try { rules = JSON.parse(await http(RULES_URL, { timeout: 6000 })); }
  catch { rules = rules || JSON.parse(fs.readFileSync(LOCAL, 'utf8')); }
  rulesAt = Date.now();
  return rules;
}

export async function build() {
  const { channels: all, cats: groupNames } = await channels();
  const r = await loadRules();
  const normed = all.map(c => [c, norm(c.name)]);
  const out = [];
  for (const c of r.categories || []) {
    const inc = c.include || [], exc = c.exclude || [], groups = (c.groups || []).map(g => g.toLowerCase());
    const picked = [], seen = new Set();
    const ok = n => !exc.some(e => matches(n, e));
    const add = ch => { if (!seen.has(ch.id)) { seen.add(ch.id); picked.push(ch); } };
    for (const p of inc) {
      const hits = normed.filter(([, n]) => matches(n, p) && ok(n)).map(([ch]) => ch);
      if (p.endsWith('*')) hits.forEach(add); else { const h = hits.find(ch => !seen.has(ch.id)); if (h) add(h); }
    }
    if (groups.length) {
      const ids = new Set(Object.keys(groupNames).filter(id => groups.some(g => groupNames[id].toLowerCase().includes(g))));
      normed.forEach(([ch, n]) => { if (ids.has(ch.cat) && ok(n)) add(ch); });
    }
    out.push({ id: c.id, name: c.name, img: c.img || '', channels: picked, parent: c.parent || null, last: !!c.last });
  }
  for (const parent of out.filter(p => !p.parent)) {
    const kids = out.filter(k => k.parent === parent.id);
    if (!kids.length) continue;
    const inKids = new Set(kids.flatMap(k => k.channels.map(ch => ch.id)));
    const merged = [...parent.channels], m = new Set(merged.map(ch => ch.id));
    kids.forEach(k => k.channels.forEach(ch => { if (!m.has(ch.id)) { m.add(ch.id); merged.push(ch); } }));
    parent.channels = merged;
    out.push({ id: parent.id + '-overig', name: 'Overige ' + parent.name.toLowerCase(), img: parent.img, parent: parent.id,
      channels: merged.filter(ch => !inKids.has(ch.id)) });
  }
  if (r.alle !== false) out.push({ id: 'alle', name: 'Alle zenders', img: 'aurora', channels: all });
  return out;
}

// Het verhaal van een film of serie uit de Nederlandse Wikipedia (CC BY-SA: Thuis toont "Bron: Wikipedia").
// Via Wikidata: TMDB geeft het Wikidata-nummer, Wikidata het Nederlandse artikel.
import { cached } from './db.js';
import { json, enc } from './http.js';

const UA = { 'User-Agent': 'tv-serverr/1.0 (Thuis, eigen gebruik)' };
const STORY = /^(verhaal|verhaallijn|plot|inhoud|synopsis|samenvatting)$/i;
const MAX = 1800;

/** Netjes inkorten op een zinseinde. */
function cut(t) {
  if (t.length <= MAX) return t;
  const s = t.slice(0, MAX), end = Math.max(s.lastIndexOf('. '), s.lastIndexOf('.\n'));
  return end > MAX / 2 ? s.slice(0, end + 1) : s.trimEnd() + '…';
}

/** { text, url } of null. Een maand bewaard. */
export function story(qid) {
  if (!/^Q\d{1,12}$/.test(qid || '')) return Promise.resolve(null);
  return cached('wiki:' + qid, 30 * 86400e3, async () => {
    const w = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=nlwiki&ids=${qid}`, { headers: UA, what: 'Wikidata' });
    const title = w?.entities?.[qid]?.sitelinks?.nlwiki?.title; if (!title) return null;
    const r = await json(`https://nl.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&redirects=1&titles=${enc(title)}`, { headers: UA, what: 'Wikipedia' });
    const page = Object.values(r?.query?.pages || {})[0], all = page?.extract || ''; if (!all) return null;
    // Opdelen in hoofdstukken ("== Verhaal =="). Het verhaal als dat er is, anders de inleiding.
    const parts = all.split(/\n(={2,})\s*(.+?)\s*\1\n/);
    let text = parts[0];
    for (let i = 1; i < parts.length; i += 3) {
      if (parts[i].length !== 2 || !STORY.test(parts[i + 1])) continue;
      text = parts[i + 2];
      // Ondertitels (=== ... ===) horen erbij, tot het volgende hoofdstuk.
      for (let j = i + 3; j < parts.length && parts[j].length > 2; j += 3) text += '\n' + parts[j + 2];
      break;
    }
    text = text.replace(/\n{2,}/g, '\n\n').trim();
    return text.length > 80 ? { text: cut(text), url: 'https://nl.wikipedia.org/wiki/' + enc(title.replace(/ /g, '_')) } : null;
  });
}

// Fanart per seizoen van fanart.tv (alleen series). De sleutels staan alleen op de server.
// fanart.tv werkt met het TVDB-nummer; dat geeft TMDB al mee.
import { S, cached } from './db.js';
import { json } from './http.js';

/** Werkt de sleutel? Proef op Breaking Bad (TVDB 81189), zonder het tussengeheugen. Voor de beheerpagina. */
export async function test() {
  if (!S('fanartKey')) return { ok: false, error: 'Er is nog geen projectsleutel ingevuld' };
  const headers = { 'api-key': S('fanartKey') };
  if (S('fanartClient')) headers['client-key'] = S('fanartClient');
  try {
    const r = await json('https://webservice.fanart.tv/v3/tv/81189', { headers, what: 'fanart.tv' });
    const bg = r.showbackground || [];
    return { ok: true, backgrounds: bg.length, perSeason: bg.filter(b => +b.season > 0).length };
  } catch (e) { return { ok: false, error: /40[13]/.test(e.message) ? 'fanart.tv weigert de sleutel (staat de projectsleutel in het goede veld?)' : e.message }; }
}

/** { <seizoen>: url } met de best gewaardeerde achtergrond per seizoen. Leeg als er niets is. Een week bewaard. */
export function seasons(tvdb) {
  if (!S('fanartKey') || !(+tvdb > 0)) return Promise.resolve({});
  return cached('fanart:tv:' + +tvdb, 7 * 86400e3, async () => {
    const headers = { 'api-key': S('fanartKey') };
    if (S('fanartClient')) headers['client-key'] = S('fanartClient');
    const r = await json('https://webservice.fanart.tv/v3/tv/' + +tvdb, { headers, what: 'fanart.tv' }).catch(e => { if (/404/.test(e.message)) return {}; throw e; });
    const best = {};
    for (const b of r.showbackground || []) {
      const n = +b.season; if (!(n > 0) || !/^https:\/\//.test(b.url || '')) continue;   // "all" = voor de hele serie: niet per seizoen
      if (!best[n] || +b.likes > +best[n].likes) best[n] = b;
    }
    return Object.fromEntries(Object.entries(best).map(([n, b]) => [n, b.url]));
  });
}

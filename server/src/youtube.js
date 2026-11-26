// YouTube: live streams, aangekondigde streams en gewone video's zoeken. Elke zoekvraag aan YouTube kost 100 punten
// van de 10.000 per dag (hier drie: 300 punten), dus elke zoekopdracht wordt een half uur bewaard.
import { S, cached } from './db.js';
import { json, enc, plain } from './http.js';

const API = 'https://www.googleapis.com/youtube/v3';
const get = path => json(`${API}${path}&key=${enc(S('youtubeKey'))}`, { what: 'YouTube' });
const vid = it => ({ id: it.id.videoId, title: unesc(it.snippet.title), channel: unesc(it.snippet.channelTitle), thumb: it.snippet.thumbnails?.high?.url || it.snippet.thumbnails?.medium?.url || '' });
// Lengte uit "PT1H2M3S" naar seconden.
const secs = d => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || '') || []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };
const unesc = s => (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function search(q) {
  if (!S('youtubeKey')) return Promise.resolve({ live: [], upcoming: [], videos: [] });
  return cached('yt:' + plain(q).trim(), 30 * 60e3, async () => {
    const base = `/search?part=snippet&type=video&maxResults=15&relevanceLanguage=nl&q=${enc(q)}`;
    const [live, soon, any] = await Promise.all([get(base + '&eventType=live'), get(base + '&eventType=upcoming'), get(base)]);
    const l = (live.items || []).map(vid), u = (soon.items || []).map(vid);
    // Gewone video's: zonder de streams die al bij live of straks staan.
    const seen = new Set([...l, ...u].map(x => x.id));
    const v = (any.items || []).filter(it => it.snippet.liveBroadcastContent === 'none' && !seen.has(it.id.videoId))
      .map(it => ({ ...vid(it), published: Date.parse(it.snippet.publishedAt || '') || 0 }));
    const ids = [...l, ...u, ...v].map(x => x.id).join(',');
    // Eén aanvraag (1 punt) voor kijkers, begintijd en lengte.
    const det = ids ? await get(`/videos?part=liveStreamingDetails,contentDetails&id=${ids}`).catch(() => ({ items: [] })) : { items: [] };
    const d = new Map((det.items || []).map(x => [x.id, x]));
    l.forEach(x => { x.viewers = +(d.get(x.id)?.liveStreamingDetails?.concurrentViewers || 0); });
    u.forEach(x => { x.start = Date.parse(d.get(x.id)?.liveStreamingDetails?.scheduledStartTime || '') || 0; });
    v.forEach(x => { x.duration = secs(d.get(x.id)?.contentDetails?.duration); });
    return { live: l, upcoming: u.filter(x => x.start > Date.now() - 3600e3).sort((a, b) => a.start - b.start), videos: v };
  });
}

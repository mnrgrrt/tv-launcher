// YouTube: live streams en aangekondigde streams zoeken. Een zoekopdracht kost 100 punten van de 10.000 per dag,
// dus elke zoekopdracht wordt een half uur bewaard.
import { S, cached } from './db.js';
import { json, enc, plain } from './http.js';

const API = 'https://www.googleapis.com/youtube/v3';
const get = path => json(`${API}${path}&key=${enc(S('youtubeKey'))}`, { what: 'YouTube' });
const vid = it => ({ id: it.id.videoId, title: unesc(it.snippet.title), channel: unesc(it.snippet.channelTitle), thumb: it.snippet.thumbnails?.high?.url || it.snippet.thumbnails?.medium?.url || '' });
const unesc = s => (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function search(q) {
  if (!S('youtubeKey')) return Promise.resolve({ live: [], upcoming: [] });
  return cached('yt:' + plain(q).trim(), 30 * 60e3, async () => {
    const base = `/search?part=snippet&type=video&maxResults=15&relevanceLanguage=nl&q=${enc(q)}`;
    const [live, soon] = await Promise.all([get(base + '&eventType=live'), get(base + '&eventType=upcoming')]);
    const l = (live.items || []).map(vid), u = (soon.items || []).map(vid);
    const ids = [...l, ...u].map(x => x.id).join(',');
    const det = ids ? await get(`/videos?part=liveStreamingDetails&id=${ids}`).catch(() => ({ items: [] })) : { items: [] };
    const d = new Map((det.items || []).map(x => [x.id, x.liveStreamingDetails || {}]));
    l.forEach(x => { x.viewers = +(d.get(x.id)?.concurrentViewers || 0); });
    u.forEach(x => { x.start = Date.parse(d.get(x.id)?.scheduledStartTime || '') || 0; });
    return { live: l, upcoming: u.filter(x => x.start > Date.now() - 3600e3).sort((a, b) => a.start - b.start) };
  });
}

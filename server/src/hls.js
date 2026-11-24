// Omzetten naar HLS, voor spelers die mkv en losse IPTV-streams niet zelf kunnen afspelen (Safari op iPad en iPhone),
// en later voor databesparing onderweg (laag = 720p). Eén ffmpeg per kijker, alleen zolang er echt gekeken wordt.
import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(os.tmpdir(), 'sjuul-hls');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
const sessions = new Map();   // id -> { proc, dir, dev, seen }
const MAX = 4;                // meer tegelijk trekt de server niet netjes
const IDLE = 60e3;            // een minuut niets opgevraagd: kijker is weg, ffmpeg stopt

const hdrArgs = h => (h && Object.keys(h).length ? ['-headers', Object.entries(h).map(([k, v]) => `${k}: ${v}\r\n`).join('')] : []);

function probe(url, headers) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-analyzeduration', '3000000', '-probesize', '3000000', ...hdrArgs(headers),
      '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', url], { timeout: 20e3 }, (e, out) => {
      if (e) return reject(Object.assign(new Error('Bron niet te openen'), { status: 502 }));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('Bron onleesbaar')); }
    });
  });
}

function kill(id) {
  const s = sessions.get(id); if (!s) return;
  sessions.delete(id);
  try { s.proc.kill('SIGKILL'); } catch {}
  fs.rm(s.dir, { recursive: true, force: true }, () => {});
}

/** Start omzetten. live: lopende zender (korte lijst die doorschuift); anders film of aflevering vanaf `from` seconden. */
export async function start({ url, headers, live, from = 0, dev, low }) {
  for (const [id, s] of sessions) if (s.dev === dev) kill(id);   // per apparaat één tegelijk
  if (sessions.size >= MAX) kill([...sessions.entries()].sort((a, b) => a[1].seen - b[1].seen)[0][0]);
  const info = await probe(url, headers);
  const v = (info.streams || []).find(s => s.codec_type === 'video'), a = (info.streams || []).find(s => s.codec_type === 'audio');
  const copyV = !low && v && ['h264', 'hevc'].includes(v.codec_name);
  const id = crypto.randomBytes(16).toString('hex'), dir = path.join(ROOT, id);
  fs.mkdirSync(dir);
  const args = ['-hide_banner', '-loglevel', 'error', ...(live || !from ? [] : ['-ss', String(Math.max(0, +from))]), ...hdrArgs(headers), '-i', url,
    '-map', '0:v:0?', '-map', '0:a:0?',
    ...(copyV ? ['-c:v', 'copy', ...(v.codec_name === 'hevc' ? ['-tag:v', 'hvc1'] : [])]
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-g', '50', ...(low ? ['-vf', 'scale=-2:min(720\\,ih)', '-b:v', '1800k', '-maxrate', '2000k', '-bufsize', '4000k'] : ['-crf', '21'])]),
    ...(a && a.codec_name === 'aac' && !low ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', low ? '128k' : '192k', '-ac', '2']),
    '-f', 'hls', '-hls_time', live ? '4' : '6', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
    ...(live ? ['-hls_list_size', '15', '-hls_flags', 'delete_segments+independent_segments'] : ['-hls_playlist_type', 'event', '-hls_flags', 'independent_segments']),
    '-hls_segment_filename', path.join(dir, 's%05d.m4s'), path.join(dir, 'index.m3u8')];
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '', done = false;
  proc.stderr.on('data', d => { err = (err + d).slice(-400); });
  proc.on('exit', () => { done = true; });
  sessions.set(id, { proc, dir, dev, seen: Date.now() });
  // Wachten tot de eerste stukjes klaar staan, anders geeft de speler meteen op.
  const list = path.join(dir, 'index.m3u8');
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(list) && /\.m4s/.test(fs.readFileSync(list, 'utf8'))) return { id, dur: live ? 0 : Math.round(+(info.format || {}).duration || 0) };
    if (done) break;
    await new Promise(r => setTimeout(r, 200));
  }
  kill(id);
  throw Object.assign(new Error('Omzetten lukt niet' + (err ? ': ' + err.trim().split('\n').pop() : '')), { status: 502 });
}

export const stop = (id, dev) => { const s = sessions.get(id); if (s && s.dev === dev) kill(id); };

/** Bestand van een sessie; het lange willekeurige nummer is de sleutel en vervalt zodra er niet meer gekeken wordt. */
export function file(id, name) {
  const s = sessions.get(id);
  if (!s || !/^(index\.m3u8|init\.mp4|s\d{5}\.m4s)$/.test(name)) return null;
  s.seen = Date.now();
  const f = path.join(s.dir, name);
  return fs.existsSync(f) ? f : null;
}

setInterval(() => { for (const [id, s] of sessions) if (Date.now() - s.seen > IDLE) kill(id); }, 15e3).unref();
export const stopAll = () => { for (const id of [...sessions.keys()]) kill(id); };

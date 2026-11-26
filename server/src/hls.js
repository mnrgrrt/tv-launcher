// Omzetten naar HLS, voor spelers die mkv en losse IPTV-streams niet zelf kunnen afspelen (Safari op iPad en iPhone),
// en later voor databesparing onderweg (laag = 720p). Eén ffmpeg per kijker, alleen zolang er echt gekeken wordt.
import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSrt, toSrt } from './subsync.js';

// Op schijf in de datamap, niet in /tmp: dat is in de container een RAM-schijf, en een film kan gigabytes zijn.
const ROOT = path.join(process.env.THUIS_DATA || os.tmpdir(), 'hls');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
const sessions = new Map();   // id -> { proc, dir, dev, seen, live }
const MAX = 4;                // meer tegelijk trekt de server niet netjes
const IDLE = 60e3;            // live: een minuut niets opgevraagd, dan is de kijker weg en stopt ffmpeg
const IDLE_VOD = 20 * 60e3;   // film of aflevering: op pauze vraagt de speler niets, dus langer bewaren

const hdrArgs = h => (h && Object.keys(h).length ? ['-headers', Object.entries(h).map(([k, v]) => `${k}: ${v}\r\n`).join('')] : []);

// De bron soms even niet te openen (aanbieder bij terugkijken, Dispatcharr net bezet): nog twee keer proberen.
async function probe(url, headers) {
  for (let i = 0; ; i++) {
    try { return await probeOnce(url, headers); }
    catch (e) { if (i >= 2) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
}
function probeOnce(url, headers) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-analyzeduration', '3000000', '-probesize', '3000000', ...hdrArgs(headers),
      '-show_entries', 'stream=codec_type,codec_name,channels:stream_tags=language,title:format=duration,format_name', '-of', 'json', url], { timeout: 20e3 }, (e, out) => {
      if (e) return reject(Object.assign(new Error('Bron niet te openen'), { status: 502 }));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('Bron onleesbaar')); }
    });
  });
}

/** Het sleutelbeeld vlak voor `sec` (in seconden vanaf het begin van de film). Leest maar één pakketje; null als het niet lukt. */
let kfLast = '';   // waarom het laatste opzoeken mislukte (zonder adressen), voor foutzoeken via /api/hls/start
function keyframeBefore(url, headers, sec) {
  const t0 = Date.now();
  return new Promise(resolve => {
    execFile('ffprobe', ['-v', 'error', ...hdrArgs(headers), '-select_streams', 'v:0', '-read_intervals', `${sec}%+#1`,
      '-show_entries', 'packet=pts_time:format=start_time', '-of', 'json', url], { timeout: 15e3 }, (e, out, errOut) => {
      const why = m => { kfLast = (m + ' ' + String(errOut || '').replace(/\w+:\/\/\S+/g, 'ADRES').trim().slice(-200) + ' ' + (Date.now() - t0) + 'ms').trim(); resolve(null); };
      if (e) return why('fout' + (e.killed ? ' (te lang)' : ''));
      try {
        const j = JSON.parse(out), pts = +((j.packets || [])[0] || {}).pts_time, st = +((j.format || {}).start_time) || 0;
        if (!Number.isFinite(pts)) return why('geen pakket: ' + String(out).replace(/\s+/g, ' ').slice(0, 120));
        kfLast = 'ok ' + (Date.now() - t0) + 'ms'; resolve(pts - st);
      } catch { why('onleesbaar'); }
    });
  });
}

function kill(id) {
  const s = sessions.get(id); if (!s) return;
  sessions.delete(id);
  try { if (s.proc) s.proc.kill('SIGKILL'); } catch {}
  fs.rm(s.dir, { recursive: true, force: true }, () => {});
}

// Geluids- en ondertitelsporen van een bron, voor de keuzes in de speler. Tekstondertitels kunnen eruit gehaald worden.
const TEXT = ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'];
function trackList(info) {
  const st = info.streams || [], t = s => s.tags || {};
  return {
    audio: st.filter(s => s.codec_type === 'audio').map(s => ({ lang: t(s).language || '', title: t(s).title || '', codec: s.codec_name || '', channels: s.channels || 0 })),
    subs: st.filter(s => s.codec_type === 'subtitle').map((s, i) => ({ i, lang: t(s).language || '', title: t(s).title || '', text: TEXT.includes(s.codec_name) }))
  };
}
const probes = new Map();   // bron -> { at, info }: niet elke keer opnieuw meten
async function probeCached(url, headers) {
  const c = probes.get(url); if (c && Date.now() - c.at < 30 * 60e3) return c.info;
  const info = await probe(url, headers); probes.set(url, { at: Date.now(), info });
  if (probes.size > 200) probes.delete(probes.keys().next().value);
  return info;
}
export const tracks = async (url, headers) => trackList(await probeCached(url, headers));

/** Eén tekstondertitel uit het bestand als srt. Bewaard, want het hele bestand doorlezen kost even. */
/** Een stuk van een tekstondertitel uit het bestand (vanaf `start` s, `len` s lang), met de echte tijden.
 *  Om andere ondertitels gelijk te zetten: zo hoeft niet het hele bestand gelezen te worden. */
export function subPart(url, headers, i, start, len) {
  return new Promise(resolve => {
    // -ss en -t vóór -i (alleen dit stuk lezen); -copyts houdt de echte tijden in de film aan.
    execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...(start > 0 ? ['-ss', String(start)] : []), '-t', String(len), ...hdrArgs(headers), '-i', url,
      '-copyts', '-map', '0:s:' + (+i), '-f', 'srt', 'pipe:1'], { timeout: 60e3, maxBuffer: 8e6 }, (e, out) => resolve(e ? '' : String(out)));
  });
}
/** Sporen (geluid, ondertitels) en lengte, voor het gelijkzetten van ondertitels. */
export async function mediaInfo(url, headers) { const info = await probeCached(url, headers); return { ...trackList(info), dur: +(info.format || {}).duration || 0 }; }

export function subText(url, headers, i) {
  const f = path.join(ROOT, 'sub-' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '-' + (+i) + '.srt');
  if (fs.existsSync(f)) return Promise.resolve(fs.readFileSync(f, 'utf8'));
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...hdrArgs(headers), '-i', url, '-map', '0:s:' + (+i), '-f', 'srt', f], { timeout: 180e3 }, e => {
      if (e || !fs.existsSync(f)) return reject(Object.assign(new Error('Ondertitels uit het bestand lukken niet'), { status: 502 }));
      resolve(fs.readFileSync(f, 'utf8'));
    });
  });
}

/** Start omzetten. live: lopende zender (korte lijst die doorschuift); anders film of aflevering vanaf `from` seconden.
 *  audio: welk geluidsspoor (0 = eerste). */
export async function start({ url, headers, live, from = 0, dev, low, audio = 0, hevc = false, ts = false }) {
  let killed = false;
  for (const [id, s] of sessions) if (s.dev === dev) { kill(id); killed = true; }   // per apparaat één tegelijk
  if (sessions.size >= MAX) kill([...sessions.entries()].sort((a, b) => a[1].seen - b[1].seen)[0][0]);
  // Net een verbinding gestopt (spoelen, ander geluidsspoor)? Even wachten: Dispatcharr kapt anders soms de nieuwe verbinding af.
  if (killed && !live) await new Promise(r => setTimeout(r, 1000));
  const info = live ? await probe(url, headers) : await probeCached(url, headers);
  const auds = (info.streams || []).filter(s => s.codec_type === 'audio'), ai = Math.min(Math.max(0, +audio || 0), Math.max(0, auds.length - 1));
  const v = (info.streams || []).find(s => s.codec_type === 'video'), a = auds[ai];
  const dur = live ? 0 : +(info.format || {}).duration || 0;
  const isFile = !live && /matroska|mov|mp4/.test((info.format || {}).format_name || '');
  // HEVC alleen kopiëren als de browser het zelf kan afspelen (iPad wel, Chrome zonder grafische kaart niet), en alleen uit een
  // filmbestand: uit een tv-stream mist ffmpeg dan de beeldinstellingen (PPS) en komt er niets uit. Dan omzetten naar H.264.
  // Samsung (ts): geen HEVC kopiëren; die oude tv speelt HEVC-in-TS niet zeker af, dus naar H.264 omzetten (of H.264 kopiëren).
  const copyV = !low && v && (v.codec_name === 'h264' || (!ts && v.codec_name === 'hevc' && hevc && isFile));

  // Film of aflevering halverwege: het gekopieerde beeld kan alleen bij een sleutelbeeld beginnen. Daar beginnen we dan ook,
  // zodat de tijd in de speler (en de ondertitels) klopt. Lukt het opzoeken niet (bij IPTV soms), dan ook het geluid bij het
  // sleutelbeeld laten beginnen: anders zit er een gat aan het begin en slaat de browser het eerste stukje over.
  let loose = false;
  if (!live && from > 0 && copyV) {
    const k = await keyframeBefore(url, headers, from);
    if (k != null && k >= 0 && k <= from && from - k < 30) from = Math.round(k * 1000) / 1000; else loose = true;
  }
  // Tekstondertitels meelezen in dezelfde ffmpeg (Nederlands en Engels eerst, max 12). Een aparte verbinding om ze uit het
  // bestand te halen gaat niet: Dispatcharr staat per film maar één verbinding toe en kapt dan de film af.
  const subIdx = live ? [] : trackList(info).subs.filter(x => x.text)
    .sort((x, y) => (/^(nl|nld|dut|en|eng)$/.test(y.lang) ? 1 : 0) - (/^(nl|nld|dut|en|eng)$/.test(x.lang) ? 1 : 0)).slice(0, 12).map(x => x.i);
  const id = crypto.randomBytes(16).toString('hex'), dir = path.join(ROOT, id);
  fs.mkdirSync(dir);
  // Eén ffmpeg-ronde. Film of aflevering: stopt de bron te vroeg (verbinding afgekapt), dan gaat een nieuwe ronde verder waar
  // de vorige ophield. Elke ronde heeft eigen bestanden (r0.m3u8, r0init.mp4, r0s00000.m4s ...);
  // file() maakt daar één lijst van. Live: één ronde met index.m3u8.
  const pre = k => live ? '' : 'r' + k;
  const args = (k, at, loose) => ['-hide_banner', '-loglevel', 'error',
    ...(live || !at ? [] : ['-ss', String(Math.max(0, +at)), ...(loose ? ['-noaccurate_seek'] : [])]),
    // Filmbestand: niet de hele film in een paar minuten binnenhalen. Eerst 30 s in één keer, daarna 4x de kijksnelheid.
    // Niet bij tv-streams (terugkijken): daar rekent de rem met rare tijdstempels en staat alles bijna stil.
    ...(isFile ? ['-readrate', '4', '-readrate_initial_burst', '30'] : []), ...hdrArgs(headers), '-i', url,
    '-map', '0:v:0?', '-map', '0:a:' + ai + '?',
    ...(copyV ? ['-c:v', 'copy', ...(v.codec_name === 'hevc' ? ['-tag:v', 'hvc1'] : [])]
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-g', '50', '-pix_fmt', 'yuv420p',   // 8-bit: 10-bit H.264 speelt in geen enkele browser
         ...(low ? ['-vf', 'scale=-2:min(720\\,ih)', '-b:v', '1800k', '-maxrate', '2000k', '-bufsize', '4000k'] : ['-vf', 'scale=-2:min(1080\\,ih)', '-crf', '21'])]),
    // Geluid altijd opnieuw naar AAC: bij kopiëren uit een tv-stream mist soms het precieze AAC-type in het init-bestand
    // (mp4a.40 in plaats van mp4a.40.2), en dan weigert Chrome het hele stuk. Opnieuw coderen kost bijna niets.
    '-c:a', 'aac', '-b:a', low ? '128k' : '192k', '-ac', '2',
    '-f', 'hls', '-hls_time', live ? '4' : '6',
    // Samsung (ts): gewone MPEG-TS stukjes, want deze oude Frame speelt geen fMP4-HLS af. Anders fMP4 (voor de browser).
    // Geen edit list bij fMP4: browsers negeren die, en dan loopt het geluid voor op het beeld. Zo staat de echte begintijd in de stukjes.
    ...(ts ? ['-hls_segment_type', 'mpegts']
           : ['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', pre(k) + 'init.mp4', '-hls_segment_options', 'use_editlist=0']),
    // Live: de laatste 30 minuten bewaren (450 stukjes van 4 s), zodat pauzeren en even terug kan zonder de aanbieder.
    ...(live ? ['-hls_list_size', '450', '-hls_flags', 'delete_segments+independent_segments'] : ['-hls_playlist_type', 'event', '-hls_flags', 'independent_segments']),
    '-hls_segment_filename', path.join(dir, pre(k) + (ts ? 's%05d.ts' : 's%05d.m4s')), path.join(dir, live ? 'index.m3u8' : pre(k) + '.m3u8'),
    // De ondertitels als losse srt-bestanden per ronde (tijden vanaf het begin van die ronde). flush_packets: meteen wegschrijven,
    // anders blijven ze tot het eind in een buffer en ziet de speler niets. avoid_negative_ts uit: anders schuift een zin die net
    // voor het startpunt begon alle tijden op.
    ...subIdx.flatMap(i => ['-map', '0:s:' + i, '-c:s', 'srt', '-flush_packets', '1', '-avoid_negative_ts', 'disabled', '-f', 'srt', path.join(dir, `${pre(k)}sub${i}.srt`)])];
  const s = { dir, dev, seen: Date.now(), live: !!live, ts: !!ts, err: '', final: false, rounds: 0, log: [], url, subIdx, at: [] };
  sessions.set(id, s);
  const run = (k, at, loose) => {
    s.at[k] = +at || 0;
    const proc = spawn('ffmpeg', args(k, at, loose), { stdio: ['ignore', 'ignore', 'pipe'] });
    s.proc = proc;
    proc.stderr.on('data', d => { s.err = (s.err + d).slice(-400); });
    proc.on('exit', code => {
      if (sessions.get(id) !== s || s.proc !== proc) return;   // gestopt of vervangen
      // Waarom deze ronde stopte (zonder adressen), voor foutzoeken: komt mee in het antwoord van /api/hls/start.
      s.log.push(`ronde ${k}: code ${code}, ${String(s.err).replace(/\w+:\/\/\S+/g, 'ADRES').trim().split('\n').slice(-2).join(' / ').slice(0, 200)}`); s.err = '';
      if (live) { s.final = true; return; }
      const made = segments(s).reduce((t, x) => t + x.len, 0);
      // Nog niet aan het eind (meer dan 15 s over) en niet te vaak geprobeerd: verder waar we waren. Beeld en geluid allebei
      // vanaf het sleutelbeeld (anders weer een gat aan het begin); de paar seconden die dan dubbel zijn nemen we voor lief.
      if (dur && from + made < dur - 15 && s.rounds < 8) {
        setTimeout(() => { if (sessions.get(id) === s) { s.rounds++; run(s.rounds, from + made, true); } }, 1500);
        return;
      }
      s.final = true;
    });
  };
  run(0, from, loose);
  // Wachten tot er genoeg stukjes klaar staan. Bij film of aflevering drie: met maar één stukje slaat Chrome het begin over
  // of geeft hij een leesfout (vooral als het beeld omgezet wordt en dat langzamer gaat).
  // Komt de bron langzaam binnen (terugkijken), dan na 8 s ook met minder stukjes beginnen.
  const need = live || !isFile ? 1 : 3;   // tv-stream (terugkijken): komt langzaam binnen, met één stukje beginnen
  for (let i = 0; i < 200; i++) {
    if (i >= 40 && (live ? 0 : segments(s).length) >= 1) return { id, start: live ? 0 : from, dur: Math.round(dur), audio: trackList(info).audio, audioIndex: ai };
    const n = live ? ((read(path.join(dir, 'index.m3u8')).match(/\.m4s/g) || []).length) : segments(s).length;
    if (n >= need || (s.final && n)) return { id, start: live ? 0 : from, dur: Math.round(dur), audio: trackList(info).audio, audioIndex: ai, kf: kfLast, rondes: s.log };
    if (s.final || (s.rounds > 2 && !n)) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const err = s.err;
  kill(id);
  throw Object.assign(new Error('Omzetten lukt niet' + (err ? ': ' + err.trim().split('\n').pop() : '')), { status: 502 });
}

/**
 * Ondertitel uit een lopende film-sessie (meegelezen door ffmpeg), met de echte tijden in de film.
 * done = false: de film komt nog binnen, de speler haalt later het volgende stuk op. null als er geen sessie is.
 */
export function sessionSub(url, i) {
  for (const s of sessions.values()) {
    if (s.live || s.url !== url || !s.subIdx.includes(+i)) continue;
    let cues = [];
    for (let k = 0; k <= s.rounds; k++) {
      const add = parseSrt(read(path.join(s.dir, `r${k}sub${+i}.srt`))).map(c => ({ s: c.s + s.at[k], e: c.e + s.at[k], t: c.t }));
      const last = cues.length ? cues[cues.length - 1].s : -1;
      cues = cues.concat(add.filter(c => c.s > last + 0.05));   // na een nieuwe ronde: dubbele zinnen weg
    }
    return { text: toSrt(cues), done: s.final, cues: cues.length };
  }
  return null;
}

const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
/** Alle stukjes van een film-sessie, ronde na ronde: { k, len, uri }. */
function segments(s) {
  const out = [];
  for (let k = 0; k <= s.rounds; k++) {
    const lines = read(path.join(s.dir, 'r' + k + '.m3u8')).split('\n');
    for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('#EXTINF:') && /\.(m4s|ts)$/.test(lines[i + 1] || '')) out.push({ k, len: +lines[i].slice(8).split(',')[0], uri: lines[i + 1].trim() });
  }
  return out;
}
/** Eén lijst voor de speler. Na een nieuwe ronde: DISCONTINUITY (de tijden beginnen daar opnieuw) en het init-bestand van die ronde. */
function playlist(s) {
  const segs = segments(s), td = Math.max(6, ...segs.map(x => Math.ceil(x.len)));
  // TS (Samsung): versie 3, geen init-bestand, geen nieuwere tags (oude AVPlay-parser). fMP4 (browser): versie 7 met een EXT-X-MAP per ronde.
  const out = ['#EXTM3U', '#EXT-X-VERSION:' + (s.ts ? 3 : 7), '#EXT-X-TARGETDURATION:' + td, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:EVENT'];
  if (!s.ts) out.push('#EXT-X-INDEPENDENT-SEGMENTS');
  let k = -1;
  for (const x of segs) {
    if (x.k !== k) { if (k >= 0) out.push('#EXT-X-DISCONTINUITY'); if (!s.ts) out.push(`#EXT-X-MAP:URI="r${x.k}init.mp4"`); k = x.k; }
    out.push('#EXTINF:' + x.len.toFixed(6) + ',', x.uri);
  }
  if (s.final) out.push('#EXT-X-ENDLIST');
  return out.join('\n') + '\n';
}

export const stop = (id, dev) => { const s = sessions.get(id); if (s && s.dev === dev) kill(id); };

/** Bestand van een sessie; het lange willekeurige nummer is de sleutel en vervalt zodra er niet meer gekeken wordt. */
export function file(id, name) {
  const s = sessions.get(id);
  if (!s || !/^(index\.m3u8|(r\d+)?init\.mp4|(r\d+)?s\d{5}\.(m4s|ts))$/.test(name)) return null;
  s.seen = Date.now();
  if (name === 'index.m3u8' && !s.live) return { list: playlist(s), live: false, ts: s.ts };
  const f = path.join(s.dir, name);
  return fs.existsSync(f) ? { f, live: s.live } : null;
}

setInterval(() => { for (const [id, s] of sessions) if (Date.now() - s.seen > (s.live ? IDLE : IDLE_VOD)) kill(id); }, 15e3).unref();
export const stopAll = () => { for (const id of [...sessions.keys()]) kill(id); };

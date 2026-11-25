// Ondertitels van buiten (OpenSubtitles) gelijkzetten met een ondertitel die in het bestand zelf zit.
// Die laatste loopt per definitie gelijk met het beeld. We zoeken een vaste verschuiving en eventueel een snelheidsverschil
// (23,976 / 24 / 25 beelden per seconde), en schuiven daarmee de hele ondertitel.

/** srt -> [{ s, e, t }] in seconden. */
export function parseSrt(txt) {
  const out = [], re = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/;
  const blocks = String(txt || '').replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n'), k = lines.findIndex(l => re.test(l)); if (k < 0) continue;
    const m = re.exec(lines[k]), sec = (h, mi, se, ms) => +h * 3600 + +mi * 60 + +se + +ms.padEnd(3, '0').slice(0, 3) / 1000;
    out.push({ s: sec(m[1], m[2], m[3], m[4]), e: sec(m[5], m[6], m[7], m[8]), t: lines.slice(k + 1).join('\n') });
  }
  return out;
}

function stamp(x) {
  x = Math.max(0, x); const ms = Math.round(x * 1000), h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export function toSrt(cues) { return cues.map((c, i) => `${i + 1}\n${stamp(c.s)} --> ${stamp(c.e)}\n${c.t}\n`).join('\n'); }

const SCALES = [1, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24, 25 / 24, 24 / 25];

/**
 * Beste schaal en verschuiving: nieuwe tijd = oude tijd * scale + offset.
 * ref = begintijden uit het bestand (gelijk met het beeld), ext = begintijden van de ondertitel die we willen gelijkzetten.
 * Geeft null als er geen duidelijke overeenkomst is.
 */
export function fit(ref, ext) {
  if (ref.length < 8 || ext.length < 8) return null;
  const R = [...ref].sort((a, b) => a - b);
  const near = (x, tol) => { let lo = 0, hi = R.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (R[mid] < x) lo = mid + 1; else hi = mid; }
    return [R[lo], R[lo - 1]].some(r => r != null && Math.abs(r - x) <= tol); };
  let best = null;
  for (const scale of SCALES) {
    // Alle verschillen tussen een zin in het bestand en een zin van buiten (binnen 60 s), per 0,1 s geteld.
    const votes = new Map();
    for (const e of ext) { const x = e * scale; for (const r of R) { const d = r - x; if (d < -60) continue; if (d > 60) break; const k = Math.round(d * 10); votes.set(k, (votes.get(k) || 0) + 1); } }
    for (const [k, n] of votes) {
      const v = n + (votes.get(k - 1) || 0) + (votes.get(k + 1) || 0);
      if (!best || v > best.v) best = { v, scale, offset: k / 10 };
    }
  }
  if (!best) return null;
  // Telling: van de zinnen van buiten die na het schuiven in de gemeten stukken vallen, hoeveel liggen binnen 0,3 s op een zin
  // uit het bestand? Bij toeval is dat rond 30%, bij een echte overeenkomst 70% of meer. We eisen 55% en minstens 10 zinnen.
  const ranges = []; for (const r of R) { const l = ranges[ranges.length - 1]; if (l && r - l[1] < 300) l[1] = r; else ranges.push([r, r]); }
  const inside = ext.map(e => e * best.scale + best.offset).filter(x => ranges.some(([a, b]) => x >= a - 2 && x <= b + 2));
  const hits = inside.filter(x => near(x, 0.3)).length;
  if (hits < 10 || hits < 0.55 * Math.min(inside.length, R.length)) return null;
  // Verfijnen: gemiddelde afwijking van de treffers.
  const diffs = [];
  for (const e of ext) { const x = e * best.scale + best.offset; let bd = null; for (const r of R) { const d = r - x; if (Math.abs(d) <= 0.3 && (bd == null || Math.abs(d) < Math.abs(bd))) bd = d; } if (bd != null) diffs.push(bd); }
  diffs.sort((a, b) => a - b);
  const med = diffs[diffs.length >> 1] || 0;
  return { scale: best.scale, offset: Math.round((best.offset + med) * 1000) / 1000, hits, of: inside.length };
}

export function shift(cues, f) { return cues.map(c => ({ s: c.s * f.scale + f.offset, e: c.e * f.scale + f.offset, t: c.t })); }

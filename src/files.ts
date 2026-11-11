import { BAR, Clip, GM_DRUMS, Note, Project, Track, emptyDrums, newTrack, uid } from './types';

// ---------- Archive ZIP (sans compression) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(d: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder(), parts: BlobPart[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data);
    const head = (sig: number, extra: number) => {
      const b = new DataView(new ArrayBuffer(extra)); let o = 0;
      const u16 = (v: number) => { b.setUint16(o, v, true); o += 2; }, u32 = (v: number) => { b.setUint32(o, v, true); o += 4; };
      u32(sig); if (sig === 0x02014b50) u16(20);
      u16(20); u16(0x0800); u16(0); u16(0); u16(0x21); u32(crc); u32(f.data.length); u32(f.data.length); u16(name.length); u16(0);
      if (sig === 0x02014b50) { u16(0); u16(0); u16(0); u32(0); u32(offset); }
      return new Uint8Array(b.buffer);
    };
    const local = head(0x04034b50, 30);
    parts.push(local as BlobPart, name as BlobPart, f.data as BlobPart);
    const c = new Uint8Array(46 + name.length); c.set(head(0x02014b50, 46)); c.set(name, 46); central.push(c);
    offset += local.length + name.length + f.data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), end.buffer], { type: 'application/zip' });
}

// ---------- MIDI ----------
const PPQ = 480, TICK = PPQ / 4; // un pas = une double-croche

/** Déroule les clips d'une piste en notes absolues (position et durée en pas). */
export function flatten(tr: Track): Note[] {
  const out: Note[] = [];
  for (const c of tr.clips) for (let s = 0; s < c.len; s++) {
    const local = (s + c.offset) % (c.patLen ?? BAR);
    if (c.drums) c.drums.forEach((row, r) => { if (row[local]) out.push({ p: GM_DRUMS[r], s: c.start + s, l: 1, v: row[local] }); });
    for (const n of c.notes ?? []) if (n.s === local) out.push({ p: n.p + (tr.synth?.octave ?? 0) * 12, s: c.start + s, l: Math.min(n.l, c.len - s), v: n.v });
  }
  return out;
}

function vlq(n: number): number[] {
  const b = [n & 0x7f];
  while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80);
  return b;
}
function chunk(id: string, data: number[]): number[] {
  const n = data.length;
  return [...id].map(c => c.charCodeAt(0)).concat([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255], data);
}
const meta = (type: number, data: number[]) => [0, 0xff, type, ...vlq(data.length), ...data];
const text = (s: string) => [...new TextEncoder().encode(s)];

/** Fichier MIDI standard (format 1) : une piste par piste batterie ou instrument. */
export function exportMidi(p: Project): Uint8Array {
  const us = Math.round(60e6 / p.bpm);
  const tracks = [chunk('MTrk', [...meta(0x03, text(p.name)), ...meta(0x51, [us >> 16, (us >> 8) & 255, us & 255]), ...meta(0x2f, [])])];
  let ch = 0;
  for (const tr of p.tracks) {
    if (tr.type === 'audio') continue;
    const channel = tr.type === 'drums' ? 9 : (ch === 9 ? ++ch : ch) % 16;
    if (tr.type !== 'drums') ch++;
    const ev: { t: number; d: number[] }[] = [];
    for (const n of flatten(tr)) {
      const pitch = Math.max(0, Math.min(127, n.p));
      ev.push({ t: n.s * TICK, d: [0x90 | channel, pitch, Math.max(1, Math.round(n.v * 127))] });
      ev.push({ t: (n.s + n.l) * TICK - 1, d: [0x80 | channel, pitch, 0] });
    }
    ev.sort((a, b) => a.t - b.t || a.d[0] - b.d[0]);
    const data = meta(0x03, text(tr.name)); let last = 0;
    for (const e of ev) { data.push(...vlq(e.t - last), ...e.d); last = e.t; }
    data.push(...meta(0x2f, []));
    tracks.push(chunk('MTrk', data));
  }
  return new Uint8Array([...chunk('MThd', [0, 1, tracks.length >> 8, tracks.length & 255, PPQ >> 8, PPQ & 255]), ...tracks.flat()]);
}

/** Lit un fichier MIDI : renvoie le tempo et une piste par couple piste/canal contenant des notes. */
export function importMidi(buf: ArrayBuffer): { bpm: number | null; tracks: Track[] } {
  const d = new DataView(buf), u = new Uint8Array(buf);
  const tag = (o: number) => String.fromCharCode(...u.subarray(o, o + 4));
  if (tag(0) !== 'MThd') throw new Error('invalid');
  const div = d.getUint16(12);
  if (div & 0x8000) throw new Error('invalid');
  const toStep = (tick: number) => Math.round(tick / (div / 4));
  let o = 8 + d.getUint32(4), bpm: number | null = null;
  const out: Track[] = [];
  while (o + 8 <= u.length) {
    const id = tag(o), len = d.getUint32(o + 4), end = o + 8 + len; o += 8;
    if (id !== 'MTrk') { o = end; continue; }
    let tick = 0, status = 0, name = '';
    const open = new Map<number, { t: number; v: number }>(), notes = new Map<number, Note[]>();
    const rv = () => { let v = 0, b; do { b = u[o++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && o < end); return v; };
    while (o < end) {
      tick += rv();
      let st = u[o];
      if (st & 0x80) o++; else st = status;
      if (st === 0xff) {
        const type = u[o++], l = rv();
        if (type === 0x51 && bpm === null) bpm = Math.round(60e6 / ((u[o] << 16) | (u[o + 1] << 8) | u[o + 2]));
        if (type === 0x03) name = new TextDecoder().decode(u.subarray(o, o + l));
        o += l; continue;
      }
      if (st === 0xf0 || st === 0xf7) { o += rv(); continue; }
      status = st;
      const cmd = st & 0xf0, chn = st & 0x0f, a = u[o++], b = cmd === 0xc0 || cmd === 0xd0 ? 0 : u[o++];
      const key = chn * 128 + a;
      if (cmd === 0x90 && b > 0) open.set(key, { t: tick, v: b / 127 });
      else if (cmd === 0x80 || cmd === 0x90) {
        const on = open.get(key);
        if (on) {
          open.delete(key);
          const s = toStep(on.t), list = notes.get(chn) ?? [];
          list.push({ p: a, s, l: Math.max(1, toStep(tick) - s), v: Math.round(on.v * 100) / 100 }); notes.set(chn, list);
        }
      }
    }
    o = end;
    for (const [chn, list] of notes) {
      const drums = chn === 9, tr = newTrack(drums ? 'drums' : 'synth', out.length + 1, 'keys');
      if (name) tr.name = name.slice(0, 40);
      const len = Math.max(BAR, Math.ceil(Math.max(...list.map(n => n.s + n.l)) / BAR) * BAR);
      const clip: Clip = { id: uid(), name: tr.name, start: 0, len, offset: 0, patLen: len };
      if (drums) {
        clip.drums = emptyDrums(len);
        for (const n of list) { const r = GM_DRUMS.indexOf(n.p); clip.drums[r >= 0 ? r : n.p % 16][n.s] = n.v; }
      } else clip.notes = list;
      tr.clips.push(clip); out.push(tr);
    }
  }
  if (!out.length) throw new Error('empty');
  return { bpm: bpm && bpm >= 40 && bpm <= 240 ? bpm : null, tracks: out };
}

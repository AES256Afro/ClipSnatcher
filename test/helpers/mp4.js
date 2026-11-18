// Builds tiny, synthetic MP4 files for tests. Only the boxes the muxer reads are
// filled in; the "samples" are arbitrary bytes, so no real video is needed.

const enc = new TextEncoder();
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0); return b; };
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n); return b; };
const zeros = (n) => new Uint8Array(n);
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export const box = (type, ...parts) => { const body = cat(...parts); return cat(u32(8 + body.length), enc.encode(type), body); };
export const fullbox = (type, version, flags, ...parts) => box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);

const matrix = () => cat(u32(0x00010000), zeros(12), u32(0x00010000), zeros(12), u32(0x40000000));

function mvhd(timescale, duration, nextId) {
  return fullbox('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), u16(0x0100), zeros(10), matrix(), zeros(24), u32(nextId));
}
function tkhd(trackId, duration) {
  return fullbox('tkhd', 0, 3, u32(0), u32(0), u32(trackId), zeros(4), u32(duration), zeros(8), zeros(4), u16(0), zeros(2), matrix(), u32(0), u32(0));
}
const mdhd = (timescale, duration) => fullbox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0));
const hdlr = (handler) => fullbox('hdlr', 0, 0, u32(0), enc.encode(handler), zeros(12), new Uint8Array([0]));
const elst = (segmentDuration) => fullbox('elst', 0, 0, u32(1), u32(segmentDuration), u32(0), u32(0x00010000));

function trak({ trackId, handler, timescale, duration, movieDuration, stbl }) {
  return box('trak',
    tkhd(trackId, movieDuration),
    box('edts', elst(movieDuration)),
    box('mdia', mdhd(timescale, duration), hdlr(handler), box('minf', box('stbl', ...stbl))));
}

/**
 * A regular (non-fragmented) single-track MP4: ftyp, mdat, moov.
 * @param {{handler:'vide'|'soun', trackId?:number, movieTimescale?:number, timescale?:number, samples:Uint8Array[]}} o
 */
export function regularMp4({ handler, trackId = 1, movieTimescale = 1000, timescale = 1000, sampleDuration = 100, samples }) {
  const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isomiso2'));
  const payload = cat(...samples);
  const mdat = box('mdat', payload);
  const chunkOffset = ftyp.length + 8;
  const duration = samples.length * sampleDuration;
  const stbl = [
    fullbox('stsz', 0, 0, u32(0), u32(samples.length), ...samples.map((s) => u32(s.length))),
    fullbox('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
    fullbox('stco', 0, 0, u32(1), u32(chunkOffset)),
  ];
  const movieDuration = Math.round((duration / timescale) * movieTimescale);
  const moov = box('moov', mvhd(movieTimescale, movieDuration, trackId + 1), trak({ trackId, handler, timescale, duration, movieDuration, stbl }));
  return cat(ftyp, mdat, moov);
}

/**
 * A fragmented single-track MP4: ftyp, moov (with mvex), then moof+mdat pairs.
 * @param {{handler, trackId?, timescale?, fragments:{time:number, samples:Uint8Array[]}[], baseOffset?:boolean}} o
 *   `time` is in the track's timescale. With `baseOffset`, each tfhd carries an absolute
 *   base-data-offset (flag 0x1) instead of being relative to its moof.
 */
export function fragmentedMp4({ handler, trackId = 1, timescale = 1000, fragments, baseOffset = false }) {
  const ftyp = box('ftyp', enc.encode('iso6'), u32(0), enc.encode('iso6cmfc'));
  const stbl = [fullbox('stsz', 0, 0, u32(0), u32(0)), fullbox('stsc', 0, 0, u32(0)), fullbox('stco', 0, 0, u32(0))];
  const trex = fullbox('trex', 0, 0, u32(trackId), u32(1), u32(0), u32(0), u32(0));
  const moov = box('moov', mvhd(1000, 0, trackId + 1), trak({ trackId, handler, timescale, duration: 0, movieDuration: 0, stbl }), box('mvex', trex));
  const parts = [ftyp, moov];
  let pos = ftyp.length + moov.length;
  fragments.forEach((frag, i) => {
    // Build twice: once to learn the moof size, once with the real offsets.
    const make = (dataOffset, base) => box('moof',
      fullbox('mfhd', 0, 0, u32(i + 1)),
      box('traf',
        baseOffset ? fullbox('tfhd', 0, 0x000001, u32(trackId), u64(base)) : fullbox('tfhd', 0, 0x020000, u32(trackId)),
        fullbox('tfdt', 1, 0, u64(frag.time)),
        fullbox('trun', 0, 0x000201, u32(frag.samples.length), u32(dataOffset), ...frag.samples.map((s) => u32(s.length)))));
    const size = make(0, 0).length;
    const moof = make(size + 8, pos);
    const mdat = box('mdat', ...frag.samples);
    parts.push(moof, mdat);
    pos += moof.length + mdat.length;
  });
  return cat(...parts);
}

export const sample = (seed, length = 40) => Uint8Array.from({ length }, (_, i) => (seed * 31 + i * 7) & 255);
export const joinParts = (parts) => cat(...parts);

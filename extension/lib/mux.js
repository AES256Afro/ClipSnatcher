// Minimal MP4 muxer: joins one video-only MP4 and one audio-only MP4 into a single file,
// without re-encoding. Handles both regular and fragmented (DASH/CMAF) files.
// Runs entirely in your browser.

const enc = new TextEncoder();

function dv(buf) { return new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }

export function parseBoxes(buf, start = 0, end = buf.length) {
  const d = dv(buf);
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = d.getUint32(p);
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    let hdr = 8;
    if (size === 1) { size = Number(d.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) throw new Error(`Malformed MP4 (box ${type})`);
    out.push({ type, start: p, size, hdr, end: p + size });
    p += size;
  }
  return out;
}

const kids = (buf, box) => parseBoxes(buf, box.start + box.hdr, box.end);
const kid = (buf, box, type) => kids(buf, box).find((b) => b.type === type);
function path(buf, box, ...types) {
  let cur = box;
  for (const t of types) { cur = cur && kid(buf, cur, t); }
  return cur || null;
}

function makeBox(type, parts) {
  const len = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  dv(out).setUint32(0, len);
  out.set(enc.encode(type), 4);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// --- field access inside full boxes -------------------------------------------------
// A "full box" body starts with 1 byte of version and 3 bytes of flags. mvhd, tkhd and
// mdhd then hold a creation and a modification time: 4 bytes each in version 0, 8 bytes
// each in version 1. The fields this file needs come right after those times:
//   mvhd: timescale (4), duration (4 or 8) ... next_track_ID (last 4 bytes of the box)
//   tkhd: track_ID (4), reserved (4), duration (4 or 8)
//   mdhd: timescale (4), duration (4 or 8)
const body = (b) => b.start + b.hdr;            // first byte after the box header
const version = (buf, b) => buf[body(b)];
const afterTimes = (buf, b) => body(b) + 4 + (version(buf, b) === 1 ? 16 : 8);
const is64 = (buf, b) => version(buf, b) === 1;

function getU(buf, off, bytes) { const d = dv(buf); return bytes === 8 ? Number(d.getBigUint64(off)) : d.getUint32(off); }
function setU(buf, off, bytes, val) {
  const d = dv(buf);
  if (bytes === 8) d.setBigUint64(off, BigInt(Math.round(val))); else d.setUint32(off, Math.round(val) >>> 0);
}

function handlerType(buf, trak) {
  const hdlr = path(buf, trak, 'mdia', 'hdlr');
  return hdlr ? String.fromCharCode(...buf.subarray(body(hdlr) + 8, body(hdlr) + 12)) : '';
}

function mdhdTimescale(buf, trak) {
  const m = path(buf, trak, 'mdia', 'mdhd');
  return getU(buf, afterTimes(buf, m), 4);
}

function trackId(buf, trak) {
  return getU(buf, afterTimes(buf, kid(buf, trak, 'tkhd')), 4);
}

function mvhdInfo(buf, mvhd) {
  const ts = afterTimes(buf, mvhd);
  return { tsOff: ts, timescale: getU(buf, ts, 4), durOff: ts + 4, durBytes: is64(buf, mvhd) ? 8 : 4, nextIdOff: mvhd.end - 4 };
}

// Copy a trak out of its file, give it a new track_ID and rescale movie-timescale durations.
function rebuildTrak(src, trak, newId, scale) {
  const t = src.slice(trak.start, trak.end);
  const root = { type: 'trak', start: 0, size: t.length, hdr: trak.hdr, end: t.length };
  const tkhd = kid(t, root, 'tkhd');
  const idOff = afterTimes(t, tkhd);
  setU(t, idOff, 4, newId);
  const durOff = idOff + 8, durBytes = is64(t, tkhd) ? 8 : 4;   // skip track_ID and 4 reserved bytes
  if (scale !== 1) setU(t, durOff, durBytes, getU(t, durOff, durBytes) * scale);
  // Edit list entries: segment_duration (movie timescale), media_time, rate (4 bytes).
  // 12 bytes per entry in version 0, 20 in version 1. Only segment_duration is rescaled.
  const elst = path(t, root, 'edts', 'elst');
  if (elst && scale !== 1) {
    const ev1 = is64(t, elst);
    const n = getU(t, body(elst) + 4, 4);
    let o = body(elst) + 8;
    for (let i = 0; i < n; i++) {
      const b = ev1 ? 8 : 4;
      setU(t, o, b, getU(t, o, b) * scale);
      o += ev1 ? 20 : 12;
    }
  }
  return { bytes: t, root };
}

// stco (32-bit) and co64 (64-bit) list where each chunk of samples starts, counted from
// the start of the file. Moving a track's data by `delta` bytes moves every entry.
function shiftChunkOffsets(t, root, delta) {
  const stbl = path(t, root, 'mdia', 'minf', 'stbl');
  for (const b of kids(t, stbl)) {
    if (b.type !== 'stco' && b.type !== 'co64') continue;
    const wide = b.type === 'co64';
    const n = getU(t, body(b) + 4, 4);
    let o = body(b) + 8;
    for (let i = 0; i < n; i++) {
      const v = getU(t, o, wide ? 8 : 4) + delta;
      if (!wide && v > 0xffffffff) throw new Error('Video is too large to merge (over 4 GB).');
      setU(t, o, wide ? 8 : 4, v);
      o += wide ? 8 : 4;
    }
  }
}

function pickTrack(buf, moov, kind) {
  return kids(buf, moov).find((b) => b.type === 'trak' && handlerType(buf, b) === kind);
}

function ftypBytes(buf, tops) {
  const f = tops.find((b) => b.type === 'ftyp');
  if (f) return buf.slice(f.start, f.end);
  return makeBox('ftyp', [enc.encode('isom'), new Uint8Array([0, 0, 2, 0]), enc.encode('isomiso2avc1mp41')]);
}

/**
 * @param {Uint8Array} vBuf video-only mp4
 * @param {Uint8Array} aBuf audio-only mp4
 * @returns {Uint8Array[]} parts to concatenate into the final file (pass to new Blob(parts))
 */
export function muxAV(vBuf, aBuf) {
  const vTops = parseBoxes(vBuf), aTops = parseBoxes(aBuf);
  const vMoov = vTops.find((b) => b.type === 'moov'), aMoov = aTops.find((b) => b.type === 'moov');
  if (!vMoov || !aMoov) throw new Error('Not an MP4 file (no moov box).');
  const vTrak = pickTrack(vBuf, vMoov, 'vide'), aTrak = pickTrack(aBuf, aMoov, 'soun');
  if (!vTrak) throw new Error('Video file has no video track.');
  if (!aTrak) throw new Error('Audio file has no audio track.');

  const vFrag = !!kid(vBuf, vMoov, 'mvex'), aFrag = !!kid(aBuf, aMoov, 'mvex');
  if (vFrag !== aFrag) throw new Error('Video and audio use different MP4 layouts.');

  const vMvhdBox = kid(vBuf, vMoov, 'mvhd'), aMvhdBox = kid(aBuf, aMoov, 'mvhd');
  const vm = mvhdInfo(vBuf, vMvhdBox), am = mvhdInfo(aBuf, aMvhdBox);
  const scale = vm.timescale / am.timescale;

  const mvhd = vBuf.slice(vMvhdBox.start, vMvhdBox.end);
  const mvhdRoot = { start: 0, hdr: vMvhdBox.hdr, end: mvhd.length, type: 'mvhd' };
  const mi = mvhdInfo(mvhd, mvhdRoot);
  const aDur = getU(aBuf, am.durOff, am.durBytes) * scale;
  if (aDur > getU(mvhd, mi.durOff, mi.durBytes)) setU(mvhd, mi.durOff, mi.durBytes, aDur);
  setU(mvhd, mi.nextIdOff, 4, 3);

  const vT = rebuildTrak(vBuf, vTrak, 1, 1);
  const aT = rebuildTrak(aBuf, aTrak, 2, scale);
  const ftyp = ftypBytes(vBuf, vTops);

  if (!vFrag) {
    // Regular MP4: keep each source file intact inside one big mdat and shift chunk offsets.
    // Layout: ftyp, moov, then a 16-byte mdat header (size 1 + 64-bit size, so it can pass
    // 4 GB), then the whole video file, then the whole audio file.
    const moovLen = 8 + mvhd.length + vT.bytes.length + aT.bytes.length;
    const head = ftyp.length + moovLen + 16;
    shiftChunkOffsets(vT.bytes, vT.root, head);
    shiftChunkOffsets(aT.bytes, aT.root, head + vBuf.length);
    const moov = makeBox('moov', [mvhd, vT.bytes, aT.bytes]);
    const mdatHdr = new Uint8Array(16);
    dv(mdatHdr).setUint32(0, 1);
    mdatHdr.set(enc.encode('mdat'), 4);
    dv(mdatHdr).setBigUint64(8, BigInt(16 + vBuf.length + aBuf.length));
    return [ftyp, moov, mdatHdr, vBuf, aBuf];
  }

  // Fragmented MP4: new init segment + every fragment from both files, interleaved by time.
  const trexFor = (buf, moov, oldId, newId) => {
    const mvex = kid(buf, moov, 'mvex');
    const trex = kids(buf, mvex).find((b) => b.type === 'trex' && getU(buf, body(b) + 4, 4) === oldId)
      || kids(buf, mvex).find((b) => b.type === 'trex');
    const out = buf.slice(trex.start, trex.end);
    setU(out, trex.hdr + 4, 4, newId);
    return out;
  };
  const vOldId = trackId(vBuf, vTrak), aOldId = trackId(aBuf, aTrak);
  const mvex = makeBox('mvex', [trexFor(vBuf, vMoov, vOldId, 1), trexFor(aBuf, aMoov, aOldId, 2)]);
  const moov = makeBox('moov', [mvhd, vT.bytes, aT.bytes, mvex]);

  const frags = [
    ...collectFragments(vBuf, vTops, vOldId, 1, mdhdTimescale(vBuf, vTrak), 0),
    ...collectFragments(aBuf, aTops, aOldId, 2, mdhdTimescale(aBuf, aTrak), 1),
  ].sort((x, y) => x.time - y.time || x.order - y.order);

  const parts = [ftyp, moov];
  let pos = ftyp.length + moov.length;
  let seq = 1;
  for (const f of frags) {
    const d = dv(f.moof);
    if (f.mfhdSeqOff != null) d.setUint32(f.mfhdSeqOff, seq++);
    for (const off of f.baseOffsets) d.setBigUint64(off, d.getBigUint64(off) - BigInt(f.oldPos) + BigInt(pos));
    parts.push(f.moof, ...f.rest);
    pos += f.moof.length + f.rest.reduce((n, r) => n + r.length, 0);
  }
  return parts;
}

function collectFragments(buf, tops, oldId, newId, timescale, order) {
  const out = [];
  for (let i = 0; i < tops.length; i++) {
    if (tops[i].type !== 'moof') continue;
    const mb = tops[i];
    const moof = buf.slice(mb.start, mb.end);
    const root = { type: 'moof', start: 0, hdr: mb.hdr, end: moof.length };
    const rest = [];
    for (let j = i + 1; j < tops.length && tops[j].type !== 'moof'; j++) {
      if (tops[j].type === 'mdat') rest.push(buf.subarray(tops[j].start, tops[j].end));
    }
    let time = 0;
    const baseOffsets = [];
    for (const traf of kids(moof, root).filter((b) => b.type === 'traf')) {
      const tfhd = kid(moof, traf, 'tfhd');
      // tfhd: version/flags (4), track_ID (4), then base_data_offset (8) if flag 0x1 is set.
      // That offset counts from the start of the file, so it has to follow the fragment
      // to its new position; without it, offsets count from the moof and need no change.
      const flags = (moof[body(tfhd) + 1] << 16) | (moof[body(tfhd) + 2] << 8) | moof[body(tfhd) + 3];
      setU(moof, body(tfhd) + 4, 4, newId);
      if (flags & 0x1) baseOffsets.push(body(tfhd) + 8);
      const tfdt = kid(moof, traf, 'tfdt');
      if (tfdt) time = getU(moof, body(tfdt) + 4, version(moof, tfdt) === 1 ? 8 : 4) / timescale;
    }
    const mfhd = kid(moof, root, 'mfhd');
    out.push({ moof, rest, time, order, oldPos: mb.start, baseOffsets, mfhdSeqOff: mfhd ? body(mfhd) + 4 : null });
  }
  if (!out.length) throw new Error('Fragmented file has no fragments.');
  return out;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muxAV, parseBoxes } from '../extension/lib/mux.js';
import { regularMp4, fragmentedMp4, sample, joinParts } from './helpers/mp4.js';

// Small readers for checking the merged file.
const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u32 = (b, o) => dv(b).getUint32(o);
const u64 = (b, o) => Number(dv(b).getBigUint64(o));
const kids = (b, box) => parseBoxes(b, box.start + box.hdr, box.end);
const find = (b, box, ...path) => path.reduce((cur, t) => cur && kids(b, cur).find((k) => k.type === t), box);
const body = (box) => box.start + box.hdr;
const handlerOf = (b, trak) => { const h = find(b, trak, 'mdia', 'hdlr'); return String.fromCharCode(...b.subarray(body(h) + 8, body(h) + 12)); };
const trackIdOf = (b, trak) => u32(b, body(find(b, trak, 'tkhd')) + 12);

// Reads every sample of a regular track back out of the file via its sample table.
function samplesOf(b, trak) {
  const stbl = find(b, trak, 'mdia', 'minf', 'stbl');
  const stsz = find(b, stbl, 'stsz'), stco = find(b, stbl, 'stco');
  const n = u32(b, body(stsz) + 8);
  let off = u32(b, body(stco) + 8);
  const out = [];
  for (let i = 0; i < n; i++) { const size = u32(b, body(stsz) + 12 + i * 4); out.push(b.slice(off, off + size)); off += size; }
  return out;
}

test('regular files: both tracks end up in one movie with all their samples', () => {
  const vSamples = [sample(1), sample(2, 55), sample(3, 12)];
  const aSamples = [sample(9, 20), sample(8, 21)];
  const v = regularMp4({ handler: 'vide', samples: vSamples, movieTimescale: 1000 });
  const a = regularMp4({ handler: 'soun', samples: aSamples, movieTimescale: 44100, timescale: 44100, sampleDuration: 22050 });   // 1 second
  const out = joinParts(muxAV(v, a));

  const tops = parseBoxes(out);
  assert.deepEqual(tops.map((t) => t.type), ['ftyp', 'moov', 'mdat']);
  const moov = tops[1];
  const traks = kids(out, moov).filter((k) => k.type === 'trak');
  assert.equal(traks.length, 2);
  const video = traks.find((t) => handlerOf(out, t) === 'vide');
  const audio = traks.find((t) => handlerOf(out, t) === 'soun');
  assert.equal(trackIdOf(out, video), 1);
  assert.equal(trackIdOf(out, audio), 2);

  const mvhd = find(out, moov, 'mvhd');
  assert.equal(u32(out, mvhd.end - 4), 3, 'next_track_ID');
  assert.deepEqual(samplesOf(out, video), vSamples);
  assert.deepEqual(samplesOf(out, audio), aSamples);

  // The audio track's 1 second is now counted in the movie's timescale (1000), not the audio file's (44100).
  const aTkhdDuration = u32(out, body(find(out, audio, 'tkhd')) + 20);
  assert.equal(aTkhdDuration, 1000);
  const aEdit = u32(out, body(find(out, audio, 'edts', 'elst')) + 8);
  assert.equal(aEdit, 1000);
});

// Reads each fragment of the merged file back: which track, its time and its samples.
function fragmentsOf(b, { baseOffset = false } = {}) {
  const out = [];
  for (const moof of parseBoxes(b).filter((t) => t.type === 'moof')) {
    const seq = u32(b, body(find(b, moof, 'mfhd')) + 4);
    const traf = find(b, moof, 'traf');
    const tfhd = find(b, traf, 'tfhd');
    const track = u32(b, body(tfhd) + 4);
    const time = u64(b, body(find(b, traf, 'tfdt')) + 4);
    const trun = find(b, traf, 'trun');
    const n = u32(b, body(trun) + 4);
    const base = baseOffset ? u64(b, body(tfhd) + 8) : moof.start;
    let off = base + u32(b, body(trun) + 8);
    const samples = [];
    for (let i = 0; i < n; i++) { const size = u32(b, body(trun) + 12 + i * 4); samples.push(b.slice(off, off + size)); off += size; }
    out.push({ seq, track, time, samples });
  }
  return out;
}

for (const baseOffset of [false, true]) {
  test(`fragmented files${baseOffset ? ' with absolute base offsets' : ''}: fragments interleave by time and keep their samples`, () => {
    const vFrags = [{ time: 0, samples: [sample(1), sample(2)] }, { time: 2000, samples: [sample(3)] }, { time: 4000, samples: [sample(4, 33)] }];
    const aFrags = [{ time: 0, samples: [sample(7, 10)] }, { time: 96000, samples: [sample(6, 11)] }];   // 0 s and 2 s at 48 kHz
    const v = fragmentedMp4({ handler: 'vide', trackId: 7, timescale: 1000, fragments: vFrags, baseOffset });
    const a = fragmentedMp4({ handler: 'soun', trackId: 3, timescale: 48000, fragments: aFrags, baseOffset });
    const out = joinParts(muxAV(v, a));

    const moov = parseBoxes(out).find((t) => t.type === 'moov');
    const trexIds = kids(out, find(out, moov, 'mvex')).map((t) => u32(out, body(t) + 4));
    assert.deepEqual(trexIds, [1, 2]);

    const frags = fragmentsOf(out, { baseOffset });
    assert.deepEqual(frags.map((f) => f.seq), [1, 2, 3, 4, 5], 'sequence numbers are renumbered in order');
    assert.deepEqual(frags.map((f) => f.track), [1, 2, 1, 2, 1], 'video first on ties, then by time');
    assert.deepEqual(frags.filter((f) => f.track === 1).map((f) => f.samples), vFrags.map((f) => f.samples));
    assert.deepEqual(frags.filter((f) => f.track === 2).map((f) => f.samples), aFrags.map((f) => f.samples));
  });
}

test('refuses files that cannot be merged, with a readable reason', () => {
  const v = regularMp4({ handler: 'vide', samples: [sample(1)] });
  const a = regularMp4({ handler: 'soun', samples: [sample(2)] });
  const fa = fragmentedMp4({ handler: 'soun', fragments: [{ time: 0, samples: [sample(3)] }] });
  assert.throws(() => muxAV(v, fa), /different MP4 layouts/);
  assert.throws(() => muxAV(a, a), /no video track/);
  assert.throws(() => muxAV(v, v), /no audio track/);
  assert.throws(() => muxAV(new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101]), a), /no moov/);
  const broken = v.slice(); new DataView(broken.buffer).setUint32(0, 9999);   // first box claims to be longer than the file
  assert.throws(() => muxAV(broken, a), /Malformed MP4/);
});

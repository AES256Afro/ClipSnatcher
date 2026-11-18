import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseVariant } from '../extension/lib/quality.js';

const MB = 1048576;
const item = {
  kind: 'direct', url: 'https://v/1080.mp4', index: 2, thumb: 't',
  variants: [
    { kind: 'direct', url: 'https://v/1080.mp4', height: 1080, estBytes: 40 * MB },
    { kind: 'direct', url: 'https://v/720.mp4', height: 720, estBytes: 18 * MB },
    { kind: 'direct', url: 'https://v/480.mp4', height: 480, estBytes: 8 * MB },
    { kind: 'direct', url: 'https://v/270.mp4', height: 270, estBytes: 2 * MB },
  ],
};

test('best keeps the top version and the item\'s own fields', async () => {
  const r = await chooseVariant(item, { quality: 'best' });
  assert.equal(r.item.url, 'https://v/1080.mp4');
  assert.equal(r.item.index, 2);
  assert.equal(r.item.thumb, 't');
  assert.equal('variants' in r.item, false);
});

test('smaller picks 720p or the next size down', async () => {
  assert.equal((await chooseVariant(item, { quality: 'smaller' })).item.url, 'https://v/720.mp4');
  const small = { ...item, variants: item.variants.slice(1) };
  assert.equal((await chooseVariant(small, { quality: 'smaller' })).item.url, 'https://v/480.mp4');
  const noHeights = { ...item, variants: item.variants.map(({ height, ...v }) => v) };
  assert.equal((await chooseVariant(noHeights, { quality: 'smaller' })).item.url, 'https://v/720.mp4');
});

test('fit picks the best version under the limit, using the real size when known', async () => {
  let r = await chooseVariant(item, { quality: 'fit', maxMB: 10 });
  assert.equal(r.item.url, 'https://v/480.mp4');
  assert.match(r.note, /480p, about 8\.0 MB/);
  assert.equal(r.over, false);
  // A real size from the server beats the estimate.
  r = await chooseVariant(item, { quality: 'fit', maxMB: 10 }, async (v) => (v.height === 720 ? 9 * MB : 0));
  assert.equal(r.item.url, 'https://v/720.mp4');
});

test('fit says so when even the smallest version is over the limit', async () => {
  const r = await chooseVariant(item, { quality: 'fit', maxMB: 1 });
  assert.equal(r.item.url, 'https://v/270.mp4');
  assert.equal(r.over, true);
  assert.match(r.note, /smallest version offered is 2\.0 MB, over your 1\.0 MB limit/);
});

test('fit with no sizes known falls back to the smallest version and says why', async () => {
  const unknown = { ...item, variants: item.variants.map(({ estBytes, ...v }) => v) };
  const r = await chooseVariant(unknown, { quality: 'fit', maxMB: 10 });
  assert.equal(r.item.url, 'https://v/270.mp4');
  assert.match(r.note, /size isn.t known/);
});

test('works for merged Reddit videos and items with no alternatives', async () => {
  const mux = { kind: 'mux', video: 'https://v/v1.mp4', audio: 'https://v/a.mp4', index: 1, variants: [
    { kind: 'mux', video: 'https://v/v1.mp4', audio: 'https://v/a.mp4', height: 1080, estBytes: 30 * MB },
    { kind: 'mux', video: 'https://v/v2.mp4', audio: 'https://v/a.mp4', height: 480, estBytes: 6 * MB }] };
  const r = await chooseVariant(mux, { quality: 'fit', maxMB: 10 });
  assert.equal(r.item.video, 'https://v/v2.mp4');
  assert.equal(r.item.audio, 'https://v/a.mp4');
  const plain = { kind: 'direct', url: 'https://v/only.mp4', index: 1 };
  assert.equal((await chooseVariant(plain, { quality: 'smaller' })).item.url, 'https://v/only.mp4');
  assert.equal((await chooseVariant(plain, { quality: 'unknown-setting' })).item.url, 'https://v/only.mp4');
});

test('with only one version there is nothing to choose, and no note unless it is too big', async () => {
  const one = { kind: 'direct', url: 'https://v/a.mp4', index: 1 };
  assert.equal((await chooseVariant(one, { quality: 'fit', maxMB: 10 })).note, '');
  const big = await chooseVariant(one, { quality: 'fit', maxMB: 1 }, async () => 5 * MB);
  assert.equal(big.over, true);
  assert.match(big.note, /Only one version is offered, and it is 5\.0 MB/);
});

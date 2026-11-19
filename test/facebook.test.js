import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, findFbVideoUrl } from '../extension/lib/resolve.js';

// The shape of a Facebook page for a logged-in user: each video lists "progressive_urls"
// with a quality label, and the next reel's video is preloaded into the same page.
const progressive = (id, file, { failed = false } = {}) => `{"id":"${id}","videoDeliveryLegacyFields":null,"videoDeliveryResponseFragment":{"videoDeliveryResponseResult":{"dash_manifests":[],"progressive_urls":[`
  + `{"progressive_url":"https:\\/\\/video-hou1-1.xx.fbcdn.net\\/${file}-sd.mp4","failure_reason":${failed ? '{"code":1}' : 'null'},"metadata":{"quality":"SD"}},`
  + `{"progressive_url":"https:\\/\\/video-hou1-1.xx.fbcdn.net\\/${file}-hd.mp4","failure_reason":${failed ? '{"code":1}' : 'null'},"metadata":{"quality":"HD"}}]}}}`;
const pad = (n) => 'x'.repeat(n);

test('logged-in pages: the requested video is picked, HD first, not the preloaded next reel', () => {
  const html = progressive('1111111111', 'mine') + pad(12000) + progressive('2222222222', 'next');
  const r = findFbVideoUrl(html, '1111111111');
  assert.equal(r.url, 'https://video-hou1-1.xx.fbcdn.net/mine-hd.mp4');
  assert.deepEqual(r.qualities, ['https://video-hou1-1.xx.fbcdn.net/mine-hd.mp4', 'https://video-hou1-1.xx.fbcdn.net/mine-sd.mp4']);
  assert.equal(findFbVideoUrl(html, '2222222222').url, 'https://video-hou1-1.xx.fbcdn.net/next-hd.mp4');
});

test('logged-in pages: if only the next reel has addresses, nothing is returned rather than the wrong video', () => {
  const html = '{"id":"1111111111","videoDeliveryResponseFragment":null}' + pad(12000) + progressive('2222222222', 'next');
  assert.equal(findFbVideoUrl(html, '1111111111'), null);
});

test('logged-in pages: addresses Facebook marks as failed are skipped', () => {
  const html = progressive('1111111111', 'broken', { failed: true });
  assert.equal(findFbVideoUrl(html, '1111111111'), null);
});

test('logged-out pages still work, and outrank nothing they shouldn\'t', () => {
  const html = '{"id":"1111111111","browser_native_sd_url":"https:\\/\\/v.fbcdn.net\\/sd.mp4","browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/hd.mp4"}';
  assert.equal(findFbVideoUrl(html, '1111111111').url, 'https://v.fbcdn.net/hd.mp4');
});

test('the Facebook page is requested as HTML (otherwise Facebook leaves the video out)', async () => {
  let accept = '';
  globalThis.fetch = async (url, opts = {}) => {
    accept = opts.headers?.Accept || '';
    const body = /text\/html/.test(accept) ? progressive('1234567890', 'v') : '<html>no video here</html>';
    return { ok: true, status: 200, url: 'https://www.facebook.com/reel/1234567890/', text: async () => body };
  };
  const r = await resolve('https://www.facebook.com/watch/?v=1234567890');
  assert.match(accept, /^text\/html/);
  assert.equal(r.items[0].url, 'https://video-hou1-1.xx.fbcdn.net/v-hd.mp4');
});

test('logged-in pages: a failure reason after the quality label also skips that address', () => {
  const entry = (q, failure) => `{"progressive_url":"https:\\/\\/video-hou1-1.xx.fbcdn.net\\/after-${q.toLowerCase()}.mp4","metadata":{"quality":"${q}"},"failure_reason":${failure}}`;
  const html = `{"id":"1111111111","progressive_urls":[${entry('SD', 'null')},${entry('HD', '{"code":1}')}]}`;
  assert.equal(findFbVideoUrl(html, '1111111111').url, 'https://video-hou1-1.xx.fbcdn.net/after-sd.mp4');
  const ok = `{"id":"1111111111","progressive_urls":[${entry('SD', 'null')},${entry('HD', 'null')}]}`;
  assert.equal(findFbVideoUrl(ok, '1111111111').url, 'https://video-hou1-1.xx.fbcdn.net/after-hd.mp4');
});

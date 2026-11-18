import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../extension/lib/resolve.js';

// A fetch stand-in that records each request, when it finished, and whether it was cancelled.
function fakeFetch(routes) {
  const log = [];
  globalThis.fetch = (url, opts = {}) => {
    const entry = { url, aborted: false, done: false, startedAt: performance.now(), doneAt: Infinity };
    log.push(entry);
    opts.signal?.addEventListener('abort', () => { entry.aborted = true; });
    const route = routes.find(([re]) => re.test(url));
    const r = route ? route[1] : { status: 404 };
    return new Promise((ok, fail) => setTimeout(() => {
      if (entry.aborted) return fail(new DOMException('aborted', 'AbortError'));
      entry.done = true;
      entry.doneAt = performance.now();
      ok({ ok: (r.status || 200) < 400, status: r.status || 200, url, text: async () => r.body || '', json: async () => JSON.parse(r.body) });
    }, r.delay || 0));
  };
  return log;
}
const listing = (post) => JSON.stringify([{ data: { children: [{ data: post } ] } }]);

test('Reddit: the post page is requested at the same time as the post data, not after', async () => {
  const pk = JSON.stringify({ playbackMp4s: { permutations: [{ source: { url: 'https://packaged-media.redd.it/a.mp4', dimensions: { height: 720 } } }] } }).replace(/"/g, '&quot;');
  const log = fakeFetch([
    [/abc123\.json/, { delay: 60, body: listing({ title: 'Clip', permalink: '/r/a/comments/abc123/c/', domain: 'v.redd.it', secure_media: { reddit_video: { fallback_url: 'https://v.redd.it/v/CMAF_720.mp4', has_audio: true } } }) }],
    [/comments\/abc123\/$/, { delay: 60, body: `<shreddit-post id="t3_abc123"><shreddit-player-2 packaged-media-json="${pk}"></shreddit-player-2></shreddit-post>` }],
  ]);
  const r = await resolve('https://www.reddit.com/r/a/comments/abc123/c/');
  assert.deepEqual(r.items.map((i) => i.url), ['https://packaged-media.redd.it/a.mp4']);
  assert.equal(log.length, 2);
  const json = log.find((e) => /\.json/.test(e.url)), page = log.find((e) => /\/$/.test(e.url));
  assert.ok(page.startedAt < json.doneAt, 'the page request started before the data request finished');
});

test('Reddit: the page request is cancelled when the post has no Reddit video', async () => {
  const log = fakeFetch([
    [/self01\.json/, { body: listing({ title: 'Q', permalink: '/r/a/comments/self01/q/', domain: 'self.a', is_self: true }) }],
    [/comments\/self01\/$/, { delay: 200, body: '<html></html>' }],
  ]);
  await assert.rejects(resolve('https://www.reddit.com/r/a/comments/self01/q/'), /text, not a video/);
  const page = log.find((e) => /comments\/self01\/$/.test(e.url));
  assert.equal(page.aborted, true);
  assert.equal(page.done, false);
});

test('X: thumbnails are fetched in the small size', async () => {
  fakeFetch([[/tweet-result/, { body: JSON.stringify({ id_str: '1', text: 'hi', user: { screen_name: 'a' },
    mediaDetails: [{ type: 'video', media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/x.jpg', video_info: { variants: [{ content_type: 'video/mp4', bitrate: 1, url: 'https://video.twimg.com/a.mp4' }] } }] }) }]]);
  const r = await resolve('https://x.com/a/status/1');
  assert.equal(r.thumb, 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/x.jpg?name=small');
  assert.equal(r.items[0].thumb, r.thumb);
});

import { isPostUrl } from '../extension/lib/resolve.js';
test('one rule decides what counts as a single post', () => {
  for (const u of ['https://x.com/a/status/1', 'https://twitter.com/a/status/1/video/2', 'https://www.reddit.com/r/a/comments/abc/t/', 'https://old.reddit.com/r/a/comments/abc/',
    'https://redd.it/abc', 'https://www.reddit.com/r/a/s/AbC1', 'https://www.facebook.com/reel/1234567', 'https://www.facebook.com/watch/?v=1234567', 'https://fb.watch/abc/']) assert.equal(isPostUrl(u), true, u);
  for (const u of ['https://x.com/home', 'https://www.reddit.com/r/a/', 'https://www.facebook.com/', 'https://www.facebook.com/nasa/videos/', 'https://example.com/a', 'not a link', "https://evil.mov'@x.com/a/status/1"]) assert.equal(isPostUrl(u), false, u);
});

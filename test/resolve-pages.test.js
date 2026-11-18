import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, ResolveError, findFbVideoUrl, packagedForPost, fbVideoId, fbIsSinglePost } from '../extension/lib/resolve.js';
// Each check is its own test, so a failure names exactly what broke.
const eq = (name, got, want) => test(name, () => assert.deepEqual(got, want));
const pickFb = (...a) => { const r = findFbVideoUrl(...a); return r && (r.ambiguous ? { ambiguous: true } : { url: r.url }); };
let page = '';
globalThis.fetch = async (url) => ({ ok: true, status: 200, url, text: async () => page, json: async () => ({}) });
const run = async (u, h = {}, o = {}) => { try { const r = await resolve(u, h, o); return { site: r.site, title: r.title, items: r.items.map((i) => i.url), thumb: r.thumb, src: r.sourceUrl }; } catch (e) { return { err: e.message }; } };
const pk = (u) => JSON.stringify({ playbackMp4s: { permutations: [{ source: { url: u, dimensions: { height: 720 } } }] } }).replace(/"/g, '&quot;');

// the Turkish capital dotted I used to shift every position after it
eq('"İ" earlier in the page does not lose the post\'s own player', packagedForPost(`<title>İstanbul İİİİİİİİİİ</title><shreddit-post id="t3_abc123"><shreddit-player-2 packaged-media-json="${pk('https://packaged-media.redd.it/MINE.mp4')}"></shreddit-player-2></shreddit-post>`, 'abc123'), 'https://packaged-media.redd.it/MINE.mp4');
page = `<title>İİİİ sayfa</title><meta property="og:title" content="İstanbul'da gün batımı | Facebook"><meta property="og:image" content="https://scontent.fbcdn.net/t.jpg">{"id":"1234567890","browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/a.mp4"}`;
let r = await run('https://www.facebook.com/reel/1234567890');
eq('Facebook page with "İ": title and thumbnail kept', [r.title, r.thumb], ["İstanbul'da gün batımı", 'https://scontent.fbcdn.net/t.jpg']);
page = `<meta property="og:title" content="Cats > Dogs | Facebook">{"id":"1234567890","browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/a.mp4"}`;
r = await run('https://www.facebook.com/reel/1234567890');
eq('">" inside a quoted attribute does not cut the tag short', r.title, 'Cats > Dogs');
page = `<META PROPERTY="og:title" CONTENT="Upper Case | Facebook"><meta content='single quoted' property="og:description">{"id":"1234567890","browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/a.mp4"}`;
r = await run('https://www.facebook.com/reel/1234567890');
eq('uppercase tag and attribute names are read', r.title, 'Upper Case');
page = `<link rel="canonical"><meta property="og:url" content="https://www.reddit.com/r/a/comments/abc123/t/">`;
r = await run('https://www.reddit.com/r/a/s/AbCdEf');
eq('canonical link with no address falls back to og:url (post found, then lookup continues)', /Couldn.t find the Reddit post/.test(r.err || ''), false);
eq('live replay address counts as one video', [fbVideoId('https://www.facebook.com/watch/live/?v=1234567890'), fbIsSinglePost('https://www.facebook.com/watch/live/?v=1234567890')], ['1234567890', true]);
eq('"paid" field is not taken for an ID', pickFb(`{"paid":"1234567890","browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/other.mp4"}` + 'x'.repeat(9000) + `{"video_id":"1234567890","browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/mine.mp4"}`, '1234567890'), { url: 'https://v.fbcdn.net/mine.mp4' });
eq('videoId (camel case) counts', pickFb(`{"videoId":"1234567890","browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/mine.mp4"}`, '1234567890'), { url: 'https://v.fbcdn.net/mine.mp4' });
// hostile: thousands of opening tags and no ">" anywhere, on a large page
page = '<shreddit-post '.repeat(5000) + 'a'.repeat(16 * 1024 * 1024);
let ms = Date.now(); packagedForPost(page, 'abc123'); ms = Date.now() - ms;
eq(`16 MB hostile page with no ">" scanned fast (${ms} ms)`, ms < 3000, true);
page = '';
// a video file's own address resolves as a plain file; the background files it under its site
r = await run('https://video.twimg.com/ext_tw_video/1/pu/vid/480x270/a.mp4?tag=14', { pageUrl: 'https://x.com/home', titleHint: 'Home / X' });
eq('X video file address resolves to that file', [r.site, r.items, r.src], ['web', ['https://video.twimg.com/ext_tw_video/1/pu/vid/480x270/a.mp4?tag=14'], 'https://x.com/home']);

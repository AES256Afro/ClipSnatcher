import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, ResolveError, extractUrl, decodeEntities, bestPackaged, packagedForPost, findFbVideoUrl, fbIsSinglePost, fbVideoId, detectSite, isSiteMediaUrl, parseDash } from '../extension/lib/resolve.js';
// Each check is its own test, so a failure names exactly what broke.
const eq = (name, got, want) => test(name, () => assert.deepEqual(got, want));
const routes = []; let calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push(url);
  for (const [re, fn] of routes) if (re.test(url)) { const r = fn(url, opts); if (r.throw) throw new TypeError('fetch failed'); return { ok: (r.status || 200) < 400, status: r.status || 200, url: r.url || url, text: async () => r.body || '', json: async () => JSON.parse(r.body) }; }
  return { ok: false, status: 404, url, text: async () => '', json: async () => ({}) };
};
const run = async (u, h, o = { pasted: true }) => { calls = []; try { const r = await resolve(u, h, o); return { items: r.items.map((i) => i.url || [i.video, i.audio]), src: r.sourceUrl, title: r.title, noAudio: r.items.map((i) => !!i.noAudio), site: r.site }; } catch (e) { return { err: e.message, typed: e instanceof ResolveError }; } };

// --- helpers
eq('extractUrl share text', extractUrl('look at this https://x.com/a/status/1?s=20 lol'), 'https://x.com/a/status/1?s=20');
eq('extractUrl no scheme', extractUrl('x.com/a/status/1'), 'https://x.com/a/status/1');
eq('extractUrl trailing punctuation', extractUrl('(https://fb.watch/abc/).'), 'https://fb.watch/abc/');
eq('entities', decodeEntities('It&#039;s &quot;ok&quot; &amp;amp; &#x1F600;'), 'It\'s "ok" &amp; \u{1F600}');
eq('media host lookalike', isSiteMediaUrl('reddit', 'https://evilredd.it/a.mp4'), false);
eq('media host http', isSiteMediaUrl('x', 'http://video.twimg.com/a.mp4'), false);
eq('packaged rejects foreign host', bestPackaged(JSON.stringify({ playbackMp4s: { permutations: [{ source: { url: 'https://attacker.example/x.mp4', dimensions: { height: 2160 } } }, { source: { url: 'https://packaged-media.redd.it/ok.mp4', dimensions: { height: 480 } } }] } })), 'https://packaged-media.redd.it/ok.mp4');
const pk = (u) => JSON.stringify({ playbackMp4s: { permutations: [{ source: { url: u, dimensions: { height: 720 } } }] } }).replace(/"/g, '&quot;');
eq('packaged only from the requested post element', packagedForPost(`<shreddit-ad-post><shreddit-player-2 packaged-media-json="${pk('https://packaged-media.redd.it/AD.mp4')}"></shreddit-player-2></shreddit-ad-post><shreddit-post permalink="/r/a/comments/abc123/x/" id="t3_abc123"><shreddit-player-2 packaged-media-json="${pk('https://packaged-media.redd.it/MINE.mp4')}"></shreddit-player-2></shreddit-post>`, 'abc123'), 'https://packaged-media.redd.it/MINE.mp4');
eq('packaged: other post only -> none', packagedForPost(`<shreddit-post id="t3_zzz999"><shreddit-player-2 packaged-media-json="${pk('https://packaged-media.redd.it/OTHER.mp4')}"></shreddit-player-2></shreddit-post>`, 'abc123'), null);

// --- facebook: what counts as one post
for (const [u, want] of [
  ['https://www.facebook.com/', false], ['https://www.facebook.com/watch/', false], ['https://www.facebook.com/some.person', false],
  ['https://www.facebook.com/nasa/videos/', false], ['https://www.facebook.com/search/videos/?q=cats', false],
  ['https://www.facebook.com/anything?x=/videos/', false], ['https://www.facebook.com/l.php?u=x&v=1234567', false],
  ['https://www.facebook.com/reel/', false], ['https://www.facebook.com/groups/123/', false],
  ['https://www.facebook.com/user/videos/1234567890/', true], ['https://www.facebook.com/user/videos/some-title/1234567890', true],
  ['https://www.facebook.com/reel/1234567890', true], ['https://www.facebook.com/watch/?v=1234567890', true],
  ['https://www.facebook.com/share/v/AbC123/', true], ['https://www.facebook.com/share/AbC123/', true], ['https://fb.watch/abc123/', true],
  ['https://www.facebook.com/user/posts/pfbid0abc', true], ['https://www.facebook.com/groups/123/permalink/456789/', true], ['https://www.facebook.com/story.php?story_fbid=1&id=2', true],
]) eq('fbIsSinglePost ' + u.replace('https://www.facebook.com', ''), fbIsSinglePost(u), want);
eq('fbVideoId ignores v= on other paths', fbVideoId('https://www.facebook.com/l.php?v=1234567'), null);

// --- facebook: which video
const j = (id, kind, file) => `{"id":"${id}","${kind}":"https:\\/\\/v.fbcdn.net\\/${file}"}`;
const pad = (n) => 'x'.repeat(n);
eq('fb picks the video next to its ID', findFbVideoUrl(j('999', 'browser_native_hd_url', 'other.mp4') + pad(30000) + j('1234567890', 'browser_native_hd_url', 'mine.mp4'), '1234567890'), { url: 'https://v.fbcdn.net/mine.mp4' });
eq('fb: own SD beats a neighbour\'s HD', findFbVideoUrl(j('1234567890', 'browser_native_sd_url', 'mine-sd.mp4') + pad(15000) + j('999', 'browser_native_hd_url', 'other-hd.mp4'), '1234567890'), { url: 'https://v.fbcdn.net/mine-sd.mp4' });
eq('fb: own HD preferred over own SD', findFbVideoUrl(`{"id":"1234567890","browser_native_sd_url":"https:\\/\\/v.fbcdn.net\\/sd.mp4","browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/hd.mp4"}`, '1234567890'), { url: 'https://v.fbcdn.net/hd.mp4' });
eq('fb: ID inside a longer number does not count', findFbVideoUrl(j('91234567890', 'browser_native_hd_url', 'other.mp4') + pad(100) + j('555', 'browser_native_hd_url', 'second.mp4'), '1234567890'), { ambiguous: true });
eq('fb: a bare number in page text is not an ID; one video on the page is used', findFbVideoUrl(`"1234567890"${pad(30000)}{"browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/other.mp4"}`, '1234567890'), { url: 'https://v.fbcdn.net/other.mp4' });
eq('fb: no ID, one video', findFbVideoUrl(`{"browser_native_sd_url":"https:\\/\\/v.fbcdn.net\\/sd.mp4","browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/only.mp4"}` + `{"browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/only.mp4"}`, null), { url: 'https://v.fbcdn.net/only.mp4' });
eq('fb: no ID, two videos -> refuse', findFbVideoUrl(j('1', 'browser_native_hd_url', 'a.mp4') + j('2', 'browser_native_hd_url', 'b.mp4'), null), { ambiguous: true });
eq('fb: plain text imitation ignored', findFbVideoUrl('<title>hd_src:"https://attacker.example/x.mp4"</title>', null), null);
eq('dash ignores foreign BaseURL', parseDash('<AdaptationSet contentType="video"><Representation bandwidth="1" height="2160"><BaseURL>https://attacker.example/v.mp4</BaseURL></Representation><Representation bandwidth="1" height="720"><BaseURL>CMAF_720.mp4</BaseURL></Representation></AdaptationSet>', 'vid9').video, 'https://v.redd.it/vid9/CMAF_720.mp4');

// --- never guess
let r = await run('https://www.reddit.com/r/aww/');
eq('reddit listing refused without any request', [r.typed, /many posts/.test(r.err), calls.length], [true, true, 0]);
for (const u of ['https://www.facebook.com/', 'https://www.facebook.com/nasa/videos/', 'https://www.facebook.com/search/videos/?q=cats']) { r = await run(u); eq('facebook listing refused without any request: ' + u, [r.typed, /many posts/.test(r.err), calls.length], [true, true, 0]); }
r = await run('https://x.com/home'); eq('x home refused', /single post/.test(r.err), true);
r = await run('https://example.com/stream.m3u8'); eq('playlist refused', /playlist/.test(r.err), true);
r = await run('http://example.com/clip.mp4'); eq('plain http direct link is left as http', r.items, ['http://example.com/clip.mp4']);
r = await run('https://example.com/watch/123', { videoSrc: 'https://cdn.example.com/files/my-clip.mp4', pageUrl: 'https://example.com/watch/123' });
eq('other site: title from file name, source is the page', [r.title, r.src], ['my-clip', 'https://example.com/watch/123']);

// --- reddit
const post = { title: 'Cat vacuum', subreddit_name_prefixed: 'r/aww', permalink: '/r/aww/comments/abc123/cat/', domain: 'v.redd.it', secure_media: { reddit_video: { fallback_url: 'https://v.redd.it/vid9/CMAF_720.mp4?source=fallback', dash_url: 'https://v.redd.it/vid9/DASHPlaylist.mpd', has_audio: true } } };
const listing = (p) => JSON.stringify([{ data: { children: [{ data: p }] } }]);
routes.push([/comments\/abc123\.json/, () => ({ body: listing(post) })]);
routes.push([/comments\/abc123\/$/, () => ({ body: `<shreddit-post id="t3_other1"><shreddit-player-2 packaged-media-json="${pk('https://packaged-media.redd.it/AD.mp4')}"></shreddit-player-2></shreddit-post>` })]);
routes.push([/vid9\/DASHPlaylist/, () => ({ body: '<AdaptationSet contentType="video"><Representation bandwidth="2" height="1080"><BaseURL>CMAF_1080.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation bandwidth="128000"><BaseURL>CMAF_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet>' })]);
r = await run('np.reddit.com/r/aww/comments/abc123/cat/');
eq('reddit: another post\'s player on the page is not used', r.items, [['https://v.redd.it/vid9/CMAF_1080.mp4', 'https://v.redd.it/vid9/CMAF_AUDIO_128.mp4']]);
routes.push([/^https:\/\/v\.redd\.it\/vid9$/, () => ({ url: 'https://www.reddit.com/r/aww/comments/abc123/cat/', body: '' })]);
r = await run('https://v.redd.it/vid9/DASH_720.mp4');
eq('v.redd.it file address resolves its post (with sound)', [r.items, calls[0]], [[['https://v.redd.it/vid9/CMAF_1080.mp4', 'https://v.redd.it/vid9/CMAF_AUDIO_128.mp4']], 'https://v.redd.it/vid9']);
const quiet = { ...post, permalink: '/r/aww/comments/noaud1/x/', secure_media: { reddit_video: { fallback_url: 'https://v.redd.it/vq/CMAF_720.mp4', dash_url: 'https://v.redd.it/vq/DASHPlaylist.mpd', has_audio: true } } };
routes.push([/comments\/noaud1\.json/, () => ({ body: listing(quiet) })]);
routes.push([/v\.redd\.it\/vq\//, () => ({ throw: true })]);
r = await run('https://www.reddit.com/r/aww/comments/noaud1/x/');
eq('reddit: audio lookup failed -> flagged as no sound', [r.items, r.noAudio], [['https://v.redd.it/vq/CMAF_720.mp4'], [true]]);
routes.push([/comments\/self01\.json/, () => ({ body: listing({ title: 'Question', permalink: '/r/AskReddit/comments/self01/q/', domain: 'self.AskReddit', is_self: true }) })]);
r = await run('https://www.reddit.com/r/AskReddit/comments/self01/q/');
eq('reddit text post message', r.err, 'That Reddit post is text, not a video.');
routes.push([/comments\/blk403/, () => ({ status: 403, body: '' })]);
r = await run('https://www.reddit.com/r/aww/comments/blk403/x/'); eq('reddit blocked says so', /error \(403\)/.test(r.err), true);
routes.push([/comments\/ext111\.json/, () => ({ body: listing({ title: 'Outside', permalink: '/r/videos/comments/ext111/o/', domain: 'attacker.example', url_overridden_by_dest: 'https://attacker.example/x.mp4' }) })]);
r = await run('https://www.reddit.com/r/videos/comments/ext111/o/');
eq('outside-hosted file is returned for the background to ask about', r.items, ['https://attacker.example/x.mp4']);

// --- facebook end to end
routes.push([/facebook\.com\/watch/, (u) => ({ url: 'https://www.facebook.com/watch/?v=1234567890', body: `<meta property="og:title" content="Tom&#039;s sunset | Facebook">{"id":"1234567890","browser_native_hd_url":"https:\\/\\/video.fbcdn.net\\/hd.mp4?a=1\\u0026b=2"}` })]);
r = await run('https://mobile.facebook.com/watch/?v=1234567890');
eq('facebook mobile host is fetched from www', [r.items, r.title, calls[0]], [['https://video.fbcdn.net/hd.mp4?a=1&b=2'], "Tom's sunset", 'https://www.facebook.com/watch/?v=1234567890']);
routes.push([/facebook\.com\/LoginVSI\/videos\/1234567/, () => ({ body: `{"id":"1234567","browser_native_hd_url":"https:\\/\\/video.fbcdn.net\\/l.mp4"}` })]);
r = await run('https://www.facebook.com/LoginVSI/videos/1234567');
eq('a page named "Login…" is not mistaken for the login wall', r.items, ['https://video.fbcdn.net/l.mp4']);
routes.push([/fb\.watch\/abc/, () => ({ url: 'https://www.facebook.com/login/?next=x', body: 'log in' })]);
r = await run('https://fb.watch/abc/'); eq('facebook login wall', /log in/.test(r.err), true);
routes.push([/fb\.watch\/offsite/, () => ({ url: 'https://attacker.example/page', body: '{"browser_native_hd_url":"https:\\/\\/attacker.example\\/x.mp4"}' })]);
r = await run('https://fb.watch/offsite/'); eq('facebook redirect to another site is refused', /another site/.test(r.err), true);
routes.push([/facebook\.com\/user\/posts\/two/, () => ({ body: j('1', 'browser_native_hd_url', 'a.mp4') + j('2', 'browser_native_hd_url', 'b.mp4') })]);
r = await run('https://www.facebook.com/user/posts/two'); eq('facebook post with two videos and no ID is refused', /more than one video/.test(r.err), true);

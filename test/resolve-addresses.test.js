import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, ResolveError, canonicalUrl, extractUrl, detectSite, findFbVideoUrl, packagedForPost } from '../extension/lib/resolve.js';
// Each check is its own test, so a failure names exactly what broke.
const eq = (name, got, want) => test(name, () => assert.deepEqual(got, want));
let calls = [];
globalThis.fetch = async (url) => { calls.push(url); return { ok: false, status: 404, url, text: async () => '', json: async () => ({}) }; };
const run = async (u, h = {}, o = {}) => { calls = []; try { const r = await resolve(u, h, o); return { site: r.site, items: r.items.map((i) => i.url) }; } catch (e) { return { err: e.message, typed: e instanceof ResolveError }; } };

// --- the address-reading mismatch: checked form and used form must be the same thing
const tricky = "https://evil.mov'@x.com/a/status/1";
eq('address with a user name is not a valid link', canonicalUrl(tricky), null);
eq('...also with a space before @', canonicalUrl('https://evil.mov @x.com/a/status/1'), null);
eq('...and a password', canonicalUrl('https://a:b@x.com/a/status/1'), null);
eq('backslash trick resolves to the real host', detectSite(canonicalUrl('https://evil.mov\\@x.com/a/status/1') || ''), null);
eq('non-http refused', [canonicalUrl('javascript:alert(1)'), canonicalUrl('file:///etc/passwd'), canonicalUrl('data:text/html,x')], [null, null, null]);
eq('over-long address refused', canonicalUrl('https://x.com/' + 'a'.repeat(5000)), null);
let r = await run(tricky);
eq('resolver refuses the tricky address outright, no request made', [r.typed, /doesn.t look like a link/.test(r.err), calls.length], [true, true, 0]);
r = await run(tricky, {}, { pasted: true });
eq('...and when pasted, the cut-down part is never treated as a site post', r.site === 'x', false);
r = await run('https://x.com/a/status/1', { videoSrc: "https://evil.mov'@video.twimg.com/v.mp4" });
eq('tricky video address in a hint is ignored', r.items, undefined);
r = await run('look https://x.com/home');
eq('free text is only searched when pasted', /doesn.t look like a link/.test(r.err), true);

// --- slow patterns: these inputs used to take seconds
const timed = (fn) => { const t = Date.now(); fn(); return Date.now() - t; };
eq('long run of ")" trims fast', timed(() => extractUrl('https://x.com/' + ')'.repeat(8000) + 'a')) < 1500, true);
const hostile = '<link '.repeat(4000) + 'rel="canonical" '.repeat(4000) + '<meta '.repeat(4000) + 'property="og:url" '.repeat(4000);
globalThis.fetch = async (url) => ({ ok: true, status: 200, url, text: async () => hostile, json: async () => ({}) });
let ms = Date.now(); r = await run('https://www.reddit.com/r/a/s/AbCdEf'); ms = Date.now() - ms;
eq('hostile page with no ">" is handled fast (' + ms + ' ms)', ms < 3000, true);
const fbHostile = '<meta '.repeat(20000) + 'content="x" '.repeat(20000) + '{"browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/a.mp4"}';
globalThis.fetch = async (url) => ({ ok: true, status: 200, url, text: async () => fbHostile, json: async () => ({}) });
ms = Date.now(); r = await run('https://www.facebook.com/reel/1234567890'); ms = Date.now() - ms;
eq('hostile Facebook page handled fast (' + ms + ' ms)', ms < 3000, true);

// --- facebook picker
const j = (id, kind, file, key = 'id') => `{"${key}":"${id}","${kind}":"https:\\/\\/v.fbcdn.net\\/${file}"}`;
const pad = (n) => 'x'.repeat(n);
eq('several videos, only one has HD, no ID -> refuse', findFbVideoUrl(`{"browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/A-hd.mp4","browser_native_sd_url":"https:\\/\\/v.fbcdn.net\\/A-sd.mp4"}` + pad(9000) + `{"browser_native_sd_url":"https:\\/\\/v.fbcdn.net\\/B-sd.mp4"}`, null), { ambiguous: true });
eq('same video listed twice counts once', findFbVideoUrl(`{"browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/A-hd.mp4","browser_native_sd_url":"https:\\/\\/v.fbcdn.net\\/A-sd.mp4"}` + pad(9000) + `{"browser_native_sd_url":"https:\\/\\/v.fbcdn.net\\/A-sd.mp4"}`, null), { url: 'https://v.fbcdn.net/A-hd.mp4' });
eq('two videos side by side, no ID -> refuse', findFbVideoUrl(j('1', 'browser_native_hd_url', 'a.mp4') + j('2', 'browser_native_hd_url', 'b.mp4'), null), { ambiguous: true });
eq('ID in a caption does not steer the pick', findFbVideoUrl(j('1234567890', 'browser_native_hd_url', 'mine.mp4') + pad(9000) + `{"caption":"watch 1234567890 now","browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/other.mp4"}`, '1234567890'), { url: 'https://v.fbcdn.net/mine.mp4' });
eq('video_id field counts as the ID', findFbVideoUrl(j('999', 'browser_native_hd_url', 'other.mp4') + pad(9000) + j('1234567890', 'browser_native_sd_url', 'mine.mp4', 'video_id'), '1234567890'), { url: 'https://v.fbcdn.net/mine.mp4' });
eq('ID field present but the video is far away -> nothing', findFbVideoUrl(`{"video_id":"1234567890"}${pad(30000)}{"browser_native_hd_url":"https:\\/\\/v.fbcdn.net\\/other.mp4"}`, '1234567890'), null);
eq('non-web address in a field is ignored', findFbVideoUrl(`{"browser_native_hd_url":"javascript:alert(1)"}`, null), null);

// --- reddit packaged: only the post's own element, matched on its real id attribute
const pk = (u) => JSON.stringify({ playbackMp4s: { permutations: [{ source: { url: u, dimensions: { height: 720 } } }] } }).replace(/"/g, '&quot;');
eq('parent-id attribute is not mistaken for id', packagedForPost(`<shreddit-post id="t3_zzz" parent-id="t3_abc123"><shreddit-player-2 packaged-media-json="${pk('https://packaged-media.redd.it/OTHER.mp4')}"></shreddit-player-2></shreddit-post>`, 'abc123'), null);
eq('own element still found', packagedForPost(`<shreddit-post permalink="/x" id="t3_abc123" post-title="t"><shreddit-player-2 packaged-media-json="${pk('https://packaged-media.redd.it/MINE.mp4')}"></shreddit-player-2></shreddit-post>`, 'abc123'), 'https://packaged-media.redd.it/MINE.mp4');

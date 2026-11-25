import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromOwnPage, cleanHint, pageLimiter, copyLimiter, siteForSave, foreignUrl, redirectedAway,
  sameVideo, alreadySaved, pageSaveResult,
} from '../extension/lib/trust.js';

const ME = 'phdbcmaifcaagmfkmbdhokgmkldllajj';
const ORIGIN = `chrome-extension://${ME}`;

/* ------------------------------------------------------------- who is asking */

test('fromOwnPage: only the extension’s own pages are trusted', () => {
  assert.equal(fromOwnPage({ id: ME, origin: ORIGIN, url: `${ORIGIN}/popup.html` }, ME, ORIGIN), true);
  assert.equal(fromOwnPage({ id: ME, url: `${ORIGIN}/history.html` }, ME, ORIGIN), true);
  // A content script carries our id but the web page's origin and address.
  assert.equal(fromOwnPage({ id: ME, origin: 'https://x.com', url: 'https://x.com/a/status/1', tab: { id: 3 } }, ME, ORIGIN), false);
  // Another extension.
  assert.equal(fromOwnPage({ id: 'abcdefghijklmnopabcdefghijklmnop', origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }, ME, ORIGIN), false);
  // An address that merely starts with our origin's text.
  assert.equal(fromOwnPage({ id: ME, url: `${ORIGIN}.evil.example/` }, ME, ORIGIN), false);
  assert.equal(fromOwnPage(undefined, ME, ORIGIN), false);
});

test('cleanHint: keeps only same-site post links and the site’s own media host', () => {
  const h = cleanHint({
    postUrl: 'https://x.com/a/status/123', videoSrc: 'https://video.twimg.com/v.mp4',
    titleHint: 'T', index: 2, quoted: true, force: true,
  }, 'https://x.com/home');
  assert.deepEqual(h, {
    pageUrl: 'https://x.com/home', titleHint: 'T', index: 2, quoted: true, force: true,
    postUrl: 'https://x.com/a/status/123', videoSrc: 'https://video.twimg.com/v.mp4',
  });
});

test('cleanHint: drops addresses a page could use to reach elsewhere', () => {
  const page = 'https://x.com/home';
  assert.equal(cleanHint({ postUrl: 'https://www.reddit.com/comments/abc/' }, page).postUrl, undefined);   // another site
  assert.equal(cleanHint({ videoSrc: 'https://attacker.example/v.mp4' }, page).videoSrc, undefined);        // not X's media host
  assert.equal(cleanHint({ videoSrc: 'http://video.twimg.com/v.mp4' }, page).videoSrc, undefined);          // not https
  assert.equal(cleanHint({ videoSrc: 'https://video.twimg.com/v.m3u8' }, page).videoSrc, undefined);        // a playlist
  assert.equal(cleanHint({ postUrl: 'https://user:pw@x.com/a/status/1' }, page).postUrl, undefined);       // user name in the link
  assert.equal(cleanHint({ postUrl: 'javascript:alert(1)' }, page).postUrl, undefined);
});

test('cleanHint: a page can never approve another host', () => {
  const h = cleanHint({ allowHost: 'attacker.example', postUrl: 'https://x.com/a/status/1' }, 'https://x.com/home');
  assert.equal('allowHost' in h, false);
});

test('cleanHint: Reddit’s packaged player data only from Reddit, and size-limited', () => {
  assert.equal(cleanHint({ packaged: '{}' }, 'https://www.reddit.com/r/a/').packaged, '{}');
  assert.equal(cleanHint({ packaged: '{}' }, 'https://x.com/home').packaged, undefined);
  assert.equal(cleanHint({ packaged: 'x'.repeat(20000) }, 'https://www.reddit.com/r/a/').packaged, undefined);
});

test('cleanHint: off the three sites, no addresses are taken at all', () => {
  const h = cleanHint({ postUrl: 'https://example.com/p', videoSrc: 'https://example.com/v.mp4' }, 'https://example.com/p');
  assert.equal(h.postUrl, undefined);
  assert.equal(h.videoSrc, undefined);
  assert.equal(h.pageUrl, 'https://example.com/p');
});

test('cleanHint: odd values are made safe', () => {
  const h = cleanHint({ titleHint: 'a'.repeat(1000), index: 99, quoted: 'yes', force: 1 }, 'chrome://settings');
  assert.equal(h.titleHint.length, 300);
  assert.equal(h.index, 0);
  assert.equal(h.quoted, false);
  assert.equal(h.force, false);
  assert.equal(h.pageUrl, '');
  assert.deepEqual(cleanHint(null, '').index, 0);
  assert.equal(cleanHint({ index: 1.5 }, '').index, 0);
});

test('pageLimiter: caps saves running at once and started per minute, per tab', () => {
  let now = 0;
  const admit = pageLimiter({ maxRunning: 2, perMinute: 3, now: () => now });
  const a = admit(1), b = admit(1);
  assert.ok(a && b);
  assert.equal(admit(1), null, 'a third at once is refused');
  assert.ok(admit(2), 'another tab has its own limit');
  a(); a();                       // releasing twice counts once
  const c = admit(1);
  assert.ok(c);
  c();
  assert.equal(admit(1), null, 'four started within a minute');
  now = 61000;
  assert.ok(admit(1), 'a minute later it is allowed again');
});

test('copyLimiter: page saves copy at most once per gap per tab; own pages always', () => {
  let now = 0;
  const allowed = copyLimiter({ gapMs: 10000, now: () => now });
  assert.equal(allowed({ fromPage: true, tabId: 1 }), true);
  now = 5000;
  assert.equal(allowed({ fromPage: true, tabId: 1 }), false);
  assert.equal(allowed({ fromPage: true, tabId: 2 }), true);
  assert.equal(allowed({ pasted: true }), true);
  now = 10001;
  assert.equal(allowed({ fromPage: true, tabId: 1 }), true);
});

/* ------------------------------------------------------------ what is saved */

const xPost = (items) => ({ site: 'x', id: '1', items });
const direct = (url, index = 1) => ({ kind: 'direct', url, index });

test('siteForSave: a save stays on the site it started from', () => {
  assert.equal(siteForSave(xPost([direct('https://video.twimg.com/a.mp4')]), 'x'), 'x');
  assert.equal(siteForSave(xPost([direct('https://video.twimg.com/a.mp4')]), null), 'x', 'a popup paste may be any site');
  assert.equal(siteForSave({ site: 'reddit', items: [] }, 'x'), null, 'an X page can’t start a Reddit save');
  assert.equal(siteForSave({ site: 'web', items: [direct('https://example.com/a.mp4')] }, 'x'), null);
  assert.equal(siteForSave({ site: 'web', items: [direct('https://example.com/a.mp4')] }, 'web'), 'web');
});

test('siteForSave: the site’s own video file is filed under that site', () => {
  assert.equal(siteForSave({ site: 'web', items: [direct('https://video.twimg.com/a.mp4')] }, 'x'), 'x');
  assert.equal(siteForSave({ site: 'web', items: [{ kind: 'mux', video: 'https://v.redd.it/a/v.mp4', audio: 'https://example.com/a.mp4' }] }, 'reddit'), null,
    'every track must be on the media host');
});

test('foreignUrl: only the site’s own media host is allowed without asking', () => {
  assert.equal(foreignUrl('x', ['https://video.twimg.com/a.mp4']), '');
  assert.equal(foreignUrl('reddit', ['https://v.redd.it/a/DASH_720.mp4', 'https://v.redd.it/a/DASH_AUDIO_128.mp4']), '');
  assert.equal(foreignUrl('reddit', ['https://i.imgur.com/a.mp4']), 'https://i.imgur.com/a.mp4');
  assert.equal(foreignUrl('reddit', ['https://i.imgur.com/a.mp4'], 'i.imgur.com'), '', 'a host the user agreed to');
  assert.equal(foreignUrl('x', ['http://video.twimg.com/a.mp4']), 'http://video.twimg.com/a.mp4', 'plain http is asked about');
  assert.equal(foreignUrl('x', ['https://video.twimg.com.attacker.example/a.mp4']), 'https://video.twimg.com.attacker.example/a.mp4');
  assert.equal(foreignUrl('web', ['https://example.com/a.mp4']), '', 'a pasted file link is its own host');
  assert.equal(foreignUrl('x', ['https://%zz/a.mp4']), 'https://%zz/a.mp4', 'an address with no readable host is never approved by default');
});

test('redirectedAway: a download that lands off the agreed host is caught', () => {
  const entry = { site: 'x', mediaHost: 'video.twimg.com', error: '' };
  assert.equal(redirectedAway(entry, { finalUrl: 'https://video.twimg.com/a.mp4' }), false);
  assert.equal(redirectedAway(entry, { finalUrl: 'https://pbs.twimg.com/a.mp4' }), false, 'same media host family');
  assert.equal(redirectedAway(entry, { finalUrl: 'https://attacker.example/a.mp4' }), true);
  assert.equal(redirectedAway({ ...entry, error: 'REDIRECTED' }, { finalUrl: 'https://attacker.example/a.mp4' }), false, 'already stopped');
  assert.equal(redirectedAway({ site: 'reddit', mediaHost: 'i.imgur.com', error: '' }, { finalUrl: 'https://i.imgur.com/a.mp4' }), false, 'the host the user agreed to');
  assert.equal(redirectedAway({ site: 'reddit', mediaHost: 'v.redd.it', error: '' }, { finalUrl: 'blob:chrome-extension://x/1' }), false, 'a merged file');
  assert.equal(redirectedAway({ site: 'web', mediaHost: 'example.com', error: '' }, { finalUrl: 'https://cdn.example.net/a.mp4' }), false, 'other websites may redirect');
});

/* ------------------------------------------------------------ saved before? */

const entry = (over) => ({ id: 'e1', site: 'x', postId: '1', index: 1, state: 'complete', mediaUrl: '', sourceUrl: 'https://x.com/a/status/1', ...over });

test('sameVideo: matches on site, post and position', () => {
  const r = xPost([]);
  assert.equal(sameVideo(entry(), r, direct('u', 1)), true);
  assert.equal(sameVideo(entry({ index: 2 }), r, direct('u', 1)), false);
  assert.equal(sameVideo(entry({ site: 'reddit' }), r, direct('u', 1)), false);
  assert.equal(sameVideo(entry({ postId: '2' }), r, direct('u', 1)), false);
  assert.equal(sameVideo(entry({ imported: true }), r, direct('u', 1)), false, 'backups never count');
  assert.equal(sameVideo(entry({ postId: '' }), { ...r, sourceUrl: 'https://x.com/a/status/1' }, direct('u')), true, 'entries from before 1.4 match by address');
  const web = { site: 'web', id: 'h', items: [] };
  assert.equal(sameVideo(entry({ site: 'web', mediaUrl: 'https://e.com/a.mp4' }), web, direct('https://e.com/a.mp4')), true);
  assert.equal(sameVideo(entry({ site: 'web', mediaUrl: 'https://e.com/a.mp4' }), web, direct('https://e.com/b.mp4')), false);
});

test('alreadySaved: a finished file that is still there counts', async () => {
  const deps = { isMerging: () => false, lookup: async () => ({ state: 'complete', exists: true }) };
  const found = await alreadySaved([entry()], xPost([]), direct('u'), deps);
  assert.deepEqual(found, { entry: entry(), busy: false });
});

test('alreadySaved: a deleted file, a failed save or a dead merge does not', async () => {
  const gone = { isMerging: () => false, lookup: async () => ({ state: 'complete', exists: false }) };
  assert.equal(await alreadySaved([entry()], xPost([]), direct('u'), gone), null);
  const any = { isMerging: () => false, lookup: async () => null };
  assert.equal(await alreadySaved([entry({ state: 'interrupted' })], xPost([]), direct('u'), any), null);
  assert.equal(await alreadySaved([entry({ state: 'merging' })], xPost([]), direct('u'), any), null);
  assert.equal(await alreadySaved([entry({ state: 'in_progress' })], xPost([]), direct('u'), { ...any, lookup: async () => ({ state: 'interrupted' }) }), null);
});

test('alreadySaved: a save in progress is reported as busy', async () => {
  const merging = await alreadySaved([entry({ state: 'merging' })], xPost([]), direct('u'), { isMerging: () => true, lookup: async () => null });
  assert.equal(merging.busy, true);
  const downloading = await alreadySaved([entry({ state: 'in_progress' })], xPost([]), direct('u'), { isMerging: () => false, lookup: async () => ({ state: 'in_progress' }) });
  assert.equal(downloading.busy, true);
});

test('alreadySaved: an entry Chrome no longer lists still counts, and lookup errors are survived', async () => {
  assert.ok(await alreadySaved([entry()], xPost([]), direct('u'), { isMerging: () => false, lookup: async () => null }));
  assert.ok(await alreadySaved([entry()], xPost([]), direct('u'), { isMerging: () => false, lookup: async () => { throw new Error('x'); } }));
});

/* ------------------------------------------------------- answers to a page */

test('pageSaveResult: questions are turned into directions to the popup', () => {
  assert.match(pageSaveResult({ ok: false, needsConfirm: true, host: 'i.imgur.com' }).error, /i\.imgur\.com.*paste the post link/);
  assert.equal(pageSaveResult({ ok: false, needsConfirm: true, host: 'h' }).needsConfirm, undefined);
  assert.match(pageSaveResult({ ok: false, duplicate: true, error: 'Already saved today: T' }).error, /^Already saved today: T\. To save another copy/);
  const ok = { ok: true, title: 'T' };
  assert.equal(pageSaveResult(ok), ok);
});

test('describeSave: one wording for every place a save is reported', async () => {
  const { describeSave } = await import('../extension/lib/trust.js');
  assert.equal(describeSave({ ok: true, title: 'T', count: 1 }), 'Download started: T');
  assert.equal(describeSave({ ok: true, title: 'T', count: 3, detail: '720p version', warning: 'It will have no sound.' }), 'Download started: 3 videos from: T (720p version). It will have no sound.');
  assert.equal(describeSave({ ok: true }), 'Download started: video');
  assert.equal(describeSave({ ok: false, error: 'Nope.' }), 'Nope.');
  assert.equal(describeSave({ ok: false }), 'Download failed.');
  assert.equal(describeSave({ ok: true, message: 'Saved and copied.' }), 'Saved and copied.');
});

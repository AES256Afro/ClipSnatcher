// Turns a post URL (plus optional hints scraped from the page) into downloadable media.
// All requests go straight from your browser to the site that hosts the post.
//
// Result shape:
// { site, id, title, author, sourceUrl, thumb,
//   items: [ {kind:'direct', url, index, noAudio?} | {kind:'mux', video, audio, index} ] }
// `index` is the video's 1-based position in the post (used by "Download again").
//
// Rule of thumb for this file: never guess. If a link doesn't identify one post, or a
// page doesn't identify one video, throw a ResolveError that tells the user to open
// the post itself.

export class ResolveError extends Error {}

// Reddit and Facebook only show some posts to logged-in users, so those requests
// carry the browser's existing login for that site.
const WITH_LOGIN = { credentials: 'include', cache: 'no-store' };
const TIMEOUT_MS = 20000;

export const SITE_LABEL = { x: 'X', reddit: 'Reddit', facebook: 'Facebook' };

// The only hosts a site's own videos (and thumbnails) are served from.
const MEDIA_HOSTS = {
  x: /(^|\.)twimg\.com$/,
  reddit: /(^|\.)redd\.it$/,
  facebook: /(^|\.)fbcdn\.net$/,
};

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

export const isHttp = (url) => /^https?:\/\//i.test(url || '');
export const isPlaylist = (url) => /\.(m3u8|mpd)(\?|#|$)/i.test(url || '');

export function isSiteMediaUrl(site, url) {
  return /^https:\/\//i.test(url || '') && !!MEDIA_HOSTS[site]?.test(hostOf(url));
}

export function detectSite(url) {
  const h = hostOf(url).replace(/^(www|m|mobile|web|old|np|new|sh)\./, '');
  if (h === 'x.com' || h === 'twitter.com') return 'x';
  if (h === 'reddit.com' || h === 'redd.it' || h === 'v.redd.it') return 'reddit';
  if (h === 'facebook.com' || h === 'fb.watch' || h === 'fb.com') return 'facebook';
  return null;
}

export function looksLikeDirectVideo(url) {
  return /^https?:\/\/[^?#]+\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url || '');
}

const MAX_URL = 4096;

// Parses an address the strict way the browser does and returns its canonical form, or
// null if it isn't a plain http(s) link. Every address is passed through this once, and
// the canonical form is what gets checked AND used, so the two can never disagree.
// Links with a user name or password are refused: the part before "@" can be made to
// look like a different site.
export function canonicalUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL) return null;
  let u;
  try { u = new URL(value.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  return u.href;
}

// Pull a link out of text a person pasted: "look at this (https://x.com/...)." or
// "x.com/a/status/1". Only used for the popup's paste box, never for addresses from pages.
export function extractUrl(text) {
  const t = String(text || '').slice(0, 2 * MAX_URL).trim();
  const trim = (u) => { let end = u.length; while (end > 0 && ')].,;!?\'"'.includes(u[end - 1])) end--; return u.slice(0, end); };
  const full = t.match(/https?:\/\/[^\s<>"']+/i);
  if (full) return trim(full[0]);
  const bare = t.split(/\s+/).find((s) => /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*/i.test(s));
  return bare ? 'https://' + trim(bare) : t;
}

// For the three sites: fetch over https, from a host the extension has permission for.
// Other addresses are left exactly as given.
function normalizeUrl(url, site) {
  if (!site) return url;
  try {
    const u = new URL(url);
    if (site === 'reddit' && /^((np|new|sh|m|www)\.)?reddit\.com$/.test(u.hostname)) u.hostname = 'www.reddit.com';
    if (site === 'facebook') u.hostname = /(^|\.)fb\.watch$/.test(u.hostname) ? 'fb.watch' : 'www.facebook.com';
    u.protocol = 'https:';
    return u.href;
  } catch { return url; }
}

async function net(url, opts, label) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...opts });
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new ResolveError(offline ? 'You appear to be offline.' : `Couldn’t reach ${label}. Check your connection and try again.`);
  }
}

/**
 * @param {string} input   an address; with `pasted`, any text a person typed or pasted
 * @param {object} hint    extra details from the page (already validated by the caller)
 */
export async function resolve(input, hint = {}, { pasted = false } = {}) {
  const raw = canonicalUrl(pasted ? extractUrl(input) : String(input || ''));
  if (!raw) throw new ResolveError('That doesn’t look like a link. Paste the address of a post.');
  const site = detectSite(raw);
  const url = normalizeUrl(raw, site);
  const src = canonicalUrl(hint.videoSrc);
  const hintSrc = src && !isPlaylist(src) ? src : null;

  if (site) {
    try {
      if (site === 'x') return await resolveX(url, hint);
      if (site === 'reddit') return await resolveReddit(url, hint);
      return await resolveFacebook(url, hint);
    } catch (err) {
      // Last resort: the page handed us the video file itself.
      if (hintSrc) return directFromHint(url, hint, hintSrc, site);
      throw err;
    }
  }
  if (isPlaylist(url)) throw new ResolveError('That link is a stream playlist, not a video file, so it can’t be saved.');
  if (looksLikeDirectVideo(url)) {
    return { site: 'web', id: shortHash(url), title: hint.titleHint || fileStem(url), author: '', sourceUrl: isHttp(hint.pageUrl) ? hint.pageUrl : url, thumb: null, items: [{ kind: 'direct', url, index: 1 }] };
  }
  if (hintSrc) return directFromHint(url, hint, hintSrc, 'web');
  throw new ResolveError('That site isn’t supported yet. Works with X/Twitter, Reddit and Facebook posts, or direct .mp4 links.');
}

function directFromHint(url, hint, src, site) {
  const sourceUrl = isHttp(hint.postUrl) ? hint.postUrl : (site === 'web' && isHttp(hint.pageUrl) ? hint.pageUrl : url);
  return { site, id: shortHash(src), title: hint.titleHint || fileStem(src), author: '', sourceUrl, thumb: null, items: [{ kind: 'direct', url: src, index: 1 }] };
}

/* ----------------------------------------------------------------- X / Twitter */

// Same token the official embed widget computes. The precision loss from Number()
// on a 19-digit ID is intentional: the widget does the same.
export function xToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function xVideos(tweet) {
  return (tweet?.mediaDetails || []).filter((m) => m.type === 'video' || m.type === 'animated_gif');
}

async function resolveX(url, hint) {
  const m = url.match(/\/status(?:es)?\/(\d+)/);
  if (!m) throw new ResolveError('That X link isn’t a single post. Open the post itself, then save from there.');
  const id = m[1];
  const res = await net(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${xToken(id)}&lang=en`, { cache: 'no-store' }, 'X');
  if (res.status === 404) throw new ResolveError('X says this post doesn’t exist or isn’t public.');
  if (!res.ok) throw new ResolveError(`X returned an error (${res.status}). Try again in a moment.`);
  const text = await res.text();
  if (!text) throw new ResolveError('X didn’t share this post (it may be age-restricted or from a protected account).');
  let tweet;
  try { tweet = JSON.parse(text); } catch { throw new ResolveError('X sent back something unexpected. Try again in a moment.'); }
  if (tweet.__typename === 'TweetTombstone') throw new ResolveError('This post is unavailable (deleted, protected or age-restricted).');

  let source = tweet;
  let vids = xVideos(tweet);
  if (hint.quoted || !vids.length) {
    const q = xVideos(tweet.quoted_tweet);
    if (q.length) { vids = q; source = tweet.quoted_tweet; }
  }
  if (!vids.length) throw new ResolveError('No video found in this post.');

  // /video/2 in the URL, or the position of the hovered player, picks one video.
  let picked = vids.map((v, i) => ({ v, index: i + 1 }));
  const want = Number(url.match(/\/video\/(\d+)/)?.[1] || hint.index || 0);
  if (want >= 1 && want <= vids.length) picked = [picked[want - 1]];

  const items = picked.map(({ v, index }) => {
    const mp4 = (v.video_info?.variants || []).filter((x) => x.content_type === 'video/mp4' && isHttp(x.url));
    mp4.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    if (!mp4.length) throw new ResolveError('This video is only offered as a stream, not a file.');
    return { kind: 'direct', url: mp4[0].url, index, thumb: v.media_url_https || null };
  });

  const user = /^\w{1,20}$/.test(source.user?.screen_name || '') ? source.user.screen_name : '';
  const postId = /^\d+$/.test(source.id_str || '') ? source.id_str : id;
  const textClean = (source.text || '').replace(/https?:\/\/t\.co\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return {
    site: 'x',
    id: postId,
    title: textClean || (user ? `Video by @${user}` : `X video ${id}`),
    author: user ? '@' + user : '',
    sourceUrl: `https://x.com/${user || 'i'}/status/${postId}`,
    thumb: picked[0].v.media_url_https || null,
    items,
  };
}

/* ---------------------------------------------------------------------- Reddit */

function codePoint(n) {
  try { return String.fromCodePoint(n); } catch { return ''; }
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

// Reddit's own "packaged" MP4 already has sound. Only accept it from Reddit's media host.
export function bestPackaged(raw) {
  if (!raw) return null;
  try {
    const j = typeof raw === 'string' ? JSON.parse(decodeEntities(raw)) : raw;
    let best = null;
    for (const p of j?.playbackMp4s?.permutations || []) {
      const url = decodeEntities(p?.source?.url || '');
      const h = Number(p?.source?.dimensions?.height) || 0;
      if (isSiteMediaUrl('reddit', url) && (!best || h > best.h)) best = { h, url };
    }
    return best?.url || null;
  } catch { return null; }
}

// Walks the opening tags named `name` in a page, in one pass. Used instead of running
// regular expressions over whole pages, which can be made very slow by hostile input.
// Positions are found on the page text itself (never a lower-cased copy, whose length
// can differ), and a ">" inside a quoted attribute value doesn't end the tag.
const MAX_TAGS = 5000, MAX_TAG_CHARS = 8192;
function* tagsOf(html, name) {
  const open = new RegExp('<' + name + '(?=[\\s>/])', 'gi');
  for (let n = 0, m; n < MAX_TAGS && (m = open.exec(html)); n++) {
    const at = m.index;
    const limit = Math.min(html.length, at + MAX_TAG_CHARS);
    let end = at + m[0].length, quote = '';
    for (; end < limit; end++) {
      const c = html[end];
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
    }
    yield { at, tag: html.slice(at, end) };
  }
}
const attrOf = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1] ?? null;

// The post's page can hold other players (ads, recommended videos). Only read the one
// inside the requested post's own element.
export function packagedForPost(html, id) {
  for (const { at, tag } of tagsOf(html, 'shreddit-post')) {
    if (attrOf(tag, 'id') !== `t3_${id}`) continue;
    const end = html.indexOf('</shreddit-post>', at);
    return bestPackaged(html.slice(at, end < 0 ? at + 200000 : end).match(/packaged-media-json="([^"]+)"/)?.[1]);
  }
  return null;
}

const redditPostId = (url) => url.match(/\/comments\/([a-z0-9]+)/i)?.[1] || null;

async function redditCanonical(url) {
  if (redditPostId(url)) return url;
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'redd.it') {
    const id = u.pathname.match(/^\/([a-z0-9]+)\/?$/i)?.[1];
    if (id) return `https://www.reddit.com/comments/${id}/`;
  }
  // Only these short forms stand for exactly one post. Anything else is a listing.
  const isShare = /^\/(r|u|user)\/[^/]+\/s\/[A-Za-z0-9]+/.test(u.pathname);
  if (host !== 'v.redd.it' && !isShare) {
    throw new ResolveError('That Reddit page shows many posts. Open the post itself, then save from there.');
  }
  let target = url;
  if (host === 'v.redd.it') {
    // v.redd.it/<id>/DASH_720.mp4 is one track of a post. Resolve the post so sound comes too.
    const vid = u.pathname.split('/')[1] || '';
    if (!/^[A-Za-z0-9]+$/.test(vid)) throw new ResolveError('That Reddit video link is incomplete. Open the post and save from there.');
    target = `https://v.redd.it/${vid}`;
  }
  const res = await net(target, { ...WITH_LOGIN, redirect: 'follow' }, 'Reddit');
  if (redditPostId(res.url) && detectSite(res.url) === 'reddit') return res.url;
  const html = await res.text();
  let found = metaContent(html, 'og:url');
  for (const { tag } of tagsOf(html.slice(0, HEAD_CHARS), 'link')) {
    // A canonical link only replaces og:url when it actually carries an address.
    const href = attrOf(tag, 'rel') === 'canonical' ? canonicalUrl(decodeEntities(attrOf(tag, 'href') || '')) : null;
    if (href) { found = href; break; }
  }
  const canonical = canonicalUrl(found) || '';
  if (redditPostId(canonical) && detectSite(canonical) === 'reddit') return canonical;
  throw new ResolveError('Couldn’t find the Reddit post behind that link. Open the post and save from there.');
}

async function resolveReddit(url, hint) {
  const canonical = await redditCanonical(url);
  const id = redditPostId(canonical);

  let post = null;
  let problem = '';
  try {
    const res = await net(`https://www.reddit.com/comments/${id}.json?raw_json=1`, WITH_LOGIN, 'Reddit');
    if (res.ok) post = (await res.json())?.[0]?.data?.children?.[0]?.data || null;
    else problem = `Reddit answered with an error (${res.status}). Try again in a moment.`;
  } catch (e) {
    problem = e instanceof ResolveError ? e.message : 'Reddit sent back something unexpected.';
  }

  const media = post?.crosspost_parent_list?.[0] || post;
  const rv = media?.secure_media?.reddit_video || media?.media?.reddit_video || media?.preview?.reddit_video_preview;
  const previews = media?.preview?.images?.[0]?.resolutions || [];
  const preview = previews.find((p) => p.width >= 160) || previews[previews.length - 1];
  const permalink = /^\/r\/[^\s"]+$/.test(post?.permalink || '') ? post.permalink : `/comments/${id}/`;
  const base = {
    site: 'reddit', id,
    title: post?.title || hint.titleHint || `Reddit video ${id}`,
    author: post?.subreddit_name_prefixed || '',
    sourceUrl: `https://www.reddit.com${permalink}`,
    thumb: preview?.url || (isHttp(post?.thumbnail) ? post.thumbnail : null),
  };

  // 1) Reddit's own merged MP4, from the page we're on or from the post's page.
  let packaged = bestPackaged(hint.packaged);
  if (!packaged && (rv || !post)) {
    try {
      const html = await (await net(`https://www.reddit.com/comments/${id}/`, WITH_LOGIN, 'Reddit')).text();
      packaged = packagedForPost(html, id);
    } catch { /* fall through */ }
  }
  if (packaged) return { ...base, items: [{ kind: 'direct', url: packaged, index: 1 }] };

  if (!post) throw new ResolveError(problem || 'Reddit didn’t return this post. Try again in a moment.');

  // 2) A video file hosted somewhere else. The background asks before using another host.
  if (!rv) {
    const ext = media?.url_overridden_by_dest || media?.url || '';
    if (/^https:\/\/i\.imgur\.com\/[^?#]+\.gifv$/i.test(ext)) return { ...base, items: [{ kind: 'direct', url: ext.replace(/\.gifv$/i, '.mp4'), index: 1 }] };
    if (looksLikeDirectVideo(ext)) return { ...base, items: [{ kind: 'direct', url: ext, index: 1 }] };
    if (post.is_gallery) throw new ResolveError('That Reddit post is an image gallery, not a video.');
    if (post.is_self || /^self\./.test(post.domain || '')) throw new ResolveError('That Reddit post is text, not a video.');
    if (post.domain && !/redd\.it$/.test(post.domain)) throw new ResolveError(`That post links to ${String(post.domain).slice(0, 60)}, which ClipSnatcher doesn’t download from.`);
    throw new ResolveError('No Reddit video found in this post.');
  }

  // 3) Separate video and audio tracks: merge them locally.
  const vid = (rv.fallback_url || rv.dash_url || rv.hls_url || '').match(/v\.redd\.it\/([A-Za-z0-9]+)/)?.[1];
  if (!isHttp(rv.fallback_url) && !vid) throw new ResolveError('No Reddit video found in this post.');
  if (rv.has_audio === false || !vid) return { ...base, items: [{ kind: 'direct', url: rv.fallback_url, index: 1 }] };

  const tracks = await redditDashTracks(rv.dash_url, vid);
  const video = tracks.video || rv.fallback_url;
  const audio = tracks.audio || (await firstExisting([
    `https://v.redd.it/${vid}/DASH_AUDIO_128.mp4`, `https://v.redd.it/${vid}/CMAF_AUDIO_128.mp4`,
    `https://v.redd.it/${vid}/DASH_AUDIO_64.mp4`, `https://v.redd.it/${vid}/CMAF_AUDIO_64.mp4`,
    `https://v.redd.it/${vid}/DASH_audio.mp4`, `https://v.redd.it/${vid}/audio`,
  ]));
  // The post has sound but its audio track couldn't be found: save the picture and say so.
  if (!audio) return { ...base, items: [{ kind: 'direct', url: video, index: 1, noAudio: true }] };
  return { ...base, items: [{ kind: 'mux', video, audio, index: 1 }] };
}

// Reads the DASH manifest with regular expressions: there is no XML parser in a service worker.
export function parseDash(xml, vid) {
  const out = { video: null, audio: null };
  for (const set of String(xml).split(/<AdaptationSet/i).slice(1)) {
    const isAudio = /contentType="audio"|mimeType="audio/i.test(set);
    const isVideo = /contentType="video"|mimeType="video/i.test(set);
    let best = null;
    for (const rep of set.split(/<Representation/i).slice(1)) {
      const bandwidth = Number(rep.match(/bandwidth="(\d+)"/i)?.[1] || 0);
      const height = Number(rep.match(/height="(\d+)"/i)?.[1] || 0);
      const baseUrl = rep.match(/<BaseURL>([^<]+)<\/BaseURL>/i)?.[1];
      if (!baseUrl) continue;
      let url;
      try { url = new URL(decodeEntities(baseUrl.trim()), `https://v.redd.it/${vid}/`).href; } catch { continue; }
      if (!isSiteMediaUrl('reddit', url)) continue;
      // Taller wins; bandwidth breaks ties (height dominates because bandwidth < 1e9).
      const score = isVideo ? height * 1e9 + bandwidth : bandwidth;
      if (!best || score > best.score) best = { score, url };
    }
    if (best && isAudio && !out.audio) out.audio = best.url;
    if (best && isVideo && !out.video) out.video = best.url;
  }
  return out;
}

async function redditDashTracks(dashUrl, vid) {
  if (!isSiteMediaUrl('reddit', dashUrl)) return { video: null, audio: null };
  try {
    const res = await net(dashUrl, { cache: 'no-store' }, 'Reddit');
    if (!isSiteMediaUrl('reddit', res.url || dashUrl)) return { video: null, audio: null };   // redirected off Reddit's media host
    return parseDash(await res.text(), vid);
  } catch { return { video: null, audio: null }; }
}

async function firstExisting(urls) {
  for (const u of urls) {
    try {
      const r = await net(u, { method: 'HEAD', cache: 'no-store' }, 'Reddit');
      if (r.ok && isSiteMediaUrl('reddit', r.url || u)) return u;
    } catch { /* next */ }
  }
  return null;
}

/* -------------------------------------------------------------------- Facebook */

// The numeric ID of the one video an address stands for, or null.
export function fbVideoId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const p = u.pathname;
  const v = u.searchParams.get('v') || '';
  return p.match(/\/videos\/(?:[^/]+\/)?(\d{6,})\/?$/)?.[1]
    || p.match(/^\/reel\/(\d{6,})\/?$/)?.[1]
    || ((/^\/watch(\/live)?\/?$/.test(p) || p === '/video.php') && /^\d{6,}$/.test(v) ? v : null);
}

// True for addresses that stand for one video or one post, false for feeds, profiles,
// search results and a page's "Videos" tab. Only the path is examined, never the query.
export function fbIsSinglePost(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const p = u.pathname;
  if (u.hostname === 'fb.watch') return /^\/[A-Za-z0-9_-]+\/?$/.test(p);
  if (fbVideoId(url)) return true;
  return /^\/share\/(?:[vrp]\/)?[A-Za-z0-9]+\/?$/.test(p)
    || /\/posts\/[A-Za-z0-9]+\/?$/.test(p)
    || /\/permalink\/\d+\/?$/.test(p)
    || p === '/permalink.php' || p === '/story.php';
}

function unescapeJsonString(s) {
  try { return JSON.parse(`"${s}"`); } catch { return s.replace(/\\\//g, '/'); }
}

const HEAD_CHARS = 1000000;   // meta tags and the title live near the top of a page

function metaContent(html, prop) {
  for (const { tag } of tagsOf(html.slice(0, HEAD_CHARS), 'meta')) {
    if (attrOf(tag, 'property') === prop || attrOf(tag, 'name') === prop) return decodeEntities(attrOf(tag, 'content') || '');
  }
  return '';
}

function titleText(html) {
  for (const { at, tag } of tagsOf(html.slice(0, HEAD_CHARS), 'title')) {
    const start = at + tag.length + 1;
    const end = html.indexOf('<', start);
    return decodeEntities(html.slice(start, end < 0 || end - start > 2000 ? start + 2000 : end));
  }
  return '';
}

const FB_NEAR = 20000;   // a video address must sit this close (in characters) to the video's ID
const FB_SAME = 4000;    // addresses this close together belong to the same video (its HD and SD)

// Groups the addresses found in a page into distinct videos. Addresses that sit close
// together are one video; clusters that share an address are the same video seen twice.
function distinctVideos(found) {
  const clusters = [];
  for (const f of [...found].sort((x, y) => x.pos - y.pos)) {
    const last = clusters[clusters.length - 1];
    if (last && f.pos - last.end < FB_SAME) { last.items.push(f); last.end = f.pos; } else clusters.push({ items: [f], end: f.pos });
  }
  const groups = [];
  for (const c of clusters) {
    const merged = { urls: new Set(c.items.map((i) => i.url)), items: [...c.items] };
    for (const g of groups.filter((g) => [...merged.urls].some((u) => g.urls.has(u)))) {
      g.urls.forEach((u) => merged.urls.add(u));
      merged.items.push(...g.items);
      groups.splice(groups.indexOf(g), 1);
    }
    groups.push(merged);
  }
  return groups;
}

// One video has at most one address per quality level.
function oneVideo(items) {
  const perRank = new Map();
  for (const i of items) perRank.set(i.rank, (perRank.get(i.rank) || new Set()).add(i.url));
  return [...perRank.values()].every((urls) => urls.size === 1);
}

// Finds the address of one video in a Facebook page.
// Returns { url }, { ambiguous: true } when it can't tell which video is meant, or null.
export function findFbVideoUrl(html, id) {
  // Best quality first. Only JSON fields are read; free text can't imitate them
  // because Facebook escapes double quotes inside strings.
  const patterns = [
    /"browser_native_hd_url":"([^"]+)"/g,
    /"playable_url_quality_hd":"([^"]+)"/g,
    /"browser_native_sd_url":"([^"]+)"/g,
    /"playable_url":"([^"]+)"/g,
  ];
  const found = [];
  patterns.forEach((re, rank) => {
    for (const m of html.matchAll(re)) {
      const url = canonicalUrl(unescapeJsonString(m[1]));
      if (url) found.push({ url, pos: m.index, rank });
    }
  });
  if (!found.length) return null;
  const best = (items) => [...items].sort((x, y) => x.rank - y.rank)[0].url;

  // The requested ID counts only where it is the value of a JSON field named like an ID
  // ("id", "video_id", "videoId", "videoID"). Digits in a caption or comment don't count,
  // nor do fields that merely end in those letters ("paid").
  const idPos = id ? [...html.matchAll(new RegExp(`"(?:id|\\w+_id|\\w+I[dD])":("?)${id}\\1(?!\\d)`, 'g'))].map((m) => m.index) : [];
  if (!idPos.length) {
    // No ID to go by: only safe when the page holds exactly one video.
    const videos = distinctVideos(found);
    return videos.length === 1 && oneVideo(videos[0].items) ? { url: best(videos[0].items) } : { ambiguous: true };
  }

  // Take the address nearest to the ID, whatever its quality, then prefer the best
  // quality among the addresses sitting next to that same ID.
  let anchor = null, nearest = Infinity;
  for (const f of found) for (const p of idPos) { const d = Math.abs(f.pos - p); if (d < nearest) { nearest = d; anchor = p; } }
  if (nearest >= FB_NEAR) return null;
  const same = found.filter((f) => Math.abs(f.pos - anchor) < Math.max(FB_SAME, nearest + 1));
  return oneVideo(same) ? { url: best(same) } : { url: found.filter((f) => Math.abs(f.pos - anchor) === nearest)[0].url };
}

async function resolveFacebook(url, hint) {
  const many = 'That Facebook page shows many posts. Open the video itself (a /videos/ or /reel/ link), then save from there.';
  if (!fbIsSinglePost(url)) throw new ResolveError(many);
  const res = await net(url, { ...WITH_LOGIN, redirect: 'follow' }, 'Facebook');
  const finalUrl = canonicalUrl(res.url || url) || '';
  if (detectSite(finalUrl) !== 'facebook') throw new ResolveError('Facebook sent that link to another site, so it can’t be saved.');
  let finalPath = '';
  try { finalPath = new URL(finalUrl).pathname; } catch { /* keep empty */ }
  if (/^\/(login|checkpoint)(\/|\.php|$)/i.test(finalPath)) throw new ResolveError('Facebook wants you to log in to see this video. Log in, then try again.');
  if (!fbIsSinglePost(finalUrl)) throw new ResolveError(many);   // a short link that lands on a feed
  const html = await res.text();
  const id = fbVideoId(finalUrl) || fbVideoId(url) || fbVideoId(hint.postUrl || '');
  const video = findFbVideoUrl(html, id);
  if (video?.ambiguous) throw new ResolveError('That Facebook page has more than one video and it isn’t clear which you mean. Open the video itself (a /videos/ or /reel/ link), then save from there.');
  if (!video) throw new ResolveError('Couldn’t find a downloadable video on that Facebook page. Open the video itself (the /videos/ or /reel/ link) and save from there.');
  let title = (metaContent(html, 'og:title') || titleText(html))
    .replace(/\s*\|\s*Facebook\s*$/i, '').trim();
  if (!title || /^(facebook|watch|video)$/i.test(title)) title = metaContent(html, 'og:description') || hint.titleHint || `Facebook video ${id || ''}`.trim();
  return {
    site: 'facebook', id: id || shortHash(video.url), title, author: '',
    sourceUrl: finalUrl, thumb: canonicalUrl(metaContent(html, 'og:image')),
    items: [{ kind: 'direct', url: video.url, index: 1 }],
  };
}

/* --------------------------------------------------------------------- helpers */

function fileStem(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop().replace(/\.[a-z0-9]+$/i, '')) || 'video'; } catch { return 'video'; }
}

export function shortHash(s) {
  let h = 2166136261;
  for (let i = 0; i < (s || '').length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

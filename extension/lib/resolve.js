// Turns a post URL (plus optional hints scraped from the page) into downloadable media.
// All requests go straight from your browser to the site that hosts the post.
//
// Result shape:
// { site, id, title, author, sourceUrl, thumb, items: [ {kind:'direct', url} | {kind:'mux', video, audio} ] }

export class ResolveError extends Error {}

const UA_FETCH = { credentials: 'include', cache: 'no-store' };

export function detectSite(url) {
  let h = '';
  try { h = new URL(url).hostname.replace(/^www\.|^m\.|^mobile\.|^web\.|^old\./, ''); } catch { return null; }
  if (h === 'x.com' || h === 'twitter.com') return 'x';
  if (h === 'reddit.com' || h === 'redd.it' || h === 'v.redd.it') return 'reddit';
  if (h === 'facebook.com' || h === 'fb.watch' || h === 'fb.com') return 'facebook';
  return null;
}

export function looksLikeDirectVideo(url) {
  return /^https?:\/\/[^?#]+\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url || '');
}

export async function resolve(url, hint = {}) {
  url = (url || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const site = detectSite(url);
  try {
    if (site === 'x') return await resolveX(url, hint);
    if (site === 'reddit') return await resolveReddit(url, hint);
    if (site === 'facebook') return await resolveFacebook(url, hint);
  } catch (err) {
    // Last resort: the page handed us a real (non-blob) video URL.
    if (hint.videoSrc && /^https?:/.test(hint.videoSrc)) return directFromHint(url, hint, site);
    throw err;
  }
  if (looksLikeDirectVideo(url)) {
    return { site: 'web', id: shortHash(url), title: hint.titleHint || fileStem(url), author: '', sourceUrl: hint.pageUrl || url, thumb: null, items: [{ kind: 'direct', url }] };
  }
  if (hint.videoSrc && /^https?:/.test(hint.videoSrc)) return directFromHint(url, hint, 'web');
  throw new ResolveError('That site isn’t supported yet. Works with X/Twitter, Reddit and Facebook posts, or direct .mp4 links.');
}

function directFromHint(url, hint, site) {
  return { site: site || 'web', id: shortHash(hint.videoSrc), title: hint.titleHint || 'video', author: '', sourceUrl: hint.postUrl || url, thumb: null, items: [{ kind: 'direct', url: hint.videoSrc }] };
}

/* ----------------------------------------------------------------- X / Twitter */

function xToken(id) {
  // Same token the official embed widget computes.
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function xVideos(tweet) {
  return (tweet?.mediaDetails || []).filter((m) => m.type === 'video' || m.type === 'animated_gif');
}

async function resolveX(url, hint) {
  const m = url.match(/\/status(?:es)?\/(\d+)/);
  if (!m) throw new ResolveError('Couldn’t find a post ID in that X link. Open the post itself and try again.');
  const id = m[1];
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${xToken(id)}&lang=en`, { cache: 'no-store' });
  if (res.status === 404) throw new ResolveError('X says this post doesn’t exist or isn’t public.');
  if (!res.ok) throw new ResolveError(`X returned an error (${res.status}). Try again in a moment.`);
  const text = await res.text();
  if (!text) throw new ResolveError('X didn’t share this post (it may be age-restricted or from a protected account).');
  const tweet = JSON.parse(text);
  if (tweet.__typename === 'TweetTombstone') throw new ResolveError('This post is unavailable (deleted, protected or age-restricted).');

  let source = tweet;
  let vids = xVideos(tweet);
  if (hint.quoted || !vids.length) {
    const q = xVideos(tweet.quoted_tweet);
    if (q.length) { vids = q; source = tweet.quoted_tweet; }
  }
  if (!vids.length) throw new ResolveError('No video found in this post.');

  // /video/2 in the URL, or the position of the hovered player, picks one video.
  const vm = url.match(/\/video\/(\d+)/);
  const want = Number(vm?.[1] || hint.index || 0);
  if (want >= 1 && want <= vids.length) vids = [vids[want - 1]];

  const items = vids.map((v) => {
    const mp4 = (v.video_info?.variants || []).filter((x) => x.content_type === 'video/mp4');
    mp4.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    if (!mp4.length) throw new ResolveError('This video is only offered as a stream, not a file.');
    return { kind: 'direct', url: mp4[0].url };
  });

  const user = source.user?.screen_name || '';
  const textClean = (source.text || '').replace(/https?:\/\/t\.co\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return {
    site: 'x',
    id: source.id_str || id,
    title: textClean || (user ? `Video by @${user}` : `X video ${id}`),
    author: user ? '@' + user : '',
    sourceUrl: `https://x.com/${user || 'i'}/status/${source.id_str || id}`,
    thumb: vids[0]?.media_url_https || null,
    items,
  };
}

/* ---------------------------------------------------------------------- Reddit */

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function bestPackaged(raw) {
  if (!raw) return null;
  try {
    const j = typeof raw === 'string' ? JSON.parse(decodeEntities(raw)) : raw;
    const perms = j?.playbackMp4s?.permutations || [];
    let best = null;
    for (const p of perms) {
      const h = p?.source?.dimensions?.height || 0;
      if (p?.source?.url && (!best || h > best.h)) best = { h, url: p.source.url };
    }
    return best?.url ? decodeEntities(best.url) : null;
  } catch { return null; }
}

async function redditCanonical(url) {
  // Short links (redd.it/x, /r/sub/s/xyz, v.redd.it/x) redirect to the real post.
  if (/\/comments\/[a-z0-9]+/i.test(url)) return url;
  const res = await fetch(url, { ...UA_FETCH, redirect: 'follow' });
  if (/\/comments\/[a-z0-9]+/i.test(res.url)) return res.url;
  const html = await res.text();
  const m = html.match(/https:\/\/www\.reddit\.com\/r\/[^"'\s]+\/comments\/[a-z0-9]+[^"'\s]*/i);
  if (m) return m[0];
  throw new ResolveError('Couldn’t find the Reddit post behind that link.');
}

async function resolveReddit(url, hint) {
  const canonical = await redditCanonical(url);
  const id = canonical.match(/\/comments\/([a-z0-9]+)/i)[1];

  let post = null;
  try {
    const res = await fetch(`https://www.reddit.com/comments/${id}.json?raw_json=1`, UA_FETCH);
    if (res.ok) post = (await res.json())?.[0]?.data?.children?.[0]?.data || null;
  } catch { /* fall back to page hints */ }

  const media = post?.crosspost_parent_list?.[0] || post;
  const rv = media?.secure_media?.reddit_video || media?.media?.reddit_video || media?.preview?.reddit_video_preview;
  const title = post?.title || hint.titleHint || `Reddit video ${id}`;
  const base = {
    site: 'reddit', id, title,
    author: post?.subreddit_name_prefixed ? `${post.subreddit_name_prefixed}` : '',
    sourceUrl: `https://www.reddit.com${post?.permalink || `/comments/${id}/`}`,
    thumb: media?.preview?.images?.[0]?.resolutions?.slice(-1)[0]?.url || (/^https?:/.test(post?.thumbnail || '') ? post.thumbnail : null),
  };

  // 1) Reddit's own "packaged" MP4 already has sound merged in. Prefer it.
  let packaged = bestPackaged(hint.packaged);
  if (!packaged) {
    try {
      const html = await (await fetch(`https://www.reddit.com/comments/${id}/`, UA_FETCH)).text();
      const m = html.match(/packaged-media-json="([^"]+)"/);
      packaged = bestPackaged(m?.[1]);
    } catch { /* ignore */ }
  }
  if (packaged) return { ...base, items: [{ kind: 'direct', url: packaged }] };

  // 2) Non-Reddit-hosted media that is a plain file.
  if (!rv) {
    const ext = media?.url_overridden_by_dest || media?.url || '';
    if (/i\.imgur\.com\/.+\.gifv$/i.test(ext)) return { ...base, items: [{ kind: 'direct', url: ext.replace(/\.gifv$/i, '.mp4') }] };
    if (looksLikeDirectVideo(ext)) return { ...base, items: [{ kind: 'direct', url: ext }] };
    if (post?.is_gallery) throw new ResolveError('That Reddit post is an image gallery, not a video.');
    if (post && post.domain && !/redd\.it$/.test(post.domain)) throw new ResolveError(`That post links to ${post.domain}, which ClipStash doesn’t download from.`);
    throw new ResolveError('No Reddit video found in this post.');
  }

  // 3) Separate video + audio tracks (DASH): merge them locally.
  const vid = (rv.fallback_url || rv.dash_url || rv.hls_url || '').match(/v\.redd\.it\/([^/?]+)/)?.[1];
  const videoUrl = rv.fallback_url;
  if (rv.has_audio === false || !vid) return { ...base, items: [{ kind: 'direct', url: videoUrl }] };

  const tracks = await redditDashTracks(rv.dash_url, vid);
  const video = tracks.video || videoUrl;
  const audio = tracks.audio || (await firstExisting([
    `https://v.redd.it/${vid}/DASH_AUDIO_128.mp4`, `https://v.redd.it/${vid}/CMAF_AUDIO_128.mp4`,
    `https://v.redd.it/${vid}/DASH_AUDIO_64.mp4`, `https://v.redd.it/${vid}/CMAF_AUDIO_64.mp4`,
    `https://v.redd.it/${vid}/DASH_audio.mp4`, `https://v.redd.it/${vid}/audio`,
  ]));
  if (!audio) return { ...base, items: [{ kind: 'direct', url: video }] };
  return { ...base, items: [{ kind: 'mux', video, audio }] };
}

async function redditDashTracks(dashUrl, vid) {
  const out = { video: null, audio: null };
  if (!dashUrl) return out;
  try {
    const xml = await (await fetch(dashUrl, { cache: 'no-store' })).text();
    const sets = xml.split(/<AdaptationSet/i).slice(1);
    for (const set of sets) {
      const isAudio = /contentType="audio"|mimeType="audio/i.test(set);
      const isVideo = /contentType="video"|mimeType="video/i.test(set);
      let best = null;
      for (const rep of set.split(/<Representation/i).slice(1)) {
        const bw = Number(rep.match(/bandwidth="(\d+)"/i)?.[1] || 0);
        const h = Number(rep.match(/height="(\d+)"/i)?.[1] || 0);
        const base = rep.match(/<BaseURL>([^<]+)<\/BaseURL>/i)?.[1];
        if (!base) continue;
        const score = isVideo ? h * 1e9 + bw : bw;
        if (!best || score > best.score) best = { score, url: new URL(decodeEntities(base.trim()), `https://v.redd.it/${vid}/`).href };
      }
      if (best && isAudio && !out.audio) out.audio = best.url;
      if (best && isVideo && !out.video) out.video = best.url;
    }
  } catch { /* fall through to guesses */ }
  return out;
}

async function firstExisting(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'HEAD', cache: 'no-store' });
      if (r.ok) return u;
    } catch { /* next */ }
  }
  return null;
}

/* -------------------------------------------------------------------- Facebook */

function fbVideoId(url) {
  return url.match(/\/videos\/(?:[^/?]+\/)?(\d{6,})/)?.[1]
    || url.match(/[?&]v=(\d{6,})/)?.[1]
    || url.match(/\/reel\/(\d{6,})/)?.[1]
    || null;
}

function unescapeJsonString(s) {
  try { return JSON.parse(`"${s}"`); } catch { return s.replace(/\\\//g, '/'); }
}

function metaContent(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i');
  const re2 = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, 'i');
  const m = html.match(re) || html.match(re2);
  return m ? decodeEntities(m[1]) : '';
}

function findFbVideoUrl(html, id) {
  const patterns = [
    /"browser_native_hd_url":"([^"]+)"/g,
    /"playable_url_quality_hd":"([^"]+)"/g,
    /"browser_native_sd_url":"([^"]+)"/g,
    /"playable_url":"([^"]+)"/g,
    /hd_src(?:_no_ratelimit)?:"([^"]+)"/g,
    /sd_src(?:_no_ratelimit)?:"([^"]+)"/g,
  ];
  // Positions of the requested video's ID, so on pages with several videos we pick
  // the URL that sits closest to it.
  const idPos = [];
  if (id) for (let i = html.indexOf(id); i !== -1; i = html.indexOf(id, i + 1)) idPos.push(i);
  const distance = (at) => idPos.reduce((d, p) => Math.min(d, Math.abs(p - at)), Infinity);

  let fallback = null;
  for (const re of patterns) {
    let best = null;
    for (const m of html.matchAll(re)) {
      const u = unescapeJsonString(m[1]);
      if (!/^https?:/.test(u)) continue;
      const d = distance(m.index);
      if (!best || d < best.d) best = { u, d };
      if (!idPos.length) break;
    }
    if (!best) continue;
    if (!idPos.length || best.d < 20000) return best.u;
    fallback ||= best.u;
  }
  return fallback;
}

async function resolveFacebook(url, hint) {
  const res = await fetch(url, { ...UA_FETCH, redirect: 'follow' });
  const html = await res.text();
  const finalUrl = res.url || url;
  const id = fbVideoId(finalUrl) || fbVideoId(url) || fbVideoId(hint.postUrl || '');
  const video = findFbVideoUrl(html, id);
  if (!video) {
    if (/login|checkpoint/i.test(finalUrl)) throw new ResolveError('Facebook wants you to log in to see this video. Log in, then try again.');
    throw new ResolveError('Couldn’t find a downloadable video on that Facebook page. Try opening the video itself (the /videos/ or /reel/ link) and saving from there.');
  }
  let title = metaContent(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '');
  title = decodeEntities(title).replace(/\s*\|\s*Facebook\s*$/i, '').trim();
  const desc = metaContent(html, 'og:description');
  if (!title || /^(facebook|watch|video)$/i.test(title)) title = desc || hint.titleHint || `Facebook video ${id || ''}`.trim();
  return {
    site: 'facebook', id: id || shortHash(video), title, author: '',
    sourceUrl: finalUrl, thumb: metaContent(html, 'og:image') || null,
    items: [{ kind: 'direct', url: video }],
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

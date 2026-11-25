// The rules that decide what the extension will do, and for whom. Kept apart from the
// background worker so they can be tested without a browser: everything here is pure,
// or takes what it needs from Chrome as an argument.
import { canonicalUrl, detectSite, hostOf, isHttp, isPlaylist, isSiteMediaUrl, SITE_LABEL } from './resolve.js';

/* ------------------------------------------------------------- who is asking */

// A message is trusted only when it comes from one of this extension's own pages
// (popup, history, settings, the hidden merge page). Content scripts run inside
// web pages, so they may only ask to save a video or read the one setting they need.
export function fromOwnPage(sender, extensionId, extOrigin) {
  return sender?.id === extensionId && (sender.origin === extOrigin || (sender.url || '').startsWith(extOrigin + '/'));
}

// Keep only well-formed values from a web page, and only addresses that belong to
// the site the page is on. A page can never say "the user agreed to another host".
export function cleanHint(raw, pageUrl) {
  const h = raw && typeof raw === 'object' ? raw : {};
  const site = detectSite(pageUrl || '');
  const out = {
    pageUrl: isHttp(pageUrl) ? pageUrl : '',
    titleHint: typeof h.titleHint === 'string' ? h.titleHint.slice(0, 300) : '',
    index: Number.isInteger(h.index) && h.index > 0 && h.index < 50 ? h.index : 0,
    quoted: h.quoted === true,
    force: h.force === true,      // "save another copy" after being told it was saved before
  };
  if (!site) return out;
  // Each address is parsed once, strictly; the parsed form is what gets checked and what
  // gets used from here on.
  const postUrl = canonicalUrl(h.postUrl);
  if (postUrl && detectSite(postUrl) === site) out.postUrl = postUrl;
  const videoSrc = canonicalUrl(h.videoSrc);
  if (videoSrc && !isPlaylist(videoSrc) && isSiteMediaUrl(site, videoSrc)) out.videoSrc = videoSrc;
  if (site === 'reddit' && typeof h.packaged === 'string' && h.packaged.length < 20000) out.packaged = h.packaged; // its addresses are host-checked by the resolver
  return out;
}

// Limits on what one tab can ask for, so a misbehaving page can't flood the disk.
// `admit(tabId)` returns a function to call when the save is over, or null if refused.
export function pageLimiter({ maxRunning, perMinute, now = Date.now }) {
  const load = new Map();   // tabId -> { running, started: [timestamps] }
  return function admit(tabId) {
    const t = now();
    const s = load.get(tabId) || { running: 0, started: [] };
    s.started = s.started.filter((at) => t - at < 60000);
    if (s.running >= maxRunning || s.started.length >= perMinute) return null;
    s.running++;
    s.started.push(t);
    load.set(tabId, s);
    let done = false;
    return () => { if (!done) { done = true; s.running--; } };
  };
}

// "Copy when saved" for saves a web page asked for (the hover button) happens at most
// once every `gapMs` per tab, so a misbehaving page can't keep replacing the clipboard.
// Saves from the extension's own pages are always allowed.
export function copyLimiter({ gapMs = 10000, now = Date.now } = {}) {
  const last = new Map();   // tabId -> time
  return function allowed(ctx) {
    if (!ctx.fromPage || ctx.tabId == null) return true;
    const t = now();
    if (last.has(ctx.tabId) && t - last.get(ctx.tabId) < gapMs) return false;
    last.set(ctx.tabId, t);
    return true;
  };
}

/* ------------------------------------------------------------ what is saved */

export const itemUrls = (item) => (item.kind === 'direct' ? [item.url] : [item.video, item.audio]);

// A save that started from a page or post link of one site must end on that site.
// `expectSite` null or undefined means a popup paste, where any supported site is fine.
// Returns the site to file the save under, or null to refuse it.
export function siteForSave(r, expectSite) {
  if (expectSite == null || r.site === expectSite) return r.site;
  // One exception: the video file's own address, already checked to be on that site's
  // media host. It is filed under the site it came from.
  const ownFile = !!SITE_LABEL[expectSite] && r.site === 'web' && r.items.flatMap(itemUrls).every((u) => isSiteMediaUrl(expectSite, u));
  return ownFile ? expectSite : null;
}

// A site's own videos come from its own media host. Returns the first address that
// needs a yes from the user (given in the popup or history page), or '' if none does.
// `allowHost` is never taken from a web page.
export function foreignUrl(site, urls, allowHost = '') {
  if (!SITE_LABEL[site]) return '';
  return urls.find((u) => !isSiteMediaUrl(site, u) && (!allowHost || hostOf(u) !== allowHost)) || '';
}

// True when Chrome reports that one of our downloads ended up on a host nobody agreed to.
export function redirectedAway(entry, item) {
  return !!SITE_LABEL[entry.site] && isHttp(item.finalUrl) && !isSiteMediaUrl(entry.site, item.finalUrl)
    && hostOf(item.finalUrl) !== entry.mediaHost && entry.error !== 'REDIRECTED';
}

/* ------------------------------------------------------------ saved before? */

// True when a history entry is the same video as `item` of the resolved post `r`.
// Files from other websites are told apart by their own address (one page can hold
// several); posts by their id on the site, or their address for entries made before 1.4.
// Entries restored from a backup never count: their files may be on another computer.
export function sameVideo(e, r, item) {
  if (e.imported || e.site !== r.site || (e.index || 1) !== (item.index || 1)) return false;
  const fileUrl = item.kind === 'direct' ? item.url : item.video;
  return r.site === 'web' ? e.mediaUrl === fileUrl : (e.postId ? e.postId === String(r.id) : e.sourceUrl === r.sourceUrl);
}

/**
 * The history entry for this video if it was saved before and its file is still there,
 * or it is being saved right now.
 * @param {any[]} history
 * @param {any} r     the resolved post
 * @param {any} item  one of its videos
 * @param {object} deps
 * @param {(id: string) => boolean} deps.isMerging  true while that entry's merge is running
 * @param {(entry: any) => Promise<any>} deps.lookup  its Chrome download item, or null
 * @returns {Promise<{entry, busy: boolean}|null>}
 */
export async function alreadySaved(history, r, item, { isMerging, lookup }) {
  for (const e of history) {
    if (!sameVideo(e, r, item)) continue;
    if (e.state === 'merging') { if (isMerging(e.id)) return { entry: e, busy: true }; continue; }
    const dl = await lookup(e).catch(() => null);
    if (e.state === 'in_progress') { if (dl?.state === 'in_progress') return { entry: e, busy: true }; continue; }
    if (e.state !== 'complete') continue;
    if (dl && dl.exists === false) continue;          // the file is gone: save it again without asking
    return { entry: e, busy: false };
  }
  return null;
}

/* ------------------------------------------------------- answers to a page */

// The one line that says how a save went, for notices, the popup and the badge's message.
export function describeSave(r) {
  if (r.message) return r.message;
  if (!r.ok) return r.error || 'Download failed.';
  const what = r.count > 1 ? `${r.count} videos from: ${r.title}` : (r.title || 'video');
  return `Download started: ${what}${r.detail ? ` (${r.detail})` : ''}${r.warning ? `. ${r.warning}` : ''}`;
}

// Right-click and keyboard saves can't ask questions: the yes/no for another host, and
// "save another copy", only happen in the popup or history page.
export function pageSaveResult(result) {
  if (result.needsConfirm) return { ok: false, error: `That video is hosted on ${result.host}. To save it anyway, paste the post link into ClipSnatcher and confirm there.` };
  if (result.duplicate) return { ok: false, duplicate: true, error: `${result.error}. To save another copy, use Download again in ClipSnatcher's history.` };
  return result;
}

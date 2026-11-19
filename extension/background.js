// ClipSnatcher background worker. No analytics, no remote servers: it only talks to the
// site that hosts the post you asked for, and to Chrome's own downloads system.
import { resolve, detectSite, canonicalUrl, ResolveError, hostOf, isHttp, isPlaylist, isSiteMediaUrl, SITE_LABEL } from './lib/resolve.js';
import { getSettings, getHistory, addEntry, updateEntry, updateByDownload, removeEntries, restoreEntries, clearHistory, failStaleMerges, isEntryDownload, failureReason, setThumb, migrateThumbs, pruneThumbs, cleanImportedEntry, validThumb, MAX_HISTORY } from './lib/store.js';
import { buildFilename } from './lib/names.js';
import { chooseVariant } from './lib/quality.js';

const HELPER = 'com.clipsnatcher.helper';
const ME = chrome.runtime.id;
const EXT_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');
const POST_PATTERNS = [
  '*://x.com/*/status/*', '*://twitter.com/*/status/*', '*://mobile.twitter.com/*/status/*',
  '*://*.reddit.com/*/comments/*', '*://redd.it/*', '*://v.redd.it/*', '*://*.reddit.com/r/*/s/*',
  '*://*.facebook.com/*/videos/*', '*://*.facebook.com/reel/*', '*://*.facebook.com/watch*', '*://*.facebook.com/share/*', '*://fb.watch/*',
];

// Pages that are themselves one post. Wider than POST_PATTERNS, which is for links:
// every page shape the page script and the resolver accept as a single post.
const POST_PAGE_PATTERNS = [
  ...POST_PATTERNS,
  '*://*.reddit.com/comments/*',
  '*://*.facebook.com/*/posts/*', '*://*.facebook.com/*/permalink/*',
  '*://*.facebook.com/permalink.php*', '*://*.facebook.com/story.php*', '*://*.facebook.com/video.php*',
];

// Limits on what one web page can ask for, so a misbehaving page can't flood the disk.
const PAGE_MAX_RUNNING = 3;        // saves in progress per tab
const PAGE_MAX_PER_MINUTE = 12;    // saves started per tab per minute
const NOTE_MAX = 500;              // characters in a note on a saved video
const MERGES_AT_ONCE = 2;          // Reddit merges held in memory at the same time
const MERGES_WAITING_MAX = 6;      // more than this queued and new Reddit merges are refused

// Web pages (through the content script) must not be able to read history or settings.
// Runs every time the worker starts; the empty onStartup listener makes sure that
// includes browser start-up, before any page script could ask.
function lockStorage() {
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((e) => console.error('ClipSnatcher: could not restrict storage access', e));
}
lockStorage();
// Housekeeping on browser start-up and after an install or update: move thumbnails out of
// history entries (versions before 1.3), then drop thumbnails of removed entries.
const housekeeping = (thorough) => migrateThumbs().then(() => pruneThumbs({ thorough })).catch((e) => console.warn('ClipSnatcher: housekeeping failed', e));
chrome.runtime.onStartup.addListener(() => housekeeping(false));

// A merge lives only as long as this worker. Any entry still marked "merging" when the
// worker starts was cut off, so it is marked as failed instead of spinning forever.
const mergesRunning = new Set();
failStaleMerges(mergesRunning).catch(() => {});

/* ------------------------------------------------- install and context menus */

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'cs-video', title: 'Save video with ClipSnatcher', contexts: ['video'] });
    chrome.contextMenus.create({ id: 'cs-link', title: 'Save video from this link (ClipSnatcher)', contexts: ['link'], targetUrlPatterns: POST_PATTERNS });
    // Only offered on a post's own page, so it doesn't appear on every right-click in a feed.
    chrome.contextMenus.create({ id: 'cs-page', title: 'Save this post’s video (ClipSnatcher)', contexts: ['page', 'frame'], documentUrlPatterns: POST_PAGE_PATTERNS });
  });
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  housekeeping(true);
  if (details.reason === 'install' || details.reason === 'update') reattachPages();
});

// Chrome only adds the page script to pages loaded after an install or update. Tabs that
// were already open (Facebook and X rarely reload) would keep a copy that can no longer
// reach the extension, so a fresh copy is added to them now; the old one steps aside.
async function reattachPages() {
  const scripts = chrome.runtime.getManifest().content_scripts || [];
  for (const cs of scripts) {
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url: cs.matches }); } catch { continue; }
    for (const tab of tabs) {
      if (tab.discarded || tab.id == null) continue;
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: cs.js }).catch(() => {});
    }
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id ?? null;
  const pageUrl = info.pageUrl || tab?.url || '';
  const site = detectSite(pageUrl);
  let hint = cleanHint({}, pageUrl);
  let url;

  let expectSite = site || 'web';   // the save must end up on this site; elsewhere it can only be a plain file
  if (info.menuItemId === 'cs-link') {
    // The link decides everything. The page's title and whatever video sits under the
    // cursor belong to a different post.
    url = canonicalUrl(info.linkUrl) || '';
    expectSite = detectSite(url) || 'none';
  } else {
    hint.titleHint = String(tab?.title || '').slice(0, 300);
    let overUntiedVideo = false;
    // Our page script only sees the top document, so only ask it about clicks made there.
    if (tabId != null && site && !info.frameId) {
      try {
        const reply = await chrome.tabs.sendMessage(tabId, { type: 'clipsnatcher:context' }, { frameId: 0 });
        const cleaned = cleanHint(reply, pageUrl);
        hint = { ...cleaned, titleHint: cleaned.titleHint || hint.titleHint };
        overUntiedVideo = reply?.overVideo === true && !cleaned.postUrl;
      } catch { /* no content script here */ }
    }
    // The address Chrome reports for the clicked <video> is the real one.
    const src = canonicalUrl(info.srcUrl);
    if (!hint.videoSrc && src && !isPlaylist(src) && (!site || isSiteMediaUrl(site, src))) hint.videoSrc = src;
    // A video the page script couldn't tie to a post (an ad, a recommendation) is never
    // swapped for the page's own post. The same goes for a click inside an embedded
    // frame, which our script can't see into.
    const untied = overUntiedVideo || !!info.frameId;
    url = hint.postUrl || (site ? (untied ? hint.videoSrc || '' : pageUrl) : hint.videoSrc);
  }

  tellTab(tabId, site, { pending: true });      // instant feedback while the video is looked up
  let result = await startDownload(url, hint, { tabId, fromPage: true, expectSite });
  if (result.needsConfirm) result = { ok: false, error: `That video is hosted on ${result.host}. To save it anyway, paste the post link into ClipSnatcher and confirm there.` };
  if (result.duplicate) result = { ok: false, error: `${result.error}. To save another copy, use Download again in ClipSnatcher's history.` };
  flashBadge(result.ok);
  rememberResult(result);
  // A post on another site may be private to the user: don't put its title or details
  // into this page.
  const crossSite = info.menuItemId === 'cs-link' && detectSite(url || '') !== site;
  tellTab(tabId, site, !crossSite ? result
    : result.ok ? { ok: true, title: 'video from that link' }
      : { ok: false, error: 'Couldn’t save that link. Open ClipSnatcher from the toolbar for details.' });
});

// Shows a notice inside a tab, but only if the tab is still on the site the save was
// made from (it may have moved on while the video was being found).
async function tellTab(tabId, site, result) {
  if (tabId == null || !site) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && detectSite(tab.url || '') === site) chrome.tabs.sendMessage(tabId, { type: 'clipsnatcher:toast', result }, { frameId: 0 }).catch(() => {});
}

function flashBadge(ok) {
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#1a7f37' : '#cf222e' });
  chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

// Pages without our script can't show a notice, so the popup shows the last result
// when it is opened soon afterwards.
function rememberResult(result) {
  const text = result.message || (result.ok ? `Download started: ${result.title || 'video'}${result.detail ? ` (${result.detail})` : ''}${result.warning ? `. ${result.warning}` : ''}` : (result.error || 'Download failed.'));
  chrome.storage.session.set({ lastResult: { text, ok: !!result.ok, at: Date.now() } }).catch(() => {});
}

/* ------------------------------------------------------------------ messages */

// A message is trusted only when it comes from one of this extension's own pages
// (popup, history, settings, the hidden merge page). Content scripts run inside
// web pages, so they may only ask to save a video or read the one setting they need.
function fromOwnPage(sender) {
  return sender?.id === ME && (sender.origin === EXT_ORIGIN || (sender.url || '').startsWith(EXT_ORIGIN + '/'));
}

// Keep only well-formed values from a web page, and only addresses that belong to
// the site the page is on. A page can never say "the user agreed to another host".
function cleanHint(raw, pageUrl) {
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

const pageLoad = new Map();   // tabId -> { running, started: [timestamps] }
function admit(tabId) {
  const now = Date.now();
  const s = pageLoad.get(tabId) || { running: 0, started: [] };
  s.started = s.started.filter((t) => now - t < 60000);
  if (s.running >= PAGE_MAX_RUNNING || s.started.length >= PAGE_MAX_PER_MINUTE) return null;
  s.running++;
  s.started.push(now);
  pageLoad.set(tabId, s);
  return () => { s.running--; };
}

const PAGE_HANDLERS = {
  'clipsnatcher:download': async (msg, sender) => {
    const pageUrl = sender.url || '';            // the document that sent this, not whatever the tab shows now
    if (!detectSite(pageUrl)) return { ok: false, error: 'ClipSnatcher doesn’t save from this page.' };
    const release = admit(sender.tab?.id ?? -1);
    if (!release) return { ok: false, error: 'Too many saves at once from this page. Wait a moment and try again.' };
    try {
      const hint = cleanHint(msg.hint, pageUrl);
      const res = await startDownload(hint.postUrl || hint.videoSrc || '', hint, { tabId: sender.tab?.id ?? null, fromPage: true, expectSite: detectSite(pageUrl) });
      // A web page learns only that the video was saved before, not when or what it was called.
      if (res.duplicate) return { ok: false, duplicate: true, busy: !!res.busy, error: res.busy ? 'Already being saved.' : 'Saved before.' };
      if (!res.needsConfirm) return res;
      // The yes/no has to happen somewhere a web page can't reach: the popup.
      return { ok: false, error: `This video is hosted on ${res.host}, not on ${SITE_LABEL[detectSite(pageUrl)]}. To save it anyway, paste the post link into ClipSnatcher (toolbar icon) and confirm there.` };
    } finally {
      release();
    }
  },
  'clipsnatcher:settings': async () => ({ hoverButton: (await getSettings()).hoverButton !== false }),
};

const allowHostFrom = (msg) => (typeof msg.allowHost === 'string' ? msg.allowHost.slice(0, 255).toLowerCase() : '');

const OWN_HANDLERS = {
  'clipsnatcher:download': (msg) => startDownload(String(msg.url || ''), { allowHost: allowHostFrom(msg), force: msg.force === true }, { pasted: true }),
  'clipsnatcher:redownload': (msg) => redownload(msg.id, allowHostFrom(msg)),
  'clipsnatcher:copyFile': (msg) => copyFile(msg.id),
  'clipsnatcher:reveal': (msg) => revealViaHelper(msg.id),
  'clipsnatcher:helperStatus': () => helperStatus(),
  'clipsnatcher:remove': (msg) => removeEntries(Array.isArray(msg.ids) ? msg.ids : []).then(() => ({ ok: true })),
  'clipsnatcher:restore': (msg) => restore(msg.entries),
  'clipsnatcher:deleteFile': (msg) => deleteFile(msg.id),
  'clipsnatcher:findMissing': () => findMissing(),
  'clipsnatcher:import': (msg) => importEntries(msg.entries, msg.thumbs),
  'clipsnatcher:setFav': (msg) => updateEntry(String(msg.id), { fav: msg.fav === true }).then((e) => ({ ok: !!e })),
  'clipsnatcher:setNote': (msg) => updateEntry(String(msg.id), { note: String(msg.note ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NOTE_MAX) }).then((e) => ({ ok: !!e })),
  'clipsnatcher:clear': () => clearHistory().then(() => ({ ok: true })),
  // Sent by the hidden merge page. Also keeps this worker awake during long merges.
  'clipsnatcher:progress': async (msg) => {
    if (typeof msg.jobId === 'string' && mergesRunning.has(msg.jobId) && Number.isFinite(msg.pct)) {
      await sessionMap('progress', (m) => { m[msg.jobId] = Math.max(0, Math.min(100, Math.round(msg.pct))); });
    }
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || msg.target === 'offscreen') return;
  const handler = fromOwnPage(sender) ? OWN_HANDLERS[msg.type] : (sender?.id === ME ? PAGE_HANDLERS[msg.type] : null);
  if (!handler) return;
  Promise.resolve().then(() => handler(msg, sender)).then(sendResponse, (e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});

/* ----------------------------------------------------------------- downloads */

const itemUrls = (item) => (item.kind === 'direct' ? [item.url] : [item.video, item.audio]);
const NO_SOUND = 'It will have no sound: Reddit’s audio couldn’t be found or merged in.';

/**
 * Find the video for `url` and start saving it.
 * @returns {{ok:true,title,count,entries,warning?}|{ok:false,error,failed?}|{ok:false,needsConfirm:true,host,error}}
 */
async function startDownload(url, hint = {}, ctx = {}) {
  if (!url) return { ok: false, error: ctx.fromPage ? 'Couldn’t tell which post this video belongs to. Open the post itself, then save from there.' : 'Paste a link to a post first.' };
  let r;
  try {
    r = await resolve(url, hint, { pasted: !!ctx.pasted });
  } catch (e) {
    if (e instanceof ResolveError) return { ok: false, error: e.message };
    console.error('ClipSnatcher: unexpected error while resolving', e);
    return { ok: false, error: 'Something went wrong while finding the video. Try again.' };
  }

  // A save that started from a page or post link of one site must end on that site.
  // (null or undefined means a popup paste, where any supported site is fine.)
  if (ctx.expectSite != null && r.site !== ctx.expectSite) {
    // One exception: the video file's own address, which has already been checked to be
    // on that site's media host. It is filed under the site it came from.
    const ownFile = SITE_LABEL[ctx.expectSite] && r.site === 'web' && r.items.flatMap(itemUrls).every((u) => isSiteMediaUrl(ctx.expectSite, u));
    if (!ownFile) return { ok: false, error: 'That link doesn’t lead to a post ClipSnatcher can save from. Open the post itself, then save from there.' };
    r.site = ctx.expectSite;
  }

  // Videos already saved (and whose file is still there) aren't saved twice unless asked.
  // Checked first, so nothing is looked up or asked about for a post already saved.
  let warning = '';
  if (!hint.force) {
    const history = await getHistory();
    const dups = new Map();
    for (const item of r.items) { const d = await alreadySaved(history, r, item); if (d) dups.set(item, d); }
    if (dups.size && dups.size === r.items.length) {
      const first = [...dups.values()][0];
      return {
        ok: false, duplicate: true, busy: first.busy, entryId: first.entry.id, title: r.title,
        error: first.busy ? `Already being saved: ${r.title}` : `Already saved ${whenText(first.entry.createdAt)}: ${r.title}`,
      };
    }
    if (dups.size) {
      r.items = r.items.filter((i) => !dups.has(i));
      warning = `${dups.size} of ${dups.size + r.items.length} videos in this post were already saved, so only the others are being saved.`;
    }
  }

  // Pick the version of each video the quality setting asks for. Sizes are looked up only
  // on the site's own media host, so no other host is contacted before the user agrees.
  const settings = await getSettings();
  const notes = [];
  let overLimit = '';
  r.items = await Promise.all(r.items.map(async (item) => {
    const choice = await chooseVariant(item, settings, (v) => sizeOnSite(r.site, v));
    if (choice.over) overLimit = choice.note; else if (choice.note) notes.push(choice.note);
    return choice.item;
  }));

  // A site's own videos come from its own media host. Every other address needs a yes
  // from the user, given in the popup or history page (hint.allowHost is never taken from a web page).
  const urls = r.items.flatMap(itemUrls);
  if (urls.some((u) => !isHttp(u))) return { ok: false, error: 'That post’s video address isn’t a web link, so it can’t be saved.' };
  if (SITE_LABEL[r.site]) {
    const foreign = urls.find((u) => !isSiteMediaUrl(r.site, u) && hostOf(u) !== hint.allowHost);
    if (foreign) {
      const host = hostOf(foreign);
      const plain = /^http:/i.test(foreign) ? ' over an unencrypted connection' : '';
      return { ok: false, needsConfirm: true, host, title: r.title, error: `This video is hosted on ${host}, not on ${SITE_LABEL[r.site]}. Saving it will download from ${host}${plain}.` };
    }
  }
  if (!isHttp(r.sourceUrl)) r.sourceUrl = url;

  // Thumbnails come only from the site's own media host, and never hold up the download.
  const thumbs = new Map();
  const thumbFor = (address) => {
    if (!thumbs.has(address)) thumbs.set(address, (SITE_LABEL[r.site] && isSiteMediaUrl(r.site, address) ? makeThumb(r.site, address) : Promise.resolve(null)).catch(() => null));
    return thumbs.get(address);
  };
  const saved = [];
  const failed = [];      // rows for downloads that died at once
  const problems = [];

  for (const item of r.items) {
    const filename = buildFilename(settings, r, item, r.items.length);
    const thumb = thumbFor(item.thumb || r.thumb);
    const mediaUrl = item.kind === 'direct' ? item.url : item.video;
    const entry = {
      id: crypto.randomUUID(),
      title: r.title, author: r.author, site: r.site, sourceUrl: r.sourceUrl,
      postId: String(r.id || ''), mediaUrl, mediaHost: hostOf(mediaUrl), index: item.index, noAudio: !!item.noAudio,
      whole: item.kind === 'direct' && !item.noAudio,   // false when mediaUrl is only the picture track
      filename, path: null, downloadId: null, dlStart: null,
      state: 'in_progress', error: '', bytes: 0, createdAt: Date.now(),
    };
    try {
      if (item.kind === 'mux') {
        if (merging + mergeWaiters.length >= MERGES_AT_ONCE + MERGES_WAITING_MAX) {
          problems.push('Too many Reddit videos are being merged at once. Try again in a moment.');
          continue;
        }
        // Merging takes a while, so the row appears now (as "Merging") and the reply goes
        // out without waiting. The outcome is reported by a notice, like any later failure.
        entry.state = 'merging';
        await addEntry(entry);
        thumb.then((data) => data && setThumb(entry.id, data));
        finishMerge(entry, item, filename, ctx.tabId ?? null);
        saved.push(entry);
        continue;
      }
      const downloadId = await download(item.url, filename);
      const [dl] = await chrome.downloads.search({ id: downloadId });
      Object.assign(entry, { downloadId, dlStart: dl?.startTime || null });
      await addEntry(entry);
      if (ctx.tabId != null) await sessionMap('tabs', (m) => { m[downloadId] = ctx.tabId; });
      if (settings.autoCopy && autoCopyAllowed(ctx)) await sessionMap('autoCopy', (m) => { m[downloadId] = true; });
      thumb.then((data) => data && setThumb(entry.id, data));
      // The download may already have finished or failed before the entry existed.
      const now = await reconcile(downloadId, { quiet: true });
      if (now?.state === 'interrupted') {
        problems.push(`The download failed straight away (${failureReason(now.error)}).`);
        failed.push(entry.id);
        continue;                               // the failed row stays in history; this isn't a success
      }
      saved.push(entry);
      if (entry.noAudio) warning = NO_SOUND;
    } catch (e) {
      problems.push(`Chrome couldn’t start the download: ${e?.message || String(e)}`);
    }
  }
  if (!saved.length) return { ok: false, error: problems[0] || 'Download failed.', failed };
  if (!warning && problems.length) warning = `${problems.length} of ${r.items.length} videos couldn’t be started.`;
  if (!warning && overLimit) warning = overLimit + '.';
  return { ok: true, title: r.title, count: saved.length, entries: saved.map((e) => e.id), warning, detail: [...new Set(notes)].join('; ') };
}

// The history entry for this video if it was saved before and its file is still there
// (or it is being saved right now). Matches on site, post and position in the post.
// Entries restored from a backup never count: their files may be on another computer.
async function alreadySaved(history, r, item) {
  const index = item.index || 1;
  const fileUrl = item.kind === 'direct' ? item.url : item.video;
  for (const e of history) {
    if (e.imported || e.site !== r.site || (e.index || 1) !== index) continue;
    // Files from other websites are told apart by their own address (one page can hold
    // several); posts by their id on the site, or their address for entries made before 1.4.
    const same = r.site === 'web' ? e.mediaUrl === fileUrl : (e.postId ? e.postId === String(r.id) : e.sourceUrl === r.sourceUrl);
    if (!same) continue;
    if (e.state === 'merging') { if (mergesRunning.has(e.id)) return { entry: e, busy: true }; continue; }
    const dl = await downloadItemFor(e).catch(() => null);
    if (e.state === 'in_progress') { if (dl?.state === 'in_progress') return { entry: e, busy: true }; continue; }
    if (e.state !== 'complete') continue;
    if (dl && dl.exists === false) continue;          // the file is gone: save it again without asking
    return { entry: e, busy: false };
  }
  return null;
}

function whenText(t) {
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return 'on ' + new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}

// The size of one version of a video, from the site's own media host (0 if unknown).
async function sizeOnSite(site, variant) {
  const urls = itemUrls(variant);
  if (!SITE_LABEL[site] || !urls.every((u) => isSiteMediaUrl(site, u))) return 0;
  const sizes = await Promise.all(urls.map(async (u) => {
    try {
      const res = await fetch(u, { method: 'HEAD', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
      return res.ok && isSiteMediaUrl(site, res.url || u) ? Number(res.headers.get('content-length')) || 0 : 0;
    } catch { return 0; }
  }));
  return sizes.every((n) => n > 0) ? sizes.reduce((a, b) => a + b, 0) : 0;
}

async function download(url, filename) {
  try {
    return await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  } catch (e) {
    // Some titles still trip Chrome's filename rules; fall back to a plain name.
    if (/filename/i.test(e.message || '')) {
      const parts = filename.split('/');
      parts[parts.length - 1] = `video-${Date.now()}.${filename.split('.').pop()}`;
      return chrome.downloads.download({ url, filename: parts.join('/'), conflictAction: 'uniquify', saveAs: false });
    }
    throw e;
  }
}

// Runs after the reply for a Reddit save has gone out: merges the two tracks, hands the
// result to Chrome, and ties the waiting history row to that download.
async function finishMerge(entry, item, filename, tabId) {
  mergesRunning.add(entry.id);
  const stillWanted = async () => (await getHistory()).some((e) => e.id === entry.id);
  try {
    let res;
    try { res = await mergeInOffscreen(item, entry.id); } catch (e) { res = { ok: false, error: e?.message || String(e) }; }
    // Removing the row (or clearing history) while it merges cancels the save: nothing
    // is written to disk and the merged data is let go.
    if (!(await stillWanted())) {
      if (res?.ok) revokeInOffscreen(res.url);
      return;
    }
    let downloadId;
    let noAudio = false;
    if (res?.ok) {
      try {
        downloadId = await download(res.url, filename);
        await sessionMap('blobs', (m) => { m[downloadId] = res.url; });
      } catch (e) {
        revokeInOffscreen(res.url);
        throw e;
      }
    } else {
      // Couldn't merge: still save the picture so the user gets something, and say so.
      console.warn('ClipSnatcher: merge failed', res?.error);
      downloadId = await download(item.video, filename.replace(/\.mp4$/, ' (no audio).mp4'));
      noAudio = true;
    }
    const [dl] = await chrome.downloads.search({ id: downloadId });
    await updateEntry(entry.id, { downloadId, dlStart: dl?.startTime || null, state: 'in_progress', noAudio });
    if (tabId != null) await sessionMap('tabs', (m) => { m[downloadId] = tabId; });
    if ((await getSettings()).autoCopy) await sessionMap('autoCopy', (m) => { m[downloadId] = true; });
    const now = await reconcile(downloadId);
    if (noAudio && now && now.state !== 'interrupted') {
      flashBadge(false);
      rememberResult({ ok: false, error: `${entry.title} is being saved without sound: Reddit's audio couldn't be merged in.` });
      tellTab(tabId, entry.site, { ok: false, error: 'A Reddit video is being saved without sound: its audio couldn\u2019t be merged in.' });
    }
  } catch (e) {
    console.warn('ClipSnatcher: could not save merged video', e);
    await updateEntry(entry.id, { state: 'interrupted', error: 'MERGE_FAILED' });
    flashBadge(false);
    rememberResult({ ok: false, error: `Couldn't save "${entry.title}": ${e?.message || 'the merge failed'}.` });
    tellTab(tabId, entry.site, { ok: false, error: 'A ClipSnatcher download failed. Open ClipSnatcher from the toolbar for details.' });
  } finally {
    mergesRunning.delete(entry.id);
    sessionMap('progress', (m) => { delete m[entry.id]; }).catch(() => {});
  }
}

// Undo for "Remove from history". What comes back is a snapshot from when the row was
// removed, so it is brought up to date with Chrome's record straight away.
async function restore(entries) {
  const back = (await restoreEntries(Array.isArray(entries) ? entries : [], mergesRunning)) || [];
  for (const e of back) if (e.downloadId != null) await reconcile(e.downloadId, { quiet: true }).catch(() => {});
  return { ok: true, restored: back.length };
}

/* ------------------------------------------------------- hidden merge page */

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Each merge holds a whole video in memory, so only a few run at a time.
let merging = 0;
const mergeWaiters = [];
async function withMergeSlot(fn) {
  if (merging >= MERGES_AT_ONCE) await new Promise((go) => mergeWaiters.push(go));
  merging++;
  try { return await fn(); } finally { merging--; mergeWaiters.shift()?.(); }
}

// The hidden page closes itself when it has no jobs and no files in hand, so a
// message can arrive just as it goes away. A short wait and a retry cover that.
function mergeInOffscreen(item, jobId) {
  return withMergeSlot(async () => {
    let lastError = 'The merge page didn’t answer.';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await pause(400);
      try {
        await ensureOffscreen();
        const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'mux', jobId, video: item.video, audio: item.audio });
        if (res) return res;
      } catch (e) {
        lastError = e?.message || String(e);
      }
    }
    return { ok: false, error: lastError };
  });
}

let creatingOffscreen = null;
async function ensureOffscreen() {
  const has = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (has.length) return;
  creatingOffscreen ||= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Merge Reddit video and audio tracks locally before saving.',
  }).finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

function revokeInOffscreen(url) {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url }).catch(() => {});
}

// Small maps that must survive this worker being restarted: which merged file belongs
// to which download, which tab asked for it, and how far each merge has got.
let sessionQueue = Promise.resolve();
function sessionMap(key, fn) {
  const run = sessionQueue.then(async () => {
    const map = (await chrome.storage.session.get(key))[key] || {};
    const out = await fn(map);
    await chrome.storage.session.set({ [key]: map });
    return out;
  });
  sessionQueue = run.catch(() => {});
  return run;
}
const takeFromSession = (key, id) => sessionMap(key, (m) => { const v = m[id]; delete m[id]; return v; });

/* ------------------------------------------------- following our downloads */

chrome.downloads.onChanged.addListener((d) => {
  if (d.state || d.filename || d.error || d.finalUrl) reconcile(d.id);
});

// Bring the history entry for one of our downloads in line with what Chrome reports.
// Safe to call any number of times. Resolves to the entry (or undefined if there is none
// yet). With `quiet`, a failure is left for the caller to report.
async function reconcile(downloadId, { quiet = false } = {}) {
  const [item] = await chrome.downloads.search({ id: downloadId });
  if (!item || item.byExtensionId !== ME) return;        // someone else's download: not our business

  const changed = await updateByDownload(item, ME, (e) => {
    // Once we have stopped a download for redirecting, that verdict stands: Chrome's own
    // record now says "cancelled" or "complete", which would hide the reason.
    if (e.error === 'REDIRECTED') return { state: 'interrupted' };
    const patch = { state: item.state };
    if (item.filename) patch.path = item.filename;
    if (item.error) patch.error = item.error;
    if (item.state === 'complete') { patch.bytes = item.fileSize || item.totalBytes || 0; patch.error = ''; }
    return patch;
  });
  if (!changed) {
    // No entry: either not written yet (the caller reconciles again) or removed while it
    // downloaded. In the second case a "copy when saved" mark must not fire later.
    if (item.state !== 'in_progress') takeFromSession('autoCopy', downloadId).catch(() => {});
    return;
  }
  const { entry, was } = changed;

  // A download that was redirected to a host nobody agreed to is stopped and removed.
  if (SITE_LABEL[entry.site] && isHttp(item.finalUrl) && !isSiteMediaUrl(entry.site, item.finalUrl) && hostOf(item.finalUrl) !== entry.mediaHost && entry.error !== 'REDIRECTED') {
    if (item.state === 'in_progress') await chrome.downloads.cancel(downloadId).catch(() => {});
    else if (item.state === 'complete') await chrome.downloads.removeFile(downloadId).catch(() => {});
    await updateEntry(entry.id, { state: 'interrupted', error: 'REDIRECTED' });
    entry.state = 'interrupted'; entry.error = 'REDIRECTED';
  }

  if (entry.state === 'in_progress') return entry;
  const blobUrl = await takeFromSession('blobs', downloadId);
  if (blobUrl) revokeInOffscreen(blobUrl);
  const tabId = await takeFromSession('tabs', downloadId);
  // "Copy when saved": only for saves started with that setting on, once each.
  if (await takeFromSession('autoCopy', downloadId) && entry.state === 'complete') copyAfterSave(entry, tabId);
  if (quiet || entry.state !== 'interrupted' || was === 'interrupted' || entry.error === 'USER_CANCELED') return entry;

  flashBadge(false);
  rememberResult({ ok: false, error: `Download failed (${failureReason(entry.error)}): ${entry.title}` });
  // Only tell the page that asked, and only if it is still on that site.
  tellTab(tabId, entry.site, { ok: false, error: `A ClipSnatcher download failed (${failureReason(entry.error)}). Open ClipSnatcher from the toolbar for details.` });
  return entry;
}

// Adds entries from a backup file. Entries already in history (same id) are left as they are.
async function importEntries(entries, thumbs) {
  const given = Array.isArray(entries) ? entries.slice(0, MAX_HISTORY) : [];
  const clean = given.map(cleanImportedEntry).filter(Boolean);
  const back = (await restoreEntries(clean, mergesRunning, { keepExisting: true })) || [];
  let images = 0;
  for (const { id } of back) {
    const t = thumbs && typeof thumbs === 'object' ? thumbs[id] : null;
    if (validThumb(t)) { await setThumb(id, t); images++; }
  }
  return { ok: true, added: back.length, existing: back.existing || 0, full: back.full || 0, invalid: given.length - clean.length, images };
}

// Saves asked for by a web page (the hover button) copy at most once every 10 seconds
// per tab, so a misbehaving page can't keep replacing what's on the clipboard.
const lastPageCopy = new Map();   // tabId -> time
function autoCopyAllowed(ctx) {
  if (!ctx.fromPage || ctx.tabId == null) return true;
  const now = Date.now();
  if (now - (lastPageCopy.get(ctx.tabId) || 0) < 10000) return false;
  lastPageCopy.set(ctx.tabId, now);
  return true;
}

async function copyAfterSave(entry, tabId) {
  const r = await copyFile(entry.id).catch((e) => ({ ok: false, error: e?.message }));
  const message = r.ok ? `Saved and copied: ${entry.title}. Paste it into Discord, Messages and so on.` : `Saved, but not copied: ${r.error || 'the copy helper didn\u2019t answer'}`;
  rememberResult({ ok: r.ok, error: message, message });
  tellTab(tabId, entry.site, { ok: r.ok, message: r.ok ? 'Saved and copied to the clipboard.' : 'Saved, but couldn\u2019t copy it to the clipboard. Open ClipSnatcher for details.' });
}

/* ----------------------------------------------------------- keyboard commands */

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'save-video') {
    const pageUrl = tab?.url || '';
    const site = detectSite(pageUrl);
    if (!isHttp(pageUrl)) { flashBadge(false); return rememberResult({ ok: false, error: 'ClipSnatcher can\u2019t save from this tab. Open a post on X, Reddit or Facebook (or a video file) and try again.' }); }
    tellTab(tab.id, site, { pending: true });
    let result = await startDownload(pageUrl, cleanHint({ titleHint: tab.title }, pageUrl), { tabId: tab.id, fromPage: true, expectSite: site || 'web' });
    if (result.needsConfirm) result = { ok: false, error: `That video is hosted on ${result.host}. To save it anyway, paste the post link into ClipSnatcher and confirm there.` };
    if (result.duplicate) result = { ok: false, error: `${result.error}. To save another copy, use Download again in ClipSnatcher's history.` };
    flashBadge(result.ok);
    rememberResult(result);
    tellTab(tab.id, site, result);
  }
  if (command === 'copy-last') {
    const last = (await getHistory()).find((e) => e.state === 'complete' && !e.imported);
    if (!last) { flashBadge(false); return rememberResult({ ok: false, error: 'Nothing saved yet to copy.' }); }
    const r = await copyFile(last.id).catch((e) => ({ ok: false, error: e?.message }));
    flashBadge(r.ok);
    const message = r.ok ? `Copied: ${last.title}` : `Couldn't copy "${last.title}": ${r.error || 'the copy helper didn\u2019t answer'}`;
    rememberResult({ ok: r.ok, error: message, message });
    tellTab(tab?.id ?? null, detectSite(tab?.url || ''), { ok: r.ok, message: r.ok ? 'Last saved video copied to the clipboard.' : 'Couldn\u2019t copy the last saved video. Open ClipSnatcher for details.' });
  }
});

async function findEntry(id) {
  const e = (await getHistory()).find((x) => x.id === id);
  if (!e) throw new Error('This entry was already removed.');
  return e;
}

async function downloadItemFor(entry) {
  if (entry.downloadId == null) return null;
  const [item] = await chrome.downloads.search({ id: entry.downloadId });
  return isEntryDownload(entry, item, ME) ? item : null;
}

async function redownload(id, allowHost = '') {
  const e = await findEntry(id);
  const item = await downloadItemFor(e);
  // The host this entry was saved from was already agreed to once.
  // An entry restored from a backup pre-approves nothing.
  const hint = { titleHint: e.title, index: e.index || 0, pageUrl: e.sourceUrl, allowHost: allowHost || e.mediaHost || (e.imported ? '' : hostOf(e.mediaUrl || '')) };
  // If the post can't be looked up again, fall back to the file's own address, but only
  // where that address is the whole video and stays valid: files on other websites, and
  // X's video files. Reddit's is often just the picture track, and Facebook's expire, so
  // for those the real reason the post couldn't be found is shown instead.
  const stable = e.site === 'web' || (e.site === 'x' && e.whole !== false && isSiteMediaUrl('x', e.mediaUrl));
  if (stable && canonicalUrl(e.mediaUrl) && !isPlaylist(e.mediaUrl)) hint.videoSrc = e.mediaUrl;
  hint.force = true;   // asking for it again is the point
  const res = await startDownload(e.sourceUrl, hint, { expectSite: SITE_LABEL[e.site] ? e.site : null });
  // Replace the old row only when it was broken. A healthy one keeps its place and date.
  const broken = e.state === 'interrupted' || item?.state === 'interrupted' || item?.exists === false;
  if (res.ok && broken) await removeEntries([id]);
  // A retry that failed at once shouldn't pile up more failed rows next to the original.
  if (!res.ok && res.failed?.length) await removeEntries(res.failed);
  return res;
}

// Deletes the saved file (through Chrome) and then the history entry.
async function deleteFile(id) {
  const e = await findEntry(id);
  const item = await downloadItemFor(e);
  if (!item) return { ok: false, error: 'Chrome no longer lists this file, so it can’t delete it for you. Delete it in your file manager, then remove the entry.' };
  if (item.state === 'in_progress') await chrome.downloads.cancel(item.id).catch(() => {});
  else if (item.exists !== false && item.state === 'complete') await chrome.downloads.removeFile(item.id);
  await removeEntries([id]);
  return { ok: true };
}

// The entries whose file Chrome says is gone. Entries Chrome no longer lists are left
// alone: their file may well still be there.
// Chrome only re-checks whether files exist when a download is looked up, does so at
// most once every 10 seconds, and reports the answer on a later lookup. So: look
// everything up, wait out that limit, look everything up again (this one is honoured),
// give the check a moment, then read the answers. Takes about 11 seconds.
async function findMissing() {
  const list = await getHistory();
  const sweep = async (onItem) => {
    for (let i = 0; i < list.length; i += 25) {
      await Promise.all(list.slice(i, i + 25).map(async (e) => onItem(e, await downloadItemFor(e).catch(() => null))));
    }
  };
  await sweep(() => {});
  await pause(10500);
  await sweep(() => {});
  await pause(700);
  const missing = [];
  await sweep((e, item) => { if (item && item.state === 'complete' && item.exists === false) missing.push(e.id); });
  return { ok: true, ids: missing };
}

/* ------------------------------------------------------ copy-to-clipboard helper */

async function finishedPath(id) {
  const e = await findEntry(id);
  const item = await downloadItemFor(e);
  if (item) {
    if (item.state === 'in_progress') throw new Error('Still downloading. Try again when it finishes.');
    if (item.state !== 'complete') throw new Error('That download didn’t finish. Use Download again.');
    if (item.exists === false) throw new Error('The file was moved or deleted. Use Download again.');
    return item.filename;
  }
  if (e.state !== 'complete' || !e.path) throw new Error('That download didn’t finish. Use Download again.');
  if (e.imported) throw new Error('This entry came from a backup, so ClipSnatcher can’t vouch for where its file is. Use Copy path, or Download again.');
  return e.path;   // Chrome no longer lists it; the helper checks the file is still there
}

const hasHelperPermission = () => chrome.permissions.contains({ permissions: ['nativeMessaging'] });

async function askHelper(message) {
  if (!(await hasHelperPermission())) return { ok: false, needsHelper: true, error: 'The copy helper isn’t switched on. Set it up in Settings.' };
  if (!chrome.runtime.sendNativeMessage) return { ok: false, needsHelper: true, restart: true, error: 'The copy helper was just switched on. Reload ClipSnatcher (or restart Chrome) to finish.' };
  try {
    return await chrome.runtime.sendNativeMessage(HELPER, message);
  } catch (e) {
    // Chrome could not start or reach the helper at all.
    return { ok: false, needsHelper: true, error: 'The copy helper isn’t installed or didn’t respond. Set it up in Settings.', detail: e?.message || String(e) };
  }
}

async function copyFile(id) {
  const path = await finishedPath(id);
  const res = await askHelper({ action: 'copyFile', path });
  if (res?.ok) return { ok: true };
  return { ok: false, needsHelper: !!res?.needsHelper, error: res?.error || 'The copy helper couldn’t copy that file.' };
}

async function revealViaHelper(id) {
  const path = await finishedPath(id);
  const res = await askHelper({ action: 'reveal', path });
  return res?.ok ? { ok: true } : { ok: false, needsHelper: !!res?.needsHelper, error: res?.error || 'Couldn’t show that file.' };
}

async function helperStatus() {
  if (!(await hasHelperPermission())) return { ok: false, permission: false };
  const res = await askHelper({ action: 'ping' });
  return { ok: !!res?.ok, permission: true, restart: !!res?.restart, version: res?.version, detail: res?.detail };
}

/* --------------------------------------------------------------- thumbnails */

// Fetch the post thumbnail once, shrink it, and keep it inline so the history
// page never has to load anything from the internet.
async function makeThumb(site, url) {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!res.ok || !isSiteMediaUrl(site, res.url || url)) return null;   // also refuses a redirect off the site's media host
  const bmp = await createImageBitmap(await res.blob());
  const w = 160, h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
  const canvas = new OffscreenCanvas(w, Math.min(h, 200));
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/jpeg;base64,' + btoa(bin);
}

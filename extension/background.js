// ClipStash background worker. No analytics, no remote servers: it only talks to the
// site that hosts the post you asked for, and to Chrome's own downloads system.
import { resolve, detectSite, shortHash } from './lib/resolve.js';
import { getSettings, addEntry, updateEntry, updateByDownloadId, removeEntries, getHistory } from './lib/store.js';

const HELPER = 'com.clipstash.helper';
const SITE_NAMES = { x: 'X', reddit: 'Reddit', facebook: 'Facebook', web: 'Web' };
const POST_PATTERNS = [
  '*://x.com/*/status/*', '*://twitter.com/*/status/*', '*://mobile.twitter.com/*/status/*',
  '*://*.reddit.com/*/comments/*', '*://redd.it/*', '*://v.redd.it/*', '*://*.reddit.com/r/*/s/*',
  '*://*.facebook.com/*/videos/*', '*://*.facebook.com/reel/*', '*://*.facebook.com/watch*', '*://*.facebook.com/share/*', '*://fb.watch/*',
];
const SITE_PAGES = ['*://x.com/*', '*://twitter.com/*', '*://*.reddit.com/*', '*://*.facebook.com/*'];

/* ------------------------------------------------------------ context menus */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'cs-video', title: 'Save video with ClipStash', contexts: ['video'] });
    chrome.contextMenus.create({ id: 'cs-link', title: 'Save video from this link (ClipStash)', contexts: ['link'], targetUrlPatterns: POST_PATTERNS });
    chrome.contextMenus.create({ id: 'cs-page', title: 'Save video from this post (ClipStash)', contexts: ['page', 'frame'], documentUrlPatterns: SITE_PAGES });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let hint = null;
  if (tab?.id != null) {
    try { hint = await chrome.tabs.sendMessage(tab.id, { type: 'clipstash:context' }, { frameId: info.frameId || 0 }); } catch { /* no content script here */ }
  }
  hint = hint || {};
  if (info.srcUrl && !info.srcUrl.startsWith('blob:')) hint.videoSrc = hint.videoSrc || info.srcUrl;
  hint.titleHint = hint.titleHint || tab?.title;
  hint.pageUrl = info.pageUrl;

  let url;
  if (info.menuItemId === 'cs-link') url = info.linkUrl;
  else url = hint.postUrl || (detectSite(info.pageUrl) ? info.pageUrl : (hint.videoSrc || info.pageUrl));

  const result = await startDownload(url, hint);
  flashBadge(result.ok);
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'clipstash:toast', result }, { frameId: info.frameId || 0 }).catch(() => {});
});

function flashBadge(ok) {
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#1a7f37' : '#cf222e' });
  chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

/* ------------------------------------------------------------------ messages */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;
  const handlers = {
    'clipstash:download': () => startDownload(msg.url, msg.hint || {}),
    'clipstash:redownload': () => redownload(msg.id),
    'clipstash:copyFile': () => copyFile(msg.id),
    'clipstash:reveal': () => revealViaHelper(msg.id),
    'clipstash:helperStatus': () => helperStatus(),
    'clipstash:remove': () => removeEntries(msg.ids).then(() => ({ ok: true })),
    'clipstash:progress': () => Promise.resolve({ ok: true }),
  };
  const h = handlers[msg.type];
  if (!h) return;
  h().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});

/* ----------------------------------------------------------------- downloads */

function sanitize(s, max = 90) {
  let out = String(s || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|~%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, '') || out.slice(0, max);
  return out.replace(/^[.\s]+|[.\s]+$/g, '');
}

function sanitizeFolder(f) {
  return String(f || '').split(/[\\/]+/).map((p) => sanitize(p, 60)).filter(Boolean).join('/');
}

function buildFilename(settings, r, idx, total) {
  const folder = sanitizeFolder(settings.folder);
  const sub = settings.perSite ? SITE_NAMES[r.site] || 'Web' : '';
  const author = settings.authorInName && r.author ? sanitize(r.author.replace(/^@/, ''), 30) + ' - ' : '';
  const name = sanitize(r.title) || 'video';
  const suffix = total > 1 ? ` (${idx + 1})` : '';
  const file = `${author}${name} [${sanitize(r.id, 24) || shortHash(r.sourceUrl)}]${suffix}.mp4`;
  return [folder, sub, file].filter(Boolean).join('/');
}

async function startDownload(url, hint = {}) {
  if (!url) return { ok: false, error: 'Paste a link to a post first.' };
  let r;
  try {
    r = await resolve(url, hint);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
  const settings = await getSettings();
  const thumb = await makeThumb(r.thumb).catch(() => null);
  const saved = [];
  const errors = [];
  for (let i = 0; i < r.items.length; i++) {
    const item = r.items[i];
    const filename = buildFilename(settings, r, i, r.items.length);
    const entry = {
      id: crypto.randomUUID(),
      title: r.title, author: r.author, site: r.site, sourceUrl: r.sourceUrl,
      mediaUrl: item.kind === 'direct' ? item.url : item.video,
      merged: item.kind === 'mux',
      filename, path: null, downloadId: null, state: 'in_progress', bytes: 0,
      createdAt: Date.now(), thumb,
    };
    try {
      const downloadId = await saveItem(item, filename, r);
      entry.downloadId = downloadId;
      await addEntry(entry);
      saved.push(entry);
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  if (!saved.length) return { ok: false, error: errors[0] || 'Download failed.' };
  return { ok: true, title: r.title, count: saved.length, entries: saved.map((e) => e.id), warning: errors[0] };
}

async function download(url, filename) {
  try {
    return await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  } catch (e) {
    // Some titles still trip Chrome's filename rules; fall back to a plain name.
    if (/filename/i.test(e.message || '')) {
      const parts = filename.split('/');
      parts[parts.length - 1] = `video-${Date.now()}.mp4`;
      return chrome.downloads.download({ url, filename: parts.join('/'), conflictAction: 'uniquify', saveAs: false });
    }
    throw e;
  }
}

const blobForDownload = new Map(); // downloadId -> blob: url held by the offscreen page

async function saveItem(item, filename) {
  if (item.kind === 'direct') return download(item.url, filename);
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'mux', jobId: crypto.randomUUID(), video: item.video, audio: item.audio });
  if (!res?.ok) {
    // Couldn't merge: still save the video so the user gets something.
    const id = await download(item.video, filename.replace(/\.mp4$/, ' (no audio).mp4'));
    return id;
  }
  const id = await download(res.url, filename);
  blobForDownload.set(id, res.url);
  return id;
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

async function releaseBlob(downloadId) {
  const url = blobForDownload.get(downloadId);
  if (!url) return;
  blobForDownload.delete(downloadId);
  try {
    const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url });
    if (r?.remaining === 0 && !blobForDownload.size) await chrome.offscreen.closeDocument();
  } catch { /* already gone */ }
}

chrome.downloads.onChanged.addListener(async (d) => {
  if (!d.state && !d.filename) return;
  const patch = {};
  if (d.filename?.current) patch.path = d.filename.current;
  if (d.state?.current) patch.state = d.state.current;
  if (d.state?.current === 'complete') {
    const [item] = await chrome.downloads.search({ id: d.id });
    if (item) { patch.path = item.filename; patch.bytes = item.fileSize || item.totalBytes || 0; }
  }
  if (d.error?.current) patch.error = d.error.current;
  const e = await updateByDownloadId(d.id, patch);
  if (d.state && d.state.current !== 'in_progress') releaseBlob(d.id);
  void e;
});

async function redownload(id) {
  const list = await getHistory();
  const e = list.find((x) => x.id === id);
  if (!e) return { ok: false, error: 'Not in history.' };
  const res = await startDownload(e.sourceUrl, {});
  if (res.ok) await removeEntries([id]);
  return res;
}

/* ------------------------------------------------------ copy-to-clipboard helper */

async function entryPath(id) {
  const e = (await getHistory()).find((x) => x.id === id);
  if (!e) throw new Error('Not in history.');
  let p = e.path;
  if (e.downloadId != null) {
    const [item] = await chrome.downloads.search({ id: e.downloadId });
    if (item?.filename) p = item.filename;
    if (item && item.exists === false) throw new Error('The file was moved or deleted. Use Re-download.');
  }
  if (!p) throw new Error('The download hasn’t finished yet.');
  return p;
}

async function copyFile(id) {
  const path = await entryPath(id);
  try {
    const res = await chrome.runtime.sendNativeMessage(HELPER, { action: 'copyFile', path });
    if (!res?.ok) throw new Error(res?.error || 'Helper failed.');
    return { ok: true };
  } catch (e) {
    const msg = e.message || String(e);
    if (/not found|forbidden|Specified native messaging host/i.test(msg)) return { ok: false, needsHelper: true, error: 'Install the copy helper (Settings → Copy helper) to copy the video file itself.' };
    return { ok: false, error: msg };
  }
}

async function revealViaHelper(id) {
  const path = await entryPath(id);
  const res = await chrome.runtime.sendNativeMessage(HELPER, { action: 'reveal', path });
  return res?.ok ? { ok: true } : { ok: false, error: res?.error || 'Helper failed.' };
}

async function helperStatus() {
  try {
    const res = await chrome.runtime.sendNativeMessage(HELPER, { action: 'ping' });
    return { ok: !!res?.ok, version: res?.version };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/* --------------------------------------------------------------- thumbnails */

// Fetch the post thumbnail once, shrink it, and keep it inline so the history
// page never has to load anything from the internet.
async function makeThumb(url) {
  if (!url) return null;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
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

import { isSiteMediaUrl } from './resolve.js';

// Local-only storage: settings + download history live in chrome.storage.local.
// Nothing here ever leaves the browser.
//
// Layout:
//   settings          the options (see DEFAULT_SETTINGS)
//   history           array of HistoryEntry, newest first, at most MAX_HISTORY
//   thumb:<entry id>  that entry's small JPEG thumbnail as a data: URL. Kept apart from
//                     `history` so that changing one entry doesn't rewrite every image.

/**
 * @typedef {Object} HistoryEntry
 * @property {string} id            random id
 * @property {string} title         post title (or file name)
 * @property {string} author        "@handle", "r/subreddit" or ""
 * @property {'x'|'reddit'|'facebook'|'web'} site
 * @property {string} sourceUrl     the post (or page) the video came from
 * @property {string} mediaUrl      the video file's address (Reddit: the picture-only track when merged)
 * @property {string} mediaHost     host of mediaUrl; agreed to once, so "Download again" may reuse it
 * @property {number} index         the video's position in its post (1-based)
 * @property {boolean} noAudio      saved without sound
 * @property {boolean} whole        mediaUrl is the complete video (false for a Reddit picture track)
 * @property {string} filename      path relative to Downloads that was asked for
 * @property {string|null} path     full path once Chrome reports it
 * @property {number|null} downloadId  Chrome's download id
 * @property {string|null} dlStart  that download's start time; with downloadId, identifies it
 * @property {'merging'|'in_progress'|'complete'|'interrupted'} state
 * @property {string} error         Chrome's error code, or REDIRECTED / MERGE_FAILED / MERGE_INTERRUPTED
 * @property {number} bytes         file size once complete
 * @property {number} createdAt     ms since 1970
 * @property {string} [postId]      the post's id on its site (used to spot videos saved before)
 * @property {boolean} [fav]        starred as a favourite
 * @property {string} [note]        the user's own note, searchable
 * @property {boolean} [imported]   came from a backup file
 */

export const DEFAULT_SETTINGS = {
  folder: 'ClipSnatcher',     // subfolder inside Chrome's Downloads folder
  perSite: true,           // ClipSnatcher/X, ClipSnatcher/Reddit, ...
  hoverButton: true,       // floating "Save" button over videos
  authorInName: true,      // prefix filenames with @author when known
  quality: 'best',         // 'best' | 'smaller' (720p or less) | 'fit' (under maxMB)
  maxMB: 10,               // size limit for 'fit', e.g. a chat app's upload limit
  autoCopy: false,         // copy each video to the clipboard when it finishes (copy helper)
  notifyProblems: false,   // a system notification when a save fails out of sight (optional permission)
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, .../** @type {object} */ (settings || {}) };
}

// Changes are applied one after another, so two made at nearly the same moment (a toggle
// clicked as the folder box saves) can't both start from the old settings and drop one.
let settingsQueue = Promise.resolve();
export function saveSettings(patch) {
  const run = settingsQueue.then(async () => {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ settings: next });
    return next;
  });
  settingsQueue = run.catch(() => {});
  return run;
}

export async function getHistory() {
  const { history } = await chrome.storage.local.get('history');
  return Array.isArray(history) ? history : [];
}

// Writes in one JavaScript context go through one queue so concurrent downloads can't
// clobber each other. The queue is per context, so every history write is made by the
// background worker; pages ask it by message instead of writing themselves.
// Return NO_CHANGE from `fn` to skip the write.
export const NO_CHANGE = Symbol('no change');
// Like NO_CHANGE, but the caller still gets `value` back.
const NO_CHANGE_WITH = (value) => ({ [NO_CHANGE]: true, value });
let queue = Promise.resolve();
export function mutateHistory(fn) {
  const run = queue.then(async () => {
    const list = await getHistory();
    const result = await fn(list);
    if (result === NO_CHANGE) return undefined;
    if (result && result[NO_CHANGE]) return result.value;
    await chrome.storage.local.set({ history: list });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export const MAX_HISTORY = 5000;   // oldest entries beyond this are dropped (files are never touched)
export const addEntry = (entry) => mutateHistory((list) => {
  list.unshift(entry);
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  return entry;
});

// True when applying `patch` would change nothing in `e`. With a full history, every
// write rewrites the whole list (about 4 MB at 5,000 entries), so writes that change
// nothing are skipped.
const changesNothing = (e, patch) => Object.keys(patch).every((k) => Object.is(e[k], patch[k]));

export const updateEntry = (id, patch) => mutateHistory((list) => {
  const e = list.find((x) => x.id === id);
  if (!e) return NO_CHANGE;
  if (changesNothing(e, patch)) return NO_CHANGE_WITH(e);
  Object.assign(e, patch);
  return e;
});

// True when a Chrome download item is the file this history entry was created for.
// Chrome can reuse download IDs after its list is cleared, so the ID alone isn't enough.
export function isEntryDownload(entry, item, extensionId) {
  return !!item && entry.downloadId === item.id && item.byExtensionId === extensionId
    && (!entry.dlStart || entry.dlStart === item.startTime);
}

// Applies a patch to the entry that belongs to this download. `patch` is an object, or a
// function that is given the entry and returns one.
// Resolves to { entry, was } (`was` = the state before the patch), or undefined if no entry
// matches. A patch that changes nothing is not written, but still resolves to the entry.
export const updateByDownload = (item, extensionId, patch) => mutateHistory((list) => {
  const e = list.find((x) => isEntryDownload(x, item, extensionId));
  if (!e) return NO_CHANGE;
  const was = e.state;
  const p = typeof patch === 'function' ? patch(e) : patch;
  if (changesNothing(e, p)) return NO_CHANGE_WITH({ entry: { ...e }, was });
  Object.assign(e, p);
  return { entry: { ...e }, was };
});

// Short, plain reason for a Chrome download error code.
export function failureReason(code) {
  if (!code) return '';
  if (code === 'USER_CANCELED') return 'cancelled';
  if (code === 'REDIRECTED') return 'the address redirected to another site';
  if (code === 'MERGE_FAILED') return 'couldn\u2019t merge the video and sound';
  if (code === 'MERGE_INTERRUPTED') return 'the merge was interrupted';
  if (code === 'IMPORTED') return 'it hadn\u2019t finished when the backup was made';
  if (code === 'FILE_NO_SPACE') return 'disk is full';
  if (/^FILE_(ACCESS_DENIED|BLOCKED|SECURITY_CHECK_FAILED|VIRUS_INFECTED)/.test(code)) return 'blocked by Chrome or the system';
  if (/^FILE_/.test(code)) return 'couldn’t write the file';
  if (/^(NETWORK_|SERVER_)/.test(code)) return 'network problem';
  return 'interrupted';
}

export const removeEntries = (ids) => mutateHistory((list) => {
  const set = new Set(ids);
  for (let i = list.length - 1; i >= 0; i--) if (set.has(list[i].id)) list.splice(i, 1);
});

// Empties history and resolves to the entries that were in it. With `keepThumbs`, their
// thumbnails stay until the next tidy-up, so the clear can be undone with pictures.
export const clearHistory = async ({ keepThumbs = false } = {}) => {
  const removed = await mutateHistory((list) => list.splice(0));
  if (!keepThumbs) await pruneThumbs();
  return removed || [];
};

/* -------------------------------------------------------------- backup/import */

export const BACKUP_FORMAT = 2;
export const THUMB_OK = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
// The thumbnails this extension makes are 160 px JPEGs, a few thousand characters each.
// The limit leaves plenty of room for those while keeping a crafted backup from filling
// the disk: 5,000 entries at this size is under 200 MB, and restoring stops adding
// pictures once storage passes IMAGE_BUDGET_BYTES anyway.
const THUMB_MAX_CHARS = 40000;
export const IMAGE_BUDGET_BYTES = 100 * 1048576;
export const validThumb = (t) => typeof t === 'string' && t.length <= THUMB_MAX_CHARS && THUMB_OK.test(t);

// Turns one entry from a backup file into a safe history entry, or null.
// A backup may come from anywhere, so nothing in it is trusted:
// - it is tied to no Chrome download (download ids belong to the computer it came from);
// - it carries no agreement to download from another host (mediaHost is dropped, so
//   "Download again" asks again), and files from other websites keep no file address;
// - addresses must be plain web links; text fields are cut to size.
export function cleanImportedEntry(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !/^[\w-]{1,100}$/.test(e.id) || typeof e.title !== 'string') return null;
  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
  const link = (v) => {
    try { const u = new URL(v); return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? u.href : ''; } catch { return ''; }
  };
  const site = ['x', 'reddit', 'facebook', 'web'].includes(e.site) ? e.site : 'web';
  const path = str(e.path, 4096);
  return {
    id: e.id, title: str(e.title, 1000) || 'video', author: str(e.author, 200), site,
    sourceUrl: link(e.sourceUrl), postId: str(e.postId, 100),
    mediaUrl: site !== 'web' && isSiteMediaUrl(site, link(e.mediaUrl)) ? link(e.mediaUrl) : '', mediaHost: '',
    index: Number.isInteger(e.index) && e.index > 0 && e.index < 50 ? e.index : 1,
    noAudio: e.noAudio === true, whole: e.whole === true,
    filename: str(e.filename, 1000), path: /^(\/|[A-Za-z]:\\)/.test(path) ? path : null,
    downloadId: null, dlStart: null,
    state: e.state === 'complete' ? 'complete' : 'interrupted', error: e.state === 'complete' ? '' : 'IMPORTED',
    bytes: Number.isFinite(e.bytes) && e.bytes >= 0 ? e.bytes : 0,
    createdAt: Number.isFinite(e.createdAt) && e.createdAt > 0 && e.createdAt <= Date.now() ? e.createdAt : Date.now(),
    fav: e.fav === true, note: str(e.note, 500).trim(), imported: true,
  };
}

/* ---------------------------------------------------------------- thumbnails */

export const THUMB_PREFIX = 'thumb:';
const thumbKey = (id) => THUMB_PREFIX + id;

export const setThumb = (id, dataUrl) => chrome.storage.local.set({ [thumbKey(id)]: dataUrl });

// Thumbnails for some entries, as a Map of entry id -> data URL.
export async function getThumbs(ids) {
  if (!ids.length) return new Map();
  const got = await chrome.storage.local.get(ids.map(thumbKey));
  return new Map(ids.filter((id) => typeof got[thumbKey(id)] === 'string').map((id) => [id, got[thumbKey(id)]]));
}

// Older versions kept thumbnails inside each history entry. Moves them to their own
// keys. Safe to run any number of times.
export const migrateThumbs = () => mutateHistory(async (list) => {
  const moved = {};
  let touched = false;
  for (const e of list) {
    if (!('thumb' in e)) continue;
    if (typeof e.thumb === 'string' && e.thumb) moved[thumbKey(e.id)] = e.thumb;
    delete e.thumb;                               // also the empty "thumb: null" older versions wrote
    touched = true;
  }
  if (!touched) return NO_CHANGE;
  await chrome.storage.local.set(moved);       // images first, so nothing is lost if this stops half-way
  return Object.keys(moved).length;
});

// Deletes thumbnails whose entry is gone. Removed entries keep theirs until this runs
// (on browser start-up, update and Clear history), so Undo can bring them back whole.
// Runs in the history write queue, so it can't race an Undo that is putting an entry back.
// Chrome before 130 has no way to list keys without reading every value, so there this
// only runs when `thorough` is set (an update, or Clear history), not on every start-up.
export const pruneThumbs = ({ thorough = true } = {}) => mutateHistory(async (list) => {
  if (!chrome.storage.local.getKeys && !thorough) return NO_CHANGE;
  const keys = chrome.storage.local.getKeys ? await chrome.storage.local.getKeys() : Object.keys(await chrome.storage.local.get(null));
  const live = new Set(list.map((e) => thumbKey(e.id)));
  const dead = keys.filter((k) => k.startsWith(THUMB_PREFIX) && !live.has(k));
  if (dead.length) await chrome.storage.local.remove(dead);
  return NO_CHANGE;                               // history itself is unchanged
}).then(() => undefined);

// Puts removed entries back (Undo). Only plain entry objects with an id that isn't
// already present are accepted, and the list is kept newest first. An entry that was
// "merging" when removed, and whose merge is no longer in `running`, comes back as
// failed (removing the row cancelled that merge). Resolves to the restored entries.
// With `keepExisting` (restoring a backup), entries already in history are never pushed
// out to make room: only as many are added as there is space for. The result also says
// how many were already there (`existing`) and how many didn't fit (`full`).
export const restoreEntries = (entries, running = new Set(), { keepExisting = false } = {}) => mutateHistory((list) => {
  const have = new Set(list.map((e) => e.id));
  const back = [];
  let existing = 0, full = 0;
  const room = keepExisting ? Math.max(0, MAX_HISTORY - list.length) : MAX_HISTORY;
  for (const e of entries.slice(0, MAX_HISTORY)) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.title !== 'string' || !Number.isFinite(e.createdAt)) continue;
    if (have.has(e.id)) { existing++; continue; }
    if (back.length >= room) { full++; continue; }
    have.add(e.id);
    const { thumb, ...plain } = e;               // images live under their own keys, never inside an entry
    back.push(plain.state === 'merging' && !running.has(plain.id) ? { ...plain, state: 'interrupted', error: 'MERGE_INTERRUPTED' } : plain);
  }
  const result = Object.assign([], { existing, full });
  if (!back.length) return keepExisting ? NO_CHANGE_WITH(result) : NO_CHANGE;
  list.push(...back);
  list.sort((a, b) => b.createdAt - a.createdAt);
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  const kept = new Set(list.map((e) => e.id));
  for (const e of back) if (kept.has(e.id)) result.push({ id: e.id, downloadId: e.downloadId ?? null });
  return result;
});

// Marks entries stuck in "merging" as failed, except the merges in `running`.
export const failStaleMerges = (running) => mutateHistory((list) => {
  let n = 0;
  for (const e of list) if (e.state === 'merging' && !running.has(e.id)) { e.state = 'interrupted'; e.error = 'MERGE_INTERRUPTED'; n++; }
  return n || NO_CHANGE;
});

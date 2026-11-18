// Local-only storage: settings + download history live in chrome.storage.local.
// Nothing here ever leaves the browser.

export const DEFAULT_SETTINGS = {
  folder: 'ClipSnatcher',     // subfolder inside Chrome's Downloads folder
  perSite: true,           // ClipSnatcher/X, ClipSnatcher/Reddit, ...
  hoverButton: true,       // floating "Save" button over videos
  authorInName: true,      // prefix filenames with @author when known
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
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
let queue = Promise.resolve();
export function mutateHistory(fn) {
  const run = queue.then(async () => {
    const list = await getHistory();
    const result = await fn(list);
    if (result === NO_CHANGE) return undefined;
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

export const updateEntry = (id, patch) => mutateHistory((list) => {
  const e = list.find((x) => x.id === id);
  if (!e) return NO_CHANGE;
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
// Resolves to { entry, was } (`was` = the state before the patch), or undefined if no entry matches.
export const updateByDownload = (item, extensionId, patch) => mutateHistory((list) => {
  const e = list.find((x) => isEntryDownload(x, item, extensionId));
  if (!e) return NO_CHANGE;
  const was = e.state;
  Object.assign(e, typeof patch === 'function' ? patch(e) : patch);
  return { entry: { ...e }, was };
});

// Short, plain reason for a Chrome download error code.
export function failureReason(code) {
  if (!code) return '';
  if (code === 'USER_CANCELED') return 'cancelled';
  if (code === 'REDIRECTED') return 'the address redirected to another site';
  if (code === 'MERGE_FAILED') return 'couldn\u2019t merge the video and sound';
  if (code === 'MERGE_INTERRUPTED') return 'the merge was interrupted';
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

export const clearHistory = () => mutateHistory((list) => { list.length = 0; });

// Puts removed entries back (Undo). Only plain entry objects with an id that isn't
// already present are accepted, and the list is kept newest first. An entry that was
// "merging" when removed, and whose merge is no longer in `running`, comes back as
// failed (removing the row cancelled that merge). Resolves to the restored entries.
export const restoreEntries = (entries, running = new Set()) => mutateHistory((list) => {
  const have = new Set(list.map((e) => e.id));
  const back = [];
  for (const e of entries.slice(0, MAX_HISTORY)) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.title !== 'string' || !Number.isFinite(e.createdAt) || have.has(e.id)) continue;
    have.add(e.id);
    back.push(e.state === 'merging' && !running.has(e.id) ? { ...e, state: 'interrupted', error: 'MERGE_INTERRUPTED' } : { ...e });
  }
  if (!back.length) return NO_CHANGE;
  list.push(...back);
  list.sort((a, b) => b.createdAt - a.createdAt);
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  return back.map((e) => ({ id: e.id, downloadId: e.downloadId ?? null }));
});

// Marks entries stuck in "merging" as failed, except the merges in `running`.
export const failStaleMerges = (running) => mutateHistory((list) => {
  let n = 0;
  for (const e of list) if (e.state === 'merging' && !running.has(e.id)) { e.state = 'interrupted'; e.error = 'MERGE_INTERRUPTED'; n++; }
  return n || NO_CHANGE;
});

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

// All writes go through one queue so concurrent downloads can't clobber each other.
let queue = Promise.resolve();
export function mutateHistory(fn) {
  const run = queue.then(async () => {
    const list = await getHistory();
    const result = await fn(list);
    await chrome.storage.local.set({ history: list });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export const addEntry = (entry) => mutateHistory((list) => { list.unshift(entry); return entry; });

export const updateEntry = (id, patch) => mutateHistory((list) => {
  const e = list.find((x) => x.id === id);
  if (e) Object.assign(e, patch);
  return e;
});

export const updateByDownloadId = (downloadId, patch) => mutateHistory((list) => {
  const e = list.find((x) => x.downloadId === downloadId);
  if (e) Object.assign(e, patch);
  return e;
});

export const removeEntries = (ids) => mutateHistory((list) => {
  const set = new Set(ids);
  for (let i = list.length - 1; i >= 0; i--) if (set.has(list[i].id)) list.splice(i, 1);
});

export const clearHistory = () => mutateHistory((list) => { list.length = 0; });

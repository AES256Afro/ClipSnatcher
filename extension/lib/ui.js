// Shared UI pieces for the popup and the history page.
import { isEntryDownload, failureReason } from './store.js';

export const ICON = {
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M1.75 4.25a1 1 0 0 1 1-1h3.5l1.5 1.75h5.5a1 1 0 0 1 1 1v6.75a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.3v9.4a.5.5 0 0 0 .77.42l7.2-4.7a.5.5 0 0 0 0-.84l-7.2-4.7A.5.5 0 0 0 5 3.3z"/></svg>',
  link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/></svg>',
  open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>',
  redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3v3.5H9.5"/><path d="M12.6 6.5A5 5 0 1 0 13 10"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6"/></svg>',
  remove: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h10M3 8h6M3 11h4M11 9.5l3 3M14 9.5l-3 3"/></svg>',
  path: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V6z"/><path d="M9 2.5V6h3.5M6 9h4M6 11h2.5"/></svg>',
  more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>',
  film: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6.5 6v4l3.5-2z" fill="currentColor"/></svg>',
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4"/></svg>',
  history: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2.5 5.7"/><path d="M2.5 2.5v3.2h3.2M8 5v3.2l2 1.3"/></svg>',
};

const SITE_LABEL = { x: 'X', reddit: 'Reddit', facebook: 'Facebook', web: 'Web' };

// The copy helper is macOS-only, and file-manager wording differs by system.
export const platform = { mac: true };
export const platformReady = chrome.runtime.getPlatformInfo().then((i) => { platform.mac = i.os === 'mac'; }).catch(() => {});
const fileManager = () => (platform.mac ? 'Finder' : 'your file manager');
const copyKeys = () => (platform.mac ? '⌘C' : 'Ctrl+C');

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
}

export function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

export async function getHistory() {
  const { history } = await chrome.storage.local.get('history');
  return Array.isArray(history) ? history : [];
}

// Look up live state (progress, file still exists) for the rows on screen. A Chrome
// download record only counts if it is the very download this entry was created for.
export async function liveState(entries) {
  const map = new Map();
  await Promise.all(entries.filter((e) => e.downloadId != null).map(async (e) => {
    try {
      const [it] = await chrome.downloads.search({ id: e.downloadId });
      if (isEntryDownload(e, it, chrome.runtime.id)) map.set(e.id, it);
    } catch { /* ignore */ }
  }));
  return map;
}

// How far each Reddit merge has got, by entry id (kept by the background worker).
export async function mergeProgress() {
  try { return (await chrome.storage.session.get('progress')).progress || {}; } catch { return {}; }
}

/* ------------------------------------------------------------------ row state */

// One of: merging | downloading | ready | unlisted | missing | failed.
// "unlisted" means the download finished but Chrome's own list no longer has it
// (the user cleared it), so the file is probably still where it was saved.
export function rowState(e, it) {
  if (e.error === 'REDIRECTED') return 'failed';
  if (e.state === 'merging') return 'merging';
  if (it) {
    if (it.state === 'in_progress') return 'downloading';
    if (it.state === 'interrupted') return 'failed';
    return it.exists === false ? 'missing' : 'ready';
  }
  if (e.state === 'complete' && e.path) return 'unlisted';
  return 'failed';
}

export const progressText = (it) => `Downloading${it.totalBytes > 0 ? ` ${Math.round((it.bytesReceived / it.totalBytes) * 100)}%` : '…'}`;
const mergeText = (pct, compact) => `${compact ? 'Merging' : 'Merging video and sound'}${Number.isFinite(pct) ? ` ${pct}%` : '…'}`;

function statusHTML(e, it, state, progress, compact) {
  let out = '';
  if (state === 'merging') out = `<span data-progress${compact ? ' data-compact' : ''}>${mergeText(progress?.[e.id], compact)}</span>`;
  else if (state === 'downloading') out = `<span data-progress>${progressText(it)}</span>`;
  else if (state === 'failed') {
    // Our own verdict (a redirect we stopped) beats Chrome's "cancelled".
    const why = failureReason(e.error === 'REDIRECTED' || !it ? e.error : (it.error || e.error));
    const full = why === 'cancelled' ? 'Cancelled' : `Failed${why ? `: ${why}` : ''}`;
    out = `<span class="bad" title="${esc(full)}">${compact && why !== 'cancelled' ? 'Failed' : esc(full)}</span>`;
  } else if (state === 'missing') out = `<span class="bad" title="File moved or deleted">${compact ? 'File missing' : 'File moved or deleted'}</span>`;
  else {
    const size = fmtBytes(it?.fileSize || e.bytes);
    if (size && !(compact && e.noAudio)) out = `<span>${size}</span>`;   // in the popup, "No sound" matters more than the size
    if (state === 'unlisted' && !compact) out += '<span class="quiet">Not in Chrome’s download list</span>';
  }
  if (e.noAudio) out += '<span class="bad">No sound</span>';
  return out;
}

const THUMB_OK = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

/* ----------------------------------------------------------------- rendering */

// Main buttons depend on what can actually be done with the file right now.
// Everything else lives in the More menu.
function mainActions(state) {
  if (state === 'ready') return [['play', 'play', 'Play'], ['show', 'folder', 'Show in folder'], ...(platform.mac ? [['copy', 'copy', 'Copy']] : [])];
  if (state === 'unlisted') return [...(platform.mac ? [['show', 'folder', 'Show in folder']] : []), ['copypath', 'path', 'Copy path']];
  if (state === 'failed' || state === 'missing') return [['redo', 'redo', 'Download again']];
  return [];
}

function menuActions(state, e) {
  const items = [];
  if (/^https?:\/\//i.test(e.sourceUrl || '')) items.push(['source', 'open', 'Open original post'], ['copylink', 'link', 'Copy post link']);
  if (state === 'ready' || state === 'unlisted') items.push(['copypath', 'path', 'Copy file path'], ['redo', 'redo', 'Download again']);
  items.push(['remove', 'remove', 'Remove from history']);
  if (state === 'ready') items.push(['deletefile', 'trash', 'Delete file…', true]);
  return items;
}

export function rowHTML(e, live, { compact = false, progress = {} } = {}) {
  const it = live.get(e.id);
  const state = rowState(e, it);
  const title = esc(e.title);
  const id = esc(e.id);
  const thumbInner = THUMB_OK.test(e.thumb || '') ? '' : ICON.film;
  // The thumbnail is a Play button only when Chrome can actually open the file.
  const thumb = state === 'ready'
    ? `<button class="thumb" data-act="play" data-slot="thumb" data-id="${id}" aria-label="Play: ${title}" title="Play">${thumbInner}<span class="thumb-play">${ICON.play}</span></button>`
    : `<div class="thumb">${thumbInner}</div>`;
  const main = mainActions(state).filter(([act]) => !(compact && act === 'play'))   // in the popup the thumbnail is enough
    .map(([act, icon, label]) => `<button class="btn ghost${compact ? ' icon' : ''}" data-act="${act}" data-id="${id}" title="${label}" aria-label="${label}: ${title}">${ICON[icon]}${compact ? '' : `<span>${label}</span>`}</button>`).join('');
  const more = `<button class="btn ghost icon" data-act="more" data-id="${id}" title="More" aria-label="More actions: ${title}" aria-haspopup="menu" aria-expanded="false">${ICON.more}</button>`;
  return `<div class="row" role="listitem" data-id="${id}" data-state="${state}">
    ${thumb}
    <div class="meta">
      <div class="title" title="${title}">${title}</div>
      <div class="sub"><span class="badge ${esc(e.site)}">${SITE_LABEL[e.site] || 'Web'}</span>${e.author && !(compact && state !== 'ready') ? `<span class="author">${esc(e.author)}</span>` : ''}<span>${timeAgo(e.createdAt)}</span>${statusHTML(e, it, state, progress, compact)}</div>
    </div>
    <div class="actions" role="group" aria-label="Actions for ${title}">${main}${more}</div>
  </div>`;
}

// Puts the rows on the page. Keeps keyboard focus on the same button of the same row
// across refreshes, and applies thumbnails from code (never through markup), and only
// if they are the inline JPEGs this extension makes. An open More menu is closed,
// because the row it belongs to is being replaced.
export function renderList(container, entries, live, opts = {}) {
  closeMenu();
  const active = container.contains(document.activeElement) ? document.activeElement : null;
  const keep = active?.dataset?.id ? { id: active.dataset.id, act: active.dataset.act, slot: active.dataset.slot || '' } : null;
  container.innerHTML = entries.length ? entries.map((e) => rowHTML(e, live, opts)).join('') : (opts.emptyHTML || '');
  const byId = new Map(entries.map((e) => [e.id, e.thumb]));
  for (const row of container.querySelectorAll('.row')) {
    const thumb = byId.get(row.dataset.id);
    if (THUMB_OK.test(thumb || '')) row.querySelector('.thumb').style.backgroundImage = `url("${thumb}")`;
  }
  if (keep) {
    const inRow = [...container.querySelectorAll('[data-act]')].filter((b) => b.dataset.id === keep.id);
    const again = inRow.find((b) => b.dataset.act === keep.act && (b.dataset.slot || '') === keep.slot)
      || inRow.find((b) => b.dataset.act === keep.act)
      || inRow.find((b) => b.dataset.act === 'more');
    again?.focus({ preventScroll: true });
  }
}

// Chrome sends no event as bytes arrive, so pages call this about once a second while
// something is downloading or merging. It only rewrites the progress text, leaving the
// rows (and keyboard focus) alone. Resolves to 'active', 'changed' (something finished
// or failed: do a full render) or 'idle'.
export async function tickProgress(container, entries, live) {
  const downloading = entries.filter((e) => live.get(e.id)?.state === 'in_progress');
  const mergingNow = entries.filter((e) => e.state === 'merging');
  if (!downloading.length && !mergingNow.length) return 'idle';
  const rowOf = (id) => [...container.querySelectorAll('.row')].find((r) => r.dataset.id === id)?.querySelector('[data-progress]');
  const fresh = await liveState(downloading);
  for (const e of downloading) {
    const it = fresh.get(e.id);
    if (!it || it.state !== 'in_progress') return 'changed';
    live.set(e.id, it);
    const el = rowOf(e.id);
    if (el) el.textContent = progressText(it);
  }
  if (mergingNow.length) {
    const progress = await mergeProgress();
    for (const e of mergingNow) { const el = rowOf(e.id); if (el) el.textContent = mergeText(progress[e.id], el.hasAttribute('data-compact')); }
  }
  return 'active';
}
export const needsTicking = (entries, live) => entries.some((e) => e.state === 'merging' || live.get(e.id)?.state === 'in_progress');

/* ------------------------------------------------------------------ More menu */

let menuEl = null, menuFor = null;
function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.setAttribute('popover', '');
  menuEl.setAttribute('role', 'menu');
  menuEl.addEventListener('toggle', (ev) => {
    if (ev.newState === 'closed' && menuFor) { menuFor.setAttribute('aria-expanded', 'false'); menuFor = null; }
  });
  menuEl.addEventListener('keydown', (ev) => {
    const items = [...menuEl.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (ev.key === 'Home') { ev.preventDefault(); items[0]?.focus(); }
    else if (ev.key === 'End') { ev.preventDefault(); items[items.length - 1]?.focus(); }
    else if (ev.key === 'Tab') menuEl.hidePopover();
  });
  document.body.appendChild(menuEl);
  return menuEl;
}

export function closeMenu() {
  if (menuEl?.matches(':popover-open')) menuEl.hidePopover();
}

// Opens the More menu for one row, next to its button.
export function openMenu(button, entry, liveItem, say) {
  const menu = ensureMenu();
  if (menuFor === button) { menu.hidePopover(); return; }
  if (menuFor) menuFor.setAttribute('aria-expanded', 'false');   // another row's menu was open
  closeMenu();
  const state = rowState(entry, liveItem);
  menu.innerHTML = menuActions(state, entry).map(([act, icon, label, danger]) =>
    `<button type="button" role="menuitem" class="menu-item${danger ? ' danger' : ''}" data-act="${act}">${ICON[icon]}<span>${label}</span></button>`).join('');
  menu.onclick = (ev) => {
    const item = ev.target.closest('button[data-act]');
    if (!item) return;
    menu.hidePopover();
    button.focus({ preventScroll: true });
    runAction(item.dataset.act, entry, say, liveItem);   // still inside the click, so Chrome allows opening files
  };
  menu.showPopover();
  menuFor = button;
  button.setAttribute('aria-expanded', 'true');
  const r = button.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
  const top = r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.querySelector('button')?.focus({ preventScroll: true });
}

/* -------------------------------------------------------------------- actions */

const send = (msg) => chrome.runtime.sendMessage(msg);

// One handler for every row button. `say(text, kind, action)` reports back to the page;
// `action` is an optional { label, run } button shown with the message.
// `cached` is the download item from the last render, so Play/Show run synchronously
// inside the click (Chrome requires a user gesture for opening files).
export async function handleAction(act, entry, say, cached) {
  let live = cached;
  if (!live && entry.downloadId != null) {
    const [it] = await chrome.downloads.search({ id: entry.downloadId });
    if (isEntryDownload(entry, it, chrome.runtime.id)) live = it;
  }
  const state = rowState(entry, live);
  const ready = state === 'ready';
  const path = live?.filename || entry.path || '';
  const copyPath = { label: 'Copy path', run: async () => { await navigator.clipboard.writeText(path); say('File path copied.', 'ok'); } };
  const whereItIs = () => say(`Chrome’s download list was cleared, so the file can’t be opened from here. It should still be at: ${path}`, '', copyPath);
  const notReady = () => say(state === 'downloading' ? 'Still downloading.' : state === 'merging' ? 'Still merging.' : 'The file isn’t available. Use Download again.', 'err');

  switch (act) {
    case 'play':
      if (ready) { chrome.downloads.open(entry.downloadId); return; }
      return state === 'unlisted' ? whereItIs() : notReady();
    case 'show': {
      if (ready) { chrome.downloads.show(entry.downloadId); return; }
      if (state !== 'unlisted') return notReady();
      const r = await send({ type: 'clipsnatcher:reveal', id: entry.id }).catch(() => null);
      if (!r?.ok) return r?.needsHelper || !r ? whereItIs() : say(r.error, 'err');
      return;
    }
    case 'copy': {
      if (!ready && state !== 'unlisted') return notReady();
      const r = await send({ type: 'clipsnatcher:copyFile', id: entry.id });
      if (r?.ok) return say('Video copied. Paste it into Discord, Messages and so on.', 'ok');
      if (r?.needsHelper && ready) {
        chrome.downloads.show(entry.downloadId);
        return say(`The file is shown in ${fileManager()}: press ${copyKeys()} there, then paste.${platform.mac ? ' For one-click copy, set up the copy helper in Settings.' : ''}`);
      }
      return say(r?.error || 'Couldn’t copy the file.', 'err');
    }
    case 'copypath':
      if (!path) return notReady();
      await navigator.clipboard.writeText(path);
      return say('File path copied.', 'ok');
    case 'source':
      if (!/^https?:\/\//i.test(entry.sourceUrl || '')) return say('This entry has no valid link.', 'err');
      chrome.tabs.create({ url: entry.sourceUrl });
      return;
    case 'copylink':
      await navigator.clipboard.writeText(entry.sourceUrl);
      return say('Post link copied.', 'ok');
    case 'redo': {
      say('Downloading again…');
      let r = await send({ type: 'clipsnatcher:redownload', id: entry.id });
      if (r?.needsConfirm) {
        // The video now sits on a host that wasn't agreed to before: ask here, on the extension's own page.
        if (!window.confirm(`${r.error}\n\nDownload from ${r.host}?`)) return say('Not downloaded.');
        r = await send({ type: 'clipsnatcher:redownload', id: entry.id, allowHost: r.host });
      }
      return say(r?.ok ? `Download started${r.warning ? `. ${r.warning}` : '.'}` : (r?.error || 'Couldn’t download again.'), r?.ok ? 'ok' : 'err');
    }
    case 'remove':
      await send({ type: 'clipsnatcher:remove', ids: [entry.id] });
      return say(state === 'merging' ? 'Removed from history. The merge was stopped, so nothing is saved.' : 'Removed from history. The file itself is untouched.', 'ok', {
        label: 'Undo',
        run: async () => {
          const r = await send({ type: 'clipsnatcher:restore', entries: [entry] });
          say(r?.restored ? (state === 'merging' ? 'Put back. Use Download again to save it.' : 'Put back.') : 'It was already back in history.', 'ok');
        },
      });
    case 'deletefile': {
      if (!window.confirm(`Delete this video from your computer and remove it from history?\n\n${entry.title}\n\nThis can’t be undone.`)) return;
      const r = await send({ type: 'clipsnatcher:deleteFile', id: entry.id });
      return say(r?.ok ? 'File deleted and removed from history.' : (r?.error || 'Couldn’t delete the file.'), r?.ok ? 'ok' : 'err');
    }
  }
}

// Saves started from the popup or history page get no notice from the background, so
// the page itself says when a row that was merging ends badly. `seen` is a Map the
// page keeps between renders (entry id -> last state).
export function announceMergeOutcomes(seen, entries, live, say) {
  for (const e of entries) {
    const state = rowState(e, live.get(e.id));
    const before = seen.get(e.id);
    seen.set(e.id, state);
    if (before !== 'merging' || state === 'merging') continue;
    if (state === 'failed') say(`Couldn't save "${e.title}": ${failureReason(e.error) || 'the download failed'}.`, 'err');
    else if (e.noAudio) say(`"${e.title}" is being saved without sound: Reddit's audio couldn't be merged in.`);
  }
}

// Run a row action and make sure a failure is shown instead of vanishing.
export function runAction(act, entry, say, cached) {
  return handleAction(act, entry, say, cached).catch((e) => say(e?.message || 'That didn’t work.', 'err'));
}

// Wire a list container: clicks on row buttons run actions, the More button opens the menu.
// `lookup(id)` returns { entry, live } for a row.
export function wireList(container, lookup, say) {
  container.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-act]');
    if (!b || !container.contains(b)) return;
    const found = lookup(b.dataset.id);
    if (!found?.entry) return;
    if (b.dataset.act === 'more') openMenu(b, found.entry, found.live, say);
    else runAction(b.dataset.act, found.entry, say, found.live);
  });
}

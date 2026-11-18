// Shared UI pieces for the popup and the history page.

export const ICON = {
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M1.75 4.25a1 1 0 0 1 1-1h3.5l1.5 1.75h5.5a1 1 0 0 1 1 1v6.75a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.3v9.4a.5.5 0 0 0 .77.42l7.2-4.7a.5.5 0 0 0 0-.84l-7.2-4.7A.5.5 0 0 0 5 3.3z"/></svg>',
  link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/></svg>',
  open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>',
  redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3v3.5H9.5"/><path d="M12.6 6.5A5 5 0 1 0 13 10"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6"/></svg>',
  film: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6.5 6v4l3.5-2z" fill="currentColor"/></svg>',
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4"/></svg>',
  history: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2.5 5.7"/><path d="M2.5 2.5v3.2h3.2M8 5v3.2l2 1.3"/></svg>',
};

const SITE_LABEL = { x: 'X', reddit: 'Reddit', facebook: 'Facebook', web: 'Web' };

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

// Look up live state (progress, file still exists) for the rows on screen.
export async function liveState(entries) {
  const map = new Map();
  await Promise.all(entries.filter((e) => e.downloadId != null).map(async (e) => {
    try { const [it] = await chrome.downloads.search({ id: e.downloadId }); if (it) map.set(e.id, it); } catch { /* ignore */ }
  }));
  return map;
}

export function rowHTML(e, live, { compact = false } = {}) {
  const it = live.get(e.id);
  let status = '';
  if (it?.state === 'in_progress') status = `<span>Downloading${it.totalBytes ? ` ${Math.round((it.bytesReceived / it.totalBytes) * 100)}%` : '…'}</span>`;
  else if (it?.state === 'interrupted' || e.state === 'interrupted') status = '<span class="missing">Failed</span>';
  else if (it && it.exists === false) status = '<span class="missing">File missing</span>';
  else if (it?.fileSize || e.bytes) status = `<span>${fmtBytes(it?.fileSize || e.bytes)}</span>`;
  const thumb = e.thumb ? `style="background-image:url('${esc(e.thumb)}')"` : '';
  const btn = (act, icon, label) => `<button class="btn icon small" data-act="${act}" data-id="${esc(e.id)}" title="${label}" aria-label="${label}">${ICON[icon]}</button>`;
  const actions = compact
    ? btn('copy', 'copy', 'Copy video file (paste into Discord etc.)') + btn('show', 'folder', 'Show in folder') + btn('source', 'open', 'Open original post')
    : btn('copy', 'copy', 'Copy video file (paste into Discord etc.)') + btn('play', 'play', 'Play') + btn('show', 'folder', 'Show in folder')
      + btn('source', 'open', 'Open original post') + btn('copylink', 'link', 'Copy post link') + btn('redo', 'redo', 'Download again') + btn('remove', 'trash', 'Remove from history');
  return `<div class="row" data-id="${esc(e.id)}">
    <div class="thumb" ${thumb}>${e.thumb ? '' : ICON.film}</div>
    <div class="meta">
      <div class="title" title="${esc(e.title)}">${esc(e.title)}</div>
      <div class="sub"><span class="badge ${esc(e.site)}">${SITE_LABEL[e.site] || 'Web'}</span>${e.author ? `<span>${esc(e.author)}</span>` : ''}<span>${timeAgo(e.createdAt)}</span>${status}</div>
    </div>
    <div class="actions">${actions}</div>
  </div>`;
}

// One handler for every row button. `say(text, kind)` reports back to the page.
// `cached` is the download item from the last render, so Play/Show run synchronously
// inside the click (Chrome requires a user gesture for opening files).
export async function handleAction(act, entry, say, cached) {
  const live = cached || (entry.downloadId != null ? (await chrome.downloads.search({ id: entry.downloadId }))[0] : null);
  switch (act) {
    case 'copy': {
      const r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:copyFile', id: entry.id });
      if (r?.ok) return say('Video copied — paste it into Discord, Messages, etc.', 'ok');
      if (r?.needsHelper) {
        if (live?.exists) { chrome.downloads.show(entry.downloadId); return say('Copy helper not installed, so the file is shown in Finder: press ⌘C there, then paste. (Install the helper in Settings for one-click copy.)', 'err'); }
      }
      return say(r?.error || 'Couldn’t copy.', 'err');
    }
    case 'show':
      if (live?.exists) { chrome.downloads.show(entry.downloadId); return; }
      {
        const r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:reveal', id: entry.id }).catch(() => null);
        if (!r?.ok) say(live?.exists === false ? 'File was moved or deleted. Use Download again.' : 'Chrome no longer tracks this file. Use Download again.', 'err');
      }
      return;
    case 'play':
      if (live?.exists && live.state === 'complete') { chrome.downloads.open(entry.downloadId); return; }
      return say('File isn’t available. Use Download again.', 'err');
    case 'source':
      chrome.tabs.create({ url: entry.sourceUrl });
      return;
    case 'copylink':
      await navigator.clipboard.writeText(entry.sourceUrl);
      return say('Post link copied.', 'ok');
    case 'redo': {
      say('Downloading again…');
      const r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:redownload', id: entry.id });
      return say(r?.ok ? 'Started.' : (r?.error || 'Failed.'), r?.ok ? 'ok' : 'err');
    }
    case 'remove':
      await chrome.runtime.sendMessage({ type: 'clipsnatcher:remove', ids: [entry.id] });
      return say('Removed from history (the file itself is untouched).', 'ok');
  }
}

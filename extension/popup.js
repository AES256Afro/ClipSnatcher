import { isPostUrl } from './lib/resolve.js';
import { ICON, getHistory, getThumbs, isThumbChange, liveState, mergeProgress, renderList, tickProgress, needsTicking, wireList, platformReady, announceMergeOutcomes } from './lib/ui.js';

const $ = (id) => document.getElementById(id);
$('openHistory').innerHTML = ICON.history;
$('openSettings').innerHTML = ICON.gear;
$('go').innerHTML = ICON.down + 'Save';

// Reuse an open history tab instead of piling up new ones. (Asking for the extension's
// own open pages needs no extra permission.)
async function openHistory() {
  const url = chrome.runtime.getURL('history.html');
  const [open] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] }).catch(() => []);
  if (open && open.tabId >= 0) {
    await chrome.tabs.update(open.tabId, { active: true }).catch(() => {});
    if (open.windowId >= 0) await chrome.windows.update(open.windowId, { focused: true }).catch(() => {});
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}
$('openHistory').onclick = openHistory;
$('all').onclick = (e) => { e.preventDefault(); openHistory(); };
$('openSettings').onclick = () => chrome.runtime.openOptionsPage();

// Shows a message, optionally with one button ({ label, run }).
function say(text, kind = '', action = null) {
  const s = $('status');
  s.className = 'status ' + kind;
  s.replaceChildren();
  if (!text) return;
  const msg = Object.assign(document.createElement('span'), { className: 'msg', textContent: text });
  s.append(msg);
  if (action) {
    const b = Object.assign(document.createElement('button'), { className: 'btn small', type: 'button', textContent: action.label });
    b.onclick = () => { say(''); action.run(); };
    s.append(b);
  }
}

// If the current tab is a post, pre-fill it so it's one click. (The tab's address is
// only visible to the extension on the sites it has access to.)
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab?.url && isPostUrl(tab.url)) { $('url').value = tab.url; $('url').select(); }
  else $('url').focus();
});

// A right-click save on a page that can't show a notice leaves its result here.
chrome.storage.session.get('lastResult').then(({ lastResult }) => {
  if (!lastResult || Date.now() - lastResult.at > 90000) return;
  say(lastResult.text, lastResult.ok ? 'ok' : 'err');
  chrome.storage.session.remove('lastResult');
}).catch(() => {});

let pendingConfirm = null;   // { url, host } while asking about a download from another host
function askConfirm(next) {
  pendingConfirm = next;
  $('confirm').hidden = !next;
  if (next) $('confirmYes').textContent = `Download from ${next.host}`;
}
$('confirmNo').onclick = () => { askConfirm(null); say(''); };
$('confirmYes').onclick = () => { const c = pendingConfirm; if (c) save(c.url, c.host); };

async function save(url, allowHost = '') {
  askConfirm(null);
  $('go').disabled = true;
  say('Finding the video…');
  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:download', url, allowHost });
  } catch {
    r = { ok: false, error: 'ClipSnatcher didn’t respond. Close this popup and try again.' };
  } finally {
    $('go').disabled = false;
  }
  if (r?.ok) {
    const what = r.count > 1 ? `${r.count} videos from: ${r.title}` : r.title;
    say(`Download started: ${what}${r.warning ? `. ${r.warning}` : ''}`, r.warning ? '' : 'ok');
    $('url').value = '';
  } else if (r?.needsConfirm) {
    say(r.error);
    askConfirm({ url, host: r.host });
  } else {
    say(r?.error || 'Something went wrong.', 'err');
  }
}

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('url').value.trim();
  if (!url) return say('Paste a link first.', 'err');
  save(url);
});

const EMPTY = '<div class="empty">Nothing saved yet. Point at a video on X, Reddit or Facebook and press <b>Save</b>, or paste a post link above.</div>';
let entries = [], live = new Map(), renderNo = 0, progressTimer = 0;
const seenStates = new Map();   // entry id -> state at the last render
async function render() {
  const mine = ++renderNo;
  await platformReady;
  const all = await getHistory();
  const list = all.slice(0, 6);
  const [state, progress, thumbs] = await Promise.all([liveState(list), mergeProgress(), getThumbs(list.map((e) => e.id))]);
  if (mine !== renderNo) return;          // a newer render is on its way; don't paint stale data
  entries = list; live = state;
  announceMergeOutcomes(seenStates, entries, live, say);
  renderList($('recent'), entries, live, { compact: true, progress, thumbs, emptyHTML: EMPTY });
  $('all').hidden = all.length === 0;
  $('all').textContent = all.length > list.length ? `See all ${all.length}` : 'Open history';
  watchProgress();
}
function watchProgress() {
  clearTimeout(progressTimer);
  if (!needsTicking(entries, live)) return;
  progressTimer = setTimeout(async () => {
    const mine = renderNo;
    const state = await tickProgress($('recent'), entries, live);
    if (mine !== renderNo) return;                 // a full render happened meanwhile and re-armed this
    if (state === 'changed') render(); else if (state === 'active') watchProgress();
  }, 1000);
}
render();
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && (c.history || isThumbChange(c))) render(); });
chrome.downloads.onChanged.addListener((d) => { if (d.state || d.exists || d.filename) render(); });
chrome.downloads.onErased.addListener(() => render());

wireList($('recent'), (id) => { const entry = entries.find((x) => x.id === id); return { entry, live: entry && live.get(entry.id) }; }, say);

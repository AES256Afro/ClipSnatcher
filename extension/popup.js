import { ICON, rowHTML, applyThumbs, getHistory, liveState, runAction, tickProgress } from './lib/ui.js';

const $ = (id) => document.getElementById(id);
$('openHistory').innerHTML = ICON.history;
$('openSettings').innerHTML = ICON.gear;
$('go').innerHTML = ICON.down + 'Save';

const openPage = (p) => { chrome.tabs.create({ url: chrome.runtime.getURL(p) }); window.close(); };
$('openHistory').onclick = () => openPage('history.html');
$('all').onclick = (e) => { e.preventDefault(); openPage('history.html'); };
$('openSettings').onclick = () => chrome.runtime.openOptionsPage();

function say(text, kind = '') {
  const s = $('status');
  s.textContent = text || '';
  s.className = 'status ' + kind;
}

// If the current tab is a post, pre-fill it so it's one click. (The tab's address is
// only visible to the extension on the sites it has access to.)
const POST_RE = /^(https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+|https:\/\/(www\.|old\.)?reddit\.com\/r\/[^/]+\/comments\/|https:\/\/(www\.|web\.)?facebook\.com\/.*(\/videos\/|\/reel\/|\/watch))/;
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab?.url && POST_RE.test(tab.url)) { $('url').value = tab.url; $('url').select(); }
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
  } catch (e) {
    r = { ok: false, error: 'ClipSnatcher didn’t respond. Close this popup and try again.' };
  } finally {
    $('go').disabled = false;
  }
  if (r?.ok) {
    const title = r.title.length > 70 ? r.title.slice(0, 70) + '…' : r.title;
    say(`Download started: ${title}${r.warning ? `. ${r.warning}` : ''}`, r.warning ? '' : 'ok');
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

let entries = [], live = new Map(), renderNo = 0;
async function render() {
  const mine = ++renderNo;
  const list = (await getHistory()).slice(0, 6);
  const state = await liveState(list);
  if (mine !== renderNo) return;          // a newer render is on its way; don't paint stale data
  entries = list; live = state;
  $('recent').innerHTML = entries.length
    ? entries.map((e) => rowHTML(e, live, { compact: true })).join('')
    : '<div class="empty">Nothing saved yet. Hover a video on X, Reddit or Facebook and press <b>Save</b>, or paste a link above.</div>';
  applyThumbs($('recent'), entries);
  watchProgress();
}
let progressTimer = 0;
function watchProgress() {
  clearTimeout(progressTimer);
  if (![...live.values()].some((it) => it.state === 'in_progress')) return;
  progressTimer = setTimeout(async () => {
    const mine = renderNo;
    const state = await tickProgress($('recent'), entries, live);
    if (mine !== renderNo) return;                 // a full render happened meanwhile and re-armed this
    if (state === 'changed') render(); else if (state === 'active') watchProgress();
  }, 1000);
}
render();
chrome.storage.onChanged.addListener((c) => { if (c.history) render(); });
chrome.downloads.onChanged.addListener(() => render());

$('recent').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const entry = entries.find((x) => x.id === b.dataset.id);
  if (entry) runAction(b.dataset.act, entry, say, live.get(entry.id));
});

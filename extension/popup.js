import { ICON, rowHTML, getHistory, liveState, handleAction } from './lib/ui.js';

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

// If the current tab is a post, pre-fill it so it's one click.
const POST_RE = /^(https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+|https:\/\/(www\.|old\.)?reddit\.com\/r\/[^/]+\/comments\/|https:\/\/(www\.|web\.)?facebook\.com\/.*(\/videos\/|\/reel\/|\/watch))/;
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab?.url && POST_RE.test(tab.url)) { $('url').value = tab.url; $('url').select(); }
  else $('url').focus();
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('url').value.trim();
  if (!url) return say('Paste a link first.', 'err');
  $('go').disabled = true;
  say('Finding the video…');
  const r = await chrome.runtime.sendMessage({ type: 'clipstash:download', url, hint: {} });
  $('go').disabled = false;
  if (r?.ok) { say(`Saving: ${r.title}${r.warning ? ` (${r.warning})` : ''}`, 'ok'); $('url').value = ''; }
  else say(r?.error || 'Something went wrong.', 'err');
});

let entries = [], live = new Map();
async function render() {
  entries = (await getHistory()).slice(0, 6);
  live = await liveState(entries);
  $('recent').innerHTML = entries.length
    ? entries.map((e) => rowHTML(e, live, { compact: true })).join('')
    : '<div class="empty">Nothing saved yet. Hover a video on X, Reddit or Facebook and hit <b>Save</b>, or paste a link above.</div>';
}
render();
chrome.storage.onChanged.addListener((c) => { if (c.history) render(); });
chrome.downloads.onChanged.addListener(() => render());

$('recent').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const entry = entries.find((x) => x.id === b.dataset.id);
  if (entry) handleAction(b.dataset.act, entry, say, live.get(entry.id));
});

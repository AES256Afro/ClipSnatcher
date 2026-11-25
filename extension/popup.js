import { isPostUrl } from './lib/resolve.js';
import { describeSave } from './lib/trust.js';
import { splitLinks, MAX_BATCH } from './lib/batch.js';
import { problemsSummary } from './lib/problems.js';
import { ICON, getHistory, getThumbs, isThumbChange, liveState, mergeProgress, renderList, tickProgress, needsTicking, wireList, platformReady, announceMergeOutcomes, runAction } from './lib/ui.js';

/** @type {(id: string) => any} */
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
  s.className = 'status ' + kind;   // also drops "long", which only the batch summary sets
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

// What happened while the popup was closed, most important first: a set of pasted links
// still saving or just finished, problems waiting on the badge, or the last right-click
// save's result. Showing problems here clears them from the badge.
async function showWhatHappened() {
  /** @type {{ batch?: any, problems?: { list?: { text: string }[] }, lastResult?: { text: string, ok: boolean, at: number } }} */
  const got = await chrome.storage.session.get(['batch', 'problems', 'lastResult']).catch(() => ({}));
  if (got.batch && showBatch(got.batch)) return;
  const list = got.problems?.list || [];
  if (list.length) {
    say(problemsSummary(list), 'err');
    $('status').classList.add('long');
    chrome.runtime.sendMessage({ type: 'clipsnatcher:problems', clear: true }).catch(() => {});
    chrome.storage.session.remove('lastResult').catch(() => {});
    return;
  }
  const last = got.lastResult;
  if (!last || Date.now() - last.at > 90000) return;
  say(last.text, last.ok ? 'ok' : 'err');
  chrome.storage.session.remove('lastResult');
}
showWhatHappened();

// Shows a set of pasted links being saved, or its summary once finished. True if shown.
function showBatch(batch) {
  if (!batch?.urls?.length) return false;
  if (batch.running) {
    $('go').disabled = true;
    say(`Saving ${Math.min(batch.results.length + 1, batch.urls.length)} of ${batch.urls.length}… You can close this window; saving carries on.`);
    return true;
  }
  $('go').disabled = false;
  if (!batch.summary) return false;
  say(batch.summary.text, batch.summary.ok ? 'ok' : 'err');
  $('status').classList.add('long');      // show every line of the summary
  if (batch.summary.ok && $('url').value.trim() && splitLinks($('url').value).length > 1) $('url').value = '';
  chrome.runtime.sendMessage({ type: 'clipsnatcher:batchSeen' }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'clipsnatcher:problems', clear: true }).catch(() => {});
  return true;
}
chrome.storage.onChanged.addListener((c, area) => { if (area === 'session' && c.batch?.newValue) showBatch(c.batch.newValue); });

// A question with buttons under the status line (for "download from another host?" and
// "already saved"). `choices` is a list of { label, run }; null clears it.
function ask(choices) {
  const row = $('confirm');
  row.replaceChildren();
  row.hidden = !choices;
  for (const c of choices || []) {
    const b = Object.assign(document.createElement('button'), { className: 'btn small', type: 'button', textContent: c.label });
    b.onclick = () => { ask(null); c.run(); };
    row.append(b);
  }
  row.querySelector('button')?.focus();
}

async function send(url, extra = {}) {
  try {
    return await chrome.runtime.sendMessage({ type: 'clipsnatcher:download', url, ...extra });
  } catch {
    return { ok: false, error: 'ClipSnatcher didn’t respond. Close this popup and try again.' };
  }
}

// Shows what happened with one saved link and offers the follow-up choices.
function report(url, r, extra) {
  if (r?.ok) {
    say(describeSave(r), r.warning ? '' : 'ok');
    $('url').value = '';
  } else if (r?.needsConfirm) {
    say(r.error);
    ask([{ label: `Download from ${r.host}`, run: () => save(url, { ...extra, allowHost: r.host }) }, { label: 'Cancel', run: () => say('') }]);
  } else if (r?.duplicate) {
    say(r.error);
    const choices = [];
    if (r.entryId) choices.push({ label: 'Show in folder', run: () => showEntry(r.entryId) });
    choices.push({ label: r.busy ? 'Save another copy' : 'Save again', run: () => save(url, { ...extra, force: true }) });
    choices.push({ label: 'Cancel', run: () => say('') });
    ask(choices);
  } else {
    say(r?.error || 'Something went wrong.', 'err');
  }
}

async function showEntry(id) {
  const entry = (await getHistory()).find((e) => e.id === id);
  if (!entry) return say('That entry is no longer in history.', 'err');
  const [state] = [await liveState([entry])];
  runAction('show', entry, say, state.get(entry.id));
}

async function save(url, extra = {}) {
  ask(null);
  $('go').disabled = true;
  say('Finding the video…');
  const r = await send(url, extra);
  $('go').disabled = false;
  report(url, r, extra);
}

// Several links pasted at once go to the background worker, which saves them one after
// another whether or not this window stays open (lib/batch.js).
async function saveMany(urls) {
  ask(null);
  const r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:batch', urls }).catch(() => null);
  if (!r?.ok) say(r?.error || 'ClipSnatcher didn’t respond. Close this popup and try again.', 'err');
}

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('url').value.trim();
  if (!text) return say('Paste a link first.', 'err');
  const links = splitLinks(text);
  if (links.length > MAX_BATCH) return say(`That's ${links.length} links. Paste up to ${MAX_BATCH} at a time.`, 'err');
  if (links.length > 1) return saveMany(links);
  save(text);
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

$('recent').addEventListener('clipsnatcher:rerender', () => { if ($('recent').dataset.stale) { delete $('recent').dataset.stale; render(); } });
wireList($('recent'), (id) => { const entry = entries.find((x) => x.id === id); return { entry, live: entry && live.get(entry.id) }; }, say);

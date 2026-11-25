import { problemsSummary } from './lib/problems.js';
import { sortEntries, totalBytes } from './lib/history-view.js';
import { ICON, getHistory, getThumbs, isThumbChange, liveState, mergeProgress, renderList, tickProgress, needsTicking, wireList, platformReady, announceMergeOutcomes, fmtBytes } from './lib/ui.js';

/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id);
$('settings').innerHTML = ICON.gear + 'Settings';

const PAGE = 60;
let favsOnly = false;
let all = [], shown = [], live = new Map(), limit = PAGE, site = '', renderNo = 0, progressTimer = 0;

// Shows a notice at the bottom, optionally with one button ({ label, run }).
// A notice stays until dismissed or replaced if it is an error, has a button, or is
// marked `sticky` (a wait in progress). Plain confirmations fade after a few seconds.
const seenStates = new Map();   // entry id -> state at the last render
let noticeTimer;
function say(text, kind = '', action = null, { sticky = false } = {}) {
  const n = $('notice');
  clearTimeout(noticeTimer);
  n.replaceChildren();
  n.hidden = !text;
  if (!text) return;
  n.className = 'notice ' + kind;
  n.append(Object.assign(document.createElement('span'), { className: 'msg', textContent: text }));
  if (action) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: action.label });
    b.onclick = () => { say(''); action.run(); };
    n.append(b);
    // If the action took keyboard focus with it (the row is gone), put focus on the button.
    setTimeout(() => { if (b.isConnected && (document.activeElement === document.body || !document.activeElement?.isConnected)) b.focus(); }, 400);
  }
  const close = Object.assign(document.createElement('button'), { type: 'button', className: 'close', textContent: '\u00d7' });
  close.setAttribute('aria-label', 'Dismiss');
  close.onclick = () => say('');
  n.append(close);
  if (kind !== 'err' && !action && !sticky) noticeTimer = setTimeout(() => say(''), 4500);
}

const SITE_WORDS = { x: 'x twitter', reddit: 'reddit', facebook: 'facebook fb', web: 'web other' };
const searchText = new WeakMap();   // entry -> lower-case text to search, built once per entry
function matches(e, terms) {
  if (site && e.site !== site) return false;
  if (favsOnly && !e.fav) return false;
  if (!terms.length) return true;
  let hay = searchText.get(e);
  if (hay === undefined) searchText.set(e, hay = `${e.title} ${e.author} ${e.sourceUrl} ${e.path || ''} ${SITE_WORDS[e.site] || ''} ${e.note || ''}`.toLowerCase());
  return terms.every((t) => hay.includes(t));
}

const EMPTY_ALL = `<div class="empty">No videos yet. Three ways to save one:
  <ul><li>Point at a video on X, Reddit or Facebook and press <b>Save</b>.</li>
  <li>Right-click a video or a post link and choose the ClipSnatcher item.</li>
  <li>Click the toolbar icon and paste a post link.</li></ul></div>`;
const EMPTY_FILTERED = '<div class="empty">Nothing matches that search or filter.</div>';

async function render() {
  const mine = ++renderNo;
  await platformReady;
  const terms = $('q').value.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = sortEntries(all.filter((e) => matches(e, terms)), $('sort').value);
  const rows = filtered.slice(0, limit);
  const [state, progress, thumbs] = await Promise.all([liveState(rows), mergeProgress(), getThumbs(rows.map((e) => e.id))]);
  if (mine !== renderNo) return;          // a newer render is on its way; don't paint stale data
  shown = rows; live = state;
  announceMergeOutcomes(seenStates, shown, live, say);
  // How many match, and how much disk space their files take (as last recorded).
  const bytes = totalBytes(filtered);
  $('count').textContent = all.length ? `${filtered.length} of ${all.length} video${all.length === 1 ? '' : 's'}${bytes ? ` · ${fmtBytes(bytes)} on disk` : ''}` : '';
  $('clearFilters').hidden = !(all.length && (terms.length || site || favsOnly));
  renderList($('list'), shown, live, { progress, thumbs, emptyHTML: all.length ? EMPTY_FILTERED : EMPTY_ALL });
  $('more').hidden = filtered.length <= limit;
  $('cleanup').hidden = all.length === 0;
  const failed = retryable(all).length;
  $('retryFailed').hidden = !failed || retrying;
  $('retryFailed').textContent = `Retry failed (${failed})`;
  watchProgress();
}

function watchProgress() {
  clearTimeout(progressTimer);
  if (!needsTicking(shown, live)) return;
  progressTimer = setTimeout(async () => {
    const mine = renderNo;
    const state = await tickProgress($('list'), shown, live);
    if (mine !== renderNo) return;                 // a full render happened meanwhile and re-armed this
    if (state === 'changed') render(); else if (state === 'active') watchProgress();
  }, 1000);
}

async function load() { all = await getHistory(); render(); }

let debounce;
$('q').addEventListener('input', () => { clearTimeout(debounce); limit = PAGE; debounce = setTimeout(render, 80); });
function pickSite(next) {
  site = next; limit = PAGE;
  for (const b of $('chips').children) b.setAttribute('aria-pressed', String(b.dataset.site === next));
}
$('chips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  pickSite(c.dataset.site);
  render();
});
$('clearFilters').onclick = () => { $('q').value = ''; pickSite(''); setFavsOnly(false); render(); $('q').focus(); };
function setFavsOnly(on) { favsOnly = on; $('favs').setAttribute('aria-pressed', String(on)); }
$('favs').onclick = () => { setFavsOnly(!favsOnly); limit = PAGE; render(); };
$('sort').addEventListener('change', () => { limit = PAGE; render(); });
$('list').addEventListener('clipsnatcher:rerender', () => { if ($('list').dataset.stale) { delete $('list').dataset.stale; render(); } });
$('more').onclick = () => { limit += PAGE; render(); };

// Downloads that failed and might work now. Ones you cancelled stay as they are, and ones
// stopped for redirecting to another host would only be stopped again.
const retryable = (list) => list.filter((e) => e.state === 'interrupted' && e.error !== 'USER_CANCELED' && e.error !== 'REDIRECTED');

// Tries every failed download again, one after another, with the same rules as each row's
// "Download again". Ones that now need a yes for another host are left for their own row.
let retrying = false;
$('retryFailed').onclick = async () => {
  const list = retryable(all);
  if (!list.length || retrying) return;
  retrying = true;
  $('retryFailed').hidden = true;
  let started = 0, ask = 0;
  const failed = [];
  for (const [i, e] of list.entries()) {
    say(`Trying again ${i + 1} of ${list.length}… Keep this page open until it finishes.`, '', null, { sticky: true });
    const r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:redownload', id: e.id }).catch(() => null);
    if (r?.ok) started++;
    else if (r?.needsConfirm) ask++;
    else failed.push(e.title);
  }
  retrying = false;
  const parts = [`Started ${started} of ${list.length} again.`];
  if (ask) parts.push(`${ask} now come${ask === 1 ? 's' : ''} from another site: use Download again on ${ask === 1 ? 'its row' : 'their rows'} to say yes.`);
  if (failed.length) parts.push(`Still failing: ${failed.slice(0, 5).join(' • ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}.`);
  say(parts.join(' '), failed.length ? 'err' : 'ok');
  render();
};

// Finds entries whose file is gone and offers to remove them (with Undo).
$('cleanup').onclick = async () => {
  $('cleanup').disabled = true;
  say('Checking which files are still there. This takes about 10 seconds…', '', null, { sticky: true });
  let r;
  try { r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:findMissing' }); } catch { r = null; }
  $('cleanup').disabled = false;
  const ids = r?.ids || [];
  if (!r?.ok) return say('Couldn’t check the files. Try again.', 'err');
  if (!ids.length) return say('Nothing to tidy: every file Chrome knows about is still there.', 'ok');
  const gone = all.filter((e) => ids.includes(e.id));
  say(`${ids.length} ${ids.length === 1 ? 'entry points' : 'entries point'} at a file that was moved or deleted.`, '', {
    label: `Remove ${ids.length === 1 ? 'it' : 'them'}`,
    run: async () => {
      await chrome.runtime.sendMessage({ type: 'clipsnatcher:remove', ids });
      say(`Removed ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} from history.`, 'ok', {
        label: 'Undo',
        run: async () => {
          const r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:restore', entries: gone });
          const n = r?.restored || 0;
          say(n === gone.length ? `Put back ${n === 1 ? 'the entry' : `all ${n} entries`}.` : `Put back ${n} of ${gone.length} entries.`, n === gone.length ? 'ok' : 'err');
        },
      });
    },
  });
};

wireList($('list'), (id) => { const entry = shown.find((x) => x.id === id); return { entry, live: entry && live.get(entry.id) }; }, say);

let thumbTimer;
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local') return;
  if (c.history) load();
  else if (isThumbChange(c)) { clearTimeout(thumbTimer); thumbTimer = setTimeout(render, 150); }   // a thumbnail arrived
});
let dlTimer;
chrome.downloads.onChanged.addListener((d) => { if (d.state || d.exists || d.filename) { clearTimeout(dlTimer); dlTimer = setTimeout(render, 300); } });
chrome.downloads.onErased.addListener(() => { clearTimeout(dlTimer); dlTimer = setTimeout(render, 300); });   // Chrome's download list was cleared
// "/" jumps to the search box; Escape in it clears the search.
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && !/** @type {HTMLElement|null} */ (document.activeElement)?.isContentEditable) {
    e.preventDefault();
    $('q').focus();
    $('q').select();
  }
});
$('q').addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('q').value) { e.preventDefault(); $('q').value = ''; limit = PAGE; render(); } });

load();

// Problems that happened out of sight wait on the toolbar badge; opening history shows
// them and clears the badge.
chrome.storage.session.get('problems').then(({ problems }) => {
  const list = /** @type {any} */ (problems)?.list || [];
  if (!list.length) return;
  say(problemsSummary(list), 'err');
  chrome.runtime.sendMessage({ type: 'clipsnatcher:problems', clear: true }).catch(() => {});
}).catch(() => {});

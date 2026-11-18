import { ICON, rowHTML, applyThumbs, getHistory, liveState, runAction, tickProgress } from './lib/ui.js';

const $ = (id) => document.getElementById(id);
$('settings').innerHTML = ICON.gear + 'Settings';

const PAGE = 60;
let all = [], shown = [], live = new Map(), limit = PAGE, site = '', renderNo = 0;

let toastTimer;
function say(text, kind = '') {
  const t = $('toast');
  if (!text) { t.style.display = 'none'; return; }
  t.textContent = text;
  t.className = kind;
  t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.style.display = 'none'), kind === 'err' ? 7000 : 3500);
}

const SITE_WORDS = { x: 'x twitter', reddit: 'reddit', facebook: 'facebook fb', web: 'web other' };
function matches(e, terms) {
  if (site && e.site !== site) return false;
  if (!terms.length) return true;
  const hay = `${e.title} ${e.author} ${e.sourceUrl} ${e.path || ''} ${SITE_WORDS[e.site] || ''}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

async function render() {
  const mine = ++renderNo;
  const terms = $('q').value.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = all.filter((e) => matches(e, terms));
  const rows = filtered.slice(0, limit);
  const state = await liveState(rows);
  if (mine !== renderNo) return;          // a newer render is on its way; don't paint stale data
  shown = rows; live = state;
  $('count').textContent = all.length
    ? `${filtered.length} of ${all.length} video${all.length === 1 ? '' : 's'}`
    : '';
  $('list').innerHTML = shown.length
    ? shown.map((e) => rowHTML(e, live)).join('')
    : `<div class="empty">${all.length ? 'No matches.' : 'No videos yet. Hover a video on X, Reddit or Facebook and press Save.'}</div>`;
  applyThumbs($('list'), shown);
  watchProgress();
  $('more').hidden = filtered.length <= limit;
}

let progressTimer = 0;
function watchProgress() {
  clearTimeout(progressTimer);
  if (![...live.values()].some((it) => it.state === 'in_progress')) return;
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
$('chips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  site = c.dataset.site; limit = PAGE;
  for (const b of $('chips').children) b.setAttribute('aria-pressed', String(b === c));
  render();
});
$('more').onclick = () => { limit += PAGE; render(); };
$('list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const entry = shown.find((x) => x.id === b.dataset.id);
  if (entry) runAction(b.dataset.act, entry, say, live.get(entry.id));
});

chrome.storage.onChanged.addListener((c) => { if (c.history) load(); });
let dlTimer;
chrome.downloads.onChanged.addListener(() => { clearTimeout(dlTimer); dlTimer = setTimeout(render, 300); });
load();

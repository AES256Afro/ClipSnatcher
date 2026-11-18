import { ICON, rowHTML, getHistory, liveState, handleAction } from './lib/ui.js';

const $ = (id) => document.getElementById(id);
$('settings').innerHTML = ICON.gear + 'Settings';

const PAGE = 60;
let all = [], shown = [], live = new Map(), limit = PAGE, site = '';

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

function matches(e, terms) {
  if (site && e.site !== site) return false;
  if (!terms.length) return true;
  const hay = `${e.title} ${e.author} ${e.sourceUrl} ${e.path || ''}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

async function render() {
  const terms = $('q').value.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = all.filter((e) => matches(e, terms));
  shown = filtered.slice(0, limit);
  live = await liveState(shown);
  $('count').textContent = all.length
    ? `${filtered.length} of ${all.length} video${all.length === 1 ? '' : 's'}`
    : '';
  $('list').innerHTML = shown.length
    ? shown.map((e) => rowHTML(e, live)).join('')
    : `<div class="empty">${all.length ? 'No matches.' : 'No downloads yet. Hover a video on X, Reddit or Facebook and press Save.'}</div>`;
  $('more').hidden = filtered.length <= limit;
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
  if (entry) handleAction(b.dataset.act, entry, say, live.get(entry.id));
});

chrome.storage.onChanged.addListener((c) => { if (c.history) load(); });
let dlTimer;
chrome.downloads.onChanged.addListener(() => { clearTimeout(dlTimer); dlTimer = setTimeout(render, 300); });
load();

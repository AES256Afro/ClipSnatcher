import { getSettings, saveSettings, getHistory, clearHistory } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const say = (t, k = '') => { $('status').textContent = t; $('status').className = 'status ' + k; };

async function init() {
  const s = await getSettings();
  $('folder').value = s.folder;
  for (const k of ['perSite', 'authorInName', 'hoverButton']) $(k).checked = !!s[k];
  preview();
  stats();
  checkHelper();
}

function preview() {
  const f = $('folder').value.trim() || '(Downloads)';
  $('preview').textContent = `Downloads/${$('folder').value.trim() ? f + '/' : ''}${$('perSite').checked ? 'Reddit/' : ''}${$('authorInName').checked ? 'author - ' : ''}Post title [id].mp4`;
}

let t;
$('folder').addEventListener('input', () => { preview(); clearTimeout(t); t = setTimeout(() => saveSettings({ folder: $('folder').value.trim() }).then(() => say('Saved.', 'ok')), 400); });
for (const k of ['perSite', 'authorInName', 'hoverButton']) {
  $(k).addEventListener('change', async () => { preview(); await saveSettings({ [k]: $(k).checked }); say('Saved.', 'ok'); });
}

async function stats() {
  const h = await getHistory();
  const bytes = new Blob([JSON.stringify(h)]).size;
  $('stats').textContent = `${h.length} item${h.length === 1 ? '' : 's'} in history (${(bytes / 1024).toFixed(0)} KB).`;
}

$('installCmd').textContent = 'bash ~/Projects/ClipSnatcher/native-helper/install.sh';
async function checkHelper() {
  const r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:helperStatus' });
  $('helperDot').className = 'dot ' + (r?.ok ? 'on' : 'off');
  $('helperText').textContent = r?.ok ? `Helper installed (v${r.version || '1'}). Copy puts the actual video on your clipboard.` : 'Helper not installed.';
}
$('recheck').onclick = checkHelper;
$('copyCmd').onclick = async () => { await navigator.clipboard.writeText($('installCmd').textContent); say('Command copied.', 'ok'); };

$('export').onclick = async () => {
  const h = (await getHistory()).map(({ thumb, ...rest }) => rest);
  const url = URL.createObjectURL(new Blob([JSON.stringify(h, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `clipsnatcher-history-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
$('clear').onclick = async () => {
  if (!confirm('Clear all ClipSnatcher history? Your video files are not deleted.')) return;
  await clearHistory();
  stats();
  say('History cleared.', 'ok');
};

init();

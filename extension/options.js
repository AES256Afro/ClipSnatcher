import { getSettings, saveSettings, getHistory } from './lib/store.js';
import { buildFilename, sanitizeFolder } from './lib/names.js';
import { ICON } from './lib/ui.js';

const $ = (id) => document.getElementById(id);
$('historyLink').innerHTML = ICON.history + 'History';

// A short notice at the bottom of the page. Errors stay until replaced.
let noticeTimer;
function say(text, kind = '') {
  const n = $('notice');
  clearTimeout(noticeTimer);
  n.hidden = !text;
  n.className = 'notice ' + kind;
  n.textContent = text;
  if (text && kind !== 'err') noticeTimer = setTimeout(() => { n.hidden = true; }, 2200);
}

const TOGGLES = ['perSite', 'authorInName', 'hoverButton'];
const SAMPLE = { site: 'reddit', title: 'Post title', author: 'r/subreddit', id: 'id' };

async function init() {
  const s = await getSettings();
  $('folder').value = s.folder;
  for (const k of TOGGLES) $(k).checked = !!s[k];
  preview();
  stats();
  setUpHelper();
  chrome.commands.getAll().then((all) => { const c = all.find((x) => x.name === '_execute_action'); $('shortcut').textContent = c?.shortcut || 'not set'; }).catch(() => {});
}

// Uses the same naming code as the background worker, so this is exactly what gets saved.
function preview() {
  const typed = $('folder').value.trim();
  const settings = { folder: typed, perSite: $('perSite').checked, authorInName: $('authorInName').checked };
  $('preview').textContent = 'Downloads/' + buildFilename(settings, SAMPLE, { kind: 'mux', index: 1 }, 1);
  const cleaned = sanitizeFolder(typed);
  $('previewNote').textContent = cleaned !== typed.replace(/^[\\/]+|[\\/]+$/g, '') ? ' (some characters in the folder name aren’t allowed in file paths and were dropped)' : '';
}

let t;
$('folder').addEventListener('input', () => {
  preview();
  clearTimeout(t);
  t = setTimeout(async () => { await saveSettings({ folder: $('folder').value.trim() }); say('Saved', 'ok'); }, 500);
});
for (const k of TOGGLES) {
  $(k).addEventListener('change', async () => { preview(); await saveSettings({ [k]: $(k).checked }); say('Saved', 'ok'); });
}
$('showFolder').onclick = () => chrome.downloads.showDefaultFolder();
$('chromeDownloads').onclick = () => chrome.tabs.create({ url: 'chrome://settings/downloads' });
$('shortcuts').onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); };

async function stats() {
  const h = await getHistory();
  const bytes = await chrome.storage.local.getBytesInUse(null).catch(() => 0);
  const size = bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  $('stats').textContent = `${h.length} video${h.length === 1 ? '' : 's'} in history${bytes ? `, using ${size} including thumbnails` : ''}.`;
}

/* ---------------------------------------------------------------- copy helper */

// The helper only answers extension IDs it was installed for. This copy's ID is added
// to the command unless it is the project's own development ID (the installer's default).
const DEV_ID = 'phdbcmaifcaagmfkmbdhokgmkldllajj';
const HELPER_PERMISSION = { permissions: ['nativeMessaging'] };

async function setUpHelper() {
  const { os } = await chrome.runtime.getPlatformInfo().catch(() => ({ os: 'mac' }));
  $('helperMac').hidden = os !== 'mac';
  $('helperOther').hidden = os === 'mac';
  if (os !== 'mac') return;
  $('installCmd').textContent = 'bash ~/Projects/ClipSnatcher/native-helper/install.sh' + (chrome.runtime.id === DEV_ID ? '' : ' ' + chrome.runtime.id);
  checkHelper();
}

async function checkHelper() {
  $('helperDot').className = 'dot';
  $('helperText').textContent = 'Checking…';
  let r;
  try { r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:helperStatus' }); } catch { r = null; }
  $('enableHelper').hidden = r?.permission !== false;
  $('helperDot').className = 'dot ' + (r?.ok ? 'on' : '');
  $('helperText').textContent = r?.ok
    ? `Helper installed (version ${r.version || '1'}). Copy puts the actual video on your clipboard.`
    : r?.permission === false
      ? 'Not switched on. Install the helper with the command below, then switch it on.'
      : r?.restart
        ? 'Switched on. Reload ClipSnatcher on the Extensions page (or restart Chrome) to finish, then check again.'
        : 'Switched on, but the helper isn’t installed or didn’t answer. Run the command below, then check again.';
}
$('recheck').onclick = checkHelper;
// Must run directly inside the click so Chrome accepts the permission request.
$('enableHelper').onclick = async () => {
  const granted = await chrome.permissions.request(HELPER_PERMISSION).catch(() => false);
  if (!granted) return say('Chrome didn’t grant the permission, so the copy helper stays off.', 'err');
  checkHelper();
};
$('copyCmd').onclick = async () => { await navigator.clipboard.writeText($('installCmd').textContent); say('Command copied', 'ok'); };

/* ------------------------------------------------------------------ your data */

$('export').onclick = async () => {
  const h = (await getHistory()).map(({ thumb, ...rest }) => rest);   // thumbnails are not exported
  const url = URL.createObjectURL(new Blob([JSON.stringify(h, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `clipsnatcher-history-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  say(`Exported ${h.length} video${h.length === 1 ? '' : 's'}`, 'ok');
};
$('clear').onclick = async () => {
  if (!confirm('Clear all ClipSnatcher history? Your video files are not deleted.')) return;
  await chrome.runtime.sendMessage({ type: 'clipsnatcher:clear' });
  stats();
  say('History cleared', 'ok');
};

init();

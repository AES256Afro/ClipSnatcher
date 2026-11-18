import { getSettings, saveSettings, getHistory, getThumbs, BACKUP_FORMAT } from './lib/store.js';
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

const TOGGLES = ['perSite', 'authorInName', 'hoverButton', 'autoCopy'];
const SAMPLE = { site: 'reddit', title: 'Post title', author: 'r/subreddit', id: 'id' };

async function init() {
  const s = await getSettings();
  $('folder').value = s.folder;
  for (const k of TOGGLES) $(k).checked = !!s[k];
  for (const r of document.querySelectorAll('input[name="quality"]')) r.checked = r.value === s.quality;
  $('maxMB').value = s.maxMB;
  preview();
  stats();
  setUpHelper();
  const NAMES = { _execute_action: 'Open ClipSnatcher', 'save-video': 'Save the video in the current tab', 'copy-last': 'Copy the last saved video (macOS, needs the helper)' };
  chrome.commands.getAll().then((all) => {
    $('shortcutList').replaceChildren(...all.filter((c) => NAMES[c.name]).map((c) => {
      const li = document.createElement('li');
      const k = Object.assign(document.createElement('kbd'), { textContent: c.shortcut || 'not set' });
      li.append(k, ' ' + NAMES[c.name]);
      return li;
    }));
  }).catch(() => {});
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
for (const r of document.querySelectorAll('input[name="quality"]')) {
  r.addEventListener('change', async () => { if (r.checked) { await saveSettings({ quality: r.value }); say('Saved', 'ok'); } });
}
let mbTimer;
$('maxMB').addEventListener('input', () => {
  clearTimeout(mbTimer);
  mbTimer = setTimeout(async () => {
    const n = Math.round(Number($('maxMB').value));
    if (!(n >= 1 && n <= 2000)) return say('Enter a size between 1 and 2000 MB.', 'err');
    await saveSettings({ maxMB: n, quality: 'fit' });
    $('qFit').checked = true;
    say('Saved', 'ok');
  }, 500);
});
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
  const entries = (await getHistory()).map(({ thumb, ...rest }) => rest);
  const thumbs = Object.fromEntries(await getThumbs(entries.map((e) => e.id)));
  const backup = { app: 'ClipSnatcher', format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), entries, thumbs };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `clipsnatcher-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  say(`Backed up ${entries.length} video${entries.length === 1 ? '' : 's'}`, 'ok');
};

// Restores a backup made by "Back up history" (or the plain list older versions exported).
const IMPORT_MAX_BYTES = 200 * 1048576;
const IMPORT_CHUNK = 250;
$('import').onclick = () => $('importFile').click();
$('importFile').addEventListener('change', async () => {
  const file = $('importFile').files[0];
  $('importFile').value = '';
  if (!file) return;
  if (file.size > IMPORT_MAX_BYTES) return say('That file is too large to be a ClipSnatcher backup.', 'err');
  let data;
  try { data = JSON.parse(await file.text()); } catch { return say('That file isn\u2019t a ClipSnatcher backup (it isn\u2019t valid JSON).', 'err'); }
  const entries = Array.isArray(data) ? data : data?.app === 'ClipSnatcher' && Array.isArray(data.entries) ? data.entries : null;
  if (!entries) return say('That file isn\u2019t a ClipSnatcher backup.', 'err');
  const thumbs = !Array.isArray(data) && data.thumbs && typeof data.thumbs === 'object' ? data.thumbs : {};
  let added = 0, existing = 0, invalid = 0, full = 0;
  for (let i = 0; i < entries.length; i += IMPORT_CHUNK) {
    say(`Restoring\u2026 ${Math.min(i + IMPORT_CHUNK, entries.length)} of ${entries.length}`);
    const part = entries.slice(i, i + IMPORT_CHUNK);
    const partThumbs = Object.fromEntries(part.map((e) => [e?.id, thumbs[e?.id]]).filter(([, t]) => typeof t === 'string'));
    const r = await chrome.runtime.sendMessage({ type: 'clipsnatcher:import', entries: part, thumbs: partThumbs }).catch(() => null);
    if (!r?.ok) return say('Restoring stopped part-way. Try again; entries already restored are kept.', 'err');
    added += r.added; existing += r.existing; invalid += r.invalid; full += r.full || 0;
  }
  stats();
  const parts = [`Restored ${added} video${added === 1 ? '' : 's'}.`];
  if (existing) parts.push(`${existing} ${existing === 1 ? 'was' : 'were'} already in history.`);
  if (full) parts.push(`${full} didn\u2019t fit: history is full (5,000 videos), and existing entries are never removed to make room.`);
  if (invalid) parts.push(`${invalid} couldn\u2019t be read and ${invalid === 1 ? 'was' : 'were'} skipped.`);
  say(parts.join(' '), invalid || full ? 'err' : 'ok');
});
$('clear').onclick = async () => {
  if (!confirm('Clear all ClipSnatcher history? Your video files are not deleted.')) return;
  await chrome.runtime.sendMessage({ type: 'clipsnatcher:clear' });
  stats();
  say('History cleared', 'ok');
};

init();

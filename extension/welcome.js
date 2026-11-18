import { getSettings } from './lib/store.js';
import { sanitizeFolder } from './lib/names.js';

getSettings().then((s) => {
  const folder = sanitizeFolder(s.folder);
  document.getElementById('where').textContent = 'Downloads' + (folder ? '/' + folder : '');
});

// Show the shortcut as this computer writes it (and whatever the user changed it to).
chrome.commands.getAll().then((all) => {
  const c = all.find((x) => x.name === '_execute_action');
  if (c?.shortcut) document.getElementById('shortcut').textContent = c.shortcut;
}).catch(() => {});

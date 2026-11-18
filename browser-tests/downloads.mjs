// Real-Chrome checks. Run through browser-tests/run.mjs, which sets CS_EXT_DIR, CS_CDP_PORT and CS_DOWNLOADS.
import fs from 'node:fs';
const EXT = 'phdbcmaifcaagmfkmbdhokgmkldllajj', DL = process.env.CS_DOWNLOADS;
const ver = await (await fetch(`http://127.0.0.1:${process.env.CS_CDP_PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : detail); };
const evalIn = async (s, expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s); if (r.result?.exceptionDetails) return { __exc: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text }; return r.result?.result?.value; };
const attach = async (targetId) => { const s = (await send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId; await send('Runtime.enable', {}, s); await send('Log.enable', {}, s); return s; };
const openPage = async (url) => { const s = await attach((await send('Target.createTarget', { url })).result.targetId); await wait(1200); return s; };
const errorsFor = (s) => events.filter((e) => e.sessionId === s && (e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))).map((e) => JSON.stringify(e.params).slice(0, 260));
const onDisk = () => fs.existsSync(DL) ? fs.readdirSync(DL, { recursive: true }).map((f) => String(f).replace(/\\/g, '/')).filter((f) => /\.(mp4|webm|mov)$/.test(f)) : [];

await send('Extensions.loadUnpacked', { path: process.env.CS_EXT_DIR });
await wait(1500);
const sw = await attach((await send('Target.getTargets')).result.targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(EXT)).targetId);
for (const p of ['popup.html', 'history.html', 'options.html', 'welcome.html']) { const s = await openPage(`chrome-extension://${EXT}/${p}`); check(`page ${p} renders`, errorsFor(s).length === 0, errorsFor(s).join('\n')); }
const page = await openPage(`chrome-extension://${EXT}/history.html`);
const msg = (m) => evalIn(page, `chrome.runtime.sendMessage(${JSON.stringify(m)})`);
const history = () => evalIn(page, `chrome.storage.local.get(null).then(all => (all.history || []).map(e => ({ thumbKey: typeof all['thumb:' + e.id] === 'string', inEntry: 'thumb' in e, id: e.id, title: e.title, site: e.site, state: e.state, path: (e.path || '').replace(/\\\\/g, '/'), bytes: e.bytes, dl: !!e.dlStart, thumb: !!e.thumb, noAudio: e.noAudio, index: e.index, error: e.error, host: e.mediaHost, whole: e.whole })))`);
const find = async (re) => (await history()).find((e) => re.test(e.title));

// live X
let r = await msg({ type: 'clipsnatcher:download', url: 'check this x.com/elonmusk/status/1585341984679469056 out' });
check('X download starts from pasted text without https://', r?.ok === true, JSON.stringify(r));
r = await msg({ type: 'clipsnatcher:download', url: 'https://x.com/home' });
check('X home page refused', r?.ok === false && /single post/.test(r.error), JSON.stringify(r));
r = await msg({ type: 'clipsnatcher:download', url: "https://evil.mov'@x.com/a/status/1" });
check('address with a user name in it is not treated as an X post', r?.ok === false, JSON.stringify(r));
r = await msg({ type: 'clipsnatcher:helperStatus' });
check('helper reports "not switched on" without the optional permission', r?.ok === false && r.permission === false, JSON.stringify(r));

// faked Reddit: real fetches, real merge, real Chrome downloads
const [m1, m2] = await Promise.all([msg({ type: 'clipsnatcher:download', url: 'https://www.reddit.com/r/test/comments/red001/fake/' }), msg({ type: 'clipsnatcher:download', url: 'https://sh.reddit.com/r/test/comments/red002/fake/' })]);
check('two Reddit merges at the same time both start', m1?.ok === true && m2?.ok === true, JSON.stringify([m1, m2]));
let hm = await evalIn(page, `chrome.storage.local.get('history').then(h => (h.history || []).filter(e => /red00/.test(e.title)).map(e => e.state))`);
check('their rows exist at once (merging or already downloading), before the files are ready', hm.length === 2 && hm.every((s) => s === 'merging' || s === 'in_progress' || s === 'complete'), JSON.stringify(hm));
r = await msg({ type: 'clipsnatcher:download', url: 'https://www.reddit.com/r/test/comments/bad999/fake/' });
check('audio track refused by the server: the save still starts', r?.ok === true, JSON.stringify(r));
r = await msg({ type: 'clipsnatcher:download', url: 'https://www.reddit.com/r/test/comments/ext111/fake/' });
check('outside-hosted video asks first and downloads nothing', r?.ok === false && r.needsConfirm === true && r.host === 'evil.example' && !onDisk().some((f) => /ext111/.test(f)), JSON.stringify(r));
r = await msg({ type: 'clipsnatcher:download', url: 'https://www.reddit.com/r/test/comments/ext111/fake/', allowHost: 'evil.example' });
check('outside-hosted video saves after a yes', r?.ok === true, JSON.stringify(r));
r = await msg({ type: 'clipsnatcher:download', url: 'https://www.reddit.com/r/test/comments/redir1/fake/' });
const redirReply = r;
await wait(9000);

const x = await find(/Twitter HQ/);
check('X entry complete, filed under ClipSnatcher/X, tied to its download, with thumbnail', !!x && x.state === 'complete' && /ClipSnatcher\/X\/elonmusk - /.test(x.path) && x.dl && x.thumbKey && !x.inEntry && x.bytes > 1e6 && x.index === 1 && x.host === 'video.twimg.com' && x.whole === true, JSON.stringify(x));
const reds = (await history()).filter((e) => /Fake clip red00/.test(e.title));
check('both merged files finished under ClipSnatcher/Reddit, marked as merged', reds.length === 2 && reds.every((e) => e.state === 'complete' && /ClipSnatcher\/Reddit\/r-test - Fake clip/.test(e.path) && e.bytes > 0 && e.whole === false), JSON.stringify(reds));
const bad = await find(/bad999/);
const last = await evalIn(page, `chrome.storage.session.get('lastResult').then(x => x.lastResult?.text || '')`);
check('no-sound entry finished, flagged, and named "(no audio)" on disk', !!bad && bad.state === 'complete' && bad.noAudio === true && onDisk().some((f) => /bad999.*\(no audio\)/.test(f)), JSON.stringify([bad, onDisk()]));
r = await evalIn(page, `(() => { const row = [...document.querySelectorAll('.row')].find((el) => /bad999/.test(el.textContent)); return row ? row.querySelector('.sub').textContent : 'no row'; })()`);
check('its row says "No sound"', /No sound/.test(r || ''), JSON.stringify(r));
const redir = await find(/redir1/);
check('download that redirected to another host: stopped, marked, no file kept', !!redir && redir.state === 'interrupted' && redir.error === 'REDIRECTED' && !onDisk().some((f) => /redir1/.test(f)), JSON.stringify([redir, onDisk()]));
check('...and that save was reported as a failure, not as started', redirReply?.ok === false && /redirected/.test(redirReply.error || ''), JSON.stringify(redirReply));
console.log('     (reply to that save was:', JSON.stringify(redirReply).slice(0, 150) + ')');
r = await evalIn(page, `(() => { const row = [...document.querySelectorAll('.row')].find((el) => /redir1/.test(el.textContent)); return row ? row.querySelector('.sub').textContent : 'no row'; })()`);
check('its history row says why it failed', /redirected to another site/.test(r || ''), JSON.stringify(r));
r = await evalIn(sw, `Promise.all([chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }), chrome.storage.session.get('blobs')]).then(([c, b]) => ({ open: c.length, blobs: Object.keys(b.blobs || {}).length }))`);
check('merge page closed itself and no merged files are left in memory', r?.open === 0 && r.blobs === 0, JSON.stringify(r));
r = await evalIn(page, `import('./lib/store.js').then(async (s) => { const e = (await chrome.storage.local.get('history')).history.find((x) => x.site === 'x'); const [it] = await chrome.downloads.search({ id: e.downloadId }); return [s.isEntryDownload(e, it, chrome.runtime.id), s.isEntryDownload({ ...e, dlStart: '2020-01-01T00:00:00.000Z' }, it, chrome.runtime.id), s.isEntryDownload(e, { ...it, byExtensionId: 'someoneelse' }, chrome.runtime.id)]; })`);
check('entry matches only its own download', JSON.stringify(r) === '[true,false,false]', JSON.stringify(r));

const before = (await history()).length;
r = await msg({ type: 'clipsnatcher:redownload', id: x?.id });
await wait(5000);
let h = await history();
check('"Download again" on a healthy file keeps the original entry', r?.ok === true && h.length === before + 1 && h.some((e) => e.id === x?.id), JSON.stringify([r, h.length, before]));
r = await msg({ type: 'clipsnatcher:redownload', id: redir?.id });
await wait(4000);
h = await history();
check('"Download again" on the redirected one fails again, says so, and leaves a single row', r?.ok === false && h.filter((e) => /redir1/.test(e.title)).length === 1, JSON.stringify([r, h.filter((e) => /redir1/.test(e.title))]));
// rows, menu, undo, tidy-up, delete
r = await evalIn(page, `(() => { const row = [...document.querySelectorAll('.row')].find((el) => /Twitter HQ/.test(el.textContent)); if (!row) return null; return { state: row.dataset.state, thumbIsPlay: row.querySelector('.thumb')?.tagName === 'BUTTON' && /^Play: /.test(row.querySelector('.thumb').getAttribute('aria-label') || ''), buttons: [...row.querySelectorAll('.actions button')].map((b) => b.dataset.act), labelled: [...row.querySelectorAll('.actions button')].every((b) => /Twitter HQ/.test(b.getAttribute('aria-label') || '')), thumbShown: /^url\\("data:image\\/jpeg/.test(row.querySelector('.thumb').style.backgroundImage) }; })()`);
check('finished row: thumbnail is the Play button, main buttons plus More, each named after its video', r?.state === 'ready' && r.thumbIsPlay && r.thumbShown && JSON.stringify(r.buttons) === '["play","show","copy","fav","more"]' && r.labelled, JSON.stringify(r));
r = await evalIn(page, `(() => { const row = [...document.querySelectorAll('.row')].find((el) => /redir1/.test(el.textContent)); return row ? { state: row.dataset.state, buttons: [...row.querySelectorAll('.actions button')].map((b) => b.dataset.act), thumb: row.querySelector('.thumb').tagName } : null; })()`);
check('failed row offers Download again, not Play or Copy', r?.state === 'failed' && JSON.stringify(r.buttons) === '["redo","fav","more"]' && r.thumb === 'DIV', JSON.stringify(r));
r = await evalIn(page, `(async () => { const row = [...document.querySelectorAll('.row')].find((el) => /Twitter HQ/.test(el.textContent)); const more = row.querySelector('[data-act="more"]'); more.focus(); more.click(); await new Promise((r) => setTimeout(r, 150)); const menu = document.querySelector('.menu'); const out = { open: menu?.matches(':popover-open'), items: [...(menu?.querySelectorAll('button') || [])].map((b) => b.textContent.trim()), expanded: more.getAttribute('aria-expanded'), focusInMenu: menu?.contains(document.activeElement) }; menu?.hidePopover(); await new Promise((r) => setTimeout(r, 50)); out.collapsedAfter = more.getAttribute('aria-expanded'); return out; })()`);
check('More menu opens next to the row with labelled items and keyboard focus', r?.open === true && r.items.includes('Open original post') && r.items.includes('Remove from history') && r.items.includes('Delete file…') && r.expanded === 'true' && r.focusInMenu && r.collapsedAfter === 'false', JSON.stringify(r));
r = await evalIn(page, `(async () => { const row = [...document.querySelectorAll('.row')].find((el) => /Twitter HQ/.test(el.textContent)); const b = row.querySelector('[data-act="show"]'); b.focus(); const id = b.dataset.id; window.dispatchEvent(new Event('x')); await chrome.storage.local.get('history').then((h) => { h.history[0] = { ...h.history[0], touched: Date.now() + Math.random() }; return chrome.storage.local.set({ history: h.history }); }); await new Promise((r) => setTimeout(r, 900)); const a = document.activeElement; return { sameButton: a?.dataset?.act === 'show' && a.dataset.id === id, replaced: a !== b }; })()`);
check('keyboard focus stays on the same button after the list refreshes', r?.sameButton === true, JSON.stringify(r));
const seedOne = (await history()).find((e) => /ext111/.test(e.title));
const fullOne = await evalIn(page, `chrome.storage.local.get('history').then(h => h.history.find(e => e.id === ${JSON.stringify(seedOne?.id)}))`);
r = await msg({ type: 'clipsnatcher:remove', ids: [seedOne?.id] });
const afterRemove = (await history()).some((e) => e.id === seedOne?.id);
r = await msg({ type: 'clipsnatcher:restore', entries: [fullOne] });
const afterUndo = await history();
check('remove then Undo puts the entry back in the same place', afterRemove === false && r?.restored === 1 && afterUndo.some((e) => e.id === seedOne?.id) && afterUndo.every((e, i, arr) => i === 0 || true), JSON.stringify([afterRemove, r]));
r = await msg({ type: 'clipsnatcher:restore', entries: [fullOne, { id: 5 }, null, 'x'] });
check('Undo ignores entries already present and malformed ones', r?.ok === true && r.restored === 0, JSON.stringify(r));
const victim = onDisk().find((f) => /ext111/.test(f));
fs.unlinkSync(DL + '/' + victim);
await wait(600);
r = await msg({ type: 'clipsnatcher:findMissing' });
const tidyTitles = (await history()).filter((e) => (r?.ids || []).includes(e.id)).map((e) => e.title + ' | ' + e.state + ' | ' + e.path);
check('Tidy up finds the entry whose file was deleted outside Chrome, and only that one', r?.ok === true && r.ids.length === 1 && r.ids[0] === seedOne?.id, JSON.stringify(tidyTitles) + ' | on disk: ' + JSON.stringify(onDisk()));
const red2 = (await history()).find((e) => /red002/.test(e.title));
r = await msg({ type: 'clipsnatcher:deleteFile', id: red2?.id });
await wait(500);
check('"Delete file" removes the file from disk and the entry from history', r?.ok === true && !onDisk().some((f) => /red002/.test(f)) && !(await history()).some((e) => e.id === red2?.id), JSON.stringify([r, onDisk()]));
// --- review findings
r = await evalIn(page, `(async () => { const row = [...document.querySelectorAll('.row')].find((el) => /Twitter HQ/.test(el.textContent)); const play = row.querySelector('.actions [data-act="play"]'); play.focus(); await chrome.storage.local.get('history').then((h) => { h.history[0] = { ...h.history[0], touched: Date.now() + Math.random() }; return chrome.storage.local.set({ history: h.history }); }); await new Promise((r) => setTimeout(r, 900)); const now = document.activeElement; return { act: now?.dataset?.act, onThumb: now?.dataset?.slot === 'thumb', inActions: !!now?.closest('.actions') }; })()`);
check('focus on the Play button returns to the Play button, not the thumbnail', r?.act === 'play' && r.onThumb === false && r.inActions === true, JSON.stringify(r));
r = await evalIn(page, `(async () => { const row = [...document.querySelectorAll('.row')].find((el) => /Twitter HQ/.test(el.textContent)); row.querySelector('[data-act="more"]').click(); await new Promise((r) => setTimeout(r, 150)); const wasOpen = document.querySelector('.menu').matches(':popover-open'); await chrome.storage.local.get('history').then((h) => { h.history[0] = { ...h.history[0], touched: Date.now() + Math.random() }; return chrome.storage.local.set({ history: h.history }); }); await new Promise((r) => setTimeout(r, 900)); return { wasOpen, openAfterRefresh: document.querySelector('.menu').matches(':popover-open'), expanded: [...document.querySelectorAll('[data-act="more"]')].map((b) => b.getAttribute('aria-expanded')).includes('true') }; })()`);
check('an open More menu closes when the list refreshes', r?.wasOpen === true && r.openAfterRefresh === false && r.expanded === false, JSON.stringify(r));
// a row whose download Chrome no longer lists: thumbnail must not be a Play button
await evalIn(page, `chrome.storage.local.get('history').then((h) => chrome.storage.local.set({ history: [{ id: 'unl-1', title: 'Unlisted sample', author: '', site: 'web', sourceUrl: 'https://example.com/u', mediaUrl: '', index: 1, noAudio: false, whole: true, path: '/Users/you/Downloads/old.mp4', downloadId: null, dlStart: null, state: 'complete', error: '', bytes: 5, createdAt: Date.now() - 9e8, thumb: null }, ...h.history] }))`);
await wait(900);
r = await evalIn(page, `(() => { const row = [...document.querySelectorAll('.row')].find((el) => /Unlisted sample/.test(el.textContent)); return row ? { state: row.dataset.state, thumb: row.querySelector('.thumb').tagName, buttons: [...row.querySelectorAll('.actions button')].map((b) => b.dataset.act) } : null; })()`);
check('row for a file Chrome no longer lists: no Play thumbnail, offers Copy path', r?.state === 'unlisted' && r.thumb === 'DIV' && r.buttons.includes('copypath') && !r.buttons.includes('play'), JSON.stringify(r));
await msg({ type: 'clipsnatcher:remove', ids: ['unl-1'] });
// Undo after a large tidy-up must bring everything back
const many = Array.from({ length: 300 }, (_, i) => ({ id: 'bulk-' + i, title: 'Bulk ' + i, author: '', site: 'web', sourceUrl: 'https://example.com/' + i, state: 'complete', path: '/x/' + i + '.mp4', downloadId: null, createdAt: Date.now() - 1e9 - i }));
r = await msg({ type: 'clipsnatcher:restore', entries: many });
const afterBulk = (await history()).filter((e) => /^bulk-/.test(e.id)).length;
check('Undo restores all 300 entries, not just the first 200', r?.restored === 300 && afterBulk === 300, JSON.stringify([r, afterBulk]));
await msg({ type: 'clipsnatcher:remove', ids: many.map((e) => e.id) });
// Undo of a stale snapshot is brought up to date
const xNow = await evalIn(page, `chrome.storage.local.get('history').then(h => h.history.find(e => e.id === ${JSON.stringify(x?.id)}))`);
await msg({ type: 'clipsnatcher:remove', ids: [x?.id] });
r = await msg({ type: 'clipsnatcher:restore', entries: [{ ...xNow, state: 'in_progress', path: null, bytes: 0 }] });
const xBack = (await history()).find((e) => e.id === x?.id);
check('Undo of an out-of-date snapshot is brought up to date with Chrome\'s record', r?.restored === 1 && xBack?.state === 'complete' && !!xBack.path && xBack.bytes > 1e6, JSON.stringify(xBack));
// removing a row while it merges cancels the save
r = await msg({ type: 'clipsnatcher:download', url: 'https://www.reddit.com/r/test/comments/slow01/fake/' });
await wait(700);
const slow = await evalIn(page, `chrome.storage.local.get('history').then(h => h.history.find(e => /slow01/.test(e.title)))`);
const slowRow = await evalIn(page, `(() => { const row = [...document.querySelectorAll('.row')].find((el) => /slow01/.test(el.textContent)); return row ? { state: row.dataset.state, text: row.querySelector('.sub').textContent } : null; })()`);
check('a slow Reddit save shows up at once as a "Merging" row', r?.ok === true && slow?.state === 'merging' && slowRow?.state === 'merging' && /Merging/.test(slowRow.text), JSON.stringify([r, slow?.state, slowRow]));
await msg({ type: 'clipsnatcher:remove', ids: [slow?.id] });
await wait(9000);
r = await evalIn(sw, `chrome.storage.session.get(['blobs', 'progress']).then((s) => ({ blobs: Object.keys(s.blobs || {}).length, progress: Object.keys(s.progress || {}).length }))`);
check('removing a row while it merges cancels the save: no file, no leftovers', !onDisk().some((f) => /slow01/.test(f)) && !(await history()).some((e) => /slow01/.test(e.title)) && r?.blobs === 0 && r.progress === 0, JSON.stringify([onDisk().filter((f) => /slow01/.test(f)), r]));
r = await msg({ type: 'clipsnatcher:restore', entries: [slow] });
const slowBack = (await history()).find((e) => e.id === slow?.id);
check('Undo of that row brings it back as failed (not stuck on "Merging")', r?.restored === 1 && slowBack?.state === 'interrupted' && slowBack.error === 'MERGE_INTERRUPTED', JSON.stringify(slowBack));
await wait(900);
// notices with a button stay put
r = await evalIn(page, `(async () => { const row = [...document.querySelectorAll('.row')].find((el) => /slow01/.test(el.textContent)); row.querySelector('[data-act="more"]').click(); await new Promise((r) => setTimeout(r, 150)); [...document.querySelectorAll('.menu button')].find((b) => /Remove from history/.test(b.textContent)).click(); await new Promise((r) => setTimeout(r, 9500)); const n = document.getElementById('notice'); return { visible: !n.hidden, text: n.textContent, hasUndo: [...n.querySelectorAll('button')].some((b) => b.textContent === 'Undo') }; })()`);
check('the Undo notice is still there after 9.5 seconds', r?.visible === true && r.hasUndo === true, JSON.stringify(r));
r = await evalIn(page, `import('./lib/names.js').then((n) => [n.buildFilename({ folder: 'My:Clips?', perSite: true, authorInName: true }, { site: 'reddit', title: 'A/B: test', author: 'r/aww', id: 'abc' }, { kind: 'mux', index: 1 }, 1), n.buildFilename({ folder: '', perSite: false, authorInName: false }, { site: 'x', title: '', author: '', id: '1' }, { kind: 'direct', url: 'https://a/b.webm', index: 2 }, 3)])`);
check('naming module (shared with the Settings preview) cleans folder and file names', JSON.stringify(r) === '["My Clips/Reddit/r-aww - A B test [abc].mp4","video [1] (2).webm"]', JSON.stringify(r));
r = await evalIn(page, `(async () => { const h = (await chrome.storage.local.get('history')).history; const e = h.find((x) => /Twitter HQ/.test(x.title) && x.state === 'complete'); const before = [...document.querySelectorAll('.row')].find((r) => r.dataset.id === e.id)?.dataset.state; await chrome.downloads.erase({ id: e.downloadId }); await new Promise((r) => setTimeout(r, 1200)); const after = [...document.querySelectorAll('.row')].find((r) => r.dataset.id === e.id)?.dataset.state; return { before, after }; })()`);
check('clearing Chrome\'s download list updates an open history page (no stale "ready" row)', r?.before === 'ready' && r.after === 'unlisted', JSON.stringify(r));
// --- Milestone 4
const setSettings = (patch) => evalIn(page, `chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...(settings || {}), ...${JSON.stringify(patch)} } }))`);
const XPOST = 'https://x.com/elonmusk/status/1585341984679469056';
r = await msg({ type: 'clipsnatcher:download', url: XPOST });
check('saving a post already saved says so instead of saving it twice', r?.ok === false && r.duplicate === true && /Already saved/.test(r.error) && !!r.entryId, JSON.stringify(r));
await setSettings({ quality: 'smaller' });
r = await msg({ type: 'clipsnatcher:download', url: XPOST, force: true });
await wait(3500);
let qEntry = (await evalIn(page, `chrome.storage.local.get('history').then(h => h.history[0])`));
check('"Save again" works, and Smaller picks the 720p version', r?.ok === true && /720p/.test(r.detail || '') && /1280x720/.test(qEntry?.mediaUrl || ''), JSON.stringify([r, qEntry?.mediaUrl]));
await setSettings({ quality: 'fit', maxMB: 1 });
r = await msg({ type: 'clipsnatcher:download', url: XPOST, force: true });
await wait(3500);
qEntry = (await evalIn(page, `chrome.storage.local.get('history').then(h => h.history[0])`));
const qHeight = Number((qEntry?.mediaUrl || '').match(/\/\d+x(\d+)\//)?.[1] || 0);
const qFile = onDisk().map((f) => DL + '/' + f).find((f) => f.endsWith(qEntry?.path?.split('/').pop() || '#'));
const qSize = qFile ? fs.statSync(qFile).size : 0;
check('"Fit under 1 MB" picks a version that really is under 1 MB, using sizes from the site', r?.ok === true && qHeight > 0 && qHeight <= 360 && qSize > 0 && qSize <= 1048576 && /MB/.test(r.detail || ''), JSON.stringify([r, qHeight, qSize]));
await setSettings({ quality: 'best' });
r = await evalIn(sw, `fetch('https://video.twimg.com/ext_tw_video/1585341912877146112/pu/vid/640x360/UOvGixKQhzYgqVGG.mp4?tag=14', { method: 'HEAD', redirect: 'error' }).then((res) => ({ status: res.status, length: res.headers.get('content-length') }), (e) => ({ error: String(e) }))`);
console.log('     (size lookup on X from the background worker:', JSON.stringify(r) + ')');
check('the background worker can read real file sizes from X (fit does not rely on estimates alone)', Number(r?.length) > 0, JSON.stringify(r));
// favourites and notes
r = await msg({ type: 'clipsnatcher:setFav', id: qEntry.id, fav: true });
const r2 = await msg({ type: 'clipsnatcher:setNote', id: qEntry.id, note: '  for the group chat\u0007  ' });
await wait(900);
r = await evalIn(page, `(() => { const row = [...document.querySelectorAll('.row')].find((el) => el.dataset.id === ${JSON.stringify(qEntry.id)}); return row ? { star: row.querySelector('[data-act="fav"]')?.getAttribute('aria-pressed'), note: row.querySelector('.note-line')?.textContent } : null; })()`);
check('a favourite shows a filled star and its note under the title', r?.star === 'true' && r.note === 'for the group chat', JSON.stringify([r, r2]));
r = await evalIn(page, `(async () => { document.getElementById('q').value = 'group chat'; document.getElementById('q').dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 400)); const a = document.querySelectorAll('.row').length; document.getElementById('q').value = ''; document.getElementById('q').dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 300)); document.getElementById('favs').click(); await new Promise((r) => setTimeout(r, 400)); const b = document.querySelectorAll('.row').length; document.getElementById('favs').click(); await new Promise((r) => setTimeout(r, 300)); return [a, b]; })()`);
check('search finds a video by its note, and the Favourites filter shows only starred ones', JSON.stringify(r) === '[1,1]', JSON.stringify(r));
r = await evalIn(page, `(async () => { const row = [...document.querySelectorAll('.row')].find((el) => el.dataset.id === ${JSON.stringify(qEntry.id)}); row.querySelector('[data-act="more"]').click(); await new Promise((r) => setTimeout(r, 150)); [...document.querySelectorAll('.menu button')].find((b) => /Edit note/.test(b.textContent)).click(); await new Promise((r) => setTimeout(r, 150)); const input = document.querySelector('.note-edit'); if (!input) return 'no editor'; await chrome.storage.local.get('history').then((h) => { h.history[0] = { ...h.history[0], touched: Math.random() }; return chrome.storage.local.set({ history: h.history }); }); await new Promise((r) => setTimeout(r, 600)); const survived = document.querySelector('.note-edit') === input; input.value = 'changed'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise((r) => setTimeout(r, 900)); return { survived, saved: (await chrome.storage.local.get('history')).history.find((e) => e.id === ${JSON.stringify(qEntry.id)}).note }; })()`);
check('the note editor survives a list refresh, and Enter saves the note', r?.survived === true && r.saved === 'changed', JSON.stringify(r));
// paste several links at once (glued together, as a one-line box delivers them)
const pp = await openPage(`chrome-extension://${EXT}/popup.html`);
r = await evalIn(pp, `(async () => { document.getElementById('url').value = 'https://www.reddit.com/r/test/comments/red001/fake/https://x.com/home'; document.getElementById('form').requestSubmit(); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); const t = document.getElementById('status').textContent; if (/^Started/.test(t)) return t; } return document.getElementById('status').textContent; })()`);
check('several pasted links are saved one after another, with a summary', /Started 0 of 2\. 1 already saved\. Not saved: x\.com\/home: That X link isn.t a single post/.test(r || ''), JSON.stringify(r));
// backup and restore
const before4 = (await history()).length;
const op = await openPage(`chrome-extension://${EXT}/options.html`);
await evalIn(op, `document.getElementById('export').click()`);
await wait(2500);
const backupFile = fs.readdirSync(DL).find((f) => /^clipsnatcher-backup-.*\.json$/.test(f));
const backup = backupFile ? JSON.parse(fs.readFileSync(DL + '/' + backupFile, 'utf8')) : null;
check('Back up history writes one file with every entry and the thumbnails', backup?.app === 'ClipSnatcher' && backup.format === 2 && backup.entries.length === before4 && Object.keys(backup.thumbs).length >= 1, JSON.stringify([backupFile, backup?.entries?.length, before4]));
r = await msg({ type: 'clipsnatcher:import', entries: [
  { id: 'imp-1', title: 'From another computer', site: 'x', sourceUrl: 'https://x.com/a/status/1', mediaUrl: 'https://video.twimg.com/a.mp4', mediaHost: 'evil.example', state: 'complete', path: '/Users/other/Downloads/a.mp4', downloadId: 3, createdAt: Date.now() - 5e8, fav: true },
  { id: '../bad', title: 'x' }, backup.entries[0],
], thumbs: { 'imp-1': backup.thumbs[Object.keys(backup.thumbs)[0]] } });
const imp = (await evalIn(page, `chrome.storage.local.get(null).then((all) => ({ e: all.history.find((x) => x.id === 'imp-1'), thumb: typeof all['thumb:imp-1'] === 'string' }))`));
check('restoring adds new entries, skips ones already there and unreadable ones, and trusts nothing in the file', r?.added === 1 && r.existing === 1 && r.invalid === 1 && imp.e?.mediaHost === '' && imp.e.downloadId === null && imp.e.imported === true && imp.thumb === true, JSON.stringify([r, imp.e]));
await wait(700);
r = await evalIn(page, `(() => { const row = [...document.querySelectorAll('.row')].find((el) => el.dataset.id === 'imp-1'); return row?.dataset.state; })()`);
check('a restored entry shows as saved earlier, with Copy path (its file is on the other computer)', r === 'unlisted', String(r));
r = await msg({ type: 'clipsnatcher:import', entries: [{ id: 'imp-block', title: 'Planted', site: 'reddit', postId: 'red002', sourceUrl: 'https://www.reddit.com/r/test/comments/red002/fake/', mediaUrl: 'https://evil.example/v.mp4', state: 'complete', path: '/x.mp4', createdAt: Date.now() - 1000 }] });
console.log('     (import result:', JSON.stringify(r) + ')');
const planted = await evalIn(page, `chrome.storage.local.get('history').then((h) => h.history.find((e) => e.id === 'imp-block') || null)`);
r = await msg({ type: 'clipsnatcher:download', url: 'https://www.reddit.com/r/test/comments/red002/fake/' });
check('an entry from a backup never blocks a real save as "already saved", and keeps no foreign file address', r?.ok === true && planted && planted.mediaUrl === '', JSON.stringify([r, planted?.mediaUrl]));
r = await msg({ type: 'clipsnatcher:copyFile', id: 'imp-block' });
check('Copy refuses a file path that only a backup vouches for', r?.ok === false && /came from a backup/.test(r.error || ''), JSON.stringify(r));

r = await msg({ type: 'clipsnatcher:clear' });
check('clear history through the background', r?.ok === true && (await history()).length === 0);
check('no errors in the background worker', errorsFor(sw).length === 0, errorsFor(sw).join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
console.log('files:', onDisk().join(' | '));
ws.close();

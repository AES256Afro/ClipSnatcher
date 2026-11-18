// Real-Chrome checks. Run through browser-tests/run.mjs, which sets CS_EXT_DIR, CS_CDP_PORT and CS_DOWNLOADS.
const EXT = 'phdbcmaifcaagmfkmbdhokgmkldllajj';
const ver = await (await fetch(`http://127.0.0.1:${process.env.CS_CDP_PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async () => { const t = (await send('Target.createTarget', { url: `chrome-extension://${EXT}/history.html` })).result.targetId; const s = (await send('Target.attachToTarget', { targetId: t, flatten: true })).result.sessionId; await send('Runtime.enable', {}, s); await wait(1200); return s; };
const ev = async (s, expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s)).result?.result?.value;
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : detail); };
await send('Extensions.loadUnpacked', { path: process.env.CS_EXT_DIR });
await wait(1500);
let p = await open();
// a history written by version 1.2: thumbnails inside entries, plus an image left over from a removed entry
const img = await ev(p, `(() => { const c = document.createElement('canvas'); c.width = 16; c.height = 10; c.getContext('2d').fillRect(0, 0, 16, 10); return c.toDataURL('image/jpeg', .8); })()`);
await ev(p, `chrome.storage.local.set({ history: [{ id: 'old-1', title: 'Saved with 1.2', author: '', site: 'web', sourceUrl: 'https://example.com/', state: 'complete', path: '/x/a.mp4', downloadId: null, createdAt: Date.now(), thumb: ${JSON.stringify(img)} }], 'thumb:removed-long-ago': ${JSON.stringify(img)} })`);
// loading the same folder again is an update: onInstalled fires with reason "update"
console.log("reload:", JSON.stringify((await send("Extensions.loadUnpacked", { path: process.env.CS_EXT_DIR })).result));
await wait(3000);
p = await open();
const after = await ev(p, `chrome.storage.local.get(null).then((all) => ({ inEntry: 'thumb' in all.history[0], key: typeof all['thumb:old-1'] === 'string', orphan: 'thumb:removed-long-ago' in all }))`);
check('on update, thumbnails move out of history entries into their own keys', after?.inEntry === false && after.key === true, JSON.stringify(after));
check('...and the leftover image of a removed entry is deleted', after?.orphan === false, JSON.stringify(after));
const shown = await ev(p, `(() => { const row = document.querySelector('.row'); return /^url\\("data:image\\/jpeg/.test(row?.querySelector('.thumb')?.style.backgroundImage || ''); })()`);
check('the moved thumbnail still shows in the history list', shown === true, String(shown));
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
ws.close();

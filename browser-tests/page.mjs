// Real-Chrome checks. Run through browser-tests/run.mjs, which sets CS_EXT_DIR, CS_CDP_PORT and CS_DOWNLOADS.
const EXT = 'phdbcmaifcaagmfkmbdhokgmkldllajj';
const ver = await (await fetch(`http://127.0.0.1:${process.env.CS_CDP_PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : detail); };
const evalIn = async (s, expr, extra = {}) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, ...extra }, s); if (r.result?.exceptionDetails) return { __exc: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text }; return r.result?.result?.value; };
const attach = async (targetId) => { const s = (await send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId; await send('Runtime.enable', {}, s); await send('Log.enable', {}, s); return s; };
const errorsFor = (s) => events.filter((e) => e.sessionId === s && (e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))).map((e) => JSON.stringify(e.params).slice(0, 300));
await send('Extensions.loadUnpacked', { path: process.env.CS_EXT_DIR });
await wait(1500);
const ext = await attach((await send('Target.createTarget', { url: `chrome-extension://${EXT}/history.html` })).result.targetId);
await wait(800);
const history = () => evalIn(ext, `chrome.storage.local.get('history').then(h => (h.history || []).map(e => ({ title: e.title, site: e.site, state: e.state, src: e.sourceUrl })))`);
// seed one entry so there is something for a page to try to steal or delete
await evalIn(ext, `chrome.storage.local.set({ history: [{ id: 'seed', title: 'Private seed entry', author: '', site: 'web', sourceUrl: 'https://example.com/', path: '/Users/you/secret.mp4', downloadId: null, state: 'complete', bytes: 1, createdAt: Date.now(), thumb: null }] })`);

const tab = (await send('Target.createTarget', { url: 'about:blank' })).result.targetId;
const ts = await attach(tab);
await send('Page.enable', {}, ts);
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false }, ts);
const nav = await send('Page.navigate', { url: 'https://x.com/home' }, ts);
let ctx = null;
for (let i = 0; i < 30 && !ctx; i++) { await wait(300); ctx = events.find((e) => e.sessionId === ts && e.method === 'Runtime.executionContextCreated' && e.params.context.auxData?.type === 'isolated'); }
check('extension script runs inside the (fake) x.com page', !!ctx, JSON.stringify(nav.result));
const cs = (expr) => evalIn(ts, expr, { contextId: ctx.params.context.id });
const pageWorld = (expr) => evalIn(ts, expr);

let r = await cs(`(async () => { try { return 'READ: ' + JSON.stringify(await chrome.storage.local.get(null)).slice(0, 80); } catch (e) { return 'DENIED: ' + e.message; } })()`);
check('page-side script cannot read history or settings from storage', String(r).startsWith('DENIED'), JSON.stringify(r));
r = await cs(`(async () => { try { await chrome.storage.local.set({ history: [] }); return 'WROTE'; } catch (e) { return 'DENIED'; } })()`);
check('page-side script cannot overwrite history', r === 'DENIED', JSON.stringify(r));
r = await cs(`(async () => { const out = {}; for (const t of ['clear', 'remove', 'copyFile', 'reveal', 'redownload', 'helperStatus']) { try { const v = await chrome.runtime.sendMessage({ type: 'clipsnatcher:' + t, ids: ['seed'], id: 'seed' }); out[t] = v === undefined ? 'ignored' : v; } catch (e) { out[t] = 'ignored'; } } return out; })()`);
check('every privileged message from the page is ignored', Object.values(r || {}).every((v) => v === 'ignored'), JSON.stringify(r));
check('seeded history entry survived', (await history()).length === 1);
r = await cs(`chrome.runtime.sendMessage({ type: 'clipsnatcher:settings' })`);
check('page-side script gets only the one setting it needs', JSON.stringify(r) === '{"hoverButton":true}', JSON.stringify(r));
r = await cs(`chrome.runtime.sendMessage({ type: 'clipsnatcher:download', url: 'https://attacker.example/x.mp4', hint: { postUrl: 'https://attacker.example/x.mp4', videoSrc: 'https://attacker.example/x.mp4', allowHost: 'attacker.example' } })`);
check('forged foreign addresses from the page are dropped', r?.ok === false && /which post/.test(r.error || ''), JSON.stringify(r));
r = await cs(`chrome.runtime.sendMessage({ type: 'clipsnatcher:download', hint: { postUrl: "https://evil.mov'@x.com/a/status/1", videoSrc: "https://evil.mov'@video.twimg.com/v.mp4" } })`);
check('an address with a user name in it, sent by the page, is dropped', r?.ok === false && /which post/.test(r.error || ''), JSON.stringify(r));
r = await cs(`chrome.runtime.sendMessage({ type: 'clipsnatcher:download', hint: { postUrl: 'https://x.com/home' } })`);
check('a non-post address from the page is refused', r?.ok === false && /single post/.test(r.error || ''), JSON.stringify(r));
r = await cs(`chrome.runtime.sendMessage({ target: 'offscreen', type: 'mux', video: 'https://v.redd.it/a', audio: 'https://v.redd.it/b' }).then((v) => v === undefined ? 'ignored' : JSON.stringify(v), () => 'ignored')`);
check('page-side script cannot give the merge page work', r === 'ignored', JSON.stringify(r));

// The Save button: hover the video, then click it.
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, ts);
await move(700, 500); await wait(200);
check('no button before hovering a video', (await pageWorld(`!!document.querySelector('clipsnatcher-ui')`)) === false);
await move(300, 220); await wait(300); await move(310, 230); await wait(900);
r = await pageWorld(`(() => { const el = document.querySelector('clipsnatcher-ui'); if (!el) return null; const b = el.getBoundingClientRect(); return { shown: el.style.display, x: Math.round(b.left + b.width / 2), y: Math.round(b.top + 15), w: Math.round(b.width), shadowReadable: !!el.shadowRoot, text: el.textContent }; })()`);
check('Save button appears over the hovered video', r?.shown === 'block' && r.w > 40, JSON.stringify(r));
check('button contents are hidden from the page (closed shadow root)', r?.shadowReadable === false && r.text === '', JSON.stringify(r));
const bx = r?.x || 0, by = r?.y || 0;
await move(bx, by); await wait(150);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bx, y: by, button: 'left', clickCount: 1 }, ts);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx, y: by, button: 'left', clickCount: 1 }, ts);
await wait(8000);
const h = await history();
const saved = h.find((e) => e.site === 'x');
check('clicking Save downloads the post the video belongs to', !!saved && saved.state === 'complete' && saved.src === 'https://x.com/elonmusk/status/1585341984679469056', JSON.stringify(h));
await move(700, 500); await wait(3500);
check('button goes away after the pointer leaves', (await pageWorld(`document.querySelector('clipsnatcher-ui').style.display`)) === 'none');
r = await pageWorld(`(() => { const n = document.querySelector('clipsnatcher-notice'); return n ? n.textContent : 'none'; })()`);
check('nothing readable by the page was written into it', r === 'none' || r === '', JSON.stringify(r));
r = await cs(`chrome.runtime.sendMessage({ type: 'clipsnatcher:download', hint: { videoSrc: 'https://video.twimg.com/ext_tw_video/1585341912877146112/pu/vid/480x270/6tarM2TjLH1Ahh90.mp4?tag=14', titleHint: 'Fake X page' } })`);
await wait(5000);
const own = (await evalIn(ext, `chrome.storage.local.get('history').then(h => (h.history || []).filter(e => /6tarM2TjLH1Ahh90/.test(e.mediaUrl || '')).map(e => ({ site: e.site, state: e.state, path: e.path })))`)) || [];
check('a video saved by its own file address from an X page is filed under X', r?.ok === true && own.length === 1 && own[0].site === 'x' && own[0].state === 'complete' && /ClipSnatcher\/X\//.test(own[0].path || ''), JSON.stringify([r, own]));
r = await cs(`chrome.runtime.sendMessage({ type: 'clipsnatcher:download', hint: { postUrl: 'https://x.com/elonmusk/status/1585341984679469056' } })`);
check('a page asking to save a post already saved hears only "Saved before.", nothing about the history', r?.duplicate === true && r.error === 'Saved before.' && !('entryId' in r) && !('title' in r), JSON.stringify(r));
r = await cs(`Promise.all(Array.from({ length: 16 }, () => chrome.runtime.sendMessage({ type: 'clipsnatcher:download', hint: { postUrl: 'https://x.com/home' } }))).then((all) => all.filter((x) => /Too many/.test(x?.error || '')).length)`);
check('a page flooding save requests is rate-limited', r >= 3, String(r));
check('no script errors from the extension on the page', errorsFor(ts).filter((e) => e.includes('chrome-extension')).length === 0, errorsFor(ts).join('\n'));
// --- Facebook home feed: regular video posts have no link around the player, only the
// video's id on a wrapper. Ads have neither; a wrapper with two videos is ambiguous.
{
  const fbTab = (await send('Target.createTarget', { url: 'about:blank' })).result.targetId;
  const fs2 = await attach(fbTab);
  await send('Page.enable', {}, fs2);
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false }, fs2);
  await send('Page.navigate', { url: 'https://www.facebook.com/' }, fs2);
  await wait(2500);
  const fbMove = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, fs2);
  const fbPage = (expr) => evalIn(fs2, expr);
  const clickSaveOver = async (x, y) => {
    await fbMove(5, 690); await wait(600);
    await fbMove(x, y); await wait(300); await fbMove(x + 10, y + 10); await wait(900);
    const b = await fbPage(`(() => { const el = document.querySelector('clipsnatcher-ui'); if (!el || el.style.display !== 'block') return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 15) }; })()`);
    if (!b) return false;
    await fbMove(b.x, b.y); await wait(150);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 }, fs2);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 }, fs2);
    return true;
  };
  const before = (await history()).length;
  let clicked = await clickSaveOver(240, 120);
  await wait(6000);
  let h = await history();
  const fbSaved = h.find((e) => e.site === 'facebook');
  check('Facebook feed: Save on a regular video post (no link, only the video id) saves that video', clicked && !!fbSaved && fbSaved.state === 'complete' && /Fake Facebook clip 5471242699683085/.test(fbSaved.title) && fbSaved.src === 'https://www.facebook.com/reel/5471242699683085/', JSON.stringify([clicked, fbSaved]));
  const afterFirst = h.length;
  clicked = await clickSaveOver(240, 350);
  await wait(3000);
  check('Facebook feed: an ad (no link, no id) saves nothing', clicked && (await history()).length === afterFirst, JSON.stringify([clicked, (await history()).length, afterFirst]));
  clicked = await clickSaveOver(130, 550);
  await wait(3000);
  check('Facebook feed: a wrapper holding two videos is not guessed at', clicked && (await history()).length === afterFirst && afterFirst === before + 1, JSON.stringify([clicked, (await history()).length, afterFirst, before]));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
ws.close();

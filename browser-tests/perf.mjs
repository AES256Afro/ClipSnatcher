// How ClipSnatcher behaves with a small history and with a full one (5,000 videos, the
// most it keeps), in real Chrome. Prints the numbers (lines starting "PERF") and checks
// the few that are rules rather than measurements. Not part of the default run:
//   node browser-tests/run.mjs perf
const EXT = 'phdbcmaifcaagmfkmbdhokgmkldllajj';
const ver = await (await fetch(`http://127.0.0.1:${process.env.CS_CDP_PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : detail); };
const evalIn = async (s, expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
const attach = async (targetId) => { const s = (await send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId; await send('Runtime.enable', {}, s); return s; };
const open = async (url) => { const targetId = (await send('Target.createTarget', { url })).result.targetId; return { s: await attach(targetId), targetId }; };
const close = (t) => send('Target.closeTarget', { targetId: t.targetId });
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const report = (size, what, value, unit) => console.log(`PERF ${String(size).padStart(4)} entries  ${what.padEnd(46)} ${typeof value === 'number' ? value.toFixed(value < 10 ? 1 : 0) : value} ${unit}`);

await send('Extensions.loadUnpacked', { path: process.env.CS_EXT_DIR });
await wait(1500);
const { s: page } = await open(`chrome-extension://${EXT}/options.html`);
await wait(800);

// History entries shaped like real ones (long titles, addresses and paths), each with a
// thumbnail the size ClipSnatcher makes: a 160 px JPEG of a noisy picture.
async function seed(n) {
  await evalIn(page, `(async () => {
    const c = new OffscreenCanvas(160, 90), g = c.getContext('2d'), img = g.createImageData(160, 90);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i % 4 === 3) ? 255 : (Math.random() * 255) | 0;
    g.putImageData(img, 0, 0);
    const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 })).arrayBuffer());
    let bin = ''; for (const x of b) bin += String.fromCharCode(x);
    const thumb = 'data:image/jpeg;base64,' + btoa(bin);
    const sites = ['x', 'reddit', 'facebook', 'web'];
    const history = Array.from({ length: ${n} }, (_, i) => ({
      id: crypto.randomUUID(), title: 'A fairly long post title about something that happened, number ' + i, author: '@someone_' + (i % 50),
      site: sites[i % 4], sourceUrl: 'https://x.com/someone_' + (i % 50) + '/status/1' + String(i).padStart(18, '0'), postId: '1' + String(i).padStart(18, '0'),
      mediaUrl: 'https://video.twimg.com/ext_tw_video/1' + String(i).padStart(18, '0') + '/pu/vid/720x1280/AbCdEfGhIjKlMnOp.mp4?tag=12', mediaHost: 'video.twimg.com',
      index: 1, noAudio: false, whole: true, filename: 'ClipSnatcher/X/someone - A fairly long post title about something that happened [1' + i + '].mp4',
      path: '/Users/someone/Downloads/ClipSnatcher/X/someone - A fairly long post title about something that happened [1' + i + '].mp4',
      downloadId: null, dlStart: null, state: 'complete', error: '', bytes: 4000000 + i, createdAt: Date.now() - i * 60000, fav: i % 20 === 0, note: i % 10 === 0 ? 'a note ' + i : '',
    }));
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ history });
    for (let i = 0; i < history.length; i += 500) await chrome.storage.local.set(Object.fromEntries(history.slice(i, i + 500).map((e) => ['thumb:' + e.id, thumb])));
    return thumb.length;
  })()`);
}

// Milliseconds from opening a page until its list shows rows (performance.now() counts
// from the start of the page's navigation).
async function timeToRows(file, selector, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t = await open(`chrome-extension://${EXT}/${file}`);
    let ms = null;
    for (let k = 0; k < 200 && ms == null; k++) {
      ms = await evalIn(t.s, `document.querySelector(${JSON.stringify(selector)}) ? performance.now() : null`).catch(() => null);
      if (ms == null) await wait(10);
    }
    times.push(ms ?? NaN);
    await close(t);
  }
  return median(times);
}

async function measure(size) {
  await seed(size);
  const bytes = await evalIn(page, `chrome.storage.local.getBytesInUse(null)`);
  const historyBytes = await evalIn(page, `chrome.storage.local.get('history').then((h) => JSON.stringify(h.history).length)`);
  report(size, 'storage used (history list only)', historyBytes / 1024, 'KB');
  report(size, 'storage used (with thumbnails)', bytes / 1048576, 'MB');

  report(size, 'popup: open until recent rows show', await timeToRows('popup.html', '#recent .row'), 'ms');
  report(size, 'history page: open until rows show', await timeToRows('history.html', '#list .row'), 'ms');

  // Search: from typing to the list showing the result (includes the 80 ms typing pause).
  const h = await open(`chrome-extension://${EXT}/history.html`);
  for (let k = 0; k < 200 && !(await evalIn(h.s, `!!document.querySelector('#list .row')`)); k++) await wait(10);
  const searches = [];
  for (const term of ['number 1234', 'someone_7', 'zzz-nothing', 'note']) {
    searches.push(await evalIn(h.s, `new Promise((done) => {
      const before = document.getElementById('count').textContent, t0 = performance.now();
      const q = document.getElementById('q'); q.value = ${JSON.stringify(term)}; q.dispatchEvent(new Event('input'));
      const tick = () => (document.getElementById('count').textContent !== before ? done(performance.now() - t0) : requestAnimationFrame(tick));
      tick();
    })`));
    await evalIn(h.s, `(() => { const q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input')); })()`);
    await wait(300);
  }
  report(size, 'history search: typing to result shown', median(searches), 'ms');

  // One save: how long until the reply, and how many times history is written for it.
  await evalIn(h.s, `(window.__writes = 0, chrome.storage.onChanged.addListener((c, a) => { if (a === 'local' && c.history) window.__writes++; }), true)`);
  const t0 = Date.now();
  const r = await evalIn(h.s, `chrome.runtime.sendMessage({ type: 'clipsnatcher:download', url: 'https://evil.example/perf-${size}.mp4' })`);
  const replyMs = Date.now() - t0;
  await wait(4000);
  const writes = await evalIn(h.s, `window.__writes`);
  report(size, 'save: until the reply', replyMs, 'ms');
  report(size, 'save: history writes for one finished download', writes, '');

  // One history write on its own, as the background worker makes it.
  const sw = await attach((await send('Target.getTargets')).result.targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(EXT)).targetId);
  const writeMs = await evalIn(sw, `(async () => { const ts = []; for (let i = 0; i < 5; i++) { const t = performance.now(); const { history } = await chrome.storage.local.get('history'); await chrome.storage.local.set({ history }); ts.push(performance.now() - t); } return ts.sort((a, b) => a - b)[2]; })()`);
  report(size, 'one history write (read + write the list)', writeMs, 'ms');
  await close(h);
  return { ok: r?.ok === true, writes };
}

const small = await measure(50);
const full = await measure(5000);
check('a save of a direct file starts with a small and a full history', small.ok && full.ok);
check('one finished save writes history at most twice', small.writes <= 2 && full.writes <= 2, JSON.stringify({ small: small.writes, full: full.writes }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
ws.close();

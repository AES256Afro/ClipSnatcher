// Hidden page used for work a service worker can't do: merging Reddit video+audio
// and handing Chrome a blob: URL to save. Nothing is sent anywhere.
import { muxAV } from './lib/mux.js';

const blobs = new Set();

async function fetchBytes(url, label, onProgress) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn’t fetch ${label} (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(label, got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'mux') {
    let last = 0;
    const onProgress = (label, got, total) => {
      const now = Date.now();
      if (now - last < 1500) return;          // also keeps the service worker awake
      last = now;
      chrome.runtime.sendMessage({ type: 'clipstash:progress', jobId: msg.jobId, label, got, total }).catch(() => {});
    };
    (async () => {
      const [v, a] = await Promise.all([fetchBytes(msg.video, 'video', onProgress), fetchBytes(msg.audio, 'audio', onProgress)]);
      const parts = muxAV(v, a);
      const blob = new Blob(parts, { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      blobs.add(url);
      return { ok: true, url, size: blob.size };
    })().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }
  if (msg.type === 'revoke') {
    if (blobs.delete(msg.url)) URL.revokeObjectURL(msg.url);
    sendResponse({ ok: true, remaining: blobs.size });
  }
});

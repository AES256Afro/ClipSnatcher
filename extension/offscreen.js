// Hidden page used for work a service worker can't do: merging Reddit video+audio
// and handing Chrome a blob: URL to save. Nothing is sent anywhere.
//
// This page looks after itself: it counts the merges in progress, forgets a merged
// file once Chrome has saved it (or after a time limit), and closes when idle.
import { muxAV } from './lib/mux.js';

const ME = chrome.runtime.id;
const OWN_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');
const BLOB_LIFETIME_MS = 15 * 60 * 1000;   // backstop if the background never asks us to revoke
const IDLE_CLOSE_MS = 4000;
const FETCH_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BYTES = 1.5 * 1024 * 1024 * 1024;   // per track; a merge holds whole files in memory
const KEEP_AWAKE_MS = 20000;
const REDDIT_MEDIA = /(^|\.)redd\.it$/i;       // the only place merge tracks may come from, redirects included

const blobs = new Map();   // blob URL -> expiry timer
let jobs = 0;              // merges in progress
let idleTimer = 0;

function closeWhenIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!jobs && !blobs.size) window.close(); }, IDLE_CLOSE_MS);
}

function revoke(url) {
  if (!blobs.has(url)) return;
  clearTimeout(blobs.get(url));
  blobs.delete(url);
  URL.revokeObjectURL(url);
  closeWhenIdle();
}

async function fetchBytes(url, label, onProgress) {
  if (!/^https:\/\//i.test(url || '')) throw new Error(`The ${label} address isn’t a secure web link.`);
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Couldn’t fetch ${label} (${res.status}).`);
  const landed = new URL(res.url || url);
  if (landed.protocol !== 'https:' || !REDDIT_MEDIA.test(landed.hostname)) throw new Error(`The ${label} address led away from Reddit’s media host.`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > MAX_BYTES) throw new Error(`The ${label} is too large to merge.`);
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (got > MAX_BYTES) { reader.cancel().catch(() => {}); throw new Error(`The ${label} is too large to merge.`); }
    onProgress(label, got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function merge(msg) {
  let last = 0;
  const onProgress = (label, got, total) => {
    const now = Date.now();
    if (now - last < 1500) return;
    last = now;   // these messages also keep the background worker awake while bytes arrive
    chrome.runtime.sendMessage({ type: 'clipsnatcher:progress', label, got, total }).catch(() => {});
  };
  // The background worker is put to sleep after 30 quiet seconds. Ping it on a timer
  // too, so a stalled connection doesn't end the save half-way.
  const keepAwake = setInterval(() => chrome.runtime.sendMessage({ type: 'clipsnatcher:progress' }).catch(() => {}), KEEP_AWAKE_MS);
  let v, a;
  try {
    [v, a] = await Promise.all([fetchBytes(msg.video, 'video', onProgress), fetchBytes(msg.audio, 'audio', onProgress)]);
  } finally {
    clearInterval(keepAwake);
  }
  const blob = new Blob(muxAV(v, a), { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  blobs.set(url, setTimeout(() => revoke(url), BLOB_LIFETIME_MS));
  return { ok: true, url, size: blob.size };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  // Only the extension's own background worker may give this page work.
  // (Content scripts always carry sender.tab and a web origin.)
  if (sender?.id !== ME || sender.tab || (sender.origin && sender.origin !== OWN_ORIGIN)) return;

  if (msg.type === 'mux') {
    jobs++;
    clearTimeout(idleTimer);
    merge(msg)
      .then(sendResponse, (e) => sendResponse({ ok: false, error: e?.message || String(e) }))
      .finally(() => { jobs--; closeWhenIdle(); });
    return true;
  }
  if (msg.type === 'revoke') {
    revoke(String(msg.url || ''));
    sendResponse({ ok: true });
  }
});

closeWhenIdle();

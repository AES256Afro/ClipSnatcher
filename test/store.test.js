import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// An in-memory stand-in for chrome.storage.local, enough for lib/store.js.
let data = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (keys == null) return { ...data };
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
      },
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v); },
      remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; },
    },
  },
};
const store = await import('../extension/lib/store.js');
beforeEach(() => { data = {}; });

const entry = (id, extra = {}) => ({ id, title: 'T ' + id, createdAt: 1000 + Number(id.replace(/\D/g, '') || 0), state: 'complete', downloadId: null, ...extra });

test('a download item only matches the entry it was made for', () => {
  const e = { downloadId: 5, dlStart: '2026-01-01T00:00:00.000Z' };
  const item = { id: 5, byExtensionId: 'me', startTime: '2026-01-01T00:00:00.000Z' };
  assert.equal(store.isEntryDownload(e, item, 'me'), true);
  assert.equal(store.isEntryDownload(e, { ...item, byExtensionId: 'other' }, 'me'), false, 'another extension');
  assert.equal(store.isEntryDownload(e, { ...item, startTime: '2026-02-02T00:00:00.000Z' }, 'me'), false, 'a reused download id');
  assert.equal(store.isEntryDownload(e, { ...item, id: 6 }, 'me'), false);
  assert.equal(store.isEntryDownload(e, undefined, 'me'), false);
});

test('failure codes become plain reasons', () => {
  assert.equal(store.failureReason('USER_CANCELED'), 'cancelled');
  assert.equal(store.failureReason('NETWORK_FAILED'), 'network problem');
  assert.equal(store.failureReason('FILE_NO_SPACE'), 'disk is full');
  assert.equal(store.failureReason('REDIRECTED'), 'the address redirected to another site');
  assert.equal(store.failureReason(''), '');
});

test('history is newest first', async () => {
  for (let i = 0; i < 3; i++) await store.addEntry(entry('e' + i));
  assert.deepEqual((await store.getHistory()).map((e) => e.id), ['e2', 'e1', 'e0']);
});

test('history keeps at most MAX_HISTORY entries, dropping the oldest', async () => {
  await store.restoreEntries(Array.from({ length: store.MAX_HISTORY }, (_, i) => entry('old' + i)));
  assert.equal((await store.getHistory()).length, store.MAX_HISTORY);
  await store.addEntry(entry('new', { createdAt: 10 ** 12 }));
  const list = await store.getHistory();
  assert.equal(list.length, store.MAX_HISTORY);
  assert.equal(list[0].id, 'new');
  assert.equal(list.some((e) => e.id === 'old0'), false, 'the oldest entry was dropped');
});

test('updates that match nothing do not rewrite history', async () => {
  await store.addEntry(entry('e1'));
  let writes = 0;
  const realSet = chrome.storage.local.set;
  chrome.storage.local.set = async (o) => { writes++; return realSet(o); };
  try {
    assert.equal(await store.updateEntry('missing', { title: 'x' }), undefined);
    assert.equal(await store.updateByDownload({ id: 99, byExtensionId: 'me' }, 'me', { state: 'complete' }), undefined);
    assert.equal(writes, 0);
  } finally {
    chrome.storage.local.set = realSet;
  }
});

test('undo puts entries back in date order, skips duplicates and junk, and has no 200 limit', async () => {
  await store.addEntry(entry('e5'));
  const many = Array.from({ length: 300 }, (_, i) => entry('b' + i));
  const back = await store.restoreEntries([...many, entry('e5'), null, { id: 7 }, 'x']);
  assert.equal(back.length, 300);
  const list = await store.getHistory();
  assert.equal(list.length, 301);
  assert.ok(list.every((e, i) => i === 0 || list[i - 1].createdAt >= e.createdAt), 'newest first');
});

test('undo of a row that was merging brings it back as failed unless the merge is still running', async () => {
  const back = await store.restoreEntries([entry('m1', { state: 'merging' }), entry('m2', { state: 'merging' })], new Set(['m2']));
  assert.equal(back.length, 2);
  const list = await store.getHistory();
  assert.deepEqual(list.find((e) => e.id === 'm1'), { ...entry('m1'), state: 'interrupted', error: 'MERGE_INTERRUPTED' });
  assert.equal(list.find((e) => e.id === 'm2').state, 'merging');
});

test('merges cut off by a restart are marked as failed', async () => {
  await store.addEntry(entry('m1', { state: 'merging' }));
  await store.addEntry(entry('m2', { state: 'merging' }));
  await store.failStaleMerges(new Set(['m2']));
  const list = await store.getHistory();
  assert.equal(list.find((e) => e.id === 'm1').state, 'interrupted');
  assert.equal(list.find((e) => e.id === 'm2').state, 'merging');
});

test('old thumbnails inside entries move to their own keys, and orphans are pruned', async () => {
  data.history = [entry('a1', { thumb: 'data:image/jpeg;base64,AAAA' }), entry('a2'), entry('a3', { thumb: '' })];
  data['thumb:gone'] = 'data:image/jpeg;base64,BBBB';
  assert.equal(await store.migrateThumbs(), 1);
  assert.ok((await store.getHistory()).every((e) => !('thumb' in e)), 'no images left inside entries');
  assert.equal(data['thumb:a1'], 'data:image/jpeg;base64,AAAA');
  assert.equal(await store.migrateThumbs(), undefined, 'second run changes nothing');
  await store.pruneThumbs();
  assert.equal(data['thumb:gone'], undefined);
  assert.equal(data['thumb:a1'], 'data:image/jpeg;base64,AAAA', 'a live entry keeps its image');
  assert.deepEqual([...(await store.getThumbs(['a1', 'a2']))], [['a1', 'data:image/jpeg;base64,AAAA']]);
});

test('entries that only carry an empty "thumb" field (as version 1.2 wrote) are cleaned too', async () => {
  data.history = [entry('n1', { thumb: null }), entry('n2', { thumb: null })];
  await store.migrateThumbs();
  assert.ok((await store.getHistory()).every((e) => !('thumb' in e)));
});

test('a prune and an Undo never interleave: an entry restored before the prune keeps its image', async () => {
  data['thumb:r1'] = 'data:image/jpeg;base64,EEEE';
  // Slow the storage down so that, unqueued, the prune would read the key list before the
  // restore lands and delete the image after it.
  const realGet = chrome.storage.local.get;
  chrome.storage.local.get = async (k) => { await new Promise((r) => setTimeout(r, 5)); return realGet(k); };
  try {
    await Promise.all([store.restoreEntries([entry('r1')]), store.pruneThumbs()]);
  } finally {
    chrome.storage.local.get = realGet;
  }
  assert.equal((await store.getHistory()).some((e) => e.id === 'r1'), true);
  assert.equal(data['thumb:r1'], 'data:image/jpeg;base64,EEEE');
});

test('on Chrome without a way to list keys, start-up skips the costly prune', async () => {
  data['thumb:gone'] = 'data:image/jpeg;base64,FFFF';
  let readAll = 0;
  const realGet = chrome.storage.local.get;
  chrome.storage.local.get = async (k) => { if (k === null) readAll++; return realGet(k); };
  try {
    await store.pruneThumbs({ thorough: false });
    assert.equal(readAll, 0);
    assert.equal(data['thumb:gone'], 'data:image/jpeg;base64,FFFF');
    await store.pruneThumbs({ thorough: true });
    assert.equal(data['thumb:gone'], undefined);
  } finally {
    chrome.storage.local.get = realGet;
  }
});

test('undo never brings an image back inside an entry', async () => {
  await store.restoreEntries([entry('u1', { thumb: 'data:image/jpeg;base64,CCCC' })]);
  assert.equal('thumb' in (await store.getHistory())[0], false);
});

test('clearing history also deletes the thumbnails', async () => {
  await store.addEntry(entry('c1'));
  await store.setThumb('c1', 'data:image/jpeg;base64,DDDD');
  await store.clearHistory();
  assert.deepEqual(Object.keys(data).filter((k) => k.startsWith('thumb:')), []);
});

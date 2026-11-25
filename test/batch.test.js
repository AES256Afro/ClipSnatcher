import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLinks, outcome, summary, cleanBatch, MAX_BATCH } from '../extension/lib/batch.js';

test('splitLinks: separate links, glued links, links in text, duplicates', () => {
  assert.deepEqual(splitLinks('https://x.com/a/status/1 https://x.com/b/status/2'), ['https://x.com/a/status/1', 'https://x.com/b/status/2']);
  assert.deepEqual(splitLinks('https://a.com/1https://b.com/2'), ['https://a.com/1', 'https://b.com/2'], 'one per line, pasted into a one-line box');
  assert.deepEqual(splitLinks('see (https://a.com/1), and https://a.com/1.'), ['https://a.com/1']);
  assert.deepEqual(splitLinks('https://a.com/r?u=https://b.com/v'), ['https://a.com/r?u=https://b.com/v'], 'an address inside a query stays part of its link');
  assert.deepEqual(splitLinks('x.com/a/status/1'), [], 'links without https:// are for single pastes');
  assert.deepEqual(splitLinks(''), []);
});

test('outcome: what happened to each link', () => {
  assert.deepEqual(outcome('u', { ok: true }), { url: 'u', kind: 'started' });
  assert.deepEqual(outcome('u', { ok: false, duplicate: true }), { url: 'u', kind: 'skipped' });
  assert.match(outcome('u', { ok: false, needsConfirm: true, host: 'i.imgur.com' }).why, /i\.imgur\.com.*on its own/);
  assert.deepEqual(outcome('u', { ok: false, error: 'No video found in this post.' }), { url: 'u', kind: 'failed', why: 'No video found in this post.' });
  assert.equal(outcome('u', null).why, 'failed');
});

test('summary: counts, and lists what wasn’t saved', () => {
  assert.deepEqual(summary([outcome('https://a.com/1', { ok: true }), outcome('https://a.com/2', { ok: true })], 2), { text: 'Started 2 of 2.', ok: true });
  const s = summary([outcome('https://a.com/1', { ok: true }), outcome('https://a.com/2', { duplicate: true }), outcome('https://www.b.com/3', { error: 'Nope.' })], 3);
  assert.equal(s.ok, false);
  assert.equal(s.text, 'Started 1 of 3. 1 already saved. Not saved: b.com/3: Nope.');
});

test('cleanBatch: only web links, no duplicates, at most MAX_BATCH', () => {
  assert.deepEqual(cleanBatch(['https://a.com/1', 'https://a.com/1', 'javascript:x', 42, 'http://b.com/2']), ['https://a.com/1', 'http://b.com/2']);
  assert.equal(cleanBatch(Array.from({ length: 40 }, (_, i) => `https://a.com/${i}`)).length, MAX_BATCH);
  assert.deepEqual(cleanBatch('https://a.com/1'), []);
  assert.deepEqual(cleanBatch(['https://a.com/' + 'x'.repeat(5000)]), []);
});

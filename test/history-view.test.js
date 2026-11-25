import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortEntries, totalBytes } from '../extension/lib/history-view.js';

const e = (id, createdAt, bytes, title, state = 'complete') => ({ id, createdAt, bytes, title, state });
const list = [e('a', 3, 10, 'banana'), e('b', 1, 300, 'Apple 10'), e('c', 2, 300, 'apple 9')];

test('sortEntries: newest, oldest, largest, title; never changes the original', () => {
  assert.deepEqual(sortEntries(list, 'newest').map((x) => x.id), ['a', 'c', 'b']);
  assert.deepEqual(sortEntries(list, 'oldest').map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(sortEntries(list, 'largest').map((x) => x.id), ['c', 'b', 'a'], 'equal sizes: newest first');
  assert.deepEqual(sortEntries(list, 'title').map((x) => x.id), ['c', 'b', 'a'], 'ignores case, and 9 comes before 10');
  assert.deepEqual(sortEntries(list, 'nonsense').map((x) => x.id), ['a', 'c', 'b']);
  assert.deepEqual(list.map((x) => x.id), ['a', 'b', 'c']);
});

test('totalBytes: only finished files with a known size', () => {
  assert.equal(totalBytes([...list, e('d', 0, 50, 't', 'interrupted'), e('f', 0, undefined, 't'), e('g', 0, -5, 't')]), 610);
  assert.equal(totalBytes([]), 0);
});

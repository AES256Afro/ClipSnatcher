import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, sanitizeFolder, buildFilename, extensionFor } from '../extension/lib/names.js';

const settings = { folder: 'ClipSnatcher', perSite: true, authorInName: true };

test('file names are built from site, author, title and post id', () => {
  assert.equal(buildFilename(settings, { site: 'x', title: 'Hello world', author: '@someone', id: '123' }, { kind: 'direct', url: 'https://v/a.mp4', index: 1 }, 1),
    'ClipSnatcher/X/someone - Hello world [123].mp4');
});

test('a subreddit as author becomes a safe prefix', () => {
  assert.equal(buildFilename(settings, { site: 'reddit', title: 'T', author: 'r/aww', id: 'a' }, { kind: 'mux', index: 1 }, 1),
    'ClipSnatcher/Reddit/r-aww - T [a].mp4');
});

test('posts with several videos get a number per video', () => {
  assert.equal(buildFilename({ folder: '', perSite: false, authorInName: false }, { site: 'x', title: '', author: '', id: '1' }, { kind: 'direct', url: 'https://a/b.webm', index: 2 }, 3),
    'video [1] (2).webm');
});

test('characters that are not allowed in paths are dropped', () => {
  assert.equal(sanitizeFolder('My:Clips?/../Sub'), 'My Clips/Sub');
  assert.equal(sanitize('a/b\\c:d*e?"f<g>h|i~j%k'), 'a b c d e f g h i j k');
  assert.equal(sanitize('...hidden.'), 'hidden');
  assert.equal(sanitize('line\nbreak\ttab'), 'line break tab');
});

test('long titles are cut at a word, never through an emoji', () => {
  const title = 'word '.repeat(40);
  assert.ok(sanitize(title).length <= 90);
  assert.ok(!sanitize(title).endsWith(' '));
  const emoji = '\u{1F600}'.repeat(100);
  const cut = sanitize(emoji);
  assert.equal(Array.from(cut).length, 90);
  assert.ok(/^(\u{1F600})+$/u.test(cut), 'no half emoji');
});

test('the file extension follows the video address', () => {
  assert.equal(extensionFor({ kind: 'direct', url: 'https://x/v.MOV?x=1' }), 'mov');
  assert.equal(extensionFor({ kind: 'direct', url: 'https://x/v' }), 'mp4');
  assert.equal(extensionFor({ kind: 'mux' }), 'mp4');
});

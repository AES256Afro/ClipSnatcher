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

test('file-name templates: tokens filled and cleaned, gaps tidied', async () => {
  const { applyTemplate } = await import('../extension/lib/names.js');
  const post = { site: 'reddit', title: 'A/B: test', author: 'r/aww', id: 'abc' };
  const item = { kind: 'mux', index: 1 };
  const day = new Date(2026, 10, 25, 12).getTime();
  const name = (nameTemplate, p = post, total = 1) => buildFilename({ folder: 'Clips', perSite: false, authorInName: true, nameTemplate }, p, item, total, day);
  assert.equal(name('{date} {author} - {title}'), 'Clips/2026-11-25 r-aww - A B test.mp4');
  assert.equal(name('{site}_{id}'), 'Clips/Reddit_abc.mp4');
  assert.equal(name('{author} - {title} [{id}]', { ...post, author: '' }), 'Clips/A B test [abc].mp4', 'no author: no dangling " - "');
  assert.equal(name('{title} ({author})', { ...post, author: '' }), 'Clips/A B test.mp4', 'empty brackets go');
  assert.equal(name('../{title}/x:y'), 'Clips/A B test x y.mp4', 'template text can’t make folders or bad characters');
  assert.equal(name('{nope} {title}'), 'Clips/{nope} A B test.mp4', 'unknown words are kept');
  assert.equal(name('{author}', { ...post, author: '' }), 'Clips/A B test.mp4', 'a template that comes out empty falls back to the title');
  assert.equal(name('{title}', post, 3), 'Clips/A B test (1).mp4', 'several videos in a post still get their number');
  assert.equal(name(''), 'Clips/r-aww - A B test [abc].mp4', 'empty: the usual name');
  assert.equal(applyTemplate('{title}', { title: 'x'.repeat(400) }).length, 150);
});

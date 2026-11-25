import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbLayout } from '../extension/lib/thumbs.js';

test('thumbLayout: landscape pictures are scaled to 160 px wide, nothing cut', () => {
  assert.deepEqual(thumbLayout(1280, 720), { canvasW: 160, canvasH: 90, drawW: 160, drawH: 90, y: 0 });
});

test('thumbLayout: portrait pictures are cut equally top and bottom, so the middle shows', () => {
  const l = thumbLayout(720, 1280);                 // 9:16, like a reel
  assert.equal(l.drawH, 284);
  assert.equal(l.canvasH, 200);
  assert.equal(l.y, -42);
  assert.equal(l.drawH + l.y * 2, l.canvasH, 'as much cut from the top as from the bottom');
});

test('thumbLayout: odd sizes stay sane', () => {
  assert.equal(thumbLayout(0, 0).canvasH, 1);
  assert.equal(thumbLayout(160, 200).y, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notesFor } from '../scripts/release-notes.mjs';

const changelog = '# Changelog\n\nIntro.\n\n## 1.6.0 (2026-12-01)\n\n- New thing.\n- Other thing.\n\n## 1.5.2 (2026-11-25)\n\n- Older.\n';

test('notesFor: one version’s section, without its heading or the next', () => {
  assert.equal(notesFor(changelog, '1.6.0'), '- New thing.\n- Other thing.');
  assert.equal(notesFor(changelog, '1.5.2'), '- Older.');
  assert.equal(notesFor(changelog, '1.5'), null, 'a version prefix is not a match');
  assert.equal(notesFor(changelog, '9.9.9'), null);
});

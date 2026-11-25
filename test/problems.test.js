import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addProblem, badgeText, problemsSummary, MAX_PROBLEMS } from '../extension/lib/problems.js';

test('addProblem: newest first, capped, text cleaned', () => {
  let list = [];
  for (let i = 0; i < MAX_PROBLEMS + 3; i++) list = addProblem(list, `Problem ${i}`, i);
  assert.equal(list.length, MAX_PROBLEMS);
  assert.equal(list[0].text, `Problem ${MAX_PROBLEMS + 2}`);
  assert.equal(addProblem(undefined, '  two\n lines ', 1)[0].text, 'two lines');
  assert.equal(addProblem([], '', 1)[0].text, 'Something went wrong.');
  assert.equal(addProblem([], 'x'.repeat(1000), 1)[0].text.length, 300);
});

test('badgeText: a count, nothing for none, and 9+ past nine', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(1), '1');
  assert.equal(badgeText(9), '9');
  assert.equal(badgeText(12), '9+');
});

test('problemsSummary: one problem as is; several counted, newest first', () => {
  assert.equal(problemsSummary([]), '');
  assert.equal(problemsSummary([{ text: 'A', at: 1 }]), 'A');
  assert.match(problemsSummary([{ text: 'B', at: 2 }, { text: 'A', at: 1 }]), /^2 things went wrong.*B • A$/);
});

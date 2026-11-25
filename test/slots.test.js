import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slots } from '../extension/lib/slots.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

test('slots: never more than the limit at once, and everything finishes in order', async () => {
  const s = slots(2);
  let now = 0, most = 0;
  const order = [];
  const job = (n) => s.run(async () => { now++; most = Math.max(most, now); await tick(); await tick(); now--; order.push(n); return n; });
  const first = [job(1), job(2), job(3), job(4)];
  assert.equal(s.load, 4);
  await tick();
  // A newcomer arriving while a finished job hands over its place must still wait.
  const late = job(5);
  assert.deepEqual(await Promise.all([...first, late]), [1, 2, 3, 4, 5]);
  assert.equal(most, 2);
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
  assert.equal(s.load, 0);
});

test('slots: a failing job frees its place', async () => {
  const s = slots(1);
  await assert.rejects(s.run(async () => { throw new Error('no'); }));
  assert.equal(await s.run(async () => 'next'), 'next');
  assert.equal(s.load, 0);
});

test('slots: a newcomer during a handover still waits its turn', async () => {
  const s = slots(1);
  let now = 0, most = 0;
  const body = async () => { now++; most = Math.max(most, now); await tick(); now--; };
  const a = s.run(body);
  const b = s.run(body);            // waits for a
  await tick();                     // a finishes and hands its place to b...
  const c = s.run(body);            // ...while c arrives in the same moment
  await Promise.all([a, b, c]);
  assert.equal(most, 1);
});

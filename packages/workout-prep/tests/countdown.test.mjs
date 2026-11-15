import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SECONDS, PrepCountdown, validSeconds } from '../countdown.mjs';

function harness(record = async () => {}) {
  let now = 0, callback, ready = true, calls = 0, signal;
  const states = [];
  const c = new PrepCountdown({ clock: () => now,
    every: fn => { callback = fn; return 0; }, clear: () => { callback = null; },
    canStart: () => ready, onChange: state => states.push(state),
    onRecord: s => { calls++; signal = s; return record(s); },
  });
  return { c, states, advance: ms => { now += ms; callback?.(); },
    unavailable: () => { ready = false; }, get calls() { return calls; }, get signal() { return signal; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('defaults to seven and supports bounded custom delays', () => {
  assert.equal(DEFAULT_SECONDS, 7);
  for (const v of [1, 7, 22, 60]) assert.ok(validSeconds(v));
  for (const v of [0, 61, 2.5, NaN, Infinity, '7']) assert.equal(validSeconds(v), false);
});
test('shows seven through one, then records once after acknowledgement', async () => {
  const h = harness(); h.c.start(7);
  for (let i = 0; i < 7; i++) h.advance(1000);
  assert.deepEqual(h.states.filter(s => s.phase === 'counting').map(s => s.remaining), [7,6,5,4,3,2,1]);
  assert.equal(h.c.state.phase, 'starting');
  await flush();
  assert.equal(h.calls, 1); assert.equal(h.c.state.phase, 'recording');
  h.advance(3000); assert.equal(h.calls, 1);
});
test('double tap cannot start two countdowns', async () => {
  const h = harness(); assert.ok(h.c.start(1)); assert.equal(h.c.start(1), false);
  h.advance(1000); await flush(); assert.equal(h.calls, 1);
});
test('late ticks use elapsed time rather than accumulating interval drift', () => {
  const h = harness(); h.c.start(7); h.advance(1100); h.advance(1100);
  assert.equal(h.c.state.remaining, 5);
});
test('camera unavailable blocks both initial start and completion', async () => {
  const a = harness(); a.unavailable(); assert.equal(a.c.start(7), false);
  const b = harness(); b.c.start(1); b.unavailable(); b.advance(1000); await flush();
  assert.equal(a.calls + b.calls, 0);
});
test('cancel and resume do not auto-record', async () => {
  const h = harness(); h.c.start(7); h.advance(1000); h.c.cancel(); h.advance(10000);
  await flush(); assert.equal(h.calls, 0); assert.equal(h.c.state.phase, 'idle');
});
test('long JS suspension cancels instead of skipping straight to recording', async () => {
  const h = harness(); h.c.start(7); h.advance(8000); await flush();
  assert.equal(h.calls, 0); assert.equal(h.c.state.phase, 'idle');
});
test('unmount prevents recording and further starts', async () => {
  const h = harness(); h.c.start(1); h.c.dispose(); h.advance(1000); await flush();
  assert.equal(h.calls, 0); assert.equal(h.c.start(1), false);
});
test('recording error is visible and can be retried', async () => {
  const h = harness(async () => { throw new Error('camera'); }); h.c.start(1); h.advance(1000);
  await flush(); assert.equal(h.c.state.phase, 'error'); assert.ok(h.c.start(1));
});
test('late camera acknowledgement after cancellation cannot show Go', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; })); h.c.start(1); h.advance(1000); await flush();
  h.c.cancel(); assert.equal(h.signal.aborted, true); resolve(); await flush();
  assert.equal(h.c.state.phase, 'idle');
});
test('new countdown is insulated from an old async completion', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; })); h.c.start(1); h.advance(1000); await flush();
  h.c.cancel(); h.c.start(7); resolve(); await flush();
  assert.equal(h.c.state.phase, 'counting'); assert.equal(h.c.state.remaining, 7);
});
test('camera adapter must explicitly acknowledge recording start', async () => {
  const h = harness(() => undefined); h.c.start(1); h.advance(1000); await flush();
  assert.equal(h.c.state.phase, 'error');
});

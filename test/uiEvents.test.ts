import assert from 'node:assert/strict';
import test from 'node:test';
import { appendRecent, statusEvents } from '../ui/src/events.js';
import { Metrics } from '../src/receiver/metrics.js';
import { Synchronizer } from '../src/receiver/synchronizer.js';

function snapshot() {
  const sync = new Synchronizer();
  return new Metrics(() => sync.stats, () => ({ udpDatagramsReceived: 0, udpBytesReceived: 0 })).snapshot();
}

test('UI derives failure and recovery even if both status samples are LOCK', () => {
  const before = { ...snapshot(), state: 'LOCK' as const, synced: true, currentBitAlignment: 0, asmDetections: 2 };
  const after = { ...before, currentBitAlignment: 1, asmDetections: 3, crcFailures: 1, resyncCount: 1, sequenceGaps: 1 };
  assert.deepEqual(statusEvents(before, after), [
    'ASM acquired (+1)', 'CRC failure (+1)', 'Resynchronized (+1)', 'Frame sequence gaps (+1)', 'Current alignment 0 → 1',
  ]);
});

test('UI distinguishes sampled HUNT and absent alignment, avoids artificial reset events', () => {
  const before = { ...snapshot(), state: 'LOCK' as const, synced: true, currentBitAlignment: 7, crcFailures: 2 };
  assert.deepEqual(statusEvents(before, snapshot()), ['FSM LOCK → HUNT']);
  assert.deepEqual(statusEvents(null, snapshot()), []);
  assert.deepEqual(statusEvents(snapshot(), snapshot()), []);
});

test('UI event history retains only newest 20 observations without mutating old list', () => {
  const previous = Array.from({ length: 20 }, (_, i) => String(i));
  const recent = appendRecent(previous, ['20', '21']);
  assert.equal(recent.length, 20);
  assert.equal(recent[0], '2');
  assert.equal(recent.at(-1), '21');
  assert.equal(previous[0], '0');
});

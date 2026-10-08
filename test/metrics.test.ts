import assert from 'node:assert/strict';
import test from 'node:test';
import { Metrics } from '../src/receiver/metrics.js';
import { Synchronizer, type SyncState } from '../src/receiver/synchronizer.js';
import { readReceiverConfig } from '../src/shared/config.js';
import { unit } from './bitHelpers.js';

function fixture() {
  const sync = new Synchronizer();
  let state = sync.stats;
  const transport = { udpDatagramsReceived: 0, udpBytesReceived: 0 };
  let time = 0;
  const metrics = new Metrics(() => state, () => transport, () => time);
  return { metrics, transport, state, advance: (ms: number) => { time += ms; },
    setState: (value: SyncState) => { state = { ...state, state: value }; } };
}

for (const [name, sequences, gaps] of [
  ['METRIC-1 normal progression', [0, 1, 2], 0],
  ['METRIC-2 one missing frame', [0, 1, 3], 1],
  ['METRIC-3 several missing frames', [3, 7], 3],
  ['METRIC-4 uint32 wraparound', [0xfffffffe, 0xffffffff, 0, 1], 0],
  ['METRIC-5 duplicates preserve forward baseline', [0, 1, 1, 2, 2, 4], 1],
  ['METRIC-6 older observations preserve forward baseline', [3, 7, 4, 6, 8], 3],
  ['gap across uint32 wraparound', [0xfffffffe, 1], 2],
  ['older observations around wraparound', [0xffffffff, 0, 0xfffffffe, 1], 0],
  ['half-range ambiguous observation ignored', [0, 0x80000000, 1], 0],
] as const) {
  test(name, () => {
    const { metrics } = fixture();
    for (const sequence of sequences) metrics.recordValidSequence(sequence);
    assert.equal(metrics.snapshot().sequenceGaps, gaps);
  });
}

test('METRIC-7 rates use counter deltas and controlled elapsed time, then decay to zero', () => {
  const { metrics, state, transport, advance } = fixture();
  state.validFrames = 2;
  transport.udpBytesReceived = 520;
  advance(250);
  metrics.sampleRates();
  assert.equal(metrics.snapshot().framesPerSecond, 8);
  assert.equal(metrics.snapshot().bytesPerSecond, 2080);
  state.validFrames += 3;
  transport.udpBytesReceived += 780;
  advance(750);
  metrics.sampleRates();
  assert.equal(metrics.snapshot().framesPerSecond, 4);
  assert.equal(metrics.snapshot().bytesPerSecond, 1040);
  advance(250);
  metrics.sampleRates();
  assert.equal(metrics.snapshot().framesPerSecond, 0);
  assert.equal(metrics.snapshot().bytesPerSecond, 0);
});

test('zero elapsed rate sample stays finite and preserves unconsumed count delta', () => {
  const { metrics, state, advance } = fixture();
  state.validFrames = 1;
  metrics.sampleRates();
  assert.equal(metrics.snapshot().framesPerSecond, 0);
  advance(500);
  metrics.sampleRates();
  assert.equal(metrics.snapshot().framesPerSecond, 2);
});

test('synced reflects all four FSM states and snapshots do not own duplicate counters', () => {
  const { metrics, state, transport, setState } = fixture();
  for (const value of ['HUNT', 'LOCK', 'VERIFY', 'EXTRACT'] as const) {
    setState(value);
    assert.equal(metrics.snapshot().synced, value !== 'HUNT');
  }
  const live = new Metrics(() => state, () => transport);
  state.currentBitAlignment = 7;
  state.crcFailures = 2;
  transport.udpDatagramsReceived = 9;
  assert.equal(live.snapshot().currentBitAlignment, 7);
  assert.equal(live.snapshot().crcFailures, 2);
  live.snapshot().crcFailures = 500;
  assert.equal(live.snapshot().crcFailures, 2);
});

test('metrics reuse authoritative resync count; only extracted valid sequences create gaps', () => {
  const sync = new Synchronizer();
  const metrics = new Metrics(() => sync.stats, () => ({ udpDatagramsReceived: 0, udpBytesReceived: 0 }));
  const damaged = unit(1);
  damaged[14] ^= 0x80;
  const frames = sync.push(Buffer.concat([unit(0), damaged, unit(2)]));
  frames.forEach(output => metrics.recordValidSequence(output.frame.sequence));
  assert.equal(metrics.snapshot().sequenceGaps, 1);
  assert.equal(metrics.snapshot().validFrames, 2);
  assert.equal(metrics.snapshot().crcFailures, 1);
  assert.equal(metrics.snapshot().resyncCount, 1);
  assert.equal(metrics.snapshot().synced, false);
  assert.equal(metrics.snapshot().currentBitAlignment, null);
});

test('receiver configuration adds localhost WebSocket default and validates WS_PORT', () => {
  assert.deepEqual(readReceiverConfig({}), { host: '127.0.0.1', port: 5000, websocket: { host: '127.0.0.1', port: 8080 } });
  assert.equal(readReceiverConfig({ WS_PORT: '9001' }).websocket.port, 9001);
  for (const value of ['', 'NaN', '0', '65536', '3.5']) assert.throws(() => readReceiverConfig({ WS_PORT: value }), RangeError);
});

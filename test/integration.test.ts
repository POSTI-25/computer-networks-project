import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { startReceiver } from '../src/receiver/index.js';
import { Synchronizer, type SynchronizedFrame } from '../src/receiver/synchronizer.js';
import { createUdpSender } from '../src/transmitter/index.js';
import { FrameBuilder, mockTelemetry } from '../src/transmitter/frameBuilder.js';
import { packetize, Packetizer } from '../src/transmitter/packetizer.js';

function stream(count: number): Buffer {
  const builder = new FrameBuilder();
  return Buffer.concat(Array.from({ length: count }, () => builder.next()));
}

function feed(chunks: Buffer[]) {
  const synchronizer = new Synchronizer();
  const frames = chunks.flatMap(chunk => synchronizer.push(chunk));
  return { frames, stats: synchronizer.stats };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for localhost UDP delivery');
    await setTimeout(5);
  }
}

async function overUdp(chunks: Buffer[], expectedFrames: number) {
  const frames: SynchronizedFrame[] = [];
  const errors: Error[] = [];
  const receiver = await startReceiver({ port: 0, onFrame: frame => frames.push(frame), onError: error => errors.push(error) });
  let sender: Awaited<ReturnType<typeof createUdpSender>> | undefined;
  try {
    sender = await createUdpSender('127.0.0.1', receiver.socket.address().port);
    await sender.send(chunks);
    await waitFor(() => receiver.counters.udpDatagramsReceived === chunks.length);
    assert.deepEqual(errors, []);
    assert.equal(frames.length, expectedFrames);
    return { frames, counters: receiver.counters, stats: receiver.synchronizer.stats };
  } finally {
    await sender?.close();
    await receiver.close();
  }
}

test('100-frame direct packetizer -> synchronizer integration recovers exact ordered telemetry', () => {
  const input = stream(100);
  const { frames, stats } = feed(packetize(input, { seed: 42 }));
  assert.deepEqual(frames.map(f => f.frame.sequence), Array.from({ length: 100 }, (_, i) => i));
  for (let i = 0; i < frames.length; i++) assert.deepEqual(frames[i].frame.telemetry, mockTelemetry(i));
  assert.equal(stats.crcFailures, 0);
  assert.equal(stats.formatFailures, 0);
});

test('explicit 2-byte chunks split ASM and spread the frame body over 128 chunks', () => {
  const chunks = packetize(stream(1), { minChunkBytes: 2, maxChunkBytes: 2 });
  assert.deepEqual(chunks[0], Buffer.from([0x1a, 0xcf]));
  assert.deepEqual(chunks[1], Buffer.from([0xfc, 0x1d]));
  assert.equal(chunks.length, 130);
  const sync = new Synchronizer();
  for (const chunk of chunks.slice(0, -1)) {
    assert.deepEqual(sync.push(chunk), []);
    assert.equal(sync.stats.crcFailures, 0);
  }
  assert.equal(sync.state, 'LOCK');
  assert.equal(sync.push(chunks.at(-1)!)[0].frame.sequence, 0);
});

test('one chunk mixes preceding frame tail, next ASM, and next frame body', () => {
  const bytes = stream(2);
  const chunks = [bytes.subarray(0, 250), bytes.subarray(250, 274), bytes.subarray(274)];
  assert.deepEqual(chunks[1].subarray(10, 14), Buffer.from([0x1a, 0xcf, 0xfc, 0x1d]));
  const { frames, stats } = feed(chunks);
  assert.deepEqual(frames.map(f => f.frame.sequence), [0, 1]);
  assert.equal(stats.crcFailures, 0);
});

test('live packetizer preserves pending tail across separately generated frames', () => {
  const builder = new FrameBuilder();
  const first = builder.next();
  const second = builder.next();
  const packetizer = new Packetizer({ minChunkBytes: 31, maxChunkBytes: 31 });
  const initial = packetizer.push(first);
  assert.equal(Buffer.concat(initial).length, 248);
  const following = packetizer.push(second);
  assert.deepEqual(following[0], Buffer.concat([first.subarray(248), second.subarray(0, 19)]));
  const { frames, stats } = feed([...initial, ...following, ...packetizer.flush()]);
  assert.deepEqual(frames.map(f => f.frame.sequence), [0, 1]);
  assert.equal(stats.crcFailures, 0);
});

test('real UDP: explicit ASM split and 128 body datagrams recover one frame', { timeout: 10000 }, async () => {
  const bytes = stream(1);
  const chunks = packetize(bytes, { minChunkBytes: 2, maxChunkBytes: 2 });
  const result = await overUdp(chunks, 1);
  assert.equal(result.frames[0].frame.sequence, 0);
  assert.equal(result.counters.udpDatagramsReceived, 130);
  assert.equal(result.counters.udpBytesReceived, 260);
  assert.equal(result.stats.crcFailures, 0);
  assert.equal(result.stats.formatFailures, 0);
});

test('real UDP: 100 clean frames survive seeded 1..96-byte datagrams in order', { timeout: 10000 }, async () => {
  const bytes = stream(100);
  const chunks = packetize(bytes, { seed: 42 });
  const result = await overUdp(chunks, 100);
  assert.deepEqual(result.frames.map(f => f.frame.sequence), Array.from({ length: 100 }, (_, i) => i));
  for (let i = 0; i < 100; i++) assert.deepEqual(result.frames[i].frame.telemetry, mockTelemetry(i));
  assert.equal(result.stats.crcFailures, 0);
  assert.equal(result.stats.formatFailures, 0);
  assert.equal(result.counters.udpDatagramsReceived, chunks.length);
  assert.equal(result.counters.udpBytesReceived, 26000);
});

test('real UDP: boundary mixing and multiple complete units in a datagram preserve order', { timeout: 10000 }, async () => {
  const bytes = stream(3);
  const chunks = [bytes.subarray(0, 250), bytes.subarray(250, 274), bytes.subarray(274)];
  const result = await overUdp(chunks, 3);
  assert.deepEqual(result.frames.map(f => f.frame.sequence), [0, 1, 2]);
  assert.equal(result.counters.udpDatagramsReceived, 3);
  assert.equal(result.stats.crcFailures, 0);
});

test('real UDP: partial candidate stays LOCK between messages until its last byte arrives', { timeout: 10000 }, async () => {
  const frames: SynchronizedFrame[] = [];
  const receiver = await startReceiver({ port: 0, onFrame: frame => frames.push(frame) });
  const sender = await createUdpSender('127.0.0.1', receiver.socket.address().port);
  try {
    const bytes = stream(1);
    await sender.send([bytes.subarray(0, 259)]);
    await waitFor(() => receiver.counters.udpDatagramsReceived === 1);
    assert.equal(receiver.synchronizer.state, 'LOCK');
    assert.equal(frames.length, 0);
    assert.equal(receiver.synchronizer.stats.crcFailures, 0);
    await sender.send([bytes.subarray(259)]);
    await waitFor(() => frames.length === 1);
    assert.equal(frames[0].frame.sequence, 0);
  } finally {
    await sender.close();
    await receiver.close();
  }
});

test('receiver reports bind conflicts and socket close is idempotent', { timeout: 10000 }, async () => {
  const receiver = await startReceiver({ port: 0 });
  try {
    await assert.rejects(startReceiver({ port: receiver.socket.address().port, onError: () => {} }), { code: 'EADDRINUSE' });
  } finally {
    await receiver.close();
    await receiver.close();
  }
});

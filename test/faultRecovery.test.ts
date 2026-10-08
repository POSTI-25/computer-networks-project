import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { startReceiver } from '../src/receiver/index.js';
import { Synchronizer, type SynchronizedFrame, type SyncTransition } from '../src/receiver/synchronizer.js';
import { MAX_BUFFER_BYTES } from '../src/receiver/bitBuffer.js';
import { BitstreamSimulator, type SimulatorOptions } from '../src/transmitter/bitstreamSimulator.js';
import { FrameBuilder, mockTelemetry } from '../src/transmitter/frameBuilder.js';
import { createUdpSender } from '../src/transmitter/index.js';
import { Packetizer, packetize } from '../src/transmitter/packetizer.js';
import { asm, bitsOf, packBits } from './bitHelpers.js';

// Exactly the live ordering; no flush between frames, no metadata to the receiver.
function impairedChunks(options: SimulatorOptions, count = 6) {
  const builder = new FrameBuilder();
  const simulator = new BitstreamSimulator(options);
  const packetizer = new Packetizer({ minChunkBytes: 1, maxChunkBytes: 16, seed: 42 });
  const chunks: Buffer[] = [];
  for (let i = 0; i < count; i++) chunks.push(...packetizer.push(simulator.push(builder.next())));
  chunks.push(...packetizer.push(simulator.flush()), ...packetizer.flush());
  return chunks;
}

function direct(chunks: Buffer[]) {
  const transitions: SyncTransition[] = [];
  const sync = new Synchronizer(event => transitions.push(event));
  const frames: SynchronizedFrame[] = [];
  for (const chunk of chunks) {
    frames.push(...sync.push(chunk));
    assert.ok(sync.stats.storageBytes <= MAX_BUFFER_BYTES);
  }
  return { frames, transitions, stats: sync.stats };
}

async function udp(chunks: Buffer[]) {
  const frames: SynchronizedFrame[] = [];
  const transitions: SyncTransition[] = [];
  const errors: Error[] = [];
  const receiver = await startReceiver({ port: 0, onFrame: frame => frames.push(frame),
    onTransition: event => transitions.push(event), onError: error => errors.push(error) });
  let sender: Awaited<ReturnType<typeof createUdpSender>> | undefined;
  try {
    sender = await createUdpSender('127.0.0.1', receiver.socket.address().port);
    await sender.send(chunks);
    const deadline = performance.now() + 5000;
    while (receiver.counters.udpDatagramsReceived < chunks.length) {
      if (performance.now() > deadline) throw new Error('UDP fault test timed out');
      await setTimeout(5);
    }
    assert.deepEqual(errors, []);
    assert.equal(receiver.counters.udpDatagramsReceived, chunks.length);
    assert.equal(receiver.counters.udpBytesReceived, chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    return { frames, transitions, stats: receiver.synchronizer.stats };
  } finally {
    await sender?.close();
    await receiver.close();
  }
}

function assertRecovery(result: ReturnType<typeof direct>, shift: number, count = 6) {
  assert.deepEqual(result.frames.map(f => f.frame.sequence), Array.from({ length: count }, (_, i) => i).filter(i => i !== 1));
  assert.equal(result.stats.validFrames, count - 1);
  assert.equal(result.stats.crcFailures, 1);
  assert.equal(result.stats.formatFailures, 0);
  assert.equal(result.stats.asmDetections, count);
  assert.equal(result.stats.resyncCount, 1);
  assert.equal(result.stats.bufferResets, 0);
  assert.ok(result.stats.storageBytes <= MAX_BUFFER_BYTES);
  assert.ok(result.stats.bufferedBits <= 31);
  const failureIndex = result.transitions.findIndex(event => event.reason === 'crc_failure');
  const failure = result.transitions[failureIndex];
  assert.equal(failure.from, 'VERIFY');
  assert.equal(failure.to, 'HUNT');
  assert.equal(failure.headBitOffset, 2080 + 1); // Failed ASM start + ONE, independent of slip.
  const reacquired = result.transitions.slice(failureIndex + 1).find(event => event.to === 'LOCK')!;
  assert.equal(reacquired.from, 'HUNT');
  assert.equal(reacquired.headBitOffset, 2 * 2080 + shift);
  assert.equal(reacquired.bitAlignment, (8 + shift) % 8);
  assert.equal(result.frames[0].bitAlignment, 0);
  for (const output of result.frames) {
    assert.equal(output.bitAlignment, output.frame.sequence === 0 ? 0 : (8 + shift) % 8);
    assert.deepEqual(output.frame.telemetry, mockTelemetry(output.frame.sequence));
    assert.equal(output.frame.crcValid, true);
  }
}

for (let offset = 1; offset <= 7; offset++) {
  for (const transport of ['direct', 'real UDP'] as const) {
    test(`${transport}: offset ${offset} acquires nonaligned ASM through 1..16-byte fragments`, { timeout: 10000 }, async () => {
      const chunks = impairedChunks({ mode: 'bit-offset', offsetBits: offset });
      const result = transport === 'direct' ? direct(chunks) : await udp(chunks);
      assert.deepEqual(result.frames.map(f => f.frame.sequence), [0, 1, 2, 3, 4, 5]);
      for (const frame of result.frames) {
        assert.equal(frame.bitAlignment, offset);
        assert.equal(frame.asmBitOffset, frame.frame.sequence * 2080 + offset);
        assert.deepEqual(frame.frame.telemetry, mockTelemetry(frame.frame.sequence));
      }
      assert.equal(result.stats.crcFailures, 0);
      assert.equal(result.stats.resyncCount, 0);
      assert.equal(result.stats.bufferResets, 0);
      assert.equal(result.transitions[0].from, 'HUNT');
      assert.equal(result.transitions[0].bitAlignment, offset);
    });
  }
}

for (const [mode, shift] of [['bit-flip', 0], ['bit-insert', 1], ['bit-delete', -1]] as const) {
  test(`direct: ${mode} rejects frame 1 and automatically recovers frames 2 and 3`, () => {
    assertRecovery(direct(impairedChunks({ mode, targetFrame: 1, bodyBitOffset: 80 }, 4)), shift, 4);
  });
  test(`real UDP: ${mode} plus tiny fragmentation rejects CRC and reacquires later intact ASM`, { timeout: 10000 }, async () => {
    const chunks = impairedChunks({ mode, targetFrame: 1, bodyBitOffset: 80 });
    assert.ok(chunks.length > 100);
    assert.ok(chunks.every(chunk => chunk.length >= 1 && chunk.length <= 16));
    assertRecovery(await udp(chunks), shift);
  });
}

test('recovers after bit-slip and reacquires ASM at new bit alignment', () => {
  const chunks = impairedChunks({ mode: 'bit-insert', targetFrame: 1, bodyBitOffset: 80 });
  // One receiver instance sees valid -> CRC failure -> HUNT at failed ASM+1 -> alignment 1.
  assertRecovery(direct(chunks), 1);
});

test('real UDP: false lock searches inside failed candidate instead of discarding whole unit', { timeout: 10000 }, async () => {
  const builder = new FrameBuilder();
  const bytes = packBits(bitsOf(asm()) + '101' + bitsOf(builder.next()) + bitsOf(builder.next()));
  const result = await udp(packetize(bytes, { minChunkBytes: 1, maxChunkBytes: 16 }));
  assert.deepEqual(result.frames.map(f => f.frame.sequence), [0, 1]);
  assert.equal(result.stats.crcFailures, 1);
  assert.equal(result.stats.resyncCount, 1);
  assert.equal(result.transitions.find(event => event.reason === 'crc_failure')!.headBitOffset, 1);
  assert.equal(result.frames[0].asmBitOffset, 35);
  assert.equal(result.frames[0].bitAlignment, 3);
});

test('long noise followed by slipped stream stays bounded and recovers without reset', () => {
  const sync = new Synchronizer();
  for (let i = 0; i < 256; i++) {
    assert.equal(sync.push(Buffer.alloc(4096, 0)).length, 0);
    assert.equal(sync.stats.bufferedBits, 31);
    assert.ok(sync.stats.storageBytes <= MAX_BUFFER_BYTES);
  }
  const outputs = impairedChunks({ mode: 'bit-delete', targetFrame: 1 }).flatMap(chunk => sync.push(chunk));
  assert.deepEqual(outputs.map(f => f.frame.sequence), [0, 2, 3, 4, 5]);
  assert.deepEqual(outputs.map(f => f.bitAlignment), [0, 7, 7, 7, 7]);
  assert.equal(sync.stats.crcFailures, 1);
  assert.equal(sync.stats.bufferResets, 0);
  assert.ok(sync.stats.storageBytes <= MAX_BUFFER_BYTES);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Synchronizer, type SyncTransition, type SynchronizedFrame } from '../src/receiver/synchronizer.js';
import { BitBuffer, BufferLimitError, MAX_BUFFER_BYTES } from '../src/receiver/bitBuffer.js';
import { crc16Ccitt } from '../src/shared/crc16.js';
import { decodeFrame, encodeFrame } from '../src/shared/frame.js';
import { asm, bitsOf, frame, packBits, unit } from './bitHelpers.js';

test('SYNC-1: clean aligned frame traverses all four explicit FSM states', () => {
  const transitions: SyncTransition[] = [];
  const sync = new Synchronizer(event => transitions.push(event));
  assert.equal(sync.state, 'HUNT');
  const output = sync.push(unit());
  assert.equal(output.length, 1);
  assert.equal(output[0].frame.sequence, 42);
  assert.equal(output[0].frame.crcValid, true);
  assert.equal(output[0].frame.formatValid, true);
  assert.equal(output[0].bitAlignment, 0);
  assert.equal(output[0].asmBitOffset, 0);
  assert.deepEqual(transitions.map(t => [t.from, t.to]), [
    ['HUNT', 'LOCK'], ['LOCK', 'VERIFY'], ['VERIFY', 'EXTRACT'], ['EXTRACT', 'HUNT'],
  ]);
  assert.equal(sync.stats.validFrames, 1);
  assert.equal(sync.stats.currentBitAlignment, null);
});

test('SYNC-2: ignores noise and reports the logical ASM position', () => {
  const sync = new Synchronizer();
  const output = sync.push(packBits('1101010010111' + bitsOf(unit())));
  assert.equal(output.length, 1);
  assert.equal(output[0].asmBitOffset, 13);
  assert.equal(output[0].bitAlignment, 5);
});

for (let alignment = 0; alignment < 8; alignment++) {
  test(`SYNC-3: recovers exact frame and telemetry at alignment ${alignment} with one-byte chunks`, () => {
    const sync = new Synchronizer();
    const bytes = packBits('1'.repeat(alignment) + bitsOf(unit()));
    const output: SynchronizedFrame[] = [];
    for (let i = 0; i < bytes.length; i++) output.push(...sync.push(bytes.subarray(i, i + 1)));
    assert.equal(output.length, 1);
    assert.deepEqual(output[0].frame, decodeFrame(frame()));
    assert.equal(output[0].bitAlignment, alignment);
    assert.equal(output[0].asmBitOffset, alignment);
    assert.equal(sync.stats.crcFailures, 0);
  });
}

test('SYNC-4: ASM split over four pushes persists until frame completion', () => {
  const sync = new Synchronizer();
  const bytes = unit();
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(sync.push(bytes.subarray(i, i + 1)), []);
    assert.equal(sync.state, i === 3 ? 'LOCK' : 'HUNT');
  }
  assert.equal(sync.stats.asmDetections, 1);
  assert.equal(sync.push(bytes.subarray(4)).length, 1);
});

test('SYNC-5: emits only when enough fragmented frame bytes have arrived', () => {
  const sync = new Synchronizer();
  const bytes = unit();
  let offset = 0;
  for (const size of [1, 2, 7, 3, 11, 19, 5, 31, 17, 29, 23, 37]) {
    assert.deepEqual(sync.push(bytes.subarray(offset, offset + size)), []);
    offset += size;
    assert.equal(sync.stats.crcFailures, 0);
  }
  assert.equal(sync.state, 'LOCK');
  assert.equal(sync.push(bytes.subarray(offset)).length, 1);
});

test('SYNC-6: CRC failure rejects the candidate and later reacquires without restart', () => {
  const transitions: SyncTransition[] = [];
  const sync = new Synchronizer(event => transitions.push(event));
  const corrupt = unit(1);
  corrupt[14] ^= 1;
  assert.deepEqual(sync.push(corrupt), []);
  assert.equal(sync.stats.crcFailures, 1);
  assert.equal(sync.stats.formatFailures, 0);
  assert.equal(sync.state, 'HUNT');
  assert.equal(sync.stats.resyncCount, 0);
  assert.equal(transitions.find(t => t.reason === 'crc_failure')?.headBitOffset, 1);
  const output = sync.push(unit(2));
  assert.deepEqual(output.map(f => f.frame.sequence), [2]);
  assert.equal(sync.stats.resyncCount, 1);
});

test('SYNC-7: false ASM in noise fails and a later true candidate is recovered', () => {
  const sync = new Synchronizer();
  const bytes = Buffer.concat([Buffer.alloc(17, 0xff), asm(), Buffer.alloc(256), Buffer.alloc(9, 0xff), unit(7)]);
  const output = sync.push(bytes);
  assert.deepEqual(output.map(f => f.frame.sequence), [7]);
  assert.equal(sync.stats.asmDetections, 2);
  assert.equal(sync.stats.crcFailures, 1);
  assert.equal(sync.stats.resyncCount, 1);
});

test('critical recovery: real ASM inside the failed candidate survives the one-bit restart', () => {
  const transitions: SyncTransition[] = [];
  const sync = new Synchronizer(event => transitions.push(event));
  // False ASM at bit 0, true ASM at bit 35 INSIDE the false 2080-bit candidate.
  const bytes = packBits(bitsOf(asm()) + '000' + bitsOf(unit(99)));
  assert.equal(decodeFrame(bytes.subarray(4, 260)).crcValid, false);
  assert.deepEqual(sync.push(bytes.subarray(0, 260)), []);
  assert.equal(sync.stats.crcFailures, 1);
  assert.equal(sync.state, 'LOCK');
  assert.equal(sync.stats.currentBitAlignment, 3);
  assert.equal(transitions.find(t => t.reason === 'crc_failure')?.headBitOffset, 1);
  assert.equal(transitions.filter(t => t.to === 'LOCK')[1].headBitOffset, 35);
  const output = sync.push(bytes.subarray(260));
  assert.deepEqual(output.map(f => f.frame.sequence), [99]);
  assert.equal(output[0].asmBitOffset, 35);
  assert.equal(sync.stats.resyncCount, 1);
});

test('SYNC-8: extracts consecutive frames in order with direct EXTRACT -> LOCK transitions', () => {
  const transitions: SyncTransition[] = [];
  const sync = new Synchronizer(event => transitions.push(event));
  const output = sync.push(Buffer.concat([unit(1), unit(2), unit(3)]));
  assert.deepEqual(output.map(f => f.frame.sequence), [1, 2, 3]);
  assert.deepEqual(output.map(f => f.asmBitOffset), [0, 2080, 4160]);
  assert.equal(transitions.filter(t => t.from === 'EXTRACT' && t.to === 'LOCK').length, 2);
  assert.equal(sync.stats.asmDetections, 3);
});

test('SYNC-9: incomplete candidate stays LOCK across empty and partial pushes', () => {
  const sync = new Synchronizer();
  const bytes = unit();
  assert.deepEqual(sync.push(bytes.subarray(0, 100)), []);
  assert.equal(sync.state, 'LOCK');
  assert.equal(sync.stats.bufferedBits, 800);
  assert.deepEqual(sync.push(Buffer.alloc(0)), []);
  assert.deepEqual(sync.push(bytes.subarray(100, 259)), []);
  assert.equal(sync.state, 'LOCK');
  assert.equal(sync.stats.crcFailures, 0);
  assert.equal(sync.stats.formatFailures, 0);
  assert.equal(sync.push(bytes.subarray(259)).length, 1);
});

test('SYNC-10: CRC-valid malformed length triggers format rejection and one-bit reacquisition', () => {
  const transitions: SyncTransition[] = [];
  const sync = new Synchronizer(event => transitions.push(event));
  const malformed = frame(1);
  malformed.writeUInt16BE(247, 4);
  malformed.writeUInt16BE(crc16Ccitt(malformed.subarray(0, 254)), 254);
  assert.equal(decodeFrame(malformed).crcValid, true);
  assert.deepEqual(sync.push(Buffer.concat([asm(), malformed])), []);
  assert.equal(sync.stats.formatFailures, 1);
  assert.equal(sync.stats.crcFailures, 0);
  assert.equal(sync.state, 'HUNT');
  assert.equal(transitions.find(t => t.reason === 'format_failure')?.headBitOffset, 1);
  assert.equal(sync.push(unit(2))[0].frame.sequence, 2);
  assert.equal(sync.stats.resyncCount, 1);
});

test('SYNC-11: long noise retains exactly 31 bits and bounded backing storage, then recovers', () => {
  const sync = new Synchronizer();
  const noise = Buffer.alloc(16 * 1024, 0xff);
  for (let i = 0; i < 64; i++) {
    assert.deepEqual(sync.push(noise), []);
    assert.equal(sync.state, 'HUNT');
    assert.equal(sync.stats.bufferedBits, 31);
    assert.ok(sync.stats.storageBytes <= MAX_BUFFER_BYTES);
  }
  assert.equal(sync.stats.asmDetections, 0);
  assert.equal(sync.stats.bufferResets, 0);
  const output = sync.push(unit());
  assert.equal(output.length, 1);
  assert.equal(output[0].asmBitOffset, 64 * noise.length * 8);
  assert.equal(output[0].bitAlignment, 0);
});

test('tail retention preserves an ASM whose first bit was in the preceding push', () => {
  const sync = new Synchronizer();
  const bytes = packBits('1'.repeat(31) + bitsOf(unit()));
  assert.deepEqual(sync.push(bytes.subarray(0, 4)), []);
  assert.equal(sync.stats.bufferedBits, 31);
  const output = sync.push(bytes.subarray(4));
  assert.equal(output[0].asmBitOffset, 31);
  assert.equal(output[0].bitAlignment, 7);
});

test('alignment remains relative to stream origin after compaction and inter-frame noise', () => {
  const sync = new Synchronizer();
  const noise = Buffer.alloc(6000, 0xff);
  assert.deepEqual(sync.push(noise), []);
  const output = sync.push(packBits('111' + bitsOf(unit(1)) + '11111' + bitsOf(unit(2))));
  assert.deepEqual(output.map(f => f.bitAlignment), [3, 0]);
  assert.deepEqual(output.map(f => f.asmBitOffset), [48003, 50088]);
  assert.equal(sync.stats.resyncCount, 0); // Noise alone is not failed-candidate reacquisition.
});

test('large single push over 64 KiB recovers all frames without crossing the storage cap', () => {
  const sync = new Synchronizer();
  const bytes = Buffer.concat(Array.from({ length: 300 }, (_, i) => unit(i)));
  assert.ok(bytes.length > MAX_BUFFER_BYTES);
  const output = sync.push(bytes);
  assert.deepEqual(output.map(f => f.frame.sequence), Array.from({ length: 300 }, (_, i) => i));
  assert.equal(sync.stats.crcFailures, 0);
  assert.equal(sync.stats.bufferResets, 0);
  assert.ok(sync.stats.storageBytes <= MAX_BUFFER_BYTES);
});

test('100 clean frames survive an explicit reproducible schedule of 1..96-byte chunks', () => {
  const sync = new Synchronizer();
  const bytes = Buffer.concat(Array.from({ length: 100 }, (_, i) => unit(i)));
  const output: SynchronizedFrame[] = [];
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    const size = (index++ * 17) % 96 + 1;
    output.push(...sync.push(bytes.subarray(offset, offset + size)));
    offset += size;
  }
  assert.deepEqual(output.map(f => f.frame.sequence), Array.from({ length: 100 }, (_, i) => i));
  assert.equal(sync.stats.crcFailures, 0);
  assert.equal(sync.stats.formatFailures, 0);
});

test('resyncCount records one reacquisition per failed candidate, including another false lock', () => {
  const sync = new Synchronizer();
  const bad = Buffer.concat([asm(), Buffer.alloc(256)]);
  assert.deepEqual(sync.push(bad), []);
  assert.equal(sync.stats.resyncCount, 0);
  assert.deepEqual(sync.push(bad), []);
  assert.equal(sync.stats.resyncCount, 1);
  assert.equal(sync.push(unit()).length, 1);
  assert.equal(sync.stats.resyncCount, 2);
  assert.equal(sync.stats.crcFailures, 2);
});

test('short meaningful payload remains a valid frame without invented telemetry', () => {
  const sync = new Synchronizer();
  const output = sync.push(Buffer.concat([asm(), encodeFrame({ sequence: 1, flags: 17, payload: Buffer.from([5]) })]));
  assert.equal(output.length, 1);
  assert.equal(output[0].frame.flags, 17);
  assert.equal(output[0].frame.payloadLength, 1);
  assert.equal(output[0].frame.telemetry, undefined);
  assert.deepEqual(output[0].frame.payload, Buffer.from([5]));
});

test('statistics snapshots cannot mutate synchronizer counters', () => {
  const sync = new Synchronizer();
  sync.push(unit());
  const stats = sync.stats;
  stats.validFrames = 99;
  assert.equal(sync.stats.validFrames, 1);
});

test('defensive capacity fault abandons an incomplete candidate and recovers in the current batch', t => {
  const originalAppend = BitBuffer.prototype.append;
  let appends = 0;
  // Normal processing cannot fill 64 KiB; inject a capacity failure at the public
  // buffer boundary to verify the safeguard without modifying private FSM state.
  t.mock.method(BitBuffer.prototype, 'append', function (this: BitBuffer, data: Buffer) {
    if (++appends === 2) throw new BufferLimitError();
    originalAppend.call(this, data);
  });
  const transitions: SyncTransition[] = [];
  const sync = new Synchronizer(event => transitions.push(event));
  const partial = packBits('111' + bitsOf(unit(1))).subarray(0, 10);
  assert.deepEqual(sync.push(partial), []);
  assert.equal(sync.state, 'LOCK');
  const output = sync.push(unit(2));
  assert.deepEqual(output.map(f => f.frame.sequence), [2]);
  assert.equal(output[0].asmBitOffset, 80);
  assert.equal(output[0].bitAlignment, 0);
  assert.equal(sync.stats.bufferResets, 1);
  assert.equal(sync.stats.crcFailures, 0);
  const reset = transitions.find(event => event.reason === 'buffer_limit');
  assert.equal(reset?.from, 'LOCK');
  assert.equal(reset?.to, 'HUNT');
  assert.equal(reset?.headBitOffset, 80);
});

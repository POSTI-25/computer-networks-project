import assert from 'node:assert/strict';
import test from 'node:test';
import { packetize, Packetizer } from '../src/transmitter/packetizer.js';

const data = Buffer.from(Array.from({ length: 4096 }, (_, i) => i & 255));

test('PACKET-1: concatenate packetized bytes to recover the exact source', () => {
  assert.deepEqual(Buffer.concat(packetize(data)), data);
});

test('PACKET-2: same seed and bounds produce identical boundaries and bytes', () => {
  const options = { seed: 42, minChunkBytes: 1, maxChunkBytes: 96 };
  assert.deepEqual(packetize(data, options), packetize(data, options));
});

test('PACKET-3: fixed different seeds produce different schedules with exact reassembly', () => {
  const first = packetize(data, { seed: 42 });
  const second = packetize(data, { seed: 43 });
  assert.notDeepEqual(first.map(chunk => chunk.length), second.map(chunk => chunk.length));
  assert.deepEqual(Buffer.concat(second), data);
});

test('PACKET-4: bounds hold and a finite final tail may be shorter than min', () => {
  const chunks = packetize(data, { minChunkBytes: 17, maxChunkBytes: 37 });
  for (const chunk of chunks.slice(0, -1)) assert.ok(chunk.length >= 17 && chunk.length <= 37);
  assert.ok(chunks.at(-1)!.length >= 1 && chunks.at(-1)!.length <= 37);
  assert.deepEqual(packetize(Buffer.alloc(23), { minChunkBytes: 10, maxChunkBytes: 10 }).map(c => c.length), [10, 10, 3]);
});

test('PACKET-5: tiny 1..3 byte chunks preserve the complete stream', () => {
  const chunks = packetize(data, { minChunkBytes: 1, maxChunkBytes: 3 });
  assert.ok(chunks.every(chunk => chunk.length >= 1 && chunk.length <= 3));
  assert.deepEqual(Buffer.concat(chunks), data);
});

test('streaming append boundaries do not change seeded packetization', () => {
  const streaming = new Packetizer({ seed: 42 });
  const chunks: Buffer[] = [];
  for (let i = 0; i < data.length; i += 7) chunks.push(...streaming.push(data.subarray(i, i + 7)));
  chunks.push(...streaming.flush());
  assert.deepEqual(chunks, packetize(data, { seed: 42 }));
  assert.deepEqual(streaming.flush(), []);
});

test('seed zero and uint32 maximum are deterministic valid seeds', () => {
  for (const seed of [0, 0xffffffff]) {
    assert.deepEqual(packetize(data, { seed }), packetize(data, { seed }));
    assert.deepEqual(Buffer.concat(packetize(data, { seed })), data);
  }
});

test('invalid chunk bounds and seeds fail before packetization', () => {
  for (const options of [
    { minChunkBytes: 0 }, { minChunkBytes: -1 }, { minChunkBytes: 1.5 },
    { minChunkBytes: 10, maxChunkBytes: 9 }, { maxChunkBytes: NaN }, { maxChunkBytes: Infinity },
    { seed: -1 }, { seed: 0x100000000 }, { seed: 1.5 }, { seed: NaN },
  ]) assert.throws(() => new Packetizer(options), RangeError);
});

test('empty input produces no datagrams and packetized storage does not alias input', () => {
  assert.deepEqual(packetize(Buffer.alloc(0)), []);
  const source = Buffer.from([1, 2, 3, 4, 5]);
  const packetizer = new Packetizer({ minChunkBytes: 3, maxChunkBytes: 3 });
  const chunks = packetizer.push(source);
  source.fill(0);
  chunks.push(...packetizer.flush());
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([1, 2, 3, 4, 5]));
});

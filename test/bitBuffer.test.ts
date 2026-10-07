import assert from 'node:assert/strict';
import test from 'node:test';
import { BitBuffer, BufferLimitError, MAX_BUFFER_BYTES } from '../src/receiver/bitBuffer.js';
import { ASM_VALUE } from '../src/shared/constants.js';
import { asm, bitsOf, frame, packBits } from './bitHelpers.js';

function readAll(buffer: BitBuffer): string {
  let bits = '';
  for (let offset = 0; offset < buffer.availableBits(); offset++) bits += buffer.readBit(offset);
  return bits;
}

test('BITBUF-1: reads 0x80 and 0x01 MSB-first', () => {
  const buffer = new BitBuffer();
  buffer.append(Buffer.from([0x80, 0x01]));
  assert.equal(buffer.availableBits(), 16);
  assert.equal(readAll(buffer), '1000000000000001');
});

test('BITBUF-2: a three-bit discard advances the logical head exactly', () => {
  const buffer = new BitBuffer();
  buffer.append(Buffer.from([0xad, 0x83]));
  buffer.discardBits(3);
  assert.equal(buffer.availableBits(), 13);
  assert.equal(readAll(buffer), '0110110000011');
});

test('BITBUF-3: append preserves residual bits after a nonaligned discard', () => {
  const buffer = new BitBuffer();
  buffer.append(Buffer.from([0xab]));
  buffer.discardBits(3);
  buffer.append(Buffer.from([0xcd, 0xef]));
  assert.equal(readAll(buffer), '010111100110111101111');
});

test('BITBUF-4: matches byte-aligned ASM and rejects a different value', () => {
  const buffer = new BitBuffer();
  buffer.append(asm());
  assert.equal(buffer.match32(0, ASM_VALUE), true);
  assert.equal(buffer.match32(0, ASM_VALUE ^ 1), false);
});

for (let alignment = 0; alignment < 8; alignment++) {
  test(`BITBUF-5: ASM matching at alignment ${alignment}, larger offset, and shifted head`, () => {
    const buffer = new BitBuffer();
    const prefix = '0'.repeat(80 + alignment);
    buffer.append(packBits(prefix + bitsOf(asm()) + '11111111'));
    assert.equal(buffer.match32(prefix.length, ASM_VALUE), true);
    buffer.discardBits(19);
    buffer.compactIfNeeded();
    assert.equal(buffer.match32(prefix.length - 19, ASM_VALUE), true);
  });
  test(`BITBUF-6: extracts exactly 256 bytes at alignment ${alignment}`, () => {
    const original = frame();
    const buffer = new BitBuffer();
    buffer.append(packBits('1'.repeat(alignment) + bitsOf(original)));
    assert.deepEqual(buffer.sliceBitsToBuffer(alignment, 2048), original);
    if (alignment > 0) {
      buffer.discardBits(alignment);
      assert.deepEqual(buffer.sliceBitsToBuffer(0, 2048), original);
    }
  });
}

test('BITBUF-7: nonaligned ASM spans successive appends', () => {
  const buffer = new BitBuffer();
  const bytes = packBits('101' + bitsOf(asm()));
  buffer.append(bytes.subarray(0, 2));
  assert.throws(() => buffer.match32(3, ASM_VALUE), RangeError);
  buffer.append(bytes.subarray(2));
  assert.equal(buffer.match32(3, ASM_VALUE), true);
});

test('BITBUF-8: compaction preserves a partial byte, extraction, and subsequent append', () => {
  const buffer = new BitBuffer();
  const bytes = Buffer.alloc(5000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 17) & 255;
  buffer.append(bytes);
  buffer.discardBits(4096 * 8 + 3);
  const expected = bitsOf(bytes.subarray(4096)).slice(3);
  buffer.compactIfNeeded();
  assert.equal(readAll(buffer), expected);
  assert.deepEqual(buffer.sliceBitsToBuffer(0, 7200), packBits(expected.slice(0, 7200)));
  buffer.append(Buffer.from([0xab]));
  assert.equal(readAll(buffer), expected + '10101011');
});

test('invalid reads, matches, extractions, and discards fail clearly', () => {
  const buffer = new BitBuffer();
  buffer.append(Buffer.alloc(5));
  for (const offset of [-1, 40, 0.5, NaN, Infinity]) assert.throws(() => buffer.readBit(offset), RangeError);
  for (const offset of [-1, 9, 0.5]) assert.throws(() => buffer.match32(offset, ASM_VALUE), RangeError);
  for (const value of [-1, 0x100000000, NaN, 0.5]) assert.throws(() => buffer.match32(0, value), RangeError);
  for (const length of [-1, 41, 7, 0.5, NaN]) {
    assert.throws(() => buffer.sliceBitsToBuffer(0, length), RangeError);
  }
  assert.throws(() => buffer.sliceBitsToBuffer(33, 8), RangeError);
  for (const count of [-1, 41, 0.5, NaN, Infinity]) assert.throws(() => buffer.discardBits(count), RangeError);
  assert.equal(buffer.availableBits(), 40);
});

test('uint32 matching handles the sign bit without signed comparison errors', () => {
  const buffer = new BitBuffer();
  buffer.append(packBits('111' + bitsOf(Buffer.from([0xff, 0x80, 0xaa, 0x55]))));
  assert.equal(buffer.match32(3, 0xff80aa55), true);
});

test('empty operations and a fully consumed buffer can be reused', () => {
  const buffer = new BitBuffer();
  buffer.append(Buffer.alloc(0));
  buffer.discardBits(0);
  buffer.compactIfNeeded();
  assert.deepEqual(buffer.sliceBitsToBuffer(0, 0), Buffer.alloc(0));
  assert.throws(() => buffer.readBit(0), RangeError);
  buffer.append(Buffer.from([0x55]));
  buffer.discardBits(8);
  buffer.append(Buffer.from([0xaa]));
  assert.equal(readAll(buffer), '10101010');
});

test('appended and extracted bytes are owned copies', () => {
  const buffer = new BitBuffer();
  const source = Buffer.from([0xa5, 0x5a]);
  buffer.append(source);
  source.fill(0);
  const extracted = buffer.sliceBitsToBuffer(0, 16);
  assert.deepEqual(extracted, Buffer.from([0xa5, 0x5a]));
  extracted.fill(0);
  assert.equal(readAll(buffer), '1010010101011010');
});

test('64 KiB cap rejects excess input without losing already buffered data', () => {
  const buffer = new BitBuffer();
  buffer.append(Buffer.alloc(MAX_BUFFER_BYTES, 0xaa));
  assert.equal(buffer.storageBytes, MAX_BUFFER_BYTES);
  assert.throws(() => buffer.append(Buffer.from([1])), BufferLimitError);
  assert.equal(buffer.availableBits(), MAX_BUFFER_BYTES * 8);
  assert.equal(buffer.readBit(0), 1);
  buffer.discardBits(MAX_BUFFER_BYTES * 8 - 3);
  buffer.compactIfNeeded();
  buffer.append(Buffer.from([0x55]));
  assert.equal(readAll(buffer), '01001010101');
});

test('many tiny appends use bounded geometric storage and preserve every byte', () => {
  const buffer = new BitBuffer();
  const expected = Buffer.alloc(4096);
  for (let i = 0; i < expected.length; i++) {
    expected[i] = i & 255;
    buffer.append(Buffer.from([expected[i]]));
  }
  assert.deepEqual(buffer.sliceBitsToBuffer(0, expected.length * 8), expected);
  assert.ok(buffer.storageBytes <= 8192);
});

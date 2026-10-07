import assert from 'node:assert/strict';
import test from 'node:test';
import { crc16Ccitt } from '../src/shared/crc16.js';

test('CRC-1: ASCII 123456789 produces the fixed check value 0x29B1', () => {
  assert.equal(crc16Ccitt(Buffer.from('123456789', 'ascii')), 0x29b1);
});

test('CRC-2: repeated calls are deterministic and leave input unchanged', () => {
  const data = Buffer.from([0x00, 0x80, 0xff, 0x01, 0x7f]);
  const original = Buffer.from(data);
  const expected = crc16Ccitt(data);
  for (let repeat = 0; repeat < 10; repeat++) assert.equal(crc16Ccitt(data), expected);
  assert.deepEqual(data, original);
  assert.ok(Number.isInteger(expected) && expected >= 0 && expected <= 0xffff);
});

test('CRC-3: a selected single-bit mutation changes the checksum', () => {
  const data = Buffer.from('123456789', 'ascii');
  const mutated = Buffer.from(data);
  mutated[4] ^= 0x01;
  assert.notEqual(crc16Ccitt(mutated), crc16Ccitt(data));
});

test('empty CRC input preserves the all-ones initial value', () => {
  assert.equal(crc16Ccitt(Buffer.alloc(0)), 0xffff);
});

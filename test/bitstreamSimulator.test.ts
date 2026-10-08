import assert from 'node:assert/strict';
import test from 'node:test';
import { BitstreamSimulator, parseSimulatorArgs, type SimulatorOptions } from '../src/transmitter/bitstreamSimulator.js';
import { buildTransmissionUnit } from '../src/transmitter/frameBuilder.js';
import { decodeFrame } from '../src/shared/frame.js';
import { bitsOf } from './bitHelpers.js';

const input = Buffer.concat([0, 1, 2, 3].map(buildTransmissionUnit));
const cleanBits = bitsOf(input);
const target = 2080 + 32 + 80;

function simulate(options: SimulatorOptions, chunks: Buffer[] = [input]) {
  const simulator = new BitstreamSimulator(options);
  const bytes = Buffer.concat([...chunks.map(chunk => simulator.push(chunk)), simulator.flush()]);
  return { bytes, length: simulator.outputBitLength, bits: bitsOf(bytes).slice(0, simulator.outputBitLength) };
}

test('SIM-1 clean identity preserves input and bit length', () => {
  const before = Buffer.from(input);
  const result = simulate({ mode: 'clean' });
  assert.deepEqual(result.bytes, input);
  assert.equal(result.length, input.length * 8);
  assert.deepEqual(input, before);
});

for (let offset = 1; offset <= 7; offset++) {
  test(`SIM-2 prefixes exactly ${offset} bits without modifying stream`, () => {
    const result = simulate({ mode: 'bit-offset', offsetBits: offset });
    assert.equal(result.bits, '1010101'.slice(0, offset) + cleanBits);
    assert.equal(result.length, input.length * 8 + offset);
    assert.equal(bitsOf(result.bytes).slice(result.length), '0'.repeat(8 - offset));
  });
}

test('SIM-3 flips exactly the chosen body bit, preserves ASM and stored CRC', () => {
  const result = simulate({ mode: 'bit-flip', targetFrame: 1, bodyBitOffset: 80 });
  assert.equal(result.length, cleanBits.length);
  assert.equal(result.bits, cleanBits.slice(0, target) + (cleanBits[target] === '0' ? '1' : '0') + cleanBits.slice(target + 1));
  assert.deepEqual(result.bytes.subarray(260, 264), input.subarray(260, 264));
  assert.deepEqual(result.bytes.subarray(518, 520), input.subarray(518, 520));
  assert.equal(decodeFrame(result.bytes.subarray(264, 520)).crcValid, false);
});

for (const insertedBit of [0, 1] as const) {
  test(`SIM-4 inserts exactly ${insertedBit} before target and shifts every following bit`, () => {
    const result = simulate({ mode: 'bit-insert', targetFrame: 1, bodyBitOffset: 80, insertedBit });
    assert.equal(result.length, cleanBits.length + 1);
    assert.equal(result.bits, cleanBits.slice(0, target) + insertedBit + cleanBits.slice(target));
  });
}

test('SIM-5 deletes exactly the original target bit and shifts all following bits', () => {
  const result = simulate({ mode: 'bit-delete', targetFrame: 1, bodyBitOffset: 80 });
  assert.equal(result.length, cleanBits.length - 1);
  assert.equal(result.bits, cleanBits.slice(0, target) + cleanBits.slice(target + 1));
});

for (const mode of ['clean', 'bit-offset', 'bit-flip', 'bit-insert', 'bit-delete', 'bit-slip'] as const) {
  test(`SIM-6 ${mode} is deterministic and independent of upstream byte chunks`, () => {
    const options = { mode, targetFrame: 1, bodyBitOffset: 80 };
    const expected = simulate(options);
    assert.deepEqual(simulate(options), expected);
    const oneByteChunks = Array.from(input, byte => Buffer.from([byte]));
    assert.deepEqual(simulate(options, oneByteChunks), expected);
    const frames = [0, 1, 2, 3].map(buildTransmissionUnit);
    assert.deepEqual(simulate(options, frames), expected);
  });
}

test('carry persists across frame calls; empty pushes do not start prefix; flush is terminal and idempotent', () => {
  const simulator = new BitstreamSimulator({ mode: 'bit-offset' });
  assert.equal(simulator.push(Buffer.alloc(0)).length, 0);
  assert.equal(simulator.outputBitLength, 0);
  const chunks: Buffer[] = [];
  for (let i = 0; i < 4; i++) {
    chunks.push(simulator.push(buildTransmissionUnit(i)));
    assert.equal(simulator.pendingBits, 3);
    assert.equal(simulator.outputBitLength, (i + 1) * 2080 + 3);
  }
  chunks.push(simulator.flush());
  assert.equal(simulator.pendingBits, 0);
  assert.deepEqual(Buffer.concat(chunks), simulate({ mode: 'bit-offset' }).bytes);
  assert.equal(simulator.flush().length, 0);
  assert.throws(() => simulator.push(input), /after simulator flush/);
});

test('default fault targets frame index 5 body bit 80, bit-slip aliases insertion', () => {
  const simulator = new BitstreamSimulator({ mode: 'bit-slip' });
  assert.equal(simulator.mode, 'bit-insert');
  assert.equal(simulator.targetFrame, 5);
  assert.equal(simulator.bodyBitOffset, 80);
  assert.equal(simulator.offsetBits, 3);
  assert.deepEqual(simulate({ mode: 'bit-slip', targetFrame: 1 }), simulate({ mode: 'bit-insert', targetFrame: 1 }));
  assert.deepEqual(simulate({ mode: 'bit-flip', targetFrame: 100 }).bytes, input);
});

test('CLI parses minimal deterministic flags and rejects invalid configuration before networking', () => {
  assert.deepEqual(parseSimulatorArgs(['--mode', 'bit-delete', '--target-frame', '1', '--body-bit', '80']),
    { mode: 'bit-delete', targetFrame: 1, bodyBitOffset: 80 });
  assert.deepEqual(parseSimulatorArgs(['--mode', 'bit-offset', '--offset', '7']), { mode: 'bit-offset', offsetBits: 7 });
  assert.deepEqual(parseSimulatorArgs([]), {});
  assert.throws(() => parseSimulatorArgs(['--mode']), /Missing value/);
  assert.throws(() => parseSimulatorArgs(['--offset', '--mode']), /Missing value/);
  assert.throws(() => parseSimulatorArgs(['--unknown', '1']), /Unknown option/);
  for (const options of [
    { mode: 'unknown' }, { offsetBits: 0 }, { offsetBits: 8 }, { offsetBits: 1.5 },
    { targetFrame: -1 }, { targetFrame: Number.MAX_SAFE_INTEGER }, { targetFrame: NaN },
    { bodyBitOffset: -1 }, { bodyBitOffset: 2032 }, { bodyBitOffset: 0.5 }, { insertedBit: 2 },
  ]) assert.throws(() => new BitstreamSimulator(options as SimulatorOptions), RangeError);
});

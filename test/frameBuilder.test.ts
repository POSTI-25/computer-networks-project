import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFrame } from '../src/shared/frame.js';
import { buildTransmissionUnit, FrameBuilder, mockTelemetry } from '../src/transmitter/frameBuilder.js';

test('builder prepends exact ASM outside the 256-byte valid body', () => {
  const unit = buildTransmissionUnit(42);
  assert.equal(unit.length, 260);
  assert.deepEqual(unit.subarray(0, 4), Buffer.from([0x1a, 0xcf, 0xfc, 0x1d]));
  const decoded = decodeFrame(unit.subarray(4));
  assert.equal(decoded.sequence, 42);
  assert.equal(decoded.payloadLength, 12);
  assert.equal(decoded.flags, 0);
  assert.equal(decoded.crcValid, true);
  assert.equal(decoded.formatValid, true);
  assert.deepEqual(decoded.telemetry, { temperatureC: 24.42, batteryMv: 7418, altitudeM: 520042, uptimeSeconds: 42 });
});

test('frame generator starts at zero and advances exactly once per generated unit', () => {
  const builder = new FrameBuilder();
  for (let sequence = 0; sequence < 100; sequence++) {
    assert.equal(builder.nextSequence, sequence);
    assert.equal(decodeFrame(builder.next().subarray(4)).sequence, sequence);
  }
  assert.equal(builder.nextSequence, 100);
});

test('generated sequences wrap from uint32 maximum to zero', () => {
  const builder = new FrameBuilder(0xffffffff);
  assert.equal(decodeFrame(builder.next().subarray(4)).sequence, 0xffffffff);
  assert.equal(decodeFrame(builder.next().subarray(4)).sequence, 0);
  assert.equal(decodeFrame(builder.next().subarray(4)).sequence, 1);
});

test('mock telemetry remains deterministic and fits wire fields throughout sequence range', () => {
  for (const sequence of [0, 1, 99, 100, 0x80000000, 0xffffffff]) {
    assert.deepEqual(buildTransmissionUnit(sequence), buildTransmissionUnit(sequence));
    assert.deepEqual(decodeFrame(buildTransmissionUnit(sequence).subarray(4)).telemetry, mockTelemetry(sequence));
  }
});

test('invalid initial sequence values are rejected', () => {
  for (const sequence of [-1, 0x100000000, 0.5, NaN, Infinity]) assert.throws(() => new FrameBuilder(sequence), RangeError);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as constants from '../src/shared/constants.js';
import { crc16Ccitt } from '../src/shared/crc16.js';
import { decodeFrame, decodeTelemetry, encodeFrame, encodeTelemetry, validateFrame } from '../src/shared/frame.js';
import type { TelemetryPayload } from '../src/shared/types.js';

const telemetry: TelemetryPayload = {
  temperatureC: 24.37, batteryMv: 7420, altitudeM: 520000, uptimeSeconds: 1800,
};

function demoFrame(sequence = 42): Buffer {
  return encodeFrame({ sequence, payload: encodeTelemetry(telemetry) });
}

test('protocol constants match the fixed PRD layout', () => {
  const expected = {
    ASM_VALUE: 0x1acffc1d, ASM_SIZE_BYTES: 4, ASM_SIZE_BITS: 32,
    FRAME_SIZE_BYTES: 256, FRAME_SIZE_BITS: 2048,
    TRANSMISSION_UNIT_SIZE_BYTES: 260, TRANSMISSION_UNIT_SIZE_BITS: 2080,
    SEQUENCE_OFFSET: 0, SEQUENCE_SIZE: 4,
    PAYLOAD_LENGTH_OFFSET: 4, PAYLOAD_LENGTH_SIZE: 2,
    FLAGS_OFFSET: 6, FLAGS_SIZE: 2, PAYLOAD_OFFSET: 8, PAYLOAD_CAPACITY: 246,
    CRC_OFFSET: 254, CRC_SIZE: 2, DEFAULT_PAYLOAD_LENGTH: 12,
    TEMPERATURE_OFFSET: 0, BATTERY_OFFSET: 2, ALTITUDE_OFFSET: 4, UPTIME_OFFSET: 8,
    CRC_POLYNOMIAL: 0x1021, CRC_INITIAL_VALUE: 0xffff, CRC_FINAL_XOR: 0,
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(constants[name as keyof typeof constants], value, name);
  }
});

test('FRAME-1: encoded body is exactly 256 bytes with no prepended ASM', () => {
  const frame = demoFrame();
  assert.equal(frame.length, 256);
  assert.equal(frame.readUInt32BE(0), 42);
});

test('FRAME-2: header fields and CRC occupy the exact PRD offsets', () => {
  const frame = encodeFrame({ sequence: 0x12345678, flags: 0xabcd, payload: Buffer.from([9, 8, 7]) });
  assert.equal(frame.readUInt32BE(0), 0x12345678);
  assert.equal(frame.readUInt16BE(4), 3);
  assert.equal(frame.readUInt16BE(6), 0xabcd);
  assert.deepEqual(frame.subarray(8, 11), Buffer.from([9, 8, 7]));
  assert.equal(frame.readUInt16BE(254), crc16Ccitt(frame.subarray(0, 254)));
  assert.equal(decodeFrame(frame).flags, 0xabcd);
});

test('FRAME-3: recognizable sequence is written in network byte order', () => {
  assert.deepEqual(demoFrame(0x01020304).subarray(0, 4), Buffer.from([1, 2, 3, 4]));
});

test('FRAME-4: meaningful telemetry occupies bytes 8..19 and padding is zero', () => {
  const frame = demoFrame();
  assert.equal(frame.readUInt16BE(4), 12);
  assert.equal(frame.readUInt16BE(6), 0);
  assert.deepEqual(frame.subarray(8, 20), Buffer.from('09851cfc0007ef4000000708', 'hex'));
  assert.deepEqual(frame.subarray(20, 254), Buffer.alloc(234));
});

test('FRAME-5: CRC is big-endian at bytes 254..255 and excludes its own field', () => {
  const frame = demoFrame();
  const expected = crc16Ccitt(frame.subarray(0, 254));
  assert.equal(frame[254], expected >>> 8);
  assert.equal(frame[255], expected & 0xff);
  const before = Buffer.from(frame.subarray(0, 254));
  frame[254] ^= 1;
  const validation = validateFrame(frame);
  assert.equal(validation.calculatedCrc, expected);
  assert.equal(validation.crcValid, false);
  assert.deepEqual(frame.subarray(0, 254), before);
});

test('FRAME-6: known frame round-trips all header and telemetry values', () => {
  const decoded = decodeFrame(demoFrame());
  assert.equal(decoded.sequence, 42);
  assert.equal(decoded.payloadLength, 12);
  assert.equal(decoded.flags, 0);
  assert.deepEqual(decoded.payload, encodeTelemetry(telemetry));
  assert.deepEqual(decoded.telemetry, telemetry);
});

test('FRAME-7: clean frame has valid CRC and format', () => {
  const frame = demoFrame();
  const decoded = decodeFrame(frame);
  assert.equal(decoded.crcValid, true);
  assert.equal(decoded.formatValid, true);
  assert.equal(decoded.storedCrc, decoded.calculatedCrc);
  assert.deepEqual(validateFrame(frame), {
    storedCrc: decoded.storedCrc, calculatedCrc: decoded.calculatedCrc,
    crcValid: true, formatValid: true,
  });
});

test('FRAME-8: selected header, telemetry, and padding bit flips fail CRC', () => {
  for (const offset of [0, 4, 6, 8, 19, 20, 253]) {
    const frame = demoFrame();
    const storedCrc = frame.readUInt16BE(254);
    frame[offset] ^= 1;
    const decoded = decodeFrame(frame);
    assert.equal(decoded.storedCrc, storedCrc);
    assert.equal(decoded.crcValid, false, `byte ${offset}`);
    assert.equal(decoded.telemetry, undefined);
  }
});

test('FRAME-9: encoder rejects over-capacity payloads; decoder flags bad lengths even with valid CRC', () => {
  assert.throws(() => encodeFrame({ sequence: 0, payload: Buffer.alloc(247) }), RangeError);
  for (const length of [247, 65535]) {
    const frame = demoFrame();
    frame.writeUInt16BE(length, 4);
    frame.writeUInt16BE(crc16Ccitt(frame.subarray(0, 254)), 254);
    const decoded = decodeFrame(frame);
    assert.equal(decoded.payloadLength, length);
    assert.equal(decoded.crcValid, true);
    assert.equal(decoded.formatValid, false);
    assert.equal(decoded.payload.length, 0);
    assert.equal(decoded.telemetry, undefined);
    assert.equal(validateFrame(frame).formatValid, false);
  }
});

test('FRAME-10: sequences 0, 1, and uint32 maximum round-trip', () => {
  for (const sequence of [0, 1, 0xffffffff]) {
    assert.equal(decodeFrame(demoFrame(sequence)).sequence, sequence);
  }
});

test('FRAME-11: negative temperature uses signed int16 centi-degrees', () => {
  const cold = { ...telemetry, temperatureC: -12.34 };
  const payload = encodeTelemetry(cold);
  assert.equal(payload.readInt16BE(0), -1234);
  assert.deepEqual(payload.subarray(0, 2), Buffer.from([0xfb, 0x2e]));
  assert.deepEqual(decodeFrame(encodeFrame({ sequence: 0, payload })).telemetry, cold);
});

test('telemetry helper uses exact big-endian bytes and ignores extension bytes', () => {
  const payload = encodeTelemetry(telemetry);
  assert.equal(payload.length, 12);
  assert.deepEqual(payload, Buffer.from('09851cfc0007ef4000000708', 'hex'));
  assert.deepEqual(decodeTelemetry(Buffer.concat([payload, Buffer.from([255])])), telemetry);
});

test('temperature rounds to centi-degree precision', () => {
  assert.equal(decodeTelemetry(encodeTelemetry({ ...telemetry, temperatureC: 24.376 })).temperatureC, 24.38);
  assert.equal(decodeTelemetry(encodeTelemetry({ ...telemetry, temperatureC: -12.346 })).temperatureC, -12.35);
});

test('telemetry wire-type minimum and maximum values round-trip', () => {
  for (const values of [
    { temperatureC: -327.68, batteryMv: 0, altitudeM: 0, uptimeSeconds: 0 },
    { temperatureC: 327.67, batteryMv: 65535, altitudeM: 0xffffffff, uptimeSeconds: 0xffffffff },
  ]) assert.deepEqual(decodeTelemetry(encodeTelemetry(values)), values);
});

test('invalid sequence and flags reject instead of truncating or wrapping', () => {
  for (const sequence of [-1, 0x100000000, 1.5, NaN, Infinity]) {
    assert.throws(() => demoFrame(sequence), RangeError);
  }
  for (const flags of [-1, 65536, 1.5, NaN, Infinity]) {
    assert.throws(() => encodeFrame({ sequence: 0, flags, payload: Buffer.alloc(0) }), RangeError);
  }
});

test('invalid telemetry values reject before writing wire fields', () => {
  const invalid: Partial<TelemetryPayload>[] = [
    { temperatureC: -327.69 }, { temperatureC: 327.68 }, { temperatureC: NaN },
    { temperatureC: Infinity }, { temperatureC: -Infinity },
  ];
  for (const [field, max] of [['batteryMv', 65535], ['altitudeM', 0xffffffff], ['uptimeSeconds', 0xffffffff]] as const) {
    for (const value of [-1, max + 1, 1.5, NaN, Infinity]) invalid.push({ [field]: value });
  }
  for (const values of invalid) assert.throws(() => encodeTelemetry({ ...telemetry, ...values }), RangeError);
});

test('decoder and validator reject any body size other than 256', () => {
  for (const length of [0, 12, 255, 257, 260]) {
    assert.throws(() => decodeFrame(Buffer.alloc(length)), RangeError);
    assert.throws(() => validateFrame(Buffer.alloc(length)), RangeError);
  }
});

test('payload lengths 0..11 are valid without telemetry; direct telemetry decode rejects them', () => {
  for (let length = 0; length < 12; length++) {
    const payload = Buffer.alloc(length, 0x55);
    const frame = encodeFrame({ sequence: 0, payload });
    const decoded = decodeFrame(frame);
    assert.equal(decoded.payloadLength, length);
    assert.equal(decoded.formatValid, true);
    assert.equal(decoded.crcValid, true);
    assert.deepEqual(decoded.payload, payload);
    assert.equal('telemetry' in decoded, false);
    assert.throws(() => decodeTelemetry(payload), RangeError);
    assert.deepEqual(frame.subarray(8 + length, 254), Buffer.alloc(246 - length));
  }
});

test('full-capacity payload is preserved and its first 12 bytes decode as telemetry', () => {
  const payload = Buffer.alloc(246, 0xa5);
  encodeTelemetry(telemetry).copy(payload);
  const decoded = decodeFrame(encodeFrame({ sequence: 0xffffffff, flags: 65535, payload }));
  assert.equal(decoded.payloadLength, 246);
  assert.deepEqual(decoded.payload, payload);
  assert.deepEqual(decoded.telemetry, telemetry);
  assert.equal(decoded.crcValid, true);
  assert.equal(decoded.formatValid, true);
});

test('encoding and decoding do not mutate or alias caller payload storage', () => {
  const payload = encodeTelemetry(telemetry);
  const original = Buffer.from(payload);
  const frame = encodeFrame({ sequence: 0, payload });
  assert.deepEqual(payload, original);
  payload.fill(255);
  assert.deepEqual(frame.subarray(8, 20), original);
  const beforeDecode = Buffer.from(frame);
  const decoded = decodeFrame(frame);
  assert.deepEqual(frame, beforeDecode);
  decoded.payload.fill(0);
  assert.deepEqual(frame, beforeDecode);
});

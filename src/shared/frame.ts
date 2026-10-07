import {
  ALTITUDE_OFFSET, BATTERY_OFFSET, CRC_OFFSET, DEFAULT_PAYLOAD_LENGTH,
  FLAGS_OFFSET, FRAME_SIZE_BYTES, PAYLOAD_CAPACITY, PAYLOAD_LENGTH_OFFSET,
  PAYLOAD_OFFSET, SEQUENCE_OFFSET, TEMPERATURE_OFFSET, UPTIME_OFFSET,
} from './constants.js';
import { crc16Ccitt } from './crc16.js';
import type { DecodedFrame, FrameInput, FrameValidation, TelemetryPayload } from './types.js';

function requireInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in ${min}..${max}`);
  }
}

function requireFrameSize(frame: Buffer): void {
  if (frame.length !== FRAME_SIZE_BYTES) {
    throw new RangeError(`Frame body must be exactly ${FRAME_SIZE_BYTES} bytes`);
  }
}

export function encodeTelemetry(telemetry: TelemetryPayload): Buffer {
  if (!Number.isFinite(telemetry.temperatureC)) {
    throw new RangeError('temperatureC must be finite');
  }
  const centiDegrees = Math.round(telemetry.temperatureC * 100);
  requireInteger('temperature in centi-degrees', centiDegrees, -0x8000, 0x7fff);
  requireInteger('batteryMv', telemetry.batteryMv, 0, 0xffff);
  requireInteger('altitudeM', telemetry.altitudeM, 0, 0xffffffff);
  requireInteger('uptimeSeconds', telemetry.uptimeSeconds, 0, 0xffffffff);

  const payload = Buffer.alloc(DEFAULT_PAYLOAD_LENGTH);
  payload.writeInt16BE(centiDegrees, TEMPERATURE_OFFSET);
  payload.writeUInt16BE(telemetry.batteryMv, BATTERY_OFFSET);
  payload.writeUInt32BE(telemetry.altitudeM, ALTITUDE_OFFSET);
  payload.writeUInt32BE(telemetry.uptimeSeconds, UPTIME_OFFSET);
  return payload;
}

export function decodeTelemetry(payload: Buffer): TelemetryPayload {
  if (payload.length < DEFAULT_PAYLOAD_LENGTH) {
    throw new RangeError(`Telemetry requires at least ${DEFAULT_PAYLOAD_LENGTH} meaningful bytes`);
  }
  return {
    temperatureC: payload.readInt16BE(TEMPERATURE_OFFSET) / 100,
    batteryMv: payload.readUInt16BE(BATTERY_OFFSET),
    altitudeM: payload.readUInt32BE(ALTITUDE_OFFSET),
    uptimeSeconds: payload.readUInt32BE(UPTIME_OFFSET),
  };
}

// Produces the 256-byte body only. Packetization will prepend ASM in a later round.
export function encodeFrame({ sequence, payload, flags = 0 }: FrameInput): Buffer {
  requireInteger('sequence', sequence, 0, 0xffffffff);
  requireInteger('flags', flags, 0, 0xffff);
  if (payload.length > PAYLOAD_CAPACITY) {
    throw new RangeError(`Payload exceeds ${PAYLOAD_CAPACITY} bytes`);
  }

  const frame = Buffer.alloc(FRAME_SIZE_BYTES);
  frame.writeUInt32BE(sequence, SEQUENCE_OFFSET);
  frame.writeUInt16BE(payload.length, PAYLOAD_LENGTH_OFFSET);
  frame.writeUInt16BE(flags, FLAGS_OFFSET);
  payload.copy(frame, PAYLOAD_OFFSET);
  frame.writeUInt16BE(crc16Ccitt(frame.subarray(0, CRC_OFFSET)), CRC_OFFSET);
  return frame;
}

// Validation failures are data for the future FSM, not fatal protocol exceptions.
// Wrong-sized input is a caller error: synchronization must first extract 256 bytes.
export function validateFrame(frame: Buffer): FrameValidation {
  requireFrameSize(frame);
  const storedCrc = frame.readUInt16BE(CRC_OFFSET);
  const calculatedCrc = crc16Ccitt(frame.subarray(0, CRC_OFFSET));
  return {
    storedCrc,
    calculatedCrc,
    crcValid: storedCrc === calculatedCrc,
    formatValid: frame.readUInt16BE(PAYLOAD_LENGTH_OFFSET) <= PAYLOAD_CAPACITY,
  };
}

export function decodeFrame(frame: Buffer): DecodedFrame {
  const validation = validateFrame(frame);
  const sequence = frame.readUInt32BE(SEQUENCE_OFFSET);
  const payloadLength = frame.readUInt16BE(PAYLOAD_LENGTH_OFFSET);
  const flags = frame.readUInt16BE(FLAGS_OFFSET);
  const payload = validation.formatValid
    ? Buffer.from(frame.subarray(PAYLOAD_OFFSET, PAYLOAD_OFFSET + payloadLength))
    : Buffer.alloc(0);

  const decoded: DecodedFrame = { sequence, payloadLength, flags, payload, ...validation };
  // Never interpret padding, malformed lengths, or CRC-invalid bytes as telemetry.
  if (validation.crcValid && validation.formatValid && payloadLength >= DEFAULT_PAYLOAD_LENGTH) {
    decoded.telemetry = decodeTelemetry(payload);
  }
  return decoded;
}

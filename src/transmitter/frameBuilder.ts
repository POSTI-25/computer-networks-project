import { ASM_SIZE_BYTES, ASM_VALUE } from '../shared/constants.js';
import { encodeFrame, encodeTelemetry } from '../shared/frame.js';
import type { TelemetryPayload } from '../shared/types.js';

export function mockTelemetry(sequence: number): TelemetryPayload {
  return {
    temperatureC: (2400 + sequence % 100) / 100,
    batteryMv: 7420 - sequence % 20,
    altitudeM: 520000 + sequence % 1000,
    uptimeSeconds: sequence,
  };
}

export function buildTransmissionUnit(sequence: number): Buffer {
  const body = encodeFrame({ sequence, payload: encodeTelemetry(mockTelemetry(sequence)) });
  const marker = Buffer.alloc(ASM_SIZE_BYTES);
  marker.writeUInt32BE(ASM_VALUE);
  return Buffer.concat([marker, body]);
}

export class FrameBuilder {
  constructor(private sequence = 0) {
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff) {
      throw new RangeError('Initial sequence must be uint32');
    }
  }

  get nextSequence(): number {
    return this.sequence;
  }

  next(): Buffer {
    const unit = buildTransmissionUnit(this.sequence);
    this.sequence = (this.sequence + 1) >>> 0;
    return unit;
  }
}

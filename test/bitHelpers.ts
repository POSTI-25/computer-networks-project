import { ASM_VALUE } from '../src/shared/constants.js';
import { encodeFrame, encodeTelemetry } from '../src/shared/frame.js';

// Short, test-only bit strings make independent expected ordering easy to inspect.
export function bitsOf(data: Buffer): string {
  return [...data].map(byte => byte.toString(2).padStart(8, '0')).join('');
}

export function packBits(bits: string): Buffer {
  const output = Buffer.alloc(Math.ceil(bits.length / 8));
  for (let bit = 0; bit < bits.length; bit++) {
    if (bits[bit] === '1') output[Math.floor(bit / 8)] |= 1 << (7 - bit % 8);
  }
  return output;
}

export function asm(): Buffer {
  const marker = Buffer.alloc(4);
  marker.writeUInt32BE(ASM_VALUE);
  return marker;
}

export function frame(sequence = 42): Buffer {
  return encodeFrame({ sequence, payload: encodeTelemetry({
    temperatureC: -12.34, batteryMv: 7420, altitudeM: 520000, uptimeSeconds: 1800,
  }) });
}

export function unit(sequence = 42): Buffer {
  return Buffer.concat([asm(), frame(sequence)]);
}

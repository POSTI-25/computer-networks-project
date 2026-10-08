import { DEFAULT_CHUNK_MAX_BYTES, DEFAULT_CHUNK_MIN_BYTES, DEFAULT_SIM_SEED } from '../shared/constants.js';

export interface PacketizerOptions {
  minChunkBytes?: number;
  maxChunkBytes?: number;
  seed?: number;
}

export class Packetizer {
  private readonly min: number;
  private readonly max: number;
  private randomState: number;
  private pending: Buffer = Buffer.alloc(0);
  private targetSize: number;

  constructor(options: PacketizerOptions = {}) {
    this.min = options.minChunkBytes ?? DEFAULT_CHUNK_MIN_BYTES;
    this.max = options.maxChunkBytes ?? DEFAULT_CHUNK_MAX_BYTES;
    this.randomState = options.seed ?? DEFAULT_SIM_SEED;
    if (!Number.isSafeInteger(this.min) || !Number.isSafeInteger(this.max) || this.min < 1 || this.max < this.min) {
      throw new RangeError('Chunk sizes must be integers with 1 <= min <= max');
    }
    if (!Number.isInteger(this.randomState) || this.randomState < 0 || this.randomState > 0xffffffff) {
      throw new RangeError('Seed must be uint32');
    }
    this.targetSize = this.nextSize();
  }

  push(data: Buffer): Buffer[] {
    if (data.length === 0) return [];
    const stream = this.pending.length === 0 ? data : Buffer.concat([this.pending, data]);
    const chunks: Buffer[] = [];
    let offset = 0;
    while (stream.length - offset >= this.targetSize) {
      chunks.push(Buffer.from(stream.subarray(offset, offset + this.targetSize)));
      offset += this.targetSize;
      this.targetSize = this.nextSize();
    }
    // Retain only an unfinished datagram, including across generated frame boundaries.
    this.pending = Buffer.from(stream.subarray(offset));
    return chunks;
  }

  // For a finite stream, the last chunk may be shorter than min. Never pad stream bytes.
  flush(): Buffer[] {
    if (this.pending.length === 0) return [];
    const tail = this.pending;
    this.pending = Buffer.alloc(0);
    this.targetSize = this.nextSize();
    return [tail];
  }

  private nextSize(): number {
    // Mulberry32: project-owned deterministic uint32 PRNG, including seed zero.
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const random = ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
    return this.min + Math.floor(random * (this.max - this.min + 1));
  }
}

export function packetize(data: Buffer, options: PacketizerOptions = {}): Buffer[] {
  const packetizer = new Packetizer(options);
  return [...packetizer.push(data), ...packetizer.flush()];
}

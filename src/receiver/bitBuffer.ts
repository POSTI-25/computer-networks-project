export const MAX_BUFFER_BYTES = 64 * 1024;
const COMPACTION_THRESHOLD_BYTES = 1024;

export class BufferLimitError extends RangeError {
  constructor() {
    super(`Receive buffer would exceed ${MAX_BUFFER_BYTES} bytes`);
  }
}

export class BitBuffer {
  private storage: Buffer = Buffer.alloc(0);
  private endBytes = 0;
  private headBit = 0;

  // Allocated bytes, exposed only to observe bounded storage without accessing internals.
  get storageBytes(): number {
    return this.storage.length;
  }

  availableBits(): number {
    return this.endBytes * 8 - this.headBit;
  }

  append(data: Buffer): void {
    if (data.length === 0) return;
    this.compactIfNeeded();
    let required = this.endBytes + data.length;
    if (required > this.storage.length) {
      this.compact();
      required = this.endBytes + data.length;
      if (required > MAX_BUFFER_BYTES) throw new BufferLimitError();
      if (required > this.storage.length) {
        // Geometric growth avoids copying the whole candidate on every tiny append.
        const capacity = Math.min(MAX_BUFFER_BYTES, Math.max(required, 256, this.storage.length * 2));
        const grown = Buffer.allocUnsafeSlow(capacity);
        this.storage.copy(grown, 0, 0, this.endBytes);
        this.storage = grown;
      }
    }
    data.copy(this.storage, this.endBytes);
    this.endBytes += data.length;
  }

  readBit(relativeBitOffset: number): 0 | 1 {
    this.requireRange(relativeBitOffset, 1);
    const absolute = this.headBit + relativeBitOffset;
    // Within each byte, the first transmitted bit is the MSB.
    return ((this.storage[Math.floor(absolute / 8)] >>> (7 - absolute % 8)) & 1) as 0 | 1;
  }

  match32(relativeBitOffset: number, value: number): boolean {
    this.requireRange(relativeBitOffset, 32);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new RangeError('32-bit match value must be a uint32');
    }
    let actual = 0;
    for (let byte = 0; byte < 4; byte++) {
      actual = (actual << 8) | this.readByte(this.headBit + relativeBitOffset + byte * 8);
    }
    return (actual >>> 0) === value;
  }

  sliceBitsToBuffer(relativeBitOffset: number, bitLength: number): Buffer {
    this.requireRange(relativeBitOffset, bitLength);
    if (bitLength % 8 !== 0) throw new RangeError('Extraction length must be a multiple of 8 bits');
    const result = Buffer.alloc(bitLength / 8);
    for (let byte = 0; byte < result.length; byte++) {
      result[byte] = this.readByte(this.headBit + relativeBitOffset + byte * 8);
    }
    return result;
  }

  discardBits(bitCount: number): void {
    this.requireRange(0, bitCount);
    this.headBit += bitCount;
    if (this.availableBits() === 0) {
      this.headBit = 0;
      this.endBytes = 0;
    }
  }

  compactIfNeeded(): void {
    const consumedBytes = Math.floor(this.headBit / 8);
    if (consumedBytes >= COMPACTION_THRESHOLD_BYTES || consumedBytes >= this.endBytes / 2) {
      this.compact();
    }
  }

  private compact(): void {
    const consumedBytes = Math.floor(this.headBit / 8);
    if (consumedBytes === 0) return;
    // Keep the partly consumed byte and its residual bit offset; do not repack its bits.
    this.storage.copyWithin(0, consumedBytes, this.endBytes);
    this.endBytes -= consumedBytes;
    this.headBit -= consumedBytes * 8;
  }

  private readByte(absoluteBitOffset: number): number {
    const index = Math.floor(absoluteBitOffset / 8);
    const shift = absoluteBitOffset % 8;
    if (shift === 0) return this.storage[index];
    // Join adjacent source bytes to produce one MSB-first output byte at any alignment.
    return ((this.storage[index] << shift) | (this.storage[index + 1] >>> (8 - shift))) & 0xff;
  }

  private requireRange(offset: number, length: number): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
      || offset > this.availableBits() - length) {
      throw new RangeError('Bit range is outside the available input');
    }
  }
}

import { ASM_SIZE_BITS, CRC_OFFSET, TRANSMISSION_UNIT_SIZE_BITS } from '../shared/constants.js';

export type ImpairmentMode = 'clean' | 'bit-offset' | 'bit-flip' | 'bit-insert' | 'bit-delete' | 'bit-slip';
export interface SimulatorOptions {
  mode?: ImpairmentMode;
  offsetBits?: number;
  // Zero-based clean transmission-unit index, equivalent to sequence for a builder starting at 0.
  targetFrame?: number;
  bodyBitOffset?: number;
  insertedBit?: 0 | 1;
}

const MODES: readonly string[] = ['clean', 'bit-offset', 'bit-flip', 'bit-insert', 'bit-delete', 'bit-slip'];

/** Impair the clean MSB-first stream AFTER CRC, BEFORE packetization. No CRC repair.
 * Carries at most seven output bits across pushes; input chunk boundaries are irrelevant.
 * These standard building blocks demonstrate the receiver's synchronization/recovery combination.
 */
export class BitstreamSimulator {
  readonly mode: Exclude<ImpairmentMode, 'bit-slip'>;
  readonly offsetBits: number;
  readonly targetFrame: number;
  readonly bodyBitOffset: number;
  private readonly insertedBit: number;
  private readonly targetBit: number;
  private inputBits = 0;
  private emittedBits = 0;
  private carry = 0;
  private carryBits = 0;
  private started = false;
  private finished = false;

  constructor(options: SimulatorOptions = {}) {
    const mode = options.mode ?? 'clean';
    if (!MODES.includes(mode)) throw new RangeError('Unknown simulator mode');
    this.mode = mode === 'bit-slip' ? 'bit-insert' : mode;
    this.offsetBits = options.offsetBits ?? 3;
    this.targetFrame = options.targetFrame ?? 5;
    this.bodyBitOffset = options.bodyBitOffset ?? 80;
    this.insertedBit = options.insertedBit ?? 1;
    if (!Number.isInteger(this.offsetBits) || this.offsetBits < 1 || this.offsetBits > 7)
      throw new RangeError('offsetBits must be 1..7');
    if (!Number.isSafeInteger(this.targetFrame) || this.targetFrame < 0)
      throw new RangeError('targetFrame must be a nonnegative safe integer');
    if (!Number.isInteger(this.bodyBitOffset) || this.bodyBitOffset < 0 || this.bodyBitOffset >= CRC_OFFSET * 8)
      throw new RangeError('bodyBitOffset must address body bytes 0..253');
    if (this.insertedBit !== 0 && this.insertedBit !== 1) throw new RangeError('insertedBit must be 0 or 1');
    this.targetBit = this.targetFrame * TRANSMISSION_UNIT_SIZE_BITS + ASM_SIZE_BITS + this.bodyBitOffset;
    if (!Number.isSafeInteger(this.targetBit)) throw new RangeError('Target exceeds safe bit indexing');
  }

  // True logical length, excluding the finite stream's final byte padding.
  get outputBitLength(): number { return this.emittedBits; }
  get pendingBits(): number { return this.carryBits; }

  push(input: Buffer): Buffer {
    if (this.finished) throw new Error('Cannot push after simulator flush');
    if (input.length === 0) return Buffer.alloc(0);
    const output = Buffer.alloc(input.length + 2);
    let length = 0;
    const write = (bit: number) => {
      this.carry = (this.carry << 1) | bit;
      this.carryBits++;
      this.emittedBits++;
      if (this.carryBits === 8) {
        output[length++] = this.carry;
        this.carry = this.carryBits = 0;
      }
    };
    if (!this.started) {
      this.started = true;
      if (this.mode === 'bit-offset') {
        for (let i = 0; i < this.offsetBits; i++) write(i % 2 === 0 ? 1 : 0);
      }
    }
    for (const byte of input) {
      for (let shift = 7; shift >= 0; shift--, this.inputBits++) {
        let bit = (byte >>> shift) & 1;
        if (this.inputBits === this.targetBit) {
          if (this.mode === 'bit-insert') write(this.insertedBit); // Before original target bit.
          if (this.mode === 'bit-delete') continue; // Remove original target bit.
          if (this.mode === 'bit-flip') bit ^= 1;
        }
        write(bit);
      }
    }
    return output.subarray(0, length);
  }

  /** Finalize ONCE at end of stream, never between frames. UDP requires whole bytes. */
  flush(): Buffer {
    this.finished = true;
    const tail = this.carryBits ? Buffer.from([this.carry << (8 - this.carryBits)]) : Buffer.alloc(0);
    this.carry = this.carryBits = 0;
    return tail;
  }
}

export function parseSimulatorArgs(args: readonly string[]): SimulatorOptions {
  const options: SimulatorOptions = {};
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
    switch (args[i]) {
      case '--mode': options.mode = value as ImpairmentMode; break;
      case '--offset': options.offsetBits = Number(value); break;
      case '--target-frame': options.targetFrame = Number(value); break;
      case '--body-bit': options.bodyBitOffset = Number(value); break;
      default: throw new Error(`Unknown option ${args[i]}`);
    }
  }
  return options; // Constructor validates before any socket is created.
}

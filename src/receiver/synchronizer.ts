import { ASM_SIZE_BITS, ASM_VALUE, FRAME_SIZE_BITS, TRANSMISSION_UNIT_SIZE_BITS } from '../shared/constants.js';
import { decodeFrame } from '../shared/frame.js';
import type { DecodedFrame } from '../shared/types.js';
import { BitBuffer, BufferLimitError } from './bitBuffer.js';

export type SyncState = 'HUNT' | 'LOCK' | 'VERIFY' | 'EXTRACT';
export type TransitionReason = 'asm_found' | 'next_asm' | 'candidate_complete' | 'verified'
  | 'crc_failure' | 'format_failure' | 'frame_extracted' | 'buffer_limit';

export interface SyncTransition {
  from: SyncState;
  to: SyncState;
  reason: TransitionReason;
  headBitOffset: number;
  bitAlignment: number | null;
}

export interface SynchronizedFrame {
  frame: DecodedFrame;
  bitAlignment: number;
  asmBitOffset: number;
}

const INPUT_BATCH_BYTES = 4096;

export class Synchronizer {
  private buffer = new BitBuffer();
  private currentState: SyncState = 'HUNT';
  private headBitOffset = 0;
  private candidateAlignment: number | null = null;
  private verifiedFrame: DecodedFrame | null = null;
  private awaitingReacquisition = false;
  private counters = {
    asmDetections: 0, validFrames: 0, crcFailures: 0, formatFailures: 0,
    resyncCount: 0, bufferResets: 0,
  };

  constructor(private readonly onTransition?: (transition: SyncTransition) => void) {}

  get state(): SyncState {
    return this.currentState;
  }

  get stats() {
    return {
      ...this.counters,
      state: this.currentState,
      currentBitAlignment: this.candidateAlignment,
      bufferedBits: this.buffer.availableBits(),
      storageBytes: this.buffer.storageBytes,
    };
  }

  push(data: Buffer): SynchronizedFrame[] {
    const frames: SynchronizedFrame[] = [];
    // Bound receive storage even for a single large input; preserve the logical stream.
    for (let offset = 0; offset < data.length; offset += INPUT_BATCH_BYTES) {
      const batch = data.subarray(offset, offset + INPUT_BATCH_BYTES);
      try {
        this.buffer.append(batch);
      } catch (error) {
        if (!(error instanceof BufferLimitError)) throw error;
        // Defensive invariant failure: abandon old buffered state, preserve stream position,
        // and start hunting in the current input batch without restarting the process.
        this.headBitOffset += this.buffer.availableBits();
        this.buffer = new BitBuffer();
        this.counters.bufferResets++;
        this.verifiedFrame = null;
        this.candidateAlignment = null;
        this.awaitingReacquisition = false;
        this.transition('HUNT', 'buffer_limit');
        this.buffer.append(batch);
      }
      this.process(frames);
      this.buffer.compactIfNeeded();
    }
    return frames;
  }

  private process(frames: SynchronizedFrame[]): void {
    while (true) {
      switch (this.currentState) {
        case 'HUNT': {
          let searchOffset = 0;
          while (searchOffset + ASM_SIZE_BITS <= this.buffer.availableBits()) {
            if (this.buffer.match32(searchOffset, ASM_VALUE)) break;
            searchOffset++; // Exactly one bit, including non-byte-aligned candidates.
          }
          this.discard(searchOffset);
          if (this.buffer.availableBits() < ASM_SIZE_BITS) {
            // All searchable positions were checked; retain only the final <=31 bits.
            return;
          }
          this.acquire('asm_found');
          break;
        }
        case 'LOCK':
          if (this.buffer.availableBits() < TRANSMISSION_UNIT_SIZE_BITS) return;
          this.transition('VERIFY', 'candidate_complete');
          break;
        case 'VERIFY': {
          const body = this.buffer.sliceBitsToBuffer(ASM_SIZE_BITS, FRAME_SIZE_BITS);
          const decoded = decodeFrame(body);
          if (!decoded.crcValid || !decoded.formatValid) {
            // CRC takes precedence; count format rejection only for CRC-valid candidates.
            const reason = !decoded.crcValid ? 'crc_failure' : 'format_failure';
            if (reason === 'crc_failure') this.counters.crcFailures++;
            else this.counters.formatFailures++;
            this.awaitingReacquisition = true;
            this.candidateAlignment = null;
            // Candidate ASM is at the head. Discard ONE bit, never the whole failed unit:
            // a true marker can be inside the false candidate's remaining buffered region.
            this.discard(1);
            this.transition('HUNT', reason);
          } else {
            this.verifiedFrame = decoded;
            this.transition('EXTRACT', 'verified');
          }
          break;
        }
        case 'EXTRACT':
          frames.push({
            frame: this.verifiedFrame!,
            bitAlignment: this.candidateAlignment!,
            asmBitOffset: this.headBitOffset,
          });
          this.counters.validFrames++;
          this.verifiedFrame = null;
          this.discard(TRANSMISSION_UNIT_SIZE_BITS);
          this.candidateAlignment = null;
          if (this.buffer.availableBits() >= ASM_SIZE_BITS && this.buffer.match32(0, ASM_VALUE)) {
            this.acquire('next_asm');
          } else {
            this.transition('HUNT', 'frame_extracted');
          }
          break;
      }
    }
  }

  private acquire(reason: 'asm_found' | 'next_asm'): void {
    this.candidateAlignment = this.headBitOffset % 8;
    this.counters.asmDetections++;
    // Count the first ASM candidate found after EACH failed candidate, even if it too fails.
    if (this.awaitingReacquisition) this.counters.resyncCount++;
    this.awaitingReacquisition = false;
    this.transition('LOCK', reason);
  }

  private discard(bits: number): void {
    this.buffer.discardBits(bits);
    // Logical stream position survives physical compaction and partial-byte heads.
    this.headBitOffset += bits;
  }

  private transition(to: SyncState, reason: TransitionReason): void {
    const from = this.currentState;
    this.currentState = to;
    this.onTransition?.({ from, to, reason, headBitOffset: this.headBitOffset, bitAlignment: this.candidateAlignment });
  }
}

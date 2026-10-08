import type { ReceiverMetrics } from '../shared/observability.js';
import type { Synchronizer } from './synchronizer.js';

type TransportCounters = { udpDatagramsReceived: number; udpBytesReceived: number };

export class Metrics {
  private lastValidSequence: number | null = null;
  private sequenceGaps = 0;
  private framesPerSecond = 0;
  private bytesPerSecond = 0;
  private sampledAt: number;
  private sampledFrames: number;
  private sampledBytes: number;

  constructor(
    private readonly readSync: () => Synchronizer['stats'],
    private readonly readTransport: () => TransportCounters,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.sampledAt = now();
    this.sampledFrames = readSync().validFrames;
    this.sampledBytes = readTransport().udpBytesReceived;
  }

  // Called ONLY for extracted valid frames. Serial-number half-range comparison:
  // advances 1..2^31-1 are forward; duplicates/older/ambiguous half-range are ignored.
  // They remain valid frame observations but never move the forward baseline backward.
  recordValidSequence(sequence: number): void {
    if (this.lastValidSequence === null) {
      this.lastValidSequence = sequence;
      return;
    }
    const advance = (sequence - this.lastValidSequence) >>> 0;
    if (advance > 0 && advance < 0x80000000) {
      this.sequenceGaps += advance - 1;
      this.lastValidSequence = sequence;
    }
  }

  sampleRates(): void {
    const time = this.now();
    const elapsed = (time - this.sampledAt) / 1000;
    if (elapsed <= 0) return;
    const frames = this.readSync().validFrames;
    const bytes = this.readTransport().udpBytesReceived;
    this.framesPerSecond = (frames - this.sampledFrames) / elapsed;
    this.bytesPerSecond = (bytes - this.sampledBytes) / elapsed;
    this.sampledAt = time;
    this.sampledFrames = frames;
    this.sampledBytes = bytes;
  }

  snapshot(): ReceiverMetrics {
    const sync = this.readSync();
    return {
      state: sync.state, synced: sync.state !== 'HUNT',
      ...this.readTransport(),
      asmDetections: sync.asmDetections, validFrames: sync.validFrames,
      crcFailures: sync.crcFailures, formatFailures: sync.formatFailures,
      sequenceGaps: this.sequenceGaps, resyncCount: sync.resyncCount,
      framesPerSecond: this.framesPerSecond, bytesPerSecond: this.bytesPerSecond,
      bufferedBits: sync.bufferedBits, currentBitAlignment: sync.currentBitAlignment,
    };
  }
}

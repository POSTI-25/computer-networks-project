import { Synchronizer, type SyncTransition } from './synchronizer.js';
import { Metrics } from './metrics.js';
import { traceMessage } from './trace.js';
import { validFrameMessage } from './websocketServer.js';
import { buildTransmissionUnit } from '../transmitter/frameBuilder.js';
import { BitstreamSimulator, type ImpairmentMode } from '../transmitter/bitstreamSimulator.js';
import { packetize } from '../transmitter/packetizer.js';
import type { LessonRecording } from '../shared/observability.js';

export const LESSON_MODES = ['clean', 'bit-offset', 'bit-flip', 'bit-insert', 'bit-delete'] as const;

// An isolated deterministic recording of the production engine. No live receiver state
// is changed, and these chunks are processed in memory rather than sent over UDP.
export function buildLesson(mode: string): LessonRecording {
  if (!(LESSON_MODES as readonly string[]).includes(mode)) throw new RangeError('Unknown lesson');
  const transitions: SyncTransition[] = [];
  const sync = new Synchronizer(event => transitions.push(event));
  let count = 0;
  let bytes = 0;
  const metrics = new Metrics(() => sync.stats, () => ({ udpDatagramsReceived: count, udpBytesReceived: bytes }));
  const simulator = new BitstreamSimulator({ mode: mode as ImpairmentMode, targetFrame: 2, offsetBits: 3 });
  const data = Buffer.concat([simulator.push(Buffer.concat(Array.from({ length: 6 }, (_, i) => buildTransmissionUnit(i)))), simulator.flush()]);
  const steps: LessonRecording['steps'] = [];
  for (const chunk of packetize(data, { minChunkBytes: 24, maxChunkBytes: 72, seed: 42 })) {
    transitions.length = 0;
    const before = sync.stats.bufferedBits;
    count++; bytes += chunk.length;
    const frames = sync.push(chunk).map(validFrameMessage).filter(frame => frame !== null);
    frames.forEach(frame => metrics.recordValidSequence(frame.frame.sequence));
    steps.push({ trace: traceMessage(chunk, count, before, sync.stats.bufferedBits, [...transitions]), metrics: metrics.snapshot(), frames });
  }
  return { type: 'lesson.recording', mode, steps };
}

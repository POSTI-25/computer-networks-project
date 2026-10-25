import type { TraceMessage } from '../shared/observability.js';
import type { SyncTransition } from './synchronizer.js';

export function traceMessage(data: Buffer, index: number, before: number, after: number, transitions: SyncTransition[]): TraceMessage {
  return {
    type: 'receiver.trace', timestamp: new Date().toISOString(),
    datagram: { index, bytes: data.length, hex: data.subarray(0, 24).toString('hex'),
      bits: [...data.subarray(0, 8)].map(byte => byte.toString(2).padStart(8, '0')).join('') },
    bufferedBefore: before, bufferedAfter: after, transitions: transitions.slice(-64),
  };
}

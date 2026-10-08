import type { ReceiverMetrics } from '../../src/shared/observability.js';

// Counter changes preserve failure/recovery evidence even when HUNT is too brief to sample.
export function statusEvents(previous: ReceiverMetrics | null, current: ReceiverMetrics): string[] {
  const events: string[] = [];
  if (previous && previous.state !== current.state) events.push(`FSM ${previous.state} → ${current.state}`);
  for (const [key, label] of [
    ['asmDetections', 'ASM acquired'], ['crcFailures', 'CRC failure'],
    ['formatFailures', 'Format failure'], ['resyncCount', 'Resynchronized'],
    ['sequenceGaps', 'Frame sequence gaps'],
  ] as const) {
    const delta = current[key] - (previous?.[key] ?? 0);
    if (delta > 0) events.push(`${label} (+${delta})`);
  }
  if (previous && current.currentBitAlignment !== null && previous.currentBitAlignment !== null
    && current.currentBitAlignment !== previous.currentBitAlignment) {
    events.push(`Current alignment ${previous.currentBitAlignment} → ${current.currentBitAlignment}`);
  }
  return events;
}

export function appendRecent(events: readonly string[], additions: readonly string[]): string[] {
  return [...events, ...additions].slice(-20);
}

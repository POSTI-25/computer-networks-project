import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import type { ReceiverMetrics, ReceiverMessage, StatusMessage, ValidFrameMessage } from '../shared/observability.js';
import type { SynchronizedFrame } from './synchronizer.js';
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from '../shared/constants.js';

export const STATUS_INTERVAL_MS = 250;
export { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from '../shared/constants.js';

export function statusMessage(metrics: ReceiverMetrics): StatusMessage {
  return { type: 'receiver.status', timestamp: new Date().toISOString(), metrics };
}

export function validFrameMessage({ frame, bitAlignment }: SynchronizedFrame): ValidFrameMessage | null {
  if (!frame.crcValid || !frame.formatValid) return null;
  // PRD requires an event for every valid frame. Preserve all keys without decoding padding.
  // The PRD does not define unavailable telemetry values; null explicitly represents absence.
  return { type: 'frame.valid', timestamp: new Date().toISOString(), frame: {
    sequence: frame.sequence, payloadLength: frame.payloadLength,
    temperatureC: frame.telemetry?.temperatureC ?? null,
    batteryMv: frame.telemetry?.batteryMv ?? null,
    altitudeM: frame.telemetry?.altitudeM ?? null,
    uptimeSeconds: frame.telemetry?.uptimeSeconds ?? null, bitAlignment,
  } };
}

export interface WebSocketOptions {
  host?: string;
  port?: number;
  readMetrics: () => ReceiverMetrics;
  onError?: (error: Error) => void;
}

export async function startWebSocketServer(options: WebSocketOptions) {
  const server = new WebSocketServer({ host: options.host ?? DEFAULT_WS_HOST, port: options.port ?? DEFAULT_WS_PORT });
  let timer: ReturnType<typeof setInterval> | undefined;
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (timer) clearInterval(timer);
    closePromise ??= new Promise<void>(resolve => {
      for (const client of server.clients) client.terminate();
      server.close(() => resolve());
    });
    return closePromise;
  };
  server.on('connection', client => {
    client.on('error', () => client.terminate()); // One observer cannot stop UDP reception.
  });
  server.on('error', error => options.onError?.(error));
  try { await once(server, 'listening'); }
  catch (error) { await close(); throw error; }

  const broadcast = (message: ReceiverMessage) => {
    const json = JSON.stringify(message);
    for (const client of server.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      // Do not retain unlimited outgoing data for a stalled dashboard.
      if (client.bufferedAmount > 64 * 1024) { client.terminate(); continue; }
      client.send(json, error => { if (error) client.terminate(); });
    }
  };
  let lastStatus = performance.now();
  timer = setInterval(() => {
    const time = performance.now();
    if (time - lastStatus < STATUS_INTERVAL_MS) return;
    lastStatus = time;
    broadcast(statusMessage(options.readMetrics()));
  }, STATUS_INTERVAL_MS);

  return {
    server, close,
    publishFrame(frame: SynchronizedFrame): void {
      const message = validFrameMessage(frame);
      if (message) broadcast(message);
    },
  };
}

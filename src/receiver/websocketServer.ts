import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import type { ReceiverMetrics, ReceiverMessage, StatusMessage, ValidFrameMessage } from '../shared/observability.js';
import type { SynchronizedFrame } from './synchronizer.js';

export const STATUS_INTERVAL_MS = 250;
export const DEFAULT_WS_PORT = 8080;
export const DEFAULT_WS_HOST = '127.0.0.1';

export function statusMessage(metrics: ReceiverMetrics): StatusMessage {
  return { type: 'receiver.status', timestamp: new Date().toISOString(), metrics };
}

export function validFrameMessage({ frame, bitAlignment }: SynchronizedFrame): ValidFrameMessage | null {
  // Short structurally valid payloads are counted but contain no demo telemetry.
  // Suppress their telemetry event rather than inventing values or changing the PRD schema.
  if (!frame.crcValid || !frame.formatValid || !frame.telemetry) return null;
  const { temperatureC, batteryMv, altitudeM, uptimeSeconds } = frame.telemetry;
  return { type: 'frame.valid', timestamp: new Date().toISOString(), frame: {
    sequence: frame.sequence, payloadLength: frame.payloadLength,
    temperatureC, batteryMv, altitudeM, uptimeSeconds, bitAlignment,
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

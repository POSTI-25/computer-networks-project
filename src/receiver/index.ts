import dgram from 'node:dgram';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { DEFAULT_UDP_HOST, DEFAULT_UDP_PORT } from '../shared/constants.js';
import { readReceiverConfig } from '../shared/config.js';
import { Synchronizer, type SynchronizedFrame, type SyncTransition } from './synchronizer.js';
import { Metrics } from './metrics.js';
import { startWebSocketServer } from './websocketServer.js';

export interface ReceiverOptions {
  host?: string;
  port?: number;
  onFrame?: (frame: SynchronizedFrame) => void;
  onError?: (error: Error) => void;
  onTransition?: (transition: SyncTransition) => void;
  // CLI enables the dashboard bridge; transport-only callers/tests can omit it.
  websocket?: { host?: string; port?: number };
}

export async function startReceiver(options: ReceiverOptions = {}) {
  const socket = dgram.createSocket('udp4');
  const synchronizer = new Synchronizer(options.onTransition);
  let udpDatagramsReceived = 0;
  let udpBytesReceived = 0;
  const metrics = new Metrics(() => synchronizer.stats, () => ({ udpDatagramsReceived, udpBytesReceived }));
  let websocket: Awaited<ReturnType<typeof startWebSocketServer>> | undefined;
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      await websocket?.close();
      await new Promise<void>(resolve => {
        try { socket.close(() => resolve()); } catch { resolve(); }
      });
    })();
    return closePromise;
  };
  socket.on('error', error => {
    if (options.onError) options.onError(error);
    else console.error(`[UDP] ${error.message}`);
    void close();
  });
  socket.on('message', msg => {
    udpDatagramsReceived++;
    udpBytesReceived += msg.length;
    // No framing here: one persistent synchronizer receives every payload unchanged.
    for (const frame of synchronizer.push(msg)) {
      metrics.recordValidSequence(frame.frame.sequence);
      websocket?.publishFrame(frame);
      options.onFrame?.(frame);
    }
  });
  const ready = once(socket, 'listening');
  try {
    socket.bind(options.port ?? DEFAULT_UDP_PORT, options.host ?? DEFAULT_UDP_HOST);
    await ready;
    if (options.websocket) {
      websocket = await startWebSocketServer({ ...options.websocket,
        readMetrics: () => { metrics.sampleRates(); return metrics.snapshot(); },
        onError: error => console.error(`[WS] ${error.message}`),
      });
    }
  } catch (error) {
    await close();
    throw error;
  }
  return {
    socket, synchronizer, metrics, websocket, close,
    get counters() { return { udpDatagramsReceived, udpBytesReceived }; },
  };
}

async function main(): Promise<void> {
  const receiver = await startReceiver({
    ...readReceiverConfig(),
    onTransition: event => {
      if (event.to === 'LOCK' || event.reason === 'crc_failure' || event.reason === 'format_failure') {
        console.log(`[FSM] ${event.from} -> ${event.to} reason=${event.reason} bitOffset=${event.headBitOffset} alignment=${event.bitAlignment}`);
      }
    },
    onError: error => { console.error(`[UDP] ${error.message}`); process.exitCode = 1; },
    onFrame: ({ frame }) => {
      const telemetry = frame.telemetry;
      console.log(`[FRAME] valid seq=${frame.sequence}` + (telemetry
        ? ` temp=${telemetry.temperatureC.toFixed(2)}C battery=${telemetry.batteryMv}mV` : ''));
    },
  });
  const endpoint = receiver.socket.address();
  console.log(`[UDP] listening ${endpoint.address}:${endpoint.port}`);
  const wsEndpoint = receiver.websocket?.server.address();
  if (wsEndpoint && typeof wsEndpoint !== 'string') console.log(`[WS] listening ws://${wsEndpoint.address}:${wsEndpoint.port}`);
  const stop = () => { void receiver.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`[UDP] ${error.message}`); process.exitCode = 1; });
}

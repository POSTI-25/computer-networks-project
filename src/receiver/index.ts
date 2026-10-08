import dgram from 'node:dgram';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { DEFAULT_UDP_HOST, DEFAULT_UDP_PORT } from '../shared/constants.js';
import { readUdpConfig } from '../shared/config.js';
import { Synchronizer, type SynchronizedFrame } from './synchronizer.js';

export interface ReceiverOptions {
  host?: string;
  port?: number;
  onFrame?: (frame: SynchronizedFrame) => void;
  onError?: (error: Error) => void;
}

export async function startReceiver(options: ReceiverOptions = {}) {
  const socket = dgram.createSocket('udp4');
  const synchronizer = new Synchronizer();
  let udpDatagramsReceived = 0;
  let udpBytesReceived = 0;
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= new Promise<void>(resolve => {
      try { socket.close(() => resolve()); } catch { resolve(); }
    });
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
    for (const frame of synchronizer.push(msg)) options.onFrame?.(frame);
  });
  const ready = once(socket, 'listening');
  try {
    socket.bind(options.port ?? DEFAULT_UDP_PORT, options.host ?? DEFAULT_UDP_HOST);
    await ready;
  } catch (error) {
    await close();
    throw error;
  }
  return {
    socket, synchronizer, close,
    get counters() { return { udpDatagramsReceived, udpBytesReceived }; },
  };
}

async function main(): Promise<void> {
  const receiver = await startReceiver({
    ...readUdpConfig(),
    onError: error => { console.error(`[UDP] ${error.message}`); process.exitCode = 1; },
    onFrame: ({ frame }) => {
      const telemetry = frame.telemetry;
      console.log(`[FRAME] valid seq=${frame.sequence}` + (telemetry
        ? ` temp=${telemetry.temperatureC.toFixed(2)}C battery=${telemetry.batteryMv}mV` : ''));
    },
  });
  const endpoint = receiver.socket.address();
  console.log(`[UDP] listening ${endpoint.address}:${endpoint.port}`);
  const stop = () => { void receiver.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`[UDP] ${error.message}`); process.exitCode = 1; });
}

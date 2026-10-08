import dgram from 'node:dgram';
import { once } from 'node:events';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { DEFAULT_UDP_HOST, DEFAULT_UDP_PORT } from '../shared/constants.js';
import { readTransmitterConfig } from '../shared/config.js';
import { FrameBuilder } from './frameBuilder.js';
import { Packetizer } from './packetizer.js';

export async function createUdpSender(host = DEFAULT_UDP_HOST, port = DEFAULT_UDP_PORT) {
  const socket = dgram.createSocket('udp4');
  // Observe asynchronous socket errors; send callbacks still reject the failed operation.
  let socketError: Error | undefined;
  socket.on('error', error => { socketError = error; });
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= new Promise<void>(resolve => {
      try { socket.close(() => resolve()); } catch { resolve(); }
    });
    return closePromise;
  };
  const ready = once(socket, 'listening');
  try {
    socket.bind(0, DEFAULT_UDP_HOST);
    await ready;
  } catch (error) {
    await close();
    throw error;
  }
  return {
    close,
    async send(chunks: readonly Buffer[]): Promise<void> {
      for (const chunk of chunks) {
        if (socketError) throw socketError;
        await new Promise<void>((resolve, reject) => {
          socket.send(chunk, port, host, error => error ? reject(error) : resolve());
        });
        // Yield for local receive I/O; this adds no acknowledgement or retransmission.
        await setImmediate();
      }
    },
  };
}

async function main(): Promise<void> {
  const config = readTransmitterConfig();
  const packetizer = new Packetizer(config);
  const builder = new FrameBuilder();
  const sender = await createUdpSender(config.host, config.port);
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`[TX] destination=${config.host}:${config.port} rate=${config.frameRate} seed=${config.seed}`);
  try {
    while (!abort.signal.aborted) {
      const started = performance.now();
      const sequence = builder.nextSequence;
      const chunks = packetizer.push(builder.next());
      await sender.send(chunks);
      console.log(`[TX] generated seq=${sequence} chunks=${chunks.length}`);
      const delay = Math.max(0, 1000 / config.frameRate - (performance.now() - started));
      try { await setTimeout(delay, undefined, { signal: abort.signal }); }
      catch (error) { if (!abort.signal.aborted) throw error; }
    }
    await sender.send(packetizer.flush());
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await sender.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`[TX] ${error.message}`); process.exitCode = 1; });
}

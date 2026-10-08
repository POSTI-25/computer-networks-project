import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { startReceiver } from '../src/receiver/index.js';
import { Synchronizer } from '../src/receiver/synchronizer.js';
import { Metrics } from '../src/receiver/metrics.js';
import { startWebSocketServer, validFrameMessage } from '../src/receiver/websocketServer.js';
import type { ReceiverMessage, ReceiverMetrics } from '../src/shared/observability.js';
import { encodeFrame } from '../src/shared/frame.js';
import { BitstreamSimulator } from '../src/transmitter/bitstreamSimulator.js';
import { buildTransmissionUnit, mockTelemetry } from '../src/transmitter/frameBuilder.js';
import { createUdpSender } from '../src/transmitter/index.js';
import { packetize } from '../src/transmitter/packetizer.js';
import { asm } from './bitHelpers.js';

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for WebSocket/UDP observation');
    await setTimeout(5);
  }
}

async function connect(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: ReceiverMessage[] = [];
  const statusTimes: number[] = [];
  socket.on('message', data => {
    const message = JSON.parse(data.toString()) as ReceiverMessage;
    messages.push(message);
    if (message.type === 'receiver.status') statusTimes.push(performance.now());
  });
  socket.on('error', () => {});
  await once(socket, 'open');
  return { socket, messages, statusTimes };
}

function metrics(): ReceiverMetrics {
  const sync = new Synchronizer();
  return new Metrics(() => sync.stats, () => ({ udpDatagramsReceived: 12, udpBytesReceived: 520 })).snapshot();
}

test('WS-1/2: client connects and periodic status has exact PRD metric keys and ISO UTC time', { timeout: 10000 }, async () => {
  const known = { ...metrics(), state: 'LOCK' as const, synced: true, currentBitAlignment: 3, crcFailures: 2 };
  const bridge = await startWebSocketServer({ port: 0, readMetrics: () => known });
  let client: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    const address = bridge.server.address();
    assert.ok(address && typeof address !== 'string');
    client = await connect(address.port);
    const inbox = client.messages;
    await waitFor(() => inbox.length > 0);
    const message = inbox[0];
    assert.equal(message.type, 'receiver.status');
    assert.deepEqual(Object.keys(message).sort(), ['metrics', 'timestamp', 'type']);
    if (message.type !== 'receiver.status') throw new Error('Expected status');
    assert.deepEqual(Object.keys(message.metrics).sort(), [
      'state', 'synced', 'udpDatagramsReceived', 'udpBytesReceived', 'asmDetections', 'validFrames',
      'crcFailures', 'formatFailures', 'sequenceGaps', 'resyncCount', 'framesPerSecond', 'bytesPerSecond',
      'bufferedBits', 'currentBitAlignment',
    ].sort());
    assert.deepEqual(message.metrics, known);
    assert.equal(new Date(message.timestamp).toISOString(), message.timestamp);
  } finally { client?.socket.terminate(); await bridge.close(); }
});

test('WS-3/4: exact valid telemetry broadcasts to multiple clients; disconnect and zero clients are isolated', { timeout: 10000 }, async () => {
  const bridge = await startWebSocketServer({ port: 0, readMetrics: metrics });
  const address = bridge.server.address();
  assert.ok(address && typeof address !== 'string');
  const clients: Awaited<ReturnType<typeof connect>>[] = [];
  try {
    clients.push(await connect(address.port), await connect(address.port));
    const frame = new Synchronizer().push(buildTransmissionUnit(42))[0];
    bridge.publishFrame(frame);
    await waitFor(() => clients.every(client => client.messages.some(message => message.type === 'frame.valid')));
    for (const client of clients) {
      const message = client.messages.find(message => message.type === 'frame.valid')!;
      assert.deepEqual(Object.keys(message).sort(), ['frame', 'timestamp', 'type']);
      assert.deepEqual(message.frame, { sequence: 42, payloadLength: 12, ...mockTelemetry(42), bitAlignment: 0 });
      assert.equal(new Date(message.timestamp).toISOString(), message.timestamp);
    }
    clients[0].socket.close();
    await once(clients[0].socket, 'close');
    await waitFor(() => bridge.server.clients.size === 1);
    bridge.publishFrame(new Synchronizer().push(buildTransmissionUnit(43))[0]);
    await waitFor(() => clients[1].messages.some(message => message.type === 'frame.valid' && message.frame.sequence === 43));
    clients[1].socket.terminate();
    await waitFor(() => bridge.server.clients.size === 0);
    assert.doesNotThrow(() => bridge.publishFrame(frame));
    clients.push(await connect(address.port));
    bridge.publishFrame(frame);
    await waitFor(() => clients[2].messages.some(message => message.type === 'frame.valid'));
  } finally {
    clients.forEach(client => client.socket.terminate());
    await bridge.close();
    await bridge.close();
  }
});

test('status cadence is bounded while valid frames publish immediately', { timeout: 10000 }, async () => {
  const bridge = await startWebSocketServer({ port: 0, readMetrics: metrics });
  const address = bridge.server.address();
  assert.ok(address && typeof address !== 'string');
  const client = await connect(address.port);
  try {
    for (let i = 0; i < 20; i++) bridge.publishFrame(new Synchronizer().push(buildTransmissionUnit(i))[0]);
    await waitFor(() => client.messages.filter(message => message.type === 'frame.valid').length === 20);
    await waitFor(() => client.statusTimes.length >= 4);
    // Allow small transport scheduling jitter; source uses an exact monotonic >=250-ms guard.
    for (let i = 1; i < client.statusTimes.length; i++) assert.ok(client.statusTimes[i] - client.statusTimes[i - 1] >= 230);
  } finally { client.socket.terminate(); await bridge.close(); }
});

test('bridge suppresses CRC/format-invalid and short-payload telemetry without altering receiver acceptance', () => {
  const frame = new Synchronizer().push(buildTransmissionUnit(0))[0];
  assert.equal(validFrameMessage({ ...frame, frame: { ...frame.frame, crcValid: false } }), null);
  assert.equal(validFrameMessage({ ...frame, frame: { ...frame.frame, formatValid: false } }), null);
  const short = new Synchronizer().push(Buffer.concat([asm(), encodeFrame({ sequence: 2, payload: Buffer.alloc(3) })]))[0];
  assert.equal(short.frame.crcValid, true);
  assert.equal(validFrameMessage(short), null);
});

for (const [mode, alignment] of [['clean', 0], ['bit-flip', 0], ['bit-insert', 1], ['bit-delete', 7]] as const) {
  test(`real UDP -> WebSocket: ${mode} exposes valid-only telemetry, gaps, CRC and recovery`, { timeout: 10000 }, async () => {
    const receiver = await startReceiver({ port: 0, websocket: { port: 0 } });
    const address = receiver.websocket!.server.address();
    assert.ok(address && typeof address !== 'string');
    let client: Awaited<ReturnType<typeof connect>> | undefined;
    let sender: Awaited<ReturnType<typeof createUdpSender>> | undefined;
    try {
      client = await connect(address.port);
      sender = await createUdpSender('127.0.0.1', receiver.socket.address().port);
      const simulator = new BitstreamSimulator({ mode, targetFrame: 1 });
      const stream = Buffer.concat([simulator.push(Buffer.concat([0, 1, 2, 3, 4, 5].map(buildTransmissionUnit))), simulator.flush()]);
      const chunks = packetize(stream, { minChunkBytes: 1, maxChunkBytes: 16 });
      await sender.send(chunks);
      const inbox = client.messages;
      const expected = mode === 'clean' ? [0, 1, 2, 3, 4, 5] : [0, 2, 3, 4, 5];
      await waitFor(() => inbox.some(message => message.type === 'receiver.status' && message.metrics.validFrames === expected.length));
      const frames = inbox.filter(message => message.type === 'frame.valid');
      assert.deepEqual(frames.map(message => message.frame.sequence), expected);
      frames.forEach(message => {
        assert.equal(message.frame.bitAlignment, message.frame.sequence === 0 ? 0 : alignment);
        assert.equal(message.frame.temperatureC, mockTelemetry(message.frame.sequence).temperatureC);
      });
      const status = inbox.find(message => message.type === 'receiver.status' && message.metrics.validFrames === expected.length)!;
      assert.equal(status.type, 'receiver.status');
      if (status.type !== 'receiver.status') throw new Error('Expected status');
      assert.equal(status.metrics.crcFailures, mode === 'clean' ? 0 : 1);
      assert.equal(status.metrics.sequenceGaps, mode === 'clean' ? 0 : 1);
      assert.equal(status.metrics.resyncCount, mode === 'clean' ? 0 : 1);
      assert.equal(status.metrics.udpDatagramsReceived, chunks.length);
      assert.equal(status.metrics.udpBytesReceived, stream.length);
      assert.ok(status.metrics.framesPerSecond > 0);
      assert.ok(status.metrics.bytesPerSecond > 0);
      // Disconnect observer, continue same UDP stream: CRC/FSM must remain independent.
      client.socket.terminate();
      await waitFor(() => receiver.websocket!.server.clients.size === 0);
      // New clean mode simulator would reset carry, so keep using the same logical stream
      // only in clean/flip modes; slip modes already prove recovery with connected observers.
      if (alignment === 0) {
        await sender.send(packetize(buildTransmissionUnit(6)));
        await waitFor(() => receiver.synchronizer.stats.validFrames === expected.length + 1);
        assert.equal(receiver.metrics.snapshot().sequenceGaps, mode === 'clean' ? 0 : 1);
      }
    } finally { client?.socket.terminate(); await sender?.close(); await receiver.close(); }
  });
}

test('WebSocket bind failure rejects startup and releases its UDP socket', { timeout: 10000 }, async () => {
  const bridge = await startWebSocketServer({ port: 0, readMetrics: metrics });
  const address = bridge.server.address();
  assert.ok(address && typeof address !== 'string');
  const probe = await startReceiver({ port: 0 });
  const port = probe.socket.address().port;
  await probe.close();
  try {
    await assert.rejects(startReceiver({ port, websocket: { port: address.port } }), { code: 'EADDRINUSE' });
    const rebound = await startReceiver({ port });
    await rebound.close();
  } finally { await bridge.close(); }
});

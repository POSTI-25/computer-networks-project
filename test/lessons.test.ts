import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { buildLesson, LESSON_MODES } from '../src/receiver/lessons.js';
import { startReceiver } from '../src/receiver/index.js';
import { createUdpSender } from '../src/transmitter/index.js';
import { buildTransmissionUnit } from '../src/transmitter/frameBuilder.js';
import type { ReceiverMessage } from '../src/shared/observability.js';

for (const mode of LESSON_MODES) {
  test(`guided ${mode}: production engine records real CRC evidence and expected alignment`, () => {
    const lesson = buildLesson(mode);
    const frames = lesson.steps.flatMap(step => step.frames);
    const checks = lesson.steps.flatMap(step => step.trace.transitions.flatMap(event => event.validation ? [event.validation] : []));
    const fault = !['clean', 'bit-offset'].includes(mode);
    assert.deepEqual(frames.map(frame => frame.frame.sequence), fault ? [0, 1, 3, 4, 5] : [0, 1, 2, 3, 4, 5]);
    assert.equal(checks.filter(check => !check.crcValid).length, fault ? 1 : 0);
    checks.forEach(check => assert.equal(check.crcValid, check.storedCrc === check.calculatedCrc));
    assert.equal(frames.at(-1)!.frame.bitAlignment, mode === 'bit-offset' ? 3 : mode === 'bit-insert' ? 1 : mode === 'bit-delete' ? 7 : 0);
    const final = lesson.steps.at(-1)!.metrics;
    assert.equal(final.sequenceGaps, fault ? 1 : 0);
    assert.equal(final.resyncCount, fault ? 1 : 0);
    assert.ok(lesson.steps.some(step => step.trace.bufferedBefore > 0));
    assert.equal(lesson.steps.reduce((total, step) => total + step.trace.datagram.bytes, 0), final.udpBytesReceived);
    lesson.steps.forEach(step => { assert.equal(step.trace.datagram.bits.length, Math.min(step.trace.datagram.bytes, 8) * 8); });
    const markers = lesson.steps.flatMap(step => step.trace.transitions.filter(event => event.markerWindow));
    assert.ok(markers.length >= frames.length);
    markers.forEach(event => {
      const window = event.markerWindow!;
      assert.equal(Number.parseInt(window.bits.slice(window.markerIndex, window.markerIndex + 32), 2), 0x1acffc1d);
      assert.equal((window.streamStart + window.markerIndex) % 8, event.bitAlignment);
      assert.ok(window.bits.length <= 48);
    });
  });
}
test('unknown lesson modes cannot construct a recording', () => { assert.throws(() => buildLesson('invalid'), RangeError); });

test('WebSocket lesson request leaves live receiver untouched; live traces contain actual datagram bytes', { timeout: 10000 }, async () => {
  const receiver = await startReceiver({ port: 0, websocket: { port: 0 } });
  const address = receiver.websocket!.server.address(); assert.ok(address && typeof address !== 'string');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const inbox: ReceiverMessage[] = [];
  client.on('message', data => inbox.push(JSON.parse(data.toString())));
  let sender: Awaited<ReturnType<typeof createUdpSender>> | undefined;
  try {
    await once(client, 'open');
    const lessonArrived = new Promise<void>(resolve => client.on('message', data => { if (JSON.parse(data.toString()).type === 'lesson.recording') resolve(); }));
    client.send(JSON.stringify({ type: 'lesson.start', mode: 'bit-insert' }));
    await lessonArrived;
    assert.equal(receiver.metrics.snapshot().validFrames, 0);
    assert.equal(receiver.counters.udpDatagramsReceived, 0);
    const unit = buildTransmissionUnit(10);
    const traceArrived = new Promise<void>(resolve => client.on('message', data => { if (JSON.parse(data.toString()).type === 'receiver.trace') resolve(); }));
    sender = await createUdpSender('127.0.0.1', receiver.socket.address().port);
    await sender.send([unit.subarray(0, 13), unit.subarray(13)]);
    await traceArrived;
    const first = inbox.find(message => message.type === 'receiver.trace'); assert.ok(first && first.type === 'receiver.trace');
    assert.equal(first.datagram.bytes, 13);
    assert.equal(first.datagram.hex, unit.subarray(0, 13).toString('hex'));
    assert.equal(first.bufferedBefore, 0);
    assert.equal(first.bufferedAfter, 104);
    assert.ok(first.transitions.some(event => event.to === 'LOCK'));
  } finally { client.terminate(); await sender?.close(); await receiver.close(); }
});

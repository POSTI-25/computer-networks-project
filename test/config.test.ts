import assert from 'node:assert/strict';
import test from 'node:test';
import { readTransmitterConfig, readUdpConfig } from '../src/shared/config.js';

test('environment configuration defaults match the PRD', () => {
  assert.deepEqual(readTransmitterConfig({}), {
    host: '127.0.0.1', port: 5000, frameRate: 5, minChunkBytes: 1, maxChunkBytes: 96, seed: 42,
  });
});

test('all requested transmitter environment values can be overridden', () => {
  assert.deepEqual(readTransmitterConfig({
    UDP_HOST: '127.0.0.2', UDP_PORT: '5500', FRAME_RATE: '10',
    CHUNK_MIN_BYTES: '2', CHUNK_MAX_BYTES: '31', SIM_SEED: '43',
  }), { host: '127.0.0.2', port: 5500, frameRate: 10, minChunkBytes: 2, maxChunkBytes: 31, seed: 43 });
});

test('invalid endpoint and frame-rate environment values fail clearly', () => {
  for (const env of [
    { UDP_HOST: '' }, { UDP_PORT: '0' }, { UDP_PORT: '65536' }, { UDP_PORT: '2.5' },
    { UDP_PORT: 'abc' }, { FRAME_RATE: '0' }, { FRAME_RATE: '-1' }, { FRAME_RATE: 'Infinity' },
    { FRAME_RATE: '' }, { CHUNK_MIN_BYTES: 'abc' }, { SIM_SEED: '' },
  ]) assert.throws(() => readTransmitterConfig(env), RangeError);
});

test('receiver configuration ignores transmitter-only environment fields', () => {
  assert.deepEqual(readUdpConfig({ FRAME_RATE: 'invalid' }), { host: '127.0.0.1', port: 5000 });
});

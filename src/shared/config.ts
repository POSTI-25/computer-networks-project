import {
  DEFAULT_CHUNK_MAX_BYTES, DEFAULT_CHUNK_MIN_BYTES, DEFAULT_FRAME_RATE,
  DEFAULT_SIM_SEED, DEFAULT_UDP_HOST, DEFAULT_UDP_PORT,
} from './constants.js';

function numberFrom(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const text = env[name];
  if (text === undefined) return fallback;
  if (text.trim() === '' || !Number.isFinite(Number(text))) throw new RangeError(`${name} must be numeric`);
  return Number(text);
}

export function readUdpConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = env.UDP_HOST ?? DEFAULT_UDP_HOST;
  const port = numberFrom(env, 'UDP_PORT', DEFAULT_UDP_PORT);
  if (host.trim() === '') throw new RangeError('UDP_HOST must not be empty');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('UDP_PORT must be 1..65535');
  return { host, port };
}

export function readTransmitterConfig(env: NodeJS.ProcessEnv = process.env) {
  const endpoint = readUdpConfig(env);
  const frameRate = numberFrom(env, 'FRAME_RATE', DEFAULT_FRAME_RATE);
  const minChunkBytes = numberFrom(env, 'CHUNK_MIN_BYTES', DEFAULT_CHUNK_MIN_BYTES);
  const maxChunkBytes = numberFrom(env, 'CHUNK_MAX_BYTES', DEFAULT_CHUNK_MAX_BYTES);
  const seed = numberFrom(env, 'SIM_SEED', DEFAULT_SIM_SEED);
  if (frameRate <= 0) throw new RangeError('FRAME_RATE must be positive');
  // The Packetizer owns validation of its bounds and uint32 seed.
  return { ...endpoint, frameRate, minChunkBytes, maxChunkBytes, seed };
}

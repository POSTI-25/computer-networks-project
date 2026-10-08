import './style.css';
import type { ReceiverMessage, ReceiverMetrics } from '../../src/shared/observability.js';
import { appendRecent, statusEvents } from './events.js';

// Change this one constant if WS_PORT is overridden on the receiver.
const WEBSOCKET_URL = 'ws://127.0.0.1:8080';
let previousStatus: ReceiverMetrics | null = null;
let previousFrameAlignment: number | null = null;
let recent: string[] = [];
let reconnect: ReturnType<typeof setTimeout> | undefined;
let socket: WebSocket;
let stopped = false;

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing dashboard element ${id}`);
  return found;
}
function display(id: string, value: string | number): void { element(id).textContent = String(value); }
function log(events: string[]): void {
  const time = new Date().toLocaleTimeString();
  recent = appendRecent(recent, events.map(event => `${time} · ${event}`));
  const rows = [...recent].reverse().map(event => {
    const row = document.createElement('li');
    row.textContent = event;
    return row;
  });
  element('events').replaceChildren(...rows);
}

function render(message: ReceiverMessage): void {
  if (message.type === 'receiver.status') {
    const metrics = message.metrics;
    log(statusEvents(previousStatus, metrics));
    previousStatus = metrics;
    display('state', metrics.state);
    display('synced', metrics.synced ? 'Synced' : 'Unsynced');
    element('synced').className = `sync-status ${metrics.synced ? 'good' : 'neutral'}`;
    display('currentBitAlignment', metrics.currentBitAlignment ?? '—');
    for (const key of ['validFrames', 'crcFailures', 'sequenceGaps', 'resyncCount', 'udpDatagramsReceived', 'bufferedBits'] as const)
      display(key, metrics[key]);
    display('framesPerSecond', metrics.framesPerSecond.toFixed(1));
    display('bytesPerSecond', metrics.bytesPerSecond.toFixed(0));
  } else if (message.type === 'frame.valid') {
    const frame = message.frame;
    const events = [`Valid frame ${frame.sequence} · alignment ${frame.bitAlignment}`];
    if (previousFrameAlignment !== null && previousFrameAlignment !== frame.bitAlignment)
      events.unshift(`Valid-frame alignment ${previousFrameAlignment} → ${frame.bitAlignment}`);
    previousFrameAlignment = frame.bitAlignment;
    log(events);
    display('sequence', frame.sequence);
    display('temperatureC', frame.temperatureC === null ? '—' : `${frame.temperatureC.toFixed(2)} °C`);
    display('batteryMv', frame.batteryMv === null ? '—' : `${frame.batteryMv} mV`);
    display('altitudeM', frame.altitudeM === null ? '—' : `${frame.altitudeM} m`);
    display('uptimeSeconds', frame.uptimeSeconds === null ? '—' : `${frame.uptimeSeconds} s`);
    display('latestAlignment', frame.bitAlignment);
  }
}

function connect(): void {
  socket = new WebSocket(WEBSOCKET_URL);
  socket.onopen = () => {
    previousStatus = null;
    previousFrameAlignment = null;
    document.querySelectorAll('dd').forEach(field => { field.textContent = '—'; });
    display('state', '—');
    display('synced', 'Waiting for receiver status');
    display('connection', 'WebSocket: Connected');
    element('connection').className = 'indicator connected';
    log(['Dashboard connected']);
  };
  socket.onmessage = event => {
    try { render(JSON.parse(event.data) as ReceiverMessage); }
    catch { log(['Unreadable receiver message']); }
  };
  socket.onclose = () => {
    display('connection', 'WebSocket: Disconnected · last received values');
    element('connection').className = 'indicator disconnected';
    log(['Dashboard disconnected']);
    if (!stopped) reconnect = setTimeout(connect, 1000);
  };
  socket.onerror = () => socket.close();
}
window.addEventListener('beforeunload', () => {
  stopped = true;
  clearTimeout(reconnect);
  socket.close();
});
connect();

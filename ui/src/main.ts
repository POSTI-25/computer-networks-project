import './style.css';
import type { LessonRecording, ReceiverMessage, ReceiverMetrics, TraceMessage, ValidFrameMessage } from '../../src/shared/observability.js';
import type { SyncTransition } from '../../src/receiver/synchronizer.js';
import { appendRecent } from './events.js';

const WEBSOCKET_URL = 'ws://127.0.0.1:8080';
const stages = [
  ['◇', 'Spacecraft', 'Mock readings', 'Mock spacecraft', 'Generate temperature, battery voltage, altitude, and simulated uptime. These values are deterministic, so experiments can be repeated.', 'frameBuilder.ts'],
  ['▤', 'Frame builder', 'ASM + body + CRC', 'Give the stream a structure', 'Encode a sequence number and payload in a 256-byte body. Calculate CRC-16, then prepend the 32-bit ASM. One complete unit is 260 bytes.', 'shared/frame.ts'],
  ['ϟ', 'Impairment', 'Flip / insert / delete', 'Introduce a controlled fault', 'After CRC is generated, change the logical bitstream. A flip changes a value; insertion or deletion also shifts subsequent boundaries. These faults simulate a damaged link before UDP packetization.', 'bitstreamSimulator.ts'],
  ['▥', 'UDP chunks', 'Arbitrary boundaries', 'One frame is not one message', 'The packetizer splits the stream into variable-size chunks. In Live mode, each chunk travels as an intact UDP datagram. A marker or frame may span multiple datagrams.', 'packetizer.ts'],
  ['▰', 'Bit buffer', 'Preserve partial data', 'Keep the unfinished pieces', 'Append each datagram to the same persistent buffer. Do not reset at network-message boundaries. Search one bit at a time and retain incomplete candidates for the next arrival.', 'bitBuffer.ts'],
  ['⌕', 'Synchronizer', 'HUNT → CRC → accept', 'Find and validate the next frame', 'HUNT finds the marker; LOCK waits for 2,080 bits; VERIFY checks CRC and format; EXTRACT accepts valid telemetry. Failure advances one bit from the rejected marker before searching again.', 'synchronizer.ts'],
  ['◉', 'Ground station', 'Decoded telemetry', 'Observe the result', 'Only accepted frames become telemetry. The receiver publishes observations over WebSocket; the browser is not the UDP receiver. Guided recordings run the same engine in isolation.', 'websocketServer.ts'],
];
const fields = [
  ['ASM', '4 bytes', 'Attached Sync Marker · external bytes 0–3', '0x1ACFFC1D is the known 32-bit start pattern. Search every bit position; finding a marker alone does not prove the following frame is valid.'],
  ['Sequence', '4 bytes', 'Sequence · body bytes 0–3', 'An unsigned 32-bit identifier. A forward jump between accepted sequences reveals missing frame observations. It does not count missing UDP datagrams.'],
  ['Length', '2 bytes', 'Payload length · body bytes 4–5', 'Number of meaningful payload bytes, from 0 to 246. Values above capacity fail format validation. The default telemetry uses 12 bytes.'],
  ['Flags', '2 bytes', 'Flags · body bytes 6–7', 'A reserved field, set to zero by the default transmitter. Integers are encoded in big-endian order.'],
  ['Payload + padding', '246 bytes', 'Payload area · body bytes 8–253', 'Default payload: temperature (2 bytes), battery (2), altitude (4), and simulated uptime (4). Unused capacity is zero-filled. Padding is not decoded as sensor data.'],
  ['CRC-16', '2 bytes', 'CRC-16 · body bytes 254–255', 'Stored big-endian CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF. Covers body bytes 0–253, excluding the ASM and the CRC itself. Detects corruption; cannot repair it.'],
];
const descriptions: Record<string, string> = {
  HUNT: 'Search every bit position for 0x1ACFFC1D. Keep up to 31 trailing bits when no complete marker is found.',
  LOCK: 'Marker found. Keep buffering until the full 2,080-bit transmission unit is available.',
  VERIFY: 'Extract the 256-byte body and calculate CRC. Compare it with the stored CRC and check the payload length.',
  EXTRACT: 'CRC and format passed. Accept the frame, decode its meaningful payload, and consume the transmission unit.',
};
function el(id: string): HTMLElement { const node = document.getElementById(id); if (!node) throw new Error(`Missing ${id}`); return node; }
function text(id: string, value: string | number): void { el(id).textContent = String(value); }
function value(id: string): string { return (el(id) as HTMLSelectElement).value; }
function span(content: string, className: string): HTMLElement { const node = document.createElement('span'); node.textContent = content; node.className = className; return node; }
function selectStage(index: number): void {
  document.querySelectorAll('.pipeline-node').forEach((node, i) => { node.classList.toggle('selected', i === index); node.setAttribute('aria-pressed', String(i === index)); });
  text('stage-index', String(index + 1).padStart(2, '0')); text('stage-title', stages[index][3]); text('stage-description', stages[index][4]); text('stage-code', stages[index][5]);
}
stages.forEach((stage, i) => {
  const button = document.createElement('button'); button.className = 'pipeline-node'; button.id = `stage-${i}`;
  const icon = document.createElement('b'); icon.textContent = stage[0]; const label = document.createElement('strong'); label.textContent = stage[1]; const sub = document.createElement('small'); sub.textContent = stage[2];
  button.append(icon, label, sub); button.onclick = () => selectStage(i); el('pipeline').append(button);
});
fields.forEach((field, i) => {
  const button = document.createElement('button'); button.className = `frame-field${i === 0 ? ' selected' : ''}`; button.dataset.field = String(i); button.setAttribute('aria-pressed', String(i === 0)); button.append(document.createTextNode(field[0]), span(field[1], ''));
  button.onclick = () => { document.querySelectorAll('.frame-field').forEach(node => { node.classList.toggle('selected', node === button); node.setAttribute('aria-pressed', String(node === button)); }); text('field-title', field[2]); text('field-description', field[3]); };
  el('frame-layout').append(button);
});
for (const state of Object.keys(descriptions)) { const node = span(state, 'fsm-node'); node.dataset.state = state; el('fsm').append(node); }
for (let i = 0; i < 8; i++) { const node = span(String(i), 'align-cell'); node.dataset.alignment = String(i); el('alignment').append(node); }
selectStage(0);

let socket: WebSocket;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
let mode: 'live' | 'lesson' = 'live';
let frozen = false;
let recent: string[] = [];
let packets: { index: number; bytes: number }[] = [];
let candidates: { sequence: number; valid: boolean }[] = [];
let latestStatus: ReceiverMetrics | null = null;
let latestFrame: ValidFrameMessage | null = null;
let alignment: number | null = null;
let recording: LessonRecording | null = null;
type PlaybackStep = { trace: TraceMessage; metrics: ReceiverMetrics; frames: ValidFrameMessage[]; transition?: SyncTransition; first: boolean; last: boolean };
let playback: PlaybackStep[] = [];
let cursor = 0;
let playing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let markerWindow: SyncTransition['markerWindow'];

function renderMarker(position: number): void {
  if (!markerWindow) return;
  const window = markerWindow;
  el('marker-window').replaceChildren(...[...window.bits].map((bit, i) => {
    const node = span(bit, `marker-bit${i >= position && i < position + 32 ? ' in-window' : ''}${(window.streamStart + i) % 8 === 0 ? ' byte-start' : ''}`);
    node.title = `Stream bit ${window.streamStart + i}`;
    return node;
  }));
  const hex = Number.parseInt(window.bits.slice(position, position + 32), 2).toString(16).toUpperCase().padStart(8, '0');
  const matches = hex === '1ACFFC1D';
  text('scan-value', `0x${hex}`);
  text('marker-result', matches ? 'ASM matches ✓' : 'No match · shift one bit →');
  text('marker-detail', `Window starts at stream bit ${window.streamStart + position}, alignment ${(window.streamStart + position) % 8}. ${matches ? 'Exact marker found. The full body still needs CRC validation.' : 'This position is not the marker. HUNT advances one bit, rather than jumping to the next byte.'}`);
}
el('scan-position').oninput = () => renderMarker(Number((el('scan-position') as HTMLInputElement).value));

function log(events: string[]): void {
  if (!events.length) return;
  const stamp = mode === 'lesson' ? `STEP ${cursor}` : new Date().toLocaleTimeString();
  recent = appendRecent(recent, events.map(event => `${stamp} · ${event}`));
  el('events').replaceChildren(...[...recent].reverse().map(event => { const row = document.createElement('li'); row.textContent = event; return row; }));
}
function renderState(state: string, at: number | null): void {
  text('state', state); text('state-explanation', descriptions[state] ?? 'Waiting for receiver data.'); text('synced', state === 'HUNT' ? 'Searching' : state === 'WAITING' ? 'Waiting' : 'Candidate acquired');
  text('currentBitAlignment', at ?? '—');
  document.querySelectorAll<HTMLElement>('.fsm-node').forEach(node => { node.classList.toggle('active', node.dataset.state === state); });
  document.querySelectorAll<HTMLElement>('.align-cell').forEach(node => { node.classList.toggle('active', at !== null && node.dataset.alignment === String(at)); });
}
function renderMetrics(metrics: ReceiverMetrics): void {
  for (const key of ['validFrames', 'crcFailures', 'sequenceGaps', 'resyncCount', 'udpDatagramsReceived', 'bufferedBits'] as const) text(key, metrics[key]);
  text('framesPerSecond', mode === 'lesson' ? 'Replay' : metrics.framesPerSecond.toFixed(1));
  text('bytesPerSecond', mode === 'lesson' ? 'Step timing is illustrative' : `${metrics.bytesPerSecond.toFixed(0)} bytes / sec`);
  el('buffer-fill').style.width = `${Math.min(100, metrics.bufferedBits / 2080 * 100)}%`;
  renderState(metrics.state, metrics.currentBitAlignment);
}
function renderFrame(message: ValidFrameMessage): void {
  const frame = message.frame;
  text('sequence', frame.sequence); text('temperatureC', frame.temperatureC === null ? '—' : `${frame.temperatureC.toFixed(2)} °C`);
  text('batteryMv', frame.batteryMv === null ? '—' : `${frame.batteryMv} mV`); text('altitudeM', frame.altitudeM === null ? '—' : `${frame.altitudeM.toLocaleString()} m`);
  text('uptimeSeconds', frame.uptimeSeconds === null ? '—' : `${frame.uptimeSeconds} s`); text('latestAlignment', frame.bitAlignment);
  if (alignment !== null && alignment !== frame.bitAlignment) {
    text('recovery-callout', `RECOVERED · Valid marker alignment changed from ${alignment} to ${frame.bitAlignment}. The same receiver found the shifted stream automatically.`);
    el('recovery-callout').classList.remove('fault'); log([`Recovered alignment ${alignment} → ${frame.bitAlignment}`]);
  }
  alignment = frame.bitAlignment;
  log([`Accepted sequence ${frame.sequence} · alignment ${frame.bitAlignment}`]);
  pulse(6);
}
function pulse(index: number): void { const node = el(`stage-${index}`); node.classList.remove('pulse'); void node.offsetWidth; node.classList.add('pulse'); }
function renderPacket(trace: TraceMessage): void {
  packets = [...packets, trace.datagram].slice(-8);
  el('packet-lane').replaceChildren(...packets.map(packet => { const node = document.createElement('div'); node.className = 'packet'; node.textContent = `${packet.bytes} B`; const sub = document.createElement('small'); sub.textContent = `#${packet.index}`; node.append(sub); return node; }));
  text('packet-badge', `${mode === 'lesson' ? 'Chunk' : 'Datagram'} #${trace.datagram.index}`); text('raw-size', `${trace.datagram.bytes} bytes total`);
  el('raw-bits').replaceChildren(...(trace.datagram.bits.match(/.{1,8}/g) ?? []).map(byte => span(byte, 'raw-byte')));
  text('raw-hex', `HEX ${(trace.datagram.hex.match(/.{1,2}/g) ?? []).join(' ')}${trace.datagram.bytes > 24 ? ' …' : ''}`);
  text('buffer-explanation', `${trace.bufferedBefore} bits retained + ${trace.datagram.bytes * 8} incoming bits → ${trace.bufferedAfter} bits left after this chunk is fully processed.`);
  pulse(3); pulse(4);
}
function renderTransition(transition: SyncTransition): void {
  if (transition.markerWindow) {
    markerWindow = transition.markerWindow;
    const slider = el('scan-position') as HTMLInputElement;
    slider.disabled = false; slider.max = String(markerWindow.bits.length - 32); slider.value = String(markerWindow.markerIndex);
    renderMarker(markerWindow.markerIndex);
  }
  renderState(transition.to, transition.bitAlignment);
  text('transition-position', `${transition.from} → ${transition.to} · ${transition.reason.replaceAll('_', ' ')} · stream head bit ${transition.headBitOffset}`);
  log([`${transition.from} → ${transition.to} · ${transition.reason.replaceAll('_', ' ')} · bit ${transition.headBitOffset}`]); pulse(5);
  const check = transition.validation;
  if (!check) return;
  const valid = check.crcValid && check.formatValid;
  text('stored-crc', `0x${check.storedCrc.toString(16).toUpperCase().padStart(4, '0')}`); text('calculated-crc', `0x${check.calculatedCrc.toString(16).toUpperCase().padStart(4, '0')}`);
  text('crc-symbol', check.crcValid ? '=' : '≠'); el('crc-symbol').className = valid ? 'crc-good' : 'crc-bad';
  text('crc-verdict', `Sequence ${check.sequence} · ${valid ? 'accepted' : 'rejected'}`);
  text('crc-story', valid ? 'Stored and calculated CRC match; the payload length is valid. This candidate is accepted.' : check.crcValid ? 'CRC matches, but the payload length is invalid. Reject the candidate and hunt again.' : 'The two CRC values differ. Reject this candidate; resume searching one bit after its marker.');
  candidates = [...candidates, { sequence: check.sequence, valid }].slice(-12);
  el('frame-history').replaceChildren(...candidates.map(candidate => { const node = span(`${candidate.valid ? '✓' : '×'} ${candidate.sequence}`, `frame-chip${candidate.valid ? '' : ' bad'}`); node.title = `Sequence ${candidate.sequence}: ${candidate.valid ? 'accepted' : 'rejected'}`; return node; }));
  if (!valid) { text('recovery-callout', `REJECTED · Sequence ${check.sequence}. The receiver advances one bit from this candidate's marker and hunts for the next ASM. Watch later frames continue.`); el('recovery-callout').classList.add('fault'); }
  else if (el('recovery-callout').classList.contains('fault')) { text('recovery-callout', `RECOVERED · Sequence ${check.sequence} passed validation after the rejection. Damaged data was skipped; later telemetry continues.`); el('recovery-callout').classList.remove('fault'); }
}
function resetView(): void {
  recent = []; packets = []; candidates = []; alignment = null;
  markerWindow = undefined; el('marker-window').replaceChildren(span('The next marker acquisition will appear here.', 'empty'));
  const slider = el('scan-position') as HTMLInputElement; slider.disabled = true; slider.max = '0'; slider.value = '0';
  text('scan-value', '0x1ACFFC1D is the target'); text('marker-result', 'Awaiting a marker'); text('marker-detail', 'Pause a guided experiment, then slide the 32-bit window over the captured bits.');
  document.querySelectorAll('dd').forEach(node => { node.textContent = '—'; });
  for (const id of ['packet-lane', 'frame-history', 'events']) el(id).replaceChildren();
  text('bytesPerSecond', '—'); text('raw-bits', 'Waiting for the next chunk'); text('raw-hex', 'HEX —'); text('raw-size', '—'); text('packet-badge', 'Awaiting input');
  text('stored-crc', '—'); text('calculated-crc', '—'); text('crc-symbol', '?'); el('crc-symbol').className = ''; text('crc-verdict', 'No candidate checked');
  text('crc-story', 'Compare the stored CRC with the value calculated from the received body.');
  text('recovery-callout', 'CRC detects damage. Recovery finds the next frame; it does not repair the damaged frame.'); el('recovery-callout').classList.remove('fault');
  text('buffer-explanation', 'Waiting for input. The buffer survives message boundaries.'); text('transition-position', 'Marker: 0x1ACFFC1D · 32 bits · searched MSB first'); el('buffer-fill').style.width = '0%'; renderState('WAITING', null);
}
function stopPlayback(): void { playing = false; clearTimeout(timer); text('play', '▶ Play'); }
function playbackControls(): void {
  for (const id of ['play', 'step', 'next-event']) (el(id) as HTMLButtonElement).disabled = playback.length === 0 || cursor >= playback.length;
  text('lesson-progress', playback.length ? `${cursor} / ${playback.length} steps${cursor === playback.length ? ' · complete' : ''}` : 'Waiting for recording');
}
function loadRecording(data: LessonRecording): void {
  stopPlayback(); recording = data; playback = []; cursor = 0; resetView();
  data.steps.forEach(step => {
    const transitions = step.trace.transitions;
    if (!transitions.length) playback.push({ ...step, first: true, last: true });
    else transitions.forEach((transition, i) => playback.push({ ...step, transition, first: i === 0, last: i === transitions.length - 1 }));
  });
  text('mode-note', `Guided replay · ${data.mode} · same receiver engine, chunks processed in memory`);
  text('trace-note', 'Deterministic six-frame recording from the production engine. Frame 2 is the fault target. Each state transition is expanded for teaching; buffer totals and counters update at chunk completion. No UDP sockets or live state are changed.');
  log([`Loaded ${data.mode} experiment · press Step or Play`]); playbackControls();
}
function advance(): boolean {
  if (cursor >= playback.length) { stopPlayback(); return false; }
  const step = playback[cursor++];
  if (step.first) renderPacket(step.trace);
  if (step.last) renderMetrics(step.metrics);
  if (step.transition) renderTransition(step.transition);
  if (step.last) step.frames.forEach(renderFrame);
  playbackControls();
  if (cursor === playback.length) { stopPlayback(); log(['Experiment complete. Choose another scenario or restart.']); }
  return Boolean(step.transition);
}
function tick(): void { if (!playing) return; advance(); if (playing) timer = setTimeout(tick, Number(value('speed'))); }
function requestLesson(): void {
  stopPlayback(); recording = null; playback = []; cursor = 0; resetView(); playbackControls();
  if (socket?.readyState !== WebSocket.OPEN) { text('lesson-progress', 'Start npm run receiver to load experiments'); return; }
  text('lesson-progress', 'Loading experiment…'); socket.send(JSON.stringify({ type: 'lesson.start', mode: value('scenario') }));
}
function switchMode(next: 'live' | 'lesson'): void {
  stopPlayback(); mode = next; frozen = false; text('freeze', 'Freeze live visuals'); el('freeze').hidden = next === 'lesson';
  for (const [id, active] of [['live-tab', next === 'live'], ['lesson-tab', next === 'lesson']] as const) { el(id).classList.toggle('selected', active); el(id).setAttribute('aria-pressed', String(active)); }
  el('lesson-controls').hidden = next !== 'lesson'; resetView();
  if (next === 'lesson') requestLesson();
  else { text('mode-note', 'Actual UDP traffic · receiver → WebSocket → browser'); text('trace-note', 'Live observations from the receiver. Freeze visuals to discuss a snapshot; backend reception continues.'); if (latestStatus) renderMetrics(latestStatus); if (latestFrame) renderFrame(latestFrame); }
}
el('live-tab').onclick = () => switchMode('live'); el('lesson-tab').onclick = () => switchMode('lesson');
el('scenario').onchange = requestLesson;
el('restart').onclick = () => { if (recording && recording.mode === value('scenario')) loadRecording(recording); else requestLesson(); };
el('step').onclick = () => { stopPlayback(); advance(); };
el('next-event').onclick = () => { stopPlayback(); while (cursor < playback.length) if (advance()) break; };
el('play').onclick = () => { if (playing) stopPlayback(); else { playing = true; text('play', 'Ⅱ Pause'); tick(); } };
el('freeze').onclick = () => { frozen = !frozen; text('freeze', frozen ? 'Resume live visuals' : 'Freeze live visuals'); text('mode-note', frozen ? 'Frozen snapshot · backend reception continues' : 'Actual UDP traffic · receiver → WebSocket → browser'); if (!frozen) { if (latestStatus) renderMetrics(latestStatus); if (latestFrame) renderFrame(latestFrame); } };
el('present').onclick = async () => {
  document.body.classList.toggle('presenting'); text('present', document.body.classList.contains('presenting') ? 'Exit presentation' : 'Present ↗');
  try { if (document.body.classList.contains('presenting')) await document.documentElement.requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* Compact presentation layout works without fullscreen permission. */ }
};
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { document.body.classList.remove('presenting'); text('present', 'Present ↗'); } });
function receive(message: ReceiverMessage): void {
  if (message.type === 'lesson.recording') { if (mode === 'lesson' && message.mode === value('scenario')) loadRecording(message); return; }
  if (message.type === 'receiver.status') latestStatus = message.metrics;
  if (message.type === 'frame.valid') latestFrame = message;
  if (mode !== 'live' || frozen) return;
  if (message.type === 'receiver.status') renderMetrics(message.metrics);
  else if (message.type === 'frame.valid') renderFrame(message);
  else { renderPacket(message); message.transitions.forEach(renderTransition); }
}
function connect(): void {
  socket = new WebSocket(WEBSOCKET_URL);
  socket.onopen = () => {
    latestStatus = null; latestFrame = null; text('connection', 'Receiver connected'); el('connection').className = 'indicator connected';
    if (mode === 'live') { resetView(); log(['Connected to receiver. Waiting for UDP traffic.']); }
    else if (!recording) requestLesson();
  };
  socket.onmessage = event => { try { receive(JSON.parse(event.data) as ReceiverMessage); } catch { log(['Could not read receiver message']); } };
  socket.onclose = () => { text('connection', 'Receiver offline'); el('connection').className = 'indicator disconnected'; if (mode === 'live') text('mode-note', 'Receiver disconnected · displayed values are the last observations'); if (!stopped) reconnect = setTimeout(connect, 1000); };
  socket.onerror = () => socket.close();
}
window.addEventListener('beforeunload', () => { stopped = true; stopPlayback(); clearTimeout(reconnect); socket.close(); });
playbackControls(); connect();

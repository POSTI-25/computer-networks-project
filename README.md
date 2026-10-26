# Simulated Telemetry Ground Station

A software-only Computer Networks project: mock spacecraft telemetry is framed,
impaired, and deliberately fragmented across UDP datagrams. A persistent ground
receiver searches every bit for the ASM, verifies CRC, rejects damaged frames, and
automatically reacquires synchronization. An interactive teaching dashboard visualizes it.
`prd.md` is authoritative; `context.md` records implementation and final evidence.

## Technical focus and architecture

The protected behavior is persistent UDP-independent buffering, bit-level ASM search
at alignments 0–7, explicit HUNT/LOCK/VERIFY/EXTRACT states, CRC-controlled acceptance,
one-bit-after-failed-ASM resynchronization, and recovery after changed bit alignment.
UDP, CRC, FSMs, CCSDS ASM concepts, and WebSockets are standard building blocks.

```text
FrameBuilder -> BitstreamSimulator -> Packetizer -> UDP sender
    -> UDP receiver -> persistent BitBuffer -> Synchronizer FSM
    -> CRC / frame decoder -> accepted frames -> Metrics -> WebSocket -> Dashboard
```

HUNT scans every bit and retains at most 31 trailing bits. LOCK waits for all 2080
candidate bits. VERIFY extracts/checks the body; EXTRACT emits and consumes a valid
unit. Failed CRC or format validation resumes search one bit after the failed ASM
start, including markers inside the rejected candidate. Receiver storage is capped
at 64 KiB and compacted; the FSM processes large input in 4 KiB batches.

WebSocket is only the ground-to-browser observer link. The receiver continues without
browser clients, and never receives simulator fault locations or alignment hints.

## Stack and installation

Node.js **22.19.0** (LTS), npm **10.9.3**, TypeScript, Node Buffer, `node:dgram`,
project-owned CRC/BitBuffer, `ws`, Vite, vanilla HTML/CSS/TypeScript, and `node:test`.
One package; `ws` is the only external runtime dependency.

```text
git clone https://github.com/POSTI-25/computer-networks-project.git
cd computer-networks-project
npm ci
```

## Frame format

External ASM: **0x1ACFFC1D**, 32 bits, MSB-first. It precedes the custom **256-byte**
body; the clean transmission unit is 260 bytes / 2080 bits. Integers are big-endian.

| Body bytes | Field |
|---|---|
| 0–3 | uint32 sequence |
| 4–5 | uint16 payloadLength, 0–246 |
| 6–7 | uint16 flags, default 0 |
| 8–253 | 246-byte payload, unused bytes zero-filled |
| 254–255 | CRC-16, big-endian, covering body bytes 0–253 |

Default meaningful payload is 12 bytes: signed int16 centi-degree temperature,
uint16 battery millivolts, uint32 altitude metres, uint32 uptime seconds.
CRC parameters: polynomial `0x1021`, initial `0xFFFF`, refin/refout false, xorout
`0x0000`; ASCII `123456789` gives `0x29B1`.

## Running and demonstrations

Use three terminals, starting the receiver first:

```text
npm run receiver
npm run transmitter -- --mode clean
npm run ui
```

Open **http://127.0.0.1:5173**. UDP defaults to **127.0.0.1:5000** and WebSocket to
**ws://127.0.0.1:8080**. Stop the transmitter first with Ctrl+C, then receiver and Vite.
The page shows the transmission pipeline, actual datagram bits, persistent buffer,
FSM transitions, frame fields, captured ASM search windows, CRC comparisons, decoded
telemetry, counters, and the latest 20 local events. Live mode is an observer.

For a classroom presentation, select **Guided lab**. Choose clean, bit-offset,
bit-flip, bit-insert, or bit-delete, then use Play/Pause, Step, or Next state.
The receiver creates a deterministic six-frame recording using the same production
frame builder, simulator, packetizer, synchronizer, and CRC implementation. Chunks
are processed in memory; no live UDP state is modified. Faults target sequence 2.
Each FSM transition can be shown separately. Metrics update at chunk completion;
replay timing is illustrative and not a measured network rate. Guided lab needs
only the receiver and UI, not a running transmitter.

Drag the ASM search-window slider to compare adjacent 32-bit candidates over actual
captured stream bits. Byte dividers demonstrate how alignment 1, 3, or 7 crosses byte
boundaries. Click pipeline stages and frame fields for explanations. **Present**
uses a compact layout and requests fullscreen; **Freeze live visuals** holds a
snapshot while reception continues. See [the presentation guide](docs/demo-guide.md).

For each distinct demo stream, restart the receiver and run one transmitter command.
The browser reconnects automatically. Recovery within each demo requires no restart.

| Demo / mode | Transmitter command | Expected evidence |
|---|---|---|
| Fragmentation / clean | `npm run transmitter -- --mode clean` | Seeded 1–96-byte datagrams; telemetry continues, zero CRC failures/gaps |
| Nonaligned ASM / bit-offset | `npm run transmitter -- --mode bit-offset --offset 3` | ASM acquired at alignment 3; telemetry continues |
| CRC rejection / bit-flip | `npm run transmitter -- --mode bit-flip` | Sequence 5 rejected, 6 and later accepted; CRC/gap/resync each +1 |
| Changed alignment / bit-insert | `npm run transmitter -- --mode bit-insert` | Sequence 5 rejected; alignment 0 → 1; later frames accepted |
| Changed alignment / bit-delete | `npm run transmitter -- --mode bit-delete` | Sequence 5 rejected; alignment 0 → 7; later frames accepted |
| Insertion alias / bit-slip | `npm run transmitter -- --mode bit-slip` | Same behavior as bit-insert |

Fault defaults: one fault at zero-based clean frame index **5**, body bit **80**
(body byte 10 MSB), after CRC generation. Override with `--target-frame 1 --body-bit 80`.
Body bit range is 0–2031, excluding ASM and stored CRC. Index equals sequence for
the default generator until uint32 wraparound. Insertion adds `1` before the target;
deletion removes it. Prefix mode uses alternating `101...`, with offset 1–7.

The simulator carries unfinished bits across generation calls; Packetizer retains
unfinished datagrams and Mulberry32 state. Neither flushes per frame. Only final
shutdown pads the last partial byte and flushes the remaining datagram. A frame's
last bytes can wait one generation tick for the next unit. SIM_SEED controls chunk
boundaries; explicit fault locations require no random targeting or CRC repair.

## Configuration and observation semantics

| Environment variable | Default |
|---|---|
| UDP_HOST | 127.0.0.1 |
| UDP_PORT | 5000 |
| WS_PORT | 8080 |
| FRAME_RATE | 5 |
| CHUNK_MIN_BYTES / CHUNK_MAX_BYTES | 1 / 96 |
| SIM_SEED | 42 |

PowerShell example: `$env:CHUNK_MAX_BYTES = '16'` before starting the transmitter.
Changing WS_PORT also requires updating the obvious `WEBSOCKET_URL` constant in
`ui/src/main.ts`. Vite stays on localhost:5173; `npm run build` writes `dist/ui/`.

`receiver.status` (at most 4/sec) and `frame.valid` (every valid extracted frame)
retain their original JSON schemas and ISO UTC timestamps. `receiver.trace` adds a
bounded observation per datagram: its size, first 24 bytes in hex, first 8 bytes in
bits, before/after buffer counts, and at most 64 transitions. Marker acquisition
includes up to 48 actual buffered bits; validation includes stored/calculated CRC.
The browser can request `lesson.start` with one of the five supported modes; only
that client receives a cached `lesson.recording`. This does not control the live
transmitter or receiver. Incoming observer messages are limited to 1 KiB, outgoing
backlog is bounded, and recordings contain only six generated frames.
Rates use count deltas / actual elapsed
time, so short samples fluctuate around 5 FPS. Synced is false only in HUNT; current
alignment is null when no candidate is known. Latest Valid Alignment remains visible.
Counters/events show recovery even when status sampling misses brief FSM transitions.

Frame Sequence Gaps count missing valid frame observations, not missing UDP datagrams.
Unsigned forward advances below 2^31 add `advance - 1` gaps; duplicates, older values,
and ambiguous half-range jumps do not move the forward baseline or repair old gaps.
`resyncCount` counts the first ASM candidate after each failed candidate, even if that
new candidate also fails. Startup/noise alone does not increment it.

Payloads 0–11 remain structurally valid without decoded telemetry. They still produce
`frame.valid` with the same keys and null telemetry values; the UI displays “—”.
This represents unavailable fields without interpreting padding. Default 12-byte
payloads use the numeric telemetry schema shown in the PRD. Invalid frames emit no event.

## Tests and audit evidence

```text
npm test
npm run typecheck
npm run build
```

Teaching-view regression: **185 passed, 0 failed, 0 skipped**; strict typecheck and
Vite build passed. The original 178 tests still pass. See [the original PRD audit](docs/prd-audit.md) for all 36 sections,
acceptance criteria, exact test names, and final demo evidence.

Tests use ephemeral localhost UDP/WebSocket ports and close their sockets. In
particular, `test/integration.test.ts` proves 100 clean frames through seeded 1–96-byte
real UDP datagrams. `test/synchronizer.test.ts` protects true ASM recovery at bit 35
inside a failed candidate, 31-bit noise retention, and defensive buffer-cap recovery.
`test/faultRecovery.test.ts` combines tiny UDP datagrams with insertion/deletion.

## Important technical notes and limits

The ASM is the real CCSDS Attached Sync Marker; the educational body is **not** a
complete CCSDS TM Transfer Frame. Fragmentation is application-generated; UDP delivers
each datagram intact. Bit slips are simulated in the logical stream before UDP
packetization; normal UDP sockets do not expose RF bit slips. CRC detects errors,
does not repair them, and can theoretically miss some corruption/false candidates.

No retransmission, FEC, reorder restoration, RF hardware, database, authentication,
cloud service, frontend framework, or persistent history is required or implemented.
Optional datagram drop/reorder/duplicate modes and charts are outside this MVP.
Build/dependency/editor artifacts are ignored. Submission screenshots are tracked
under `docs/screenshots/`; saved verification logs are under `docs/verification/`.

## Faculty verification and submission evidence

**Jahnavi Singh, 24BCE2055**

**Slot F2, Team 5 (sole member)**
**BCSE308P Computer Networks Lab, Fall Semester 2026-27**
Submitted to: **Sreethar S.**

| Evidence | Location |
|---|---|
| Final project report | [F2_Team5_Report.pdf](F2_Team5_Report.pdf) |
| Project presentation | [PowerPoint](F2_Team5_PPT.pptx) or [PDF preview](F2_Team5_PPT.pdf) |
| Assignment 10 repository document and dashboard screenshots | [F2_Team5_Github.pdf](F2_Team5_Github.pdf) |
| Complete transmitter, receiver and shared implementation | [`src/`](src/) |
| Dashboard source and Vite configuration | [`ui/`](ui/) |
| Dependency manifest, exact lockfile and runtime version | `package.json`, `package-lock.json`, `.nvmrc` |
| Dashboard screenshots and one description per image | [Screenshot gallery](docs/screenshots/README.md) |
| Saved automated test, typecheck and build output | [Verification record](docs/verification/README.md) |
| Guided and live demonstration procedure | [Demo guide](docs/demo-guide.md) |
| Requirement mapping and VTOP submission procedure | [Submission guide](docs/submission-guide.md) |
| Detailed implementation and earlier acceptance audit | [PRD audit](docs/prd-audit.md) |

This is a Node.js software simulation. There is no Cisco Packet Tracer topology,
`.pkt` file, database, or Visual Studio solution to supply. The transmitter,
impairment simulator, UDP receiver and browser dashboard source are the executable
project. `npm ci` restores dependencies; generated `dist/` and `node_modules/`
directories are intentionally excluded from version control.

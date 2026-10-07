# PRD — CCSDS-Inspired Software Telemetry Receiver and Ground Station

**File:** `prd.md`  
**Status:** Source of Truth for Implementation  
**Project Type:** Software-only Computer Networks course project  
**Primary Goal:** Demonstrate network framing, synchronization, error detection, recovery, and real-time monitoring without over-engineering the surrounding application.

---

## 1. Product Summary

Build a **software-only simulated spacecraft telemetry link** consisting of:

1. a mock spacecraft transmitter that creates fixed-length telemetry frames,
2. a UDP packetizer that intentionally divides the logical telemetry bitstream into arbitrary datagrams and can inject controlled faults,
3. a ground-station receiver that reconstructs the logical stream in a persistent bit buffer,
4. a deterministic receiver FSM that searches for an Attached Sync Marker (ASM), locks to a candidate frame, validates it using CRC-16, extracts valid telemetry, and automatically resynchronizes after corruption or misalignment, and
5. a small browser dashboard that receives receiver state and metrics over WebSocket.

The project is inspired by CCSDS telemetry synchronization concepts but is intentionally small enough for a Computer Networks course.

> **Important terminology:** The project uses the real CCSDS 32-bit ASM `0x1ACFFC1D`, but the 256-byte frame body defined in this PRD is a **custom educational telemetry frame**. Do not call the custom frame body a fully standards-compliant CCSDS TM Transfer Frame unless the implementation is later changed to conform to the complete CCSDS TM Space Data Link Protocol.

---

## 2. Problem Statement

UDP is connectionless and does not guarantee delivery, ordering, or duplicate protection. However, UDP still delivers **datagrams/messages** to the application; it does not normally expose half of one UDP datagram as a separate UDP message.

Therefore, this project must not claim that "UDP itself splits a packet in half."

Instead, the mock spacecraft deliberately constructs a **logical continuous telemetry bitstream** and the simulator/packetizer slices that logical stream into arbitrary UDP datagrams. A frame or ASM may therefore span two or more UDP datagrams because **our application chose those datagram boundaries**.

The receiver must ignore UDP datagram boundaries for telemetry framing. It appends the datagram payload bytes to a persistent buffer and finds telemetry frame boundaries from the ASM and frame rules.

The receiver must also survive controlled corruption and bit alignment changes without restarting.

---

## 3. Course Relevance

The implementation must visibly demonstrate Computer Networks concepts rather than hiding them behind HTTP frameworks.

Primary CN concepts demonstrated:

- UDP socket programming
- connectionless transport
- datagram loss and reordering behavior
- application-level framing
- stream reconstruction above UDP
- bit/byte manipulation
- synchronization markers
- finite-state protocol parsing
- CRC-based error detection
- sequence numbers and loss observation
- buffering and bounded memory
- real-time client/server communication using WebSocket
- throughput and error-rate measurement

The frontend is only an observer. The technical emphasis is the network receiver.

---

## 4. Novelty / Technical Focus

### 4.1 Known building blocks

The following are established technologies and must **not** be presented as individually novel:

- UDP
- CCSDS Attached Sync Marker concepts
- `0x1ACFFC1D`
- CRC-16
- finite-state machines
- sliding/persistent buffers
- WebSockets
- Node.js
- TypeScript
- browser dashboards

### 4.2 Project's potentially distinctive contribution

Implementation effort must focus on the **specific receiver-side interaction** of:

**persistent fragmented input buffer → bit-level ASM search → deterministic HUNT/LOCK/VERIFY/EXTRACT FSM → CRC-controlled acceptance/rejection → automatic loss-of-lock and bit-level reacquisition**

The strongest demonstration is recovery when:

- a logical frame crosses UDP datagram boundaries,
- the ASM crosses a UDP datagram boundary,
- the stream starts at a non-byte-aligned bit offset,
- a frame contains a flipped bit,
- a bit insertion/deletion shifts subsequent alignment, and
- the receiver must find a later intact ASM without being restarted.

Do not spend project time trying to make the UI, deployment, or architecture "enterprise grade."

---

## 5. MVP Scope

### Must implement

- Software-only local simulation
- UDP transmitter and receiver
- Fixed-length 256-byte custom telemetry frame body
- 32-bit ASM `0x1ACFFC1D` immediately before each frame body
- Logical stream packetized into arbitrary UDP datagram sizes
- Persistent receiver bit buffer
- ASM search across datagram boundaries
- Bit-level ASM search, including non-byte-aligned offsets
- FSM states:
  - `HUNT`
  - `LOCK`
  - `VERIFY`
  - `EXTRACT`
- CRC-16 verification
- Automatic recovery after invalid CRC or lost alignment
- Frame sequence number
- Basic valid-frame and sequence-gap metrics
- WebSocket status output
- Minimal browser dashboard
- Automated unit/integration tests
- Deterministic fault simulation using a seed

### Nice-to-have only after MVP is complete

- UDP datagram drop simulation
- adjacent-datagram reordering simulation
- duplicate datagram simulation
- small throughput history graph
- CLI controls for impairment parameters
- saved demo presets

### Explicit non-goals

Do **not** add these unless the course requirement changes:

- database
- authentication/login
- user accounts
- REST API
- Express/NestJS backend framework
- cloud deployment
- Docker requirement
- Kubernetes
- microservices
- Kafka/RabbitMQ/Redis
- Redux or another global state-management framework
- ORM
- blockchain
- machine learning
- hardware/SDR integration
- RF modulation/demodulation
- Reed-Solomon, LDPC, Turbo coding, or other channel coding
- full CCSDS protocol-stack compliance
- production-grade mission-control features
- transport-level retransmission protocol
- complex reorder buffer

---

## 6. Locked Tech Stack

The implementation agent should use this stack unless a concrete blocker is found.

### Runtime / language

- **Node.js LTS**
- **TypeScript**
- Exact Node version should be pinned in the repository when implementation begins.

### UDP networking

- Node built-in **`node:dgram`**
- IPv4 UDP (`udp4`) for the course demo
- Default receiver endpoint: `127.0.0.1:5000`

### Binary / bit processing

- Node **`Buffer`**
- TypeScript bitwise/integer operations
- A project-owned `BitBuffer` abstraction described later in this PRD

### CRC

- Small project-owned CRC-16 implementation
- No large checksum framework is required

### Real-time browser bridge

- **`ws`** package
- Default WebSocket endpoint: `ws://127.0.0.1:8080`

### Ground station UI

- **Vite**
- **Vanilla TypeScript + HTML + CSS**
- No React is required for the MVP.
- No Tailwind, Recharts, or UI component library is required.

This is deliberate: the UI should remain small so implementation time goes toward the network parser.

### Testing

- Node built-in **`node:test`**
- Node built-in **`assert`**
- No separate test framework is required for the MVP.

### Required external runtime dependency

- `ws`

### Expected development dependencies

- `typescript`
- `tsx`
- `vite`
- `@types/node`
- `@types/ws`

Keep dependency count low.

---

## 7. System Architecture

```text
+---------------------------+
| Mock Spacecraft           |
| Frame Builder             |
| ASM + 256-byte frame      |
+-------------+-------------+
              |
              v
+---------------------------+
| Bitstream / Fault         |
| Simulator                 |
| - chunking                |
| - bit offset              |
| - bit flip                |
| - optional bit slip/drop  |
+-------------+-------------+
              |
              | UDP datagrams
              v
+---------------------------+
| Ground Receiver           |
| node:dgram                |
+-------------+-------------+
              |
              v
+---------------------------+
| Persistent BitBuffer      |
+-------------+-------------+
              |
              v
+---------------------------+
| Synchronization FSM       |
| HUNT -> LOCK -> VERIFY    |
|              -> EXTRACT   |
+-------------+-------------+
              |
       +------+------+
       |             |
       v             v
  CRC failure    Valid frame
  -> resync      -> decoder
                     |
                     v
              Metrics / Events
                     |
                     v
                WebSocket
                     |
                     v
              Browser Dashboard
```

No database or second backend service is needed.

---

## 8. Wire Format

### 8.1 Transmission unit

Each clean logical transmission unit is:

```text
[ 32-bit ASM ][ 256-byte custom telemetry frame ]
```

ASM length: **4 bytes / 32 bits**  
Frame length: **256 bytes / 2048 bits**  
Clean unit length: **260 bytes / 2080 bits**

The ASM is **not counted as part of the 256-byte custom frame**.

### 8.2 ASM

Use:

```text
Hex: 0x1ACFFC1D
Bits: 00011010110011111111110000011101
```

Bit order for matching is the transmitted order shown above, MSB first.

### 8.3 Custom 256-byte frame body

All multi-byte integer fields are **big-endian / network byte order**.

| Offset | Size | Field | Description |
|---|---:|---|---|
| `0..3` | 4 bytes | `sequence` | Unsigned 32-bit frame sequence counter |
| `4..5` | 2 bytes | `payloadLength` | Number of meaningful payload bytes, `0..246` |
| `6..7` | 2 bytes | `flags` | Reserved for demo; set to `0` in MVP |
| `8..253` | 246 bytes | `payload` | Telemetry payload; unused bytes zero padded |
| `254..255` | 2 bytes | `crc16` | CRC over frame bytes `0..253` |

Total = `4 + 2 + 2 + 246 + 2 = 256 bytes`.

### 8.4 Mock telemetry payload

The first 12 meaningful payload bytes should contain simple test telemetry:

| Payload offset | Size | Value |
|---|---:|---|
| `0..1` | 2 | temperature in centi-degrees Celsius, signed int16 |
| `2..3` | 2 | battery voltage in millivolts, uint16 |
| `4..7` | 4 | altitude in metres, uint32 |
| `8..11` | 4 | spacecraft uptime in seconds, uint32 |

Set `payloadLength = 12` for the default demo and zero-fill the remaining payload bytes.

This is intentionally simple and is **not** a CCSDS packet definition.

---

## 9. CRC Definition

For this project, use one CRC function consistently in transmitter and receiver:

- Width: **16 bits**
- Polynomial: **`0x1021`**
- Initial value: **`0xFFFF`**
- Input reflection: **false**
- Output reflection: **false**
- Final XOR: **`0x0000`**
- CRC input: custom frame bytes `0..253`
- Stored CRC: bytes `254..255`, big-endian
- Check vector: ASCII `123456789` must produce **`0x29B1`**

This is the common non-reflected CRC-16/CCITT configuration using the polynomial and all-ones preset associated with CCSDS TM frame error-control processing.

For this project, CRC is used for **error detection only**.

CRC does not repair corrupted data.

The implementation must contain a CRC unit test using at least one fixed known input/output vector and must use the same function for the frame builder and receiver verifier.

---

## 10. Transmitter

### 10.1 Responsibilities

The transmitter must:

1. generate a frame sequence number,
2. generate mock telemetry values,
3. encode the 256-byte frame,
4. calculate and append CRC-16,
5. prepend the 32-bit ASM,
6. add the completed unit to the logical outgoing bitstream,
7. pass the bitstream through the selected impairment mode,
8. split the resulting bytes into UDP datagrams, and
9. send the datagrams to the receiver.

### 10.2 Default transmission rate

Default: **5 frames per second**

It should be configurable, but performance benchmarking is not the project goal.

### 10.3 Sequence behavior

- Start at `0`
- Increment by `1` per generated telemetry frame
- Use unsigned 32-bit wraparound if necessary
- Do not reset sequence because of a simulated network fault

---

## 11. UDP Packetization

### 11.1 Core rule

**Telemetry framing must be independent of UDP datagram boundaries.**

The packetizer should accumulate the outgoing logical stream and split it into pseudo-random datagram payload sizes.

Default random payload size range:

```text
1 to 96 bytes
```

Using small chunks intentionally causes ASMs and frames to cross datagram boundaries frequently.

The receiver must not use `message` event boundaries as telemetry frame boundaries.

### 11.2 Deterministic randomness

Fault/chunk generation must accept a numeric seed.

Example:

```text
--seed 42
```

The same seed and configuration should produce the same impairment sequence so demos and tests are reproducible.

---

## 12. Simulator Impairment Modes

Implement these in order.

### Mode A — `clean`

No corruption. Only arbitrary UDP chunk boundaries.

Purpose: prove reconstruction across UDP datagrams.

### Mode B — `bit-offset`

Insert `1..7` harmless prefix bits before an otherwise valid stream.

Purpose: prove that the ASM search is truly bit-level and is not restricted to byte offset `0`.

The prefix bits are not part of a telemetry frame.

### Mode C — `bit-flip`

Flip one selected/random bit inside selected frame bodies after CRC generation.

Purpose: the corrupted frame must fail CRC while later valid frames are recovered.

### Mode D — `bit-slip`

Insert or delete one bit in the logical bitstream.

Purpose: simulate loss of bit alignment. The affected frame may fail. The receiver must eventually locate the next intact ASM at its new bit offset.

### Optional Mode E — `drop-datagram`

Drop selected UDP datagram payloads before send.

Purpose: demonstrate that missing stream material can invalidate one or more frames and that the receiver can later resynchronize.

### Optional Mode F — `reorder`

Swap adjacent UDP datagrams.

The MVP receiver is **not required to restore UDP ordering**. Reordering may corrupt the reconstructed logical stream. The required behavior is to avoid crashing and reacquire a later valid ASM when possible.

---

## 13. Receiver Input Rules

Node `dgram` emits one `message` event for each received UDP datagram.

For every `message`:

1. increment `udpDatagramsReceived`,
2. add `msg.length` to `udpBytesReceived`,
3. append the datagram payload bytes to `BitBuffer`,
4. call the FSM processor,
5. process as many complete frames as possible before returning.

The parser must never assume:

```text
one UDP datagram == one telemetry frame
```

---

## 14. `BitBuffer` Contract

Implement a small reusable class/module.

Required conceptual API:

```ts
append(data: Buffer): void
availableBits(): number
readBit(relativeBitOffset: number): 0 | 1
match32(relativeBitOffset: number, value: number): boolean
sliceBitsToBuffer(relativeBitOffset: number, bitLength: number): Buffer
discardBits(bitCount: number): void
compactIfNeeded(): void
```

### Required behavior

- Support reads beginning at any bit offset.
- `sliceBitsToBuffer()` must pack the requested bits MSB-first into a new byte-aligned `Buffer`.
- Do not convert the entire long-running stream into an ever-growing `number[]`.
- Maintain a head bit offset over a backing `Buffer` or equivalent bounded representation.
- Compact consumed storage periodically.

### Memory rule

The receiver must not allow noise or an absent ASM to grow memory indefinitely.

While in `HUNT`, after scanning all currently searchable positions, retain only the final **31 bits** needed to detect a 32-bit ASM that may continue in the next UDP datagram.

When locked to a candidate frame, retain the candidate until enough bits exist for verification.

Set a hard defensive cap, e.g. **64 KiB**, and record/reset safely if that cap is exceeded due to an implementation fault.

The normal demo should stay far below this limit.

---

## 15. Frame Synchronization Algorithm

### 15.1 Search granularity

Search at **every bit offset**, not only every byte offset.

### 15.2 HUNT behavior

Starting at the current buffer head:

1. ensure at least 32 bits are available,
2. compare the next 32 bits against `0x1ACFFC1D`,
3. if no match, advance exactly **1 bit**,
4. repeat,
5. if a match is found:
   - record the candidate ASM location,
   - increment `asmDetections`,
   - transition to `LOCK`.

### 15.3 Cross-datagram detection

If fewer than 32 bits remain with no match, do not discard the entire tail.

Retain the last 31 bits so that an ASM split between the old tail and the next received datagram can be detected.

---

## 16. FSM Definition

The receiver must use the following four states.

### `HUNT`

**Purpose:** Search bit-by-bit for the ASM.

Transition:

- ASM found → `LOCK`
- ASM not yet found → remain `HUNT`

### `LOCK`

**Purpose:** A candidate ASM has been found; wait for one complete 256-byte frame after it.

Required bits from ASM start:

```text
32 ASM bits + 2048 frame bits = 2080 bits
```

Transition:

- not enough buffered bits → remain `LOCK`
- enough bits → `VERIFY`

### `VERIFY`

**Purpose:** Extract the candidate 2048 frame bits into a byte-aligned 256-byte buffer and check CRC.

Transition:

- CRC valid → `EXTRACT`
- CRC invalid → increment `crcFailures`, record loss/recovery event, resume `HUNT`

**Critical resynchronization rule on CRC failure:**

Do not blindly discard the entire candidate frame and assume the next bit is aligned.

Resume searching from **one bit after the start of the failed ASM candidate**. This prevents a false ASM match from causing the receiver to skip a real ASM that may exist inside the remaining buffered region.

### `EXTRACT`

**Purpose:**

- parse header,
- validate `payloadLength <= 246`,
- decode mock telemetry,
- update frame sequence metrics,
- increment `validFrames`,
- publish a `frame.valid` WebSocket event.

After extraction:

- consume the successfully processed ASM + frame bits,
- if the next 32 bits are already available and equal to ASM, transition directly to `LOCK`,
- otherwise transition to `HUNT`.

`EXTRACT` should be short-lived; it is not a waiting state.

---

## 17. Invalid Header Handling

A valid CRC does not remove the need for basic structural checks.

If:

```text
payloadLength > 246
```

treat the candidate as invalid.

Increment `formatFailures` and follow the same resynchronization policy as a failed candidate.

This is mainly defensive programming.

---

## 18. Sequence and Loss Metrics

Use the custom frame `sequence` field to measure missing **valid telemetry frames**.

Maintain:

- `lastValidSequence`
- `sequenceGaps`

If the next valid sequence is greater than the expected value, increase `sequenceGaps` by the missing count.

Handle unsigned 32-bit wraparound.

### Terminology rule

The dashboard should label this metric:

**Frame sequence gaps**

Do not label it "UDP packet loss" unless the receiver has an independent transport-level datagram sequence mechanism.

Why: the receiver cannot infer every missing UDP datagram merely from the telemetry frame sequence number.

---

## 19. Receiver Metrics

Maintain at minimum:

```ts
type ReceiverMetrics = {
  state: 'HUNT' | 'LOCK' | 'VERIFY' | 'EXTRACT';
  synced: boolean;
  udpDatagramsReceived: number;
  udpBytesReceived: number;
  asmDetections: number;
  validFrames: number;
  crcFailures: number;
  formatFailures: number;
  sequenceGaps: number;
  resyncCount: number;
  framesPerSecond: number;
  bytesPerSecond: number;
  bufferedBits: number;
  currentBitAlignment: number | null;
};
```

### `synced`

For the MVP:

- `false` in `HUNT`
- `true` in `LOCK`, `VERIFY`, or `EXTRACT`

### `currentBitAlignment`

When an ASM is detected:

```text
candidate ASM bit offset modulo 8
```

This lets the demo visibly show non-byte-aligned synchronization.

### `resyncCount`

Increment when the receiver had a candidate/lock that failed validation and later finds another ASM candidate.

Keep implementation simple and document the exact counting rule in code comments/tests.

---

## 20. WebSocket Contract

The WebSocket is only for the local dashboard. It is **not** part of the simulated spacecraft communication link.

Use two message types.

### 20.1 `receiver.status`

Publish at most **4 times per second**.

```json
{
  "type": "receiver.status",
  "timestamp": "2026-10-07T16:00:00.000Z",
  "metrics": {
    "state": "HUNT",
    "synced": false,
    "udpDatagramsReceived": 120,
    "udpBytesReceived": 8500,
    "asmDetections": 12,
    "validFrames": 10,
    "crcFailures": 2,
    "formatFailures": 0,
    "sequenceGaps": 2,
    "resyncCount": 2,
    "framesPerSecond": 5,
    "bytesPerSecond": 1300,
    "bufferedBits": 31,
    "currentBitAlignment": null
  }
}
```

### 20.2 `frame.valid`

Publish whenever a valid frame is extracted.

```json
{
  "type": "frame.valid",
  "timestamp": "2026-10-07T16:00:00.000Z",
  "frame": {
    "sequence": 42,
    "payloadLength": 12,
    "temperatureC": 24.37,
    "batteryMv": 7420,
    "altitudeM": 520000,
    "uptimeSeconds": 1800,
    "bitAlignment": 3
  }
}
```

Do not create unnecessary message types for the MVP.

---

## 21. Ground Station UI

The UI must fit on one page.

### Required components

1. **Connection indicator**
   - WebSocket connected/disconnected

2. **Synchronization card**
   - FSM state
   - synced/unsynced
   - current bit alignment

3. **Counters**
   - valid frames
   - CRC failures
   - frame sequence gaps
   - resynchronizations
   - UDP datagrams received

4. **Rates**
   - frames/sec
   - bytes/sec

5. **Last valid telemetry**
   - sequence
   - temperature
   - battery voltage
   - altitude
   - uptime

6. **Small event log**
   - last ~20 events
   - ASM acquired
   - CRC failure
   - resynchronization
   - valid frame

### UI rule

Do not add complex animations, maps, authentication, multiple routes, themes, or heavy chart packages before all receiver acceptance tests pass.

---

## 22. Configuration

Keep configuration small.

Recommended defaults:

```text
UDP_HOST=127.0.0.1
UDP_PORT=5000
WS_PORT=8080
FRAME_RATE=5
CHUNK_MIN_BYTES=1
CHUNK_MAX_BYTES=96
SIM_SEED=42
```

Simulator mode can be selected using CLI flags or a small config object.

Example conceptual commands:

```text
npm run receiver
npm run transmitter -- --mode clean --seed 42
npm run transmitter -- --mode bit-offset --offset 3 --seed 42
npm run transmitter -- --mode bit-flip --every 20 --seed 42
npm run transmitter -- --mode bit-slip --every 20 --seed 42
npm run ui
```

Exact script syntax may differ slightly, but the functionality must remain equivalent.

---

## 23. Suggested Repository Structure

```text
/
├─ prd.md
├─ README.md
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ shared/
│  │  ├─ constants.ts
│  │  ├─ crc16.ts
│  │  ├─ frame.ts
│  │  └─ types.ts
│  ├─ transmitter/
│  │  ├─ frameBuilder.ts
│  │  ├─ bitstreamSimulator.ts
│  │  ├─ packetizer.ts
│  │  └─ index.ts
│  └─ receiver/
│     ├─ bitBuffer.ts
│     ├─ synchronizer.ts
│     ├─ metrics.ts
│     ├─ websocketServer.ts
│     └─ index.ts
├─ ui/
│  ├─ index.html
│  ├─ src/
│  │  ├─ main.ts
│  │  └─ style.css
│  └─ vite.config.ts
└─ test/
   ├─ crc16.test.ts
   ├─ frame.test.ts
   ├─ bitBuffer.test.ts
   ├─ synchronizer.test.ts
   └─ integration.test.ts
```

Do not split this into separate repositories or microservices.

---

## 24. Implementation Order

The coding agent should implement in this order.

### Phase 1 — Binary primitives

- constants
- CRC-16
- frame builder/parser
- unit tests

### Phase 2 — Bit buffer

- append
- bit reads
- 32-bit matching
- non-byte-aligned extraction
- discard/compaction
- tests crossing Buffer boundaries

### Phase 3 — Synchronizer FSM

- HUNT
- LOCK
- VERIFY
- EXTRACT
- CRC rejection
- resynchronization
- bounded-memory behavior
- deterministic unit tests

### Phase 4 — UDP transport

- transmitter socket
- receiver socket
- arbitrary chunk packetizer
- local clean integration test

### Phase 5 — Impairment simulation

In order:

1. bit-offset
2. bit-flip
3. bit-slip
4. optional datagram drop
5. optional adjacent reorder

### Phase 6 — Metrics + WebSocket

- counters
- rates
- `receiver.status`
- `frame.valid`

### Phase 7 — Minimal UI

Build only the required dashboard.

### Phase 8 — Demo hardening

- deterministic demo seeds
- README commands
- final acceptance test run

If a later phase exposes an issue, fix the receiver logic first rather than compensating in the UI.

---

## 25. Functional Requirements

### FR-1
The transmitter shall produce a logical stream of ASM + 256-byte custom frames.

### FR-2
The packetizer shall split that logical stream into UDP datagrams without preserving telemetry-frame boundaries.

### FR-3
The receiver shall append UDP payload bytes to persistent state across `message` callbacks.

### FR-4
The receiver shall detect the ASM when it spans multiple UDP datagrams.

### FR-5
The receiver shall detect the ASM at all bit alignments `0..7`.

### FR-6
The receiver shall reconstruct exactly 256 frame bytes following a detected ASM.

### FR-7
The receiver shall validate the frame CRC before accepting telemetry.

### FR-8
The receiver shall reject corrupted candidates without crashing.

### FR-9
After corruption or a bit slip, the receiver shall return to bit-level hunting and reacquire a later valid ASM.

### FR-10
The receiver shall expose live state and metrics over WebSocket.

### FR-11
The UI shall display the receiver state, error counters, throughput, and latest valid telemetry.

### FR-12
All fault simulation used in automated tests shall be reproducible from a fixed seed or explicit bit location.

---

## 26. Non-Functional Requirements

### NFR-1 — Simplicity
Prefer clear, inspectable code over framework abstraction.

### NFR-2 — Determinism
Protocol tests must not depend on uncontrolled randomness.

### NFR-3 — Bounded memory
Malformed/noisy input must not cause unbounded buffer growth.

### NFR-4 — No crash on malformed input
Bad CRC, missing ASM, random bytes, and unexpected sequence gaps must be handled as protocol events.

### NFR-5 — Observability
Important FSM transitions and validation failures should be visible in logs and/or dashboard events.

### NFR-6 — Local first
The full demo must run on one laptop with localhost networking.

### NFR-7 — Maintainability
Core protocol modules should be small and testable independently of the UI.

### NFR-8 — Performance target
At the course-demo rate of 5 frames/sec, processing should be effectively real-time. Optimization beyond what is needed for smooth local operation is not a project goal.

---

## 27. Mandatory Tests and Acceptance Criteria

### Test A — CRC known vector

- Give the CRC function a fixed byte sequence.
- Assert one fixed expected CRC value.
- Repeatability must be exact.

**Pass:** transmitter and receiver use the same tested implementation.

### Test B — Frame encode/decode

- Build a frame with known header/payload values.
- Parse it back.

**Pass:** all values match and the total frame body is exactly 256 bytes.

### Test C — ASM split across UDP chunks

Construct a clean stream and split the four ASM bytes across multiple appended chunks.

**Pass:** ASM is found and frame validates.

### Test D — Frame split across many UDP chunks

Use `1..96` byte chunk sizes for at least 100 frames.

**Pass:** all 100 frames are recovered in clean mode with zero CRC failures.

### Test E — Non-byte-aligned synchronization

Prefix the stream with each offset from `1` through `7` bits.

**Pass:** for every offset, the receiver finds the ASM and decodes the following valid frame.

### Test F — Corrupted frame

Flip one frame-body bit after CRC generation.

**Pass:**
- corrupted frame is not emitted as valid,
- `crcFailures` increases,
- receiver finds a later valid frame without restart.

### Test G — False ASM candidate

Place `0x1ACFFC1D` inside noise followed by an invalid frame candidate, then later provide a true ASM + valid frame.

**Pass:** false candidate fails and the true later frame is recovered.

### Test H — Bit slip

Insert or delete one bit so the current frame/alignment is disturbed, then continue with intact later frames.

**Pass:** receiver eventually finds the next intact ASM at the new bit alignment and emits later valid telemetry.

### Test I — Long noise / bounded memory

Feed a long stream with no ASM.

**Pass:**
- no crash,
- scanned data is discarded,
- only the trailing search context is retained,
- backing storage is compacted and remains bounded.

### Test J — End-to-end local demo

Run transmitter + UDP receiver + WebSocket + UI.

**Pass:** dashboard visibly updates at approximately the configured 5 FPS and fault modes change the CRC/resynchronization counters as expected.

---

## 28. Required Demo Scenarios

The final presentation should demonstrate these scenarios rather than spending time on UI polish.

### Demo 1 — Fragmentation without corruption

Show:

- tiny UDP chunks,
- ASM/frame crossing datagrams,
- receiver still extracting all frames.

Explain that telemetry framing is application-level and independent of UDP datagram boundaries.

### Demo 2 — Non-byte-aligned ASM

Start the stream with a 3-bit offset.

Show:

- `HUNT`
- ASM acquired at alignment `3`
- valid frame decoded

This is a key technical demonstration.

### Demo 3 — CRC failure and recovery

Flip a bit in one frame.

Show:

- candidate found,
- CRC failure,
- return to `HUNT`,
- later ASM reacquired,
- subsequent telemetry continues.

### Demo 4 — Bit slip and reacquisition

Insert/delete a bit.

Show:

- current frame becomes invalid or lock is lost,
- later marker is found at a different bit alignment,
- receiver continues without restart.

---

## 29. Do-Not-Over-Engineer Rules

These rules are binding for the implementation agent.

1. **Do not add infrastructure unless a requirement in this PRD needs it.**
2. **Do not replace Node `dgram` with HTTP or a networking framework.**
3. **Do not add a database.**
4. **Do not add authentication.**
5. **Do not add a frontend framework to the MVP unless vanilla TypeScript becomes a concrete blocker.**
6. **Do not add channel coding or SDR/hardware features before the required synchronization tests pass.**
7. **Do not implement full CCSDS TM headers merely to make the project look more aerospace-like.**
8. **Do not spend more implementation effort on the dashboard than on the receiver FSM.**
9. **Do not call a feature "packet loss" when the implementation only measures telemetry frame sequence gaps.**
10. **Do not hide protocol logic in third-party framing/parser libraries.**
11. **Do not optimize before correctness and tests.**
12. **Do not change locked wire-format constants without updating this PRD and the tests together.**

When choosing between a visually impressive feature and a stronger synchronization/recovery test, choose the synchronization/recovery test.

---

## 30. Technical Accuracy Rules

These statements should also guide reports, presentations, and code comments.

### UDP

Correct:

> UDP provides a connectionless datagram service and does not guarantee delivery, duplicate protection, or ordering.

Correct for this project:

> The simulator deliberately fragments a logical telemetry stream across multiple UDP datagrams.

Avoid:

> UDP splits one application datagram into multiple datagrams for our receiver.

IP fragmentation is a separate lower-layer behavior and is normally reassembled before the UDP payload is delivered to the application.

### CCSDS

Correct:

> `0x1ACFFC1D` is a CCSDS Attached Sync Marker used for synchronization of appropriate telemetry/channel-coding streams.

Correct:

> This project is CCSDS-inspired and uses a custom 256-byte educational frame.

Avoid:

> Our custom 256-byte frame is automatically a standard CCSDS TM Transfer Frame.

### CRC

Correct:

> CRC detects many transmission errors and lets the receiver reject an invalid frame.

Avoid:

> CRC repairs the corrupted frame.

### Bit slips

Correct:

> Bit insertion/deletion is simulated before byte packetization to model loss of bit alignment that a software synchronizer might encounter in a lower-level/raw telemetry stream.

Avoid:

> Normal Node UDP sockets directly expose RF bit slips.

### WebSocket

Correct:

> WebSocket is used only to forward receiver status to the browser dashboard.

Avoid:

> WebSocket is part of the spacecraft downlink protocol.

---

## 31. Logging

Console logging should be concise and useful for demonstrations.

Examples:

```text
[UDP] receiver listening on 127.0.0.1:5000
[FSM] HUNT -> LOCK asmBitAlignment=3
[FSM] LOCK -> VERIFY sequenceCandidate=41
[CRC] fail candidateOffset=...
[FSM] VERIFY -> HUNT reason=crc_failure
[FSM] HUNT -> LOCK asmBitAlignment=4
[FRAME] valid sequence=42 temp=24.37C
```

Do not log every scanned bit.

---

## 32. Error Handling

The process should remain alive for normal protocol errors.

Recoverable conditions:

- CRC mismatch
- invalid payload length
- noise before ASM
- sequence gap
- bit misalignment
- incomplete frame waiting for more UDP data

Fatal/process-level conditions should be limited to things such as:

- socket bind failure
- unrecoverable configuration error

Protocol corruption is not a fatal exception.

---

## 33. Definition of Done

The MVP is done only when all of the following are true:

- [ ] `prd.md` exists at repository root.
- [ ] UDP transmitter and receiver run locally.
- [ ] Custom frame body is exactly 256 bytes.
- [ ] ASM is exactly `0x1ACFFC1D` and is outside the 256-byte body.
- [ ] CRC parameters match Section 9.
- [ ] Arbitrary UDP chunking works.
- [ ] ASM crossing UDP boundaries works.
- [ ] Bit-level ASM scanning works at offsets `0..7`.
- [ ] FSM behavior matches Section 16.
- [ ] Corrupt frames are rejected.
- [ ] CRC failure triggers resynchronization rather than process restart.
- [ ] A simulated bit slip can be followed by successful reacquisition.
- [ ] Buffer memory remains bounded during long noise input.
- [ ] Valid frame sequence gaps are counted correctly.
- [ ] WebSocket sends the defined status/frame messages.
- [ ] Minimal browser dashboard displays the required data.
- [ ] Mandatory tests pass.
- [ ] README contains exact run/demo commands.
- [ ] No out-of-scope infrastructure has been introduced.

---

## 34. Implementation Priority

If schedule becomes tight, protect these features in this order:

1. **Persistent buffering independent of UDP datagram boundaries**
2. **Bit-level ASM detection**
3. **Deterministic FSM**
4. **CRC validation**
5. **Automatic resynchronization**
6. **Bit-offset and bit-slip demonstrations**
7. **Metrics/WebSocket**
8. **Minimal UI**
9. Optional UDP drop/reorder simulation
10. Visual polish

The first six items are the technical heart of the project.

---

## 35. Authoritative Technical References

Use these references when terminology is disputed.

1. **RFC 768 — User Datagram Protocol**  
   Defines UDP as a datagram-oriented protocol with minimal mechanism and without guaranteed delivery or duplicate protection.

2. **CCSDS 131-series — TM Synchronization and Channel Coding**  
   Defines telemetry synchronization concepts including the non-turbo-coded 32-bit ASM `0x1ACFFC1D`.

3. **CCSDS 132.0-B-3 — TM Space Data Link Protocol**  
   Defines the actual TM Transfer Frame protocol and Frame Error Control Field. This project does **not** claim that its simplified custom frame implements the whole standard.

4. **Node.js `dgram` documentation**  
   `dgram.Socket` delivers a `Buffer` for each received datagram via the `message` event.

These references support protocol terminology. The implementation contract for this repository is this `prd.md`.

---

## 36. Final Source-of-Truth Rule

When code, README text, presentation text, or an implementation-agent assumption conflicts with this file:

**`prd.md` wins unless this file is intentionally revised.**

Any revision that changes one of the following must update tests in the same change:

- ASM value
- frame length
- field offsets
- byte order
- CRC parameters
- FSM recovery behavior
- WebSocket schema

The goal is a small, demonstrably correct Computer Networks project whose complexity is concentrated in **software-defined synchronization and recovery**, not surrounding infrastructure.

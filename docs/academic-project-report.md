# CCSDS-Inspired Software Telemetry Receiver and Ground Station

## Academic Project Report

| Submission detail | Value |
|---|---|
| Course | Computer Networks |
| Submitted by | [Student name(s)] |
| Registration / roll number(s) | [Enter number(s)] |
| Department | [Department name] |
| Institution | [Institution name] |
| Faculty / supervisor | [Faculty name] |
| Academic year / semester | [Enter academic year and semester] |
| Report date | 8 October 2026 |

**Implementation status:** Completed and verified against the mandatory project requirements.

**Keywords:** UDP, telemetry framing, bit synchronization, Attached Sync Marker, CRC-16, finite-state machine, resynchronization, WebSocket.

---

## Abstract

This project implements a software-only spacecraft telemetry simulation and ground-station receiver for a Computer Networks course. A mock transmitter generates fixed-length custom telemetry frames, computes CRC-16, and prepends a 32-bit Attached Sync Marker (ASM). A deterministic simulator introduces controlled bit offsets, corruption, insertion, or deletion before an application packetizer divides the logical stream into small UDP datagrams.

The receiver reconstructs the arriving logical stream using a persistent bit buffer. It searches for the ASM at every bit position and uses an explicit HUNT, LOCK, VERIFY, and EXTRACT finite-state machine to identify candidates, validate them, and emit accepted telemetry. Failed candidates trigger renewed searching one bit after the failed marker's start, allowing recovery from false synchronization and changed bit alignment without restarting the receiver. A WebSocket bridge publishes receiver metrics and valid telemetry to a minimal browser dashboard.

The final implementation passed 178 automated tests, strict type checking, and a production dashboard build. Local demonstrations verified clean reception, synchronization at offset 3, rejection of a corrupted frame, and recovery after both insertion and deletion. The system uses a custom educational frame inspired by CCSDS synchronization concepts; it does not implement the complete CCSDS telemetry protocol stack.

## Contents

1. [Introduction and problem statement](#1-introduction-and-problem-statement)
2. [Objectives and scope](#2-objectives-and-scope)
3. [Background and technical distinction](#3-background-and-technical-distinction)
4. [Requirements and technology stack](#4-requirements-and-technology-stack)
5. [System architecture](#5-system-architecture)
6. [Binary protocol design](#6-binary-protocol-design)
7. [Transmitter and impairment simulation](#7-transmitter-and-impairment-simulation)
8. [Receiver synchronization algorithm](#8-receiver-synchronization-algorithm)
9. [Metrics, WebSocket, and dashboard](#9-metrics-websocket-and-dashboard)
10. [Implementation organization](#10-implementation-organization)
11. [Installation and execution](#11-installation-and-execution)
12. [Testing methodology and results](#12-testing-methodology-and-results)
13. [Discussion and limitations](#13-discussion-and-limitations)
14. [Optional future work](#14-optional-future-work)
15. [Conclusion](#15-conclusion)
16. [References](#16-references)

## 1. Introduction and Problem Statement

Telemetry communicates measurements from a remote system to a monitoring station. A receiver must identify frame boundaries, validate received information, and resume decoding after damage or loss of synchronization.

UDP provides datagram communication with no guarantee of delivery or duplicate protection, and does not supply an ordered reliable stream [1]. In this implementation, the application deliberately divides a logical telemetry stream into independently sent datagrams. A received datagram may contain only part of a marker or frame, or material from more than one transmission unit.

The problem is therefore to recover telemetry framing independently of UDP message boundaries. The receiver must retain incomplete information across callbacks, recognize markers at non-byte-aligned positions, reject corrupted candidates, and later accept intact frames without a process restart.

Application packetization is distinct from IP fragmentation. Node.js delivers a received UDP message as a Buffer [4]; the project does not assume that UDP exposes half-datagram messages or physical radio-frequency bit slips.

## 2. Objectives and Scope

The project has six central technical objectives:

1. Maintain persistent receiver state across arbitrarily sized UDP payloads.
2. Detect the ASM at all bit alignments from 0 through 7, including across datagrams.
3. Implement an explicit, observable HUNT/LOCK/VERIFY/EXTRACT FSM.
4. Use CRC validation to control frame acceptance and rejection.
5. Automatically reacquire synchronization after corruption or a false ASM candidate.
6. Recover after insertion or deletion changes the alignment of later frames.

Additional objectives are deterministic simulation, bounded receiver storage, frame sequence-gap measurement, and live browser observation.

The implemented scope is a local, software-only simulation using custom 256-byte frames. Databases, authentication, REST services, cloud deployment, RF hardware, channel coding, retransmission protocols, and full CCSDS-stack compliance are outside scope. Optional datagram drop, reorder, and duplicate modes are not implemented.

## 3. Background and Technical Distinction

### 3.1 Framing and synchronization

The ASM provides a recognizable candidate boundary in the logical stream. This project uses `0x1ACFFC1D`, the 32-bit marker documented in CCSDS telemetry synchronization material [2]. The associated frame body is a project-defined format rather than the TM Transfer Frame defined by the CCSDS TM Space Data Link Protocol [3].

A marker match alone does not establish that a candidate is valid. Noise or payload data can contain the same pattern. CRC and structural validation provide additional acceptance checks.

### 3.2 Error detection and recovery

CRC is an error-detection mechanism. A mismatch causes rejection; it does not repair damaged bytes. Recovery means locating and decoding later intact frames.

A bit insertion or deletion shifts subsequent markers relative to byte boundaries. Searching only byte-aligned positions would fail to recover these streams.

### 3.3 Technical focus

UDP, CRC, ASM concepts, FSMs, buffers, Node.js, TypeScript, and WebSockets are established building blocks. The engineering focus is their receiver-side combination:

```text
Persistent fragmented input
    -> every-bit ASM search
    -> explicit candidate locking
    -> CRC and structural verification
    -> rejection when invalid
    -> automatic bit-level reacquisition
```

This report describes implemented behavior and experimental evidence. It does not assert legal novelty or patentability.

## 4. Requirements and Technology Stack

A laptop or desktop with Node.js, npm, a browser, and three terminals is sufficient. No external spacecraft hardware or cloud service is required.

| Component | Actual technology / configuration |
|---|---|
| Runtime | Node.js 22.19.0, repository-pinned LTS version |
| Package manager | npm 10.9.3 |
| Language | TypeScript 5.9.2, strict checking |
| UDP | Built-in `node:dgram`, IPv4 `udp4` |
| Binary processing | Node Buffer and project-owned BitBuffer |
| CRC | Project-owned non-reflected CRC-16 implementation |
| Browser bridge | `ws` 8.18.3 |
| Dashboard | Vanilla TypeScript, HTML, CSS |
| UI tooling | Vite 7.1.3 |
| Tests | `node:test`, `node:assert`, tsx 4.20.5 |
| UDP destination | `127.0.0.1:5000` |
| WebSocket endpoint | `ws://127.0.0.1:8080` |
| Dashboard URL | `http://127.0.0.1:5173/` |

`ws` is the only external runtime dependency. TypeScript, tsx, Vite, and Node/ws type definitions are development dependencies.

## 5. System Architecture

```text
Mock spacecraft
  FrameBuilder: telemetry -> 256-byte body with CRC -> external ASM
       |
       v
  BitstreamSimulator: clean / offset / flip / insertion / deletion
       |
       v
  Packetizer: seeded arbitrary byte chunks, carry across frame boundaries
       |
       v
  UDP sender --------------------------> UDP receiver
                                           |
                                           v
                                     Persistent BitBuffer
                                           |
                                           v
                                     Synchronizer FSM
                                     HUNT -> LOCK -> VERIFY
                                        ^              |
                                        | invalid      | valid
                                        +--------------+ -> EXTRACT
                                                              |
                                                              v
                                                         Accepted frame
                                                              |
                                                              v
                                                           Metrics
                                                              |
                                                              v
                                                         WebSocket
                                                              |
                                                              v
                                                       Browser dashboard
```

The UDP handler passes incoming payloads unchanged to the persistent Synchronizer. The receiver receives no fault locations, alignment hints, or simulator metadata. Protocol decisions depend on received bits, the ASM, the fixed frame rules, and validation results.

Protocol counters belong to the Synchronizer; transport counters belong to the UDP wrapper. The Metrics module calculates sequence gaps and rates. WebSocket clients observe receiver output and do not control framing.

## 6. Binary Protocol Design

### 6.1 Transmission unit and bit order

A clean logical unit is:

```text
[ 4-byte ASM ][ 256-byte custom frame body ]
```

| Property | Value |
|---|---|
| ASM | `0x1ACFFC1D` |
| ASM bit pattern | `00011010110011111111110000011101` |
| ASM placement | Immediately before, outside the frame body |
| Frame body | 256 bytes / 2048 bits |
| Clean unit | 260 bytes / 2080 bits |
| Bit order | MSB-first |
| Multibyte field order | Big-endian |

### 6.2 Frame body

| Body byte offsets | Size | Field | Interpretation |
|---|---:|---|---|
| 0–3 | 4 bytes | sequence | Unsigned 32-bit counter |
| 4–5 | 2 bytes | payloadLength | Meaningful payload length, 0–246 |
| 6–7 | 2 bytes | flags | Reserved; default transmitter uses 0 |
| 8–253 | 246 bytes | payload | Meaningful bytes followed by zero padding |
| 254–255 | 2 bytes | crc16 | Big-endian CRC over bytes 0–253 |

The default payload contains 12 meaningful bytes:

| Payload offsets | Type | Measurement |
|---|---|---|
| 0–1 | signed int16 | Temperature in centi-degrees Celsius |
| 2–3 | unsigned int16 | Battery voltage in millivolts |
| 4–7 | unsigned int32 | Altitude in metres |
| 8–11 | unsigned int32 | Simulated uptime counter in seconds |

Temperature encoding rounds `temperatureC × 100` to an integer and checks the signed 16-bit range.

### 6.3 CRC parameters

| Parameter | Value |
|---|---|
| Width | 16 bits |
| Polynomial | `0x1021` |
| Initial value | `0xFFFF` |
| Input / output reflection | false / false |
| Final XOR | `0x0000` |
| Input bytes | Body bytes 0–253, including padding |
| Stored location | Body bytes 254–255, big-endian |
| Fixed check vector | ASCII `123456789` -> `0x29B1` |

The sender and receiver use the same tested implementation. ASM bytes are excluded from the frame CRC.

## 7. Transmitter and Impairment Simulation

### 7.1 Deterministic telemetry

The default generator starts sequence at 0 and increments with unsigned 32-bit wraparound. For sequence `s`:

```text
temperatureC = (2400 + s % 100) / 100
batteryMv    = 7420 - s % 20
altitudeM    = 520000 + s % 1000
uptimeSeconds = s
```

These values are synthetic. Uptime is a simulated sequence-derived counter, not measured elapsed host time.

### 7.2 Application packetization

The packetizer uses Mulberry32 with default seed 42 and selects chunks from 1 through 96 bytes. RNG state and unfinished chunks persist across generated frames. Therefore, chunk boundaries do not define telemetry boundaries.

Neither the simulator nor packetizer flushes after every generated frame. Normal shutdown flushes the remaining stream tail. Only the simulator's final incomplete byte receives terminal zero padding.

### 7.3 Impairment modes

| Mode | Transformation |
|---|---|
| clean | No corruption; arbitrary packetization remains active |
| bit-offset | Prefix 1–7 alternating bits; default offset 3 produces `101` |
| bit-flip | Flip one selected body bit |
| bit-insert | Insert bit 1 before the selected bit |
| bit-delete | Remove the selected bit |
| bit-slip | Alias for bit-insert |

Faults occur **after CRC generation and before UDP packetization**. CRC is not recomputed afterward.

Default corruption target is clean frame index 5, body bit 80. CLI controls can change target frame and body bit. Body bit indices 0–2031 exclude the ASM and stored CRC. Seeded packetization and explicit fault locations make experiments reproducible.

## 8. Receiver Synchronization Algorithm

### 8.1 Persistent BitBuffer

The BitBuffer stores bytes in an owned backing Buffer and maintains an arbitrary head bit offset. It supports bit reads, 32-bit matching, nonaligned extraction into a new byte-aligned Buffer, bit discard, and periodic compaction.

Consumed data is removed logically and compacted physically. Backing allocation is capped at 64 KiB. Large incoming pushes are processed in 4096-byte batches; the receiver does not accumulate the entire running stream as a bit array.

### 8.2 State transitions

| State | Action | Next state |
|---|---|---|
| HUNT | Compare every searchable 32-bit window against ASM | Match -> LOCK; otherwise remain HUNT |
| LOCK | Retain candidate and wait for 2080 bits from ASM start | Complete -> VERIFY; incomplete -> LOCK |
| VERIFY | Extract 2048 body bits; shared decoder checks CRC and structure | Valid -> EXTRACT; invalid -> HUNT |
| EXTRACT | Emit accepted frame, count it, consume 2080 bits | Next ASM already present -> LOCK; otherwise HUNT |

The implementation checks both CRC and payload-length validity before entering EXTRACT. CRC failure has precedence if both checks fail; `formatFailures` records CRC-valid structural rejection.

### 8.3 Search-tail retention

After HUNT checks all available 32-bit windows, it retains at most 31 trailing bits. A marker can begin in this tail and finish in the next datagram. Discarding the complete tail would lose such a marker.

### 8.4 Failed-candidate recovery

If validation fails at an ASM starting at absolute bit position `p`, search resumes at **p + 1**, not p + 2080.

This rule is necessary because a true marker may lie inside a rejected false candidate. An executed test places the failed marker at bit 0 and the real marker at bit 35. The receiver returns to HUNT at bit 1 and recovers the true marker at alignment 3.

### 8.5 Conceptual processing procedure

```text
For each received datagram:
    count datagram and payload bytes
    append bytes through bounded batches to persistent state
    repeatedly process the FSM:
        HUNT: search every bit; retain <=31 bits if no marker is complete
        LOCK: wait until the entire ASM + body is available
        VERIFY:
            reconstruct body and validate
            if invalid:
                count failure
                discard one bit from failed ASM start
                return to HUNT
        EXTRACT:
            emit valid frame
            consume the successful 2080-bit unit
            lock directly to an available next ASM, or hunt again
```

A defensive buffer-cap fault abandons the retained candidate, records a reset diagnostic, and searches the current bounded input batch. This path is tested through explicit fault injection; ordinary long-noise tests recover without requiring resets.

## 9. Metrics, WebSocket, and Dashboard

### 9.1 Receiver metrics

The status contract contains exactly:

```text
state, synced, udpDatagramsReceived, udpBytesReceived,
asmDetections, validFrames, crcFailures, formatFailures,
sequenceGaps, resyncCount, framesPerSecond, bytesPerSecond,
bufferedBits, currentBitAlignment
```

`synced` is false in HUNT and true in LOCK, VERIFY, or EXTRACT. It indicates receiver synchronization state, not a guarantee that the current candidate will pass validation. Candidate alignment is the detected absolute ASM position modulo 8.

`resyncCount` increments when another ASM candidate is acquired after a failed candidate. The new candidate may itself fail later. Startup/noise alone does not count as resynchronization.

### 9.2 Sequence gaps and rates

Only valid extracted frames influence gap tracking. The first valid sequence establishes a baseline. Subsequent unsigned forward advances below 2^31 add `advance - 1` gaps. Duplicate, older, or exactly half-range observations do not move the baseline.

The label is **Frame Sequence Gaps**, not UDP Packet Loss. Frame sequence observations do not identify every lost datagram.

Rates use actual elapsed monotonic time:

```text
framesPerSecond = delta(validFrames) / elapsedSeconds
bytesPerSecond  = delta(udpBytesReceived) / elapsedSeconds
```

The byte rate measures UDP payload bytes, excluding UDP/IP headers and WebSocket traffic.

### 9.3 WebSocket messages

Two JSON message types are used. WebSocket provides the browser communication channel [5]; it is not part of the simulated spacecraft downlink.

| Message | Content | Publication |
|---|---|---|
| receiver.status | type, ISO UTC timestamp, 14-field metrics object | At most four times per second |
| frame.valid | type, ISO UTC timestamp, sequence, payloadLength, telemetry fields, bitAlignment | Every accepted frame |

Structurally valid payloads shorter than 12 bytes have no decoded telemetry. They still generate `frame.valid` with null telemetry fields, shown as “—” by the UI. Invalid CRC/format candidates generate no valid-frame event.

The receiver continues without browser clients. Individual disconnects and slow-client termination do not stop UDP processing.

### 9.4 Dashboard

The single-page dashboard displays connection status, FSM state, sync status, current alignment, latest valid alignment/telemetry, valid-frame and failure counters, sequence gaps, resynchronizations, UDP datagram count, rates, and buffered bits.

Recent events are derived from existing status/frame messages and limited to 20 entries. No extra event protocol or persistent storage is used. The browser reconnects automatically; sampled status may miss short VERIFY/EXTRACT transitions.

## 10. Implementation Organization

```text
project/
├── prd.md
├── context.md
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── src/
│   ├── shared/        constants, configuration, CRC, frame codecs, types
│   ├── transmitter/   FrameBuilder, BitstreamSimulator, Packetizer, UDP CLI
│   └── receiver/      BitBuffer, Synchronizer, Metrics, UDP CLI, WebSocket
├── ui/                Vite configuration, HTML, TypeScript, CSS
├── test/              13 automated test suites and test-only bit helpers
└── docs/
    ├── prd-audit.md
    └── academic-project-report.md
```

The authoritative design is `prd.md`. `context.md` records implementation state. The [final audit](prd-audit.md) maps all 36 PRD sections to evidence.

## 11. Installation and Execution

### 11.1 Installation

Install the repository-pinned Node.js and npm versions. From PowerShell:

```powershell
cd "D:\jenevi\FALL SEM 26-27\CN\Project"
npm ci
```

On another computer, replace the directory with the location of the project checkout.

### 11.2 Terminal 1: ground receiver

```powershell
cd "D:\jenevi\FALL SEM 26-27\CN\Project"
npm run receiver
```

This starts UDP on 127.0.0.1:5000 and WebSocket on 127.0.0.1:8080. Expected startup messages:

```text
[UDP] listening 127.0.0.1:5000
[WS] listening ws://127.0.0.1:8080
```

After input arrives, the console reports acquisitions, validation failures when present, and valid frame sequences.

### 11.3 Terminal 2: spacecraft transmitter

```powershell
cd "D:\jenevi\FALL SEM 26-27\CN\Project"
npm run transmitter -- --mode clean
```

Expected destination/rate/seed message:

```text
[TX] destination=127.0.0.1:5000 rate=5 seed=42
```

The console also prints simulator configuration and generated sequence/chunk counts. Clean mode applies no impairment, even though configuration parameters are printed.

### 11.4 Terminal 3: dashboard

```powershell
cd "D:\jenevi\FALL SEM 26-27\CN\Project"
npm run ui
```

Open **http://127.0.0.1:5173/**. Vite uses a strict port; it reports an error rather than silently selecting another port if 5173 is occupied.

### 11.5 Demonstration commands

Use one transmitter mode at a time:

```powershell
npm run transmitter -- --mode clean
npm run transmitter -- --mode bit-offset --offset 3
npm run transmitter -- --mode bit-flip
npm run transmitter -- --mode bit-insert
npm run transmitter -- --mode bit-delete
npm run transmitter -- --mode bit-slip
```

Restart the receiver between distinct demo streams to reset sequence tracking and counters. Recovery within any one stream requires no restart. Stop the transmitter first with Ctrl+C, then receiver and dashboard.

### 11.6 Configuration

| Environment variable | Default |
|---|---|
| UDP_HOST / UDP_PORT | 127.0.0.1 / 5000 |
| WS_PORT | 8080 |
| FRAME_RATE | 5 |
| CHUNK_MIN_BYTES / CHUNK_MAX_BYTES | 1 / 96 |
| SIM_SEED | 42 |

For smaller chunks in the transmitter terminal:

```powershell
$env:CHUNK_MAX_BYTES = '16'
npm run transmitter -- --mode clean
```

Fault controls include `--target-frame` and `--body-bit`. Changing WS_PORT requires updating the browser endpoint constant in `ui/src/main.ts`.

## 12. Testing Methodology and Results

### 12.1 Verification procedure

Testing covers shared protocol primitives, buffer behavior, explicit state transitions, stream reconstruction, simulator transformations, real localhost UDP/WebSocket integration, metrics, and bounded UI event logic.

Integration tests use ephemeral localhost ports and close their sockets. Determinism comes from controlled seeds or explicit bit locations. Tests compare recovered sequences, telemetry, alignments, counters, and stream positions rather than relying only on console text.

### 12.2 Recorded final automated checks

These are the executed final-integration results recorded on 8 October 2026 in [the PRD audit](prd-audit.md). This documentation task does not claim a new test execution.

| Command | Recorded result |
|---|---|
| `npm test` | 178 total; 178 passed; 0 failed, skipped, cancelled, or todo |
| `npm run typecheck` | Passed, exit 0 |
| `npm run build` | Passed, exit 0 |
| `npm run typecheck -- --noUnusedLocals --noUnusedParameters` | Passed, exit 0 |
| `npm ls --depth=0` | Passed; required dependencies only |

### 12.3 Test coverage

| Test area | Count | Main evidence |
|---|---:|---|
| CRC | 4 | Fixed 0x29B1 vector, deterministic calculation |
| Frame codecs | 21 | Size, offsets, byte order, bounds, padding, telemetry |
| BitBuffer | 28 | Bit reads/matching/extraction, ownership, compaction, cap |
| Synchronizer | 27 | FSM, offsets 0–7, split input, false lock, recovery |
| Configuration | 4 | Defaults, overrides, input validation |
| FrameBuilder | 5 | ASM/body generation, mock values, sequence wrap |
| Packetizer | 9 | Exact reassembly, seeds, chunk range and persistent carry |
| UDP integration | 9 | 100 clean frames, split markers/bodies, lifecycle |
| Bitstream simulator | 21 | Exact deterministic transformations and carry |
| Fault recovery | 23 | Offsets, flips, both slips, false lock, long noise |
| Metrics | 14 | Counters, sequence semantics, elapsed-time rates |
| WebSocket | 10 | Schemas, clients, spacing, UDP integration, short payloads |
| UI events | 3 | Derived recovery events and bounded history |
| **Total** | **178** | **All passed** |

### 12.4 Important recovery experiments

**Fragmentation:** The real UDP test “100 clean frames survive seeded 1..96-byte datagrams in order” recovered sequences 0–99 and exact telemetry, with zero CRC/format failures and 26,000 received payload bytes.

**False lock:** The test “critical recovery: real ASM inside the failed candidate survives the one-bit restart” rejects the marker at bit 0, resumes at bit 1, and finds the true marker at bit 35. A corresponding actual-UDP test protects the same behavior.

**Bit slips:** Automated faults in frame index 1 produce a failed candidate starting at bit 2080 and a return to HUNT at bit 2081. The intact frame-2 marker occurs at bit 4161 after insertion, or 4159 after deletion. Later sequences resume in the same receiver instance.

**Memory:** A 1 MiB noise input leaves exactly 31 searchable-tail bits and bounded backing storage, then recovers when a valid stream arrives. Separate tests cover the 64 KiB cap and an injected capacity failure. The cap is a receive-backing-storage bound, not a measurement of total Node.js process memory.

### 12.5 Recorded local end-to-end demonstrations

The final verification used real receiver, transmitter, and Vite CLI processes, default localhost endpoints, seed 42, chunks 1–96 bytes, and configured 5 FPS. Installed headless Microsoft Edge loaded the actual dashboard; repeated DOM observations and screenshots provided evidence. The deletion screenshot was visually inspected. This was not an interactive graphical-window testing session.

| Scenario | Recorded observation |
|---|---|
| Clean | Connected, LOCK/Synced, alignment 0; latest sequence 8, valid-frame count 9; CRC/gap/resync all 0 |
| Offset 3 | Connected, alignment 3; latest sequence 8, valid-frame count 9; CRC/gap/resync all 0 |
| Bit flip | Damaged sequence 5 absent; sequence 6 and later through 9 displayed; alignment 0; CRC/gap/resync each 1 |
| Insertion | Sequence 5 absent; later telemetry through 8; alignment changed 0 -> 1; CRC/gap/resync each 1 |
| Deletion | Sequence 5 absent; later telemetry through 9; alignment changed 0 -> 7; CRC/gap/resync each 1 |

No receiver restarted during fault recovery. All cases showed changing telemetry and nonzero sampled rates. Screenshots/inspection records remain local under ignored `dist/manual-round7/`; the audit document is the submission evidence record.

At 5 clean units per second, the nominal telemetry-stream payload rate is `5 × 260 = 1300 bytes/second`. This is a calculation from configuration, not a measured benchmark. Periodic dashboard rates fluctuate because frames and bytes arrive in bursts, and status/frame messages are not an atomic snapshot.

## 13. Discussion and Limitations

The experiments show that datagram-independent buffering, bit-level marker detection, and CRC-driven recovery work together under the tested conditions. The receiver can reject a corrupted candidate and resume later valid decoding even when the byte alignment changes.

Several limits are intentional:

- The system models a logical stream in software; it does not model RF modulation, demodulation, or a physical spacecraft link.
- The frame is custom and CCSDS-inspired, not a complete CCSDS TM Transfer Frame.
- UDP bytes are processed in arrival order; there is no reorder restoration, retransmission, or FEC.
- CRC can miss some error patterns and cannot prove that every marker candidate is authentic.
- Sequence tracking assumes forward advances smaller than 2^31 and does not retroactively repair counted gaps.
- Dashboard sampling may omit brief FSM transitions. Exact transition tests and console logs provide additional evidence.
- A partial packetizer chunk may delay a frame's final bytes until the next generation tick.
- The receiver retains no telemetry history for replay, and the dashboard has no persistent event storage.
- Results establish correctness for the tested inputs and local course-demo conditions, not production mission readiness or a high-throughput performance guarantee.

## 14. Optional Future Work

Possible extensions, if separately requested, are deterministic datagram drop, adjacent reorder, duplicate simulation, a small throughput chart, or preset demo controls.

These are optional additions rather than incomplete requirements. Reliability protocols, full CCSDS conformance, RF hardware, and production deployment would require separately defined scope and validation.

## 15. Conclusion

The project implements and verifies a local telemetry pipeline whose core is a persistent, bit-level, CRC-controlled receiver. It reconstructs frames across arbitrary UDP boundaries, detects markers at every bit alignment, rejects invalid candidates, and automatically reacquires later telemetry after false lock, corruption, insertion, or deletion.

All 178 automated tests and the recorded typecheck/build checks passed. End-to-end demonstrations confirmed live browser observation and restart-free recovery in both slip directions. The implementation satisfies the mandatory project specification while remaining small enough to inspect and explain in a Computer Networks course.

## 16. References

External references support protocol background. The repository PRD defines the custom frame and implementation contract. No text from standards is reproduced verbatim.

1. J. Postel, **User Datagram Protocol**, RFC 768, August 1980. [RFC Editor](https://www.rfc-editor.org/rfc/rfc768).
2. Consultative Committee for Space Data Systems, **TM Synchronization and Channel Coding**, CCSDS 131.0-B-5, September 2023, section 9. [Referenced issue PDF](https://ccsds.org/Pubs/131x0b5.pdf). This issue is cited for synchronization background, not presented as the latest edition.
3. Consultative Committee for Space Data Systems, **TM Space Data Link Protocol**, CCSDS 132.0-B-3, October 2021. [Standard PDF](https://ccsds.org/Pubs/132x0b3.pdf).
4. Node.js, **UDP/datagram sockets**, Node.js 22.19.0 documentation. [Version-matched documentation](https://nodejs.org/download/release/v22.19.0/docs/api/dgram.html).
5. I. Fette and A. Melnikov, **The WebSocket Protocol**, RFC 6455, December 2011. [RFC Editor](https://www.rfc-editor.org/rfc/rfc6455).
6. Project repository, **Product Requirements Document**. [prd.md](../prd.md).
7. Project repository, **Final PRD Audit and Verification Evidence**, 8 October 2026. [prd-audit.md](prd-audit.md).
8. Project repository, **Run Instructions and Architecture**. [README.md](../README.md).

External reference links checked on 8 October 2026.

---

**Submission preparation:** Replace the bracketed identity fields on the first page with the required student, department, institution, faculty, and semester details. If screenshots are required by the institution, include actual captured dashboard images in the submitted package and label the mode and observed result.


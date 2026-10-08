# Project Development Context

## Source of Truth
- `prd.md`, read completely (all 36 sections) before implementation decisions; unchanged through Round 7.
- `context.md` records progress and does not override `prd.md`. Update at every development round; record only implemented behavior and executed checks.
- Final requirement-by-requirement evidence: `docs/prd-audit.md`; practical run commands: `README.md`.

## Project Goal
Small software-only Computer Networks project: mock spacecraft telemetry -> custom frames/CRC/ASM -> impaired logical bitstream -> arbitrary UDP chunks -> persistent bit-level receiver/FSM -> validated telemetry -> WebSocket -> minimal dashboard. Complexity belongs in synchronization and recovery.

## Project Status
PROJECT COMPLETE — all mandatory PRD requirements and final acceptance checks pass. No known blocking bug. Optional features remain optional; no further implementation round is scheduled.

## Novelty-Critical Features
All six are implemented and tested; exact names/evidence are in `docs/prd-audit.md`.
- Persistent UDP-independent buffering: real split-ASM/body, incomplete LOCK, 100-frame UDP tests.
- Bit-level ASM detection: all alignments 0..7; markers cross datagrams.
- Explicit deterministic HUNT/LOCK/VERIFY/EXTRACT FSM: transition/direct LOCK/waiting tests.
- CRC-controlled validation/recovery: fixed vector, corrupted candidate rejection, no invalid output.
- Automatic resynchronization: failure resumes at failed ASM + 1 bit; true marker at bit 35 inside false candidate recovered.
- Changed-alignment recovery: insertion 0 -> 1 and deletion 0 -> 7, later valid telemetry without restart or fault hints.
UDP, CRC, FSMs, ASM concepts/value, Node/TypeScript/Buffer, WebSockets and dashboards are standard components. Their specific receiver-side combination is the technical focus, not a proven patent claim.

## Locked Technical Decisions
- ASM `0x1ACFFC1D`, 32 bits MSB-first, immediately before and outside body. Body 256 bytes/2048 bits; clean unit 260 bytes/2080 bits. All multibyte fields big-endian.
- Body: sequence uint32@0..3; payloadLength uint16@4..5 (0..246); flags uint16@6..7 (default 0); zero-padded payload246@8..253; CRC uint16BE@254..255.
- Default telemetry12: signed int16 centi°C@payload0..1, uint16 battery mV@2..3, uint32 altitude m@4..7, uint32 uptime s@8..11.
- CRC width16/poly1021/initFFFF/refin=false/refout=false/xorout0000, covers body0..253. ASCII123456789 -> 29B1. Sender/verifier share project-owned implementation.
- UDP udp4 127.0.0.1:5000, append received bytes in arrival order; no retransmission/reorder restoration.
- Default 5 generated frames/sec; Mulberry32 chunk range1..96 bytes, seed42. Sequence starts0 and wraps uint32.
- WebSocket ws://127.0.0.1:8080; only receiver.status (<=4/sec) and frame.valid (each accepted frame), ISO UTC timestamps. Vite localhost:5173.
- Exact 14 metrics: state, synced, udpDatagramsReceived, udpBytesReceived, asmDetections, validFrames, crcFailures, formatFailures, sequenceGaps, resyncCount, framesPerSecond, bytesPerSecond, bufferedBits, currentBitAlignment.
- Node22.19.0 LTS/npm10.9.3 pinned; strict ESM/NodeNext ES2022 TypeScript, node:dgram, Node Buffer, own CRC/BitBuffer, ws, Vite, vanilla HTML/CSS/TS, node:test/assert.
- One private package. Runtime ws8.18.3 only; dev TypeScript5.9.2, tsx4.20.5, Vite7.1.3, @types/node22.18.0, @types/ws8.18.1. Lockfile retained; no final-round upgrades.
- BitBuffer append/availableBits/readBit/match32/sliceBitsToBuffer/discardBits/compactIfNeeded; hard64KiB backing cap; large Synchronizer input batched4096 bytes.
- HUNT every bit, <=31 trailing bits; LOCK waits2080 bits; VERIFY checks shared decoder/CRC; EXTRACT emits valid frame/consumes2080 then direct LOCK on next ASM or HUNT.
- CRC or format failure: discard exactly1 bit from failed ASM start and hunt buffered bits. Never discard the whole rejected candidate.

## Current Architecture
`FrameBuilder -> BitstreamSimulator -> Packetizer -> UDP sender -> UDP receiver -> persistent BitBuffer/Synchronizer -> shared CRC/decoder -> Metrics -> ws -> Vite dashboard`.
One npm package with shared/transmitter/receiver modules, vanilla UI, 13 native test suites plus test-only bit helpers. No framework/infrastructure.

## Final Architecture
- Synchronizer.push(Buffer) returns validated frame/bitAlignment/asmBitOffset results. UDP handler passes payload unchanged to the same instance; no frame parsing or fault metadata in transport.
- Synchronizer owns protocol counters, UDP wrapper owns transport counters; Metrics owns forward sequence baseline/gaps and elapsed-time rates. Shared observability types define JSON only; frontend imports no receiver runtime.
- CLI enables WebSocket; imported startReceiver enables it only with websocket option, preserving isolated UDP tests. One guarded250ms timer emits status; frame.valid emits immediately. No-client reception continues.
- Close clears timer, terminates observer clients and closes WS/UDP. Slow clients with >64KiB queued output are terminated; disconnect/send errors are observer-local.
- Vite build writes ignored dist/ui. Browser read-only, reconnects1s, retains20 derived recent events. Current candidate alignment and latest valid-frame alignment are separate.

## Current Phase
Round 7 complete — Project implementation complete.

Seven-round user roadmap completed:
1. Understanding/foundation/tooling/context.
2. Binary constants/CRC/frame encoder/decoder/tests.
3. BitBuffer and explicit synchronization/recovery FSM.
4. UDP transmitter/receiver and arbitrary packetization.
5. Deterministic faults, false lock, changed alignment, bounded memory.
6. Metrics, WebSocket, minimal UI.
7. Full PRD audit, final corrections, automated/live verification, cleanup and documentation.
The PRD's eight implementation phases group into these seven rounds without changing ordering.

## Implemented
- Exact shared binary primitives, bounds/quantization, owned decoded payloads, independent CRC/format validation.
- Persistent bounded BitBuffer with nonaligned extraction, compaction, every-bit ASM matching.
- All four explicit FSM states, incomplete-candidate retention, direct adjacent LOCK, valid-only extraction, one-bit recovery, defensive capacity-fault reset/recovery diagnostic.
- Deterministic FrameBuilder and streaming Packetizer with carry across units, seed/configuration controls, actual UDP socket lifecycle/CLI.
- Streaming MSB-first clean, bit-offset, bit-flip, bit-insert, bit-delete, bit-slip (insertion alias), after CRC and before packetization.
- Required metrics, forward uint32 gap tracking, actual elapsed-time rates, exact status/event keys, multiple browser clients/isolated disconnect.
- Every valid frame emits frame.valid, including payload0..11 with null unavailable telemetry. UI displays “—”; invalid frames emit nothing.
- One-page dashboard: connection, FSM/sync/alignment, counters, rates/buffer, latest telemetry, bounded recent events.
- Practical README, complete36-section audit, source/config/test cleanup. No optional datagram fault/UI expansion.

## Tests Passing
Final Round7 checks actually executed:
- `npm test`:178 total,178 passed,0 failed,0 skipped,0 cancelled,0 todo; exit0.
- `npm run typecheck`:exit0.
- `npm run build`:exit0, successful Vite production UI.
- `npm ls --depth=0`:exit0; dependency audit found only required packages.
- Unused-code audit `npm run typecheck -- --noUnusedLocals --noUnusedParameters`:exit0. Final `git diff --check` passed; build/dependency paths are untracked and ignored. All27 protected baseline file hashes match, including PRD/lock/core/simulator/unaffected tests.
Suite breakdown: CRC4/frame21/BitBuffer28/Synchronizer27/config4/FrameBuilder5/Packetizer9/UDP integration9/simulator21/fault recovery23/metrics14/WebSocket10/UI events3.
Earlier completed regression totals: R2=25, R3=80, R4=107, R5=151, R6=177. R7 ran all prior coverage, corrected the obsolete short-event suppression assertion and added real UDP/WS tests for every length0..11.
Evidence includes fixed CRC vector, exact frame round trips, offsets0..7, split ASM/body, 100 clean real-UDP frames, false marker at bit35, both slips, long noise/cap/defensive recovery, uint32 wrap/gaps, exact schemas/timestamps/status spacing, multi-client/disconnect/zero-client operation, rate sampling and bounded UI events. No test-only placeholder implementation.

## Demo Verification
2026-10-08, localhost/seed42/chunks1..96/configured5FPS. Actually launched receiver/transmitter/Vite processes for five cases. Installed headless Edge inspected the live dashboard DOM repeatedly and captured screenshots; final deletion screenshot visually inspected. No interactive GUI session or new browser-testing dependency claimed.
- Clean: connected LOCK/Synced/alignment0; sequence8/9 valid; CRC/gap/resync0; changing telemetry/nonzero rates.
- Offset3: connected alignment3; sequence8/9 valid; CRC/gap/resync0.
- Flip: sequence5 absent; sequence6 onward through9; alignment0; CRC/gap/resync each1.
- Insert: sequence5 absent; sequence6 onward through8; observed0 -> 1; CRC/gap/resync each1.
- Delete: sequence5 absent; sequence6 onward through9; observed0 -> 7; CRC/gap/resync each1.
Fresh receiver per distinct case, never restarted during recovery. Status and frame events are asynchronous; do not infer an atomic snapshot or exact average throughput from short sampled rates.
Automated frame1 faults: failed ASM2080 -> HUNT2081; later frame2 ASM4160 flip /4161 insert /4159 delete. False-lock failed0 -> HUNT1 -> trueASM35/alignment3.
Screenshots/JSON intentionally ignored in dist/manual-round7 (prior round evidence also under dist). Audit document is submission evidence. Temporary harness scripts/browser profile removed; final check found0 demo processes,0 UDP endpoints5000,0 TCP listeners8080/5173/9222.

## Known Issues
- No known blocking defect or synchronization-algorithm ambiguity.
- Educational simulator/custom frame, not full CCSDS TM or RF processing; CRC detects rather than repairs and may miss some errors.
- UDP arrival order only, no reliability/reorder restoration/FEC/ARQ. Forward serial comparisons assume advances<2^31; duplicates/older/half-range observations do not move baseline or repair prior gaps.
- Sampled status can miss brief FSM transitions; logs/counters/events preserve recovery evidence. Rates fluctuate; packetizer tail can delay a frame by one generation tick.
- No server history/replay. Dashboard labels disconnection, retains last values while disconnected and clears on reconnect.
- WS_PORT overrides require editing the browser's endpoint constant.
- PRD does not define absent telemetry serialization. Null is the explicit final policy for valid short payloads; default12-byte frames retain numeric schema. The earlier omission contradicted every-valid-frame publication and was corrected/tested.

## Decisions Made During Development
- Keep Node/npm pins, explicit dependency versions/lockfile, ESM/NodeNext and native tests (`node --import tsx --test test/*.test.ts`). No extra lint/build/backend framework.
- BitBuffer owns backing bytes; endBytes/headBit indices, geometric allocation starting256 bytes, cap64KiB. Compact at >=1024 consumed whole bytes or >=half used bytes and before growth; preserve headBit mod8. Fully consumed indices reset; retained peak allocation reused.
- Synchronizer batches4096-byte inputs, bulk-discards scanned noise, normalizes candidate to head. Logical absolute bit position survives physical compaction; alignment=ASMstart mod8.
- VERIFY calls shared decodeFrame once, requires CRC and format before EXTRACT (Round3 instruction); CRC failure precedes format failure when both false. Failure consumes1 bit; success2080.
- BufferLimitError abandons retained candidate/bits, preserves stream position/counters, reports buffer_limit/bufferResets, retries current bounded batch and hunts. Explicit fault injection tests it; ordinary noise/large input does not reset.
- resyncCount increments first ASM after each failed candidate even if new candidate later fails; pending flag clears on acquisition. Startup/noise alone does not count.
- Transition observer is synchronous/observational; do not reenter push. No receiver event history; stats are copied with storage diagnostics.
- Frame encoder derives length from raw payload Buffer; encoder does not wrap input sequence (generator owns wrap). decodeFrame copies meaningful payload; invalid declared length produces empty payload. Bad CRC/format is a validation result, wrong body size throws.
- Temperature quantizes Math.round(Celsius*100) then checks signed16 bounds; other fields integral/unsigned bounded. Telemetry exists only with valid CRC/format and >=12 meaningful bytes.
- Mock telemetry temperature=(2400+seq%100)/100, battery=7420-seq%20, altitude=520000+seq%1000, uptime=seq; uptime is a mock counter, not elapsed host time.
- Mulberry32 retains uint32 state including seed0. Packetizer partial chunk/RNG survive pushes; final flush only, short final tail allowed, no padding or per-frame flush. Sender awaits callbacks sequentially and yields setImmediate for I/O; no ACK/retry.
- Simulator numeric MSB-first shift register retains<=7 output bits. Fault target=zero-based clean unit index; targetBit=index*2080+32+bodyBitOffset, body0..2031 excludes ASM/storedCRC. Defaulttarget5/body80; insertion bit1; offset3 prefix101; bit-slip aliases insert. No CRC recomputation/fault oracle.
- Final simulator flush pads only terminal partial byte, excludes padding from outputBitLength, disallows later input and is idempotent. Then packetizer flush.
- Socket factories importable with CLI guards; tests bind localhost port0 and close resources. CLI validates configuration before sockets and supports normal signal shutdown/tail flush; socket/config errors process-level, corruption protocol-level.
- Metrics reuse authoritative counters; first valid sequence establishes baseline. delta=(next-baseline)>>>0; only1..2^31-1 advances add delta-1 and move baseline. Duplicates/older still count valid frames.
- Rates=count deltas/actual monotonic elapsed seconds; zero/nonpositive elapsed preserves pending deltas; status samples even with no clients.
- WS250ms minimum-spacing guard avoids bursts; exactly two messages, ISO UTC; no connect-triggered status burst. Frontend types erased, no receiver runtime imported.
- Events derive state/counter deltas and valid frames, bounded20, aggregate unseen changes. One browser endpoint constant, reconnect1s, no persistence/control.
- Round7 fixed publication (not decoder/core) for short valid frames; same keys/null unavailable fields. Consolidated backend WS defaults; no receiver synchronization or simulator algorithm changes.
- Repository originally had only PRD/no Git; a Git repository now exists. Preexisting uncommitted work preserved; no commit made. PRD, dependency lock and core synchronization source unchanged this round.

## Files Added / Changed
Round7 only:
- Added `docs/prd-audit.md`.
- Updated `README.md`, `context.md`, `.gitignore`.
- Consolidated WS defaults in `src/shared/constants.ts`, `src/shared/config.ts`; nullable event fields in `src/shared/observability.ts`.
- Corrected `src/receiver/websocketServer.ts`, `ui/src/main.ts`, `test/websocket.test.ts`.
- Removed obsolete future-phase wording in `src/shared/frame.ts` (comments only).
- Temporary ignored browser harness/profile removed; ignored screenshots/JSON retained. No dependency/package/lock/tsconfig changes in Round7; populated-directory placeholders already removed earlier.

## Optional Future Work
Datagram drop/reorder/duplicate simulation, throughput charts and preset demo buttons only. Not pending MVP requirements. Full protocol/RF/cloud infrastructure remains outside scope.

## Next Phase
No Round8 or additional implementation is authorized/scheduled. Project is complete; later work, if requested, is maintenance or explicitly optional scope.

## Do Not Forget
- PRD wins; never edit it silently to fit code.
- One UDP message is not one frame. Fragmentation/slips are application-generated before datagrams; Node UDP exposes complete datagrams, not RF bits.
- Failed-candidate hunt starts at ASM+1, including true markers inside rejected candidates. Preserve incomplete LOCK and31 trailing HUNT bits; process all available complete frames; keep memory bounded.
- Protect mandatory tests A..J and six receiver features. Invalid CRC/format never publishes valid telemetry; short valid frames publish null unavailable telemetry.
- Frame/ASM/CRC/order/recovery are locked. CRC does not repair; custom educational frame is not full CCSDS.
- No database/auth/REST framework/cloud/container/broker/large frontend/ML/hardware/channel coding/unnecessary abstraction.

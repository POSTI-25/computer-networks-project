# Project Development Context

## Source of Truth
- `prd.md` (read completely, all 36 sections, before changes in Rounds 1 and 2).
- `context.md` tracks implementation progress but does not override `prd.md`.
- Update this file at the end of every development round; preserve decisions and report only implemented behavior and executed checks.

## Project Goal
Build a small software-only Computer Networks telemetry simulation: mock spacecraft frames -> impaired logical bitstream -> arbitrary UDP chunks -> persistent receiver BitBuffer -> bit-level synchronization FSM -> CRC-controlled acceptance/recovery -> decoded telemetry -> WebSocket -> minimal dashboard. The complexity belongs in the receiver.

## Novelty-Critical Features
- Persistent UDP-independent receive buffering.
- Bit-level ASM detection at alignments 0..7 and across datagrams.
- Explicit, testable HUNT/LOCK/VERIFY/EXTRACT FSM.
- CRC-controlled validation and recovery; failed frames never become valid telemetry.
- Automatic resynchronization after corruption and false ASM candidates.
- Recovery after changed bit alignment without restarting.
- These receiver features remain future work; Round 2 implements the shared CRC/validation primitives only. UDP, CRC, FSMs, ASM concepts/value, Node.js, TypeScript, Buffer, WebSockets, and dashboards are standard building blocks. The specific receiver-side combination is the technical focus, not a proven patent claim.

## Locked Technical Decisions
- ASM: `0x1ACFFC1D`, transmitted MSB-first as `00011010110011111111110000011101`; 32 bits, immediately preceding and outside the frame body.
- Custom frame: 256 bytes / 2048 bits. Clean ASM + frame unit: 260 bytes / 2080 bits. All multibyte integers are big-endian.
- Frame offsets: sequence uint32 at 0..3; payloadLength uint16 at 4..5 (0..246); flags uint16 at 6..7 (MVP 0); zero-padded 246-byte payload at 8..253; CRC uint16 at 254..255.
- Default meaningful payload is 12 bytes: signed int16 temperature in centi-degrees Celsius at payload 0..1; uint16 battery millivolts at 2..3; uint32 altitude metres at 4..7; uint32 uptime seconds at 8..11.
- CRC: width 16; polynomial `0x1021`; initial `0xFFFF`; refin/refout false; xorout `0x0000`; input frame bytes 0..253; stored big-endian at 254..255. ASCII `123456789` -> `0x29B1`. Same project-owned function for sender and verifier; error detection only.
- UDP: `node:dgram`, `udp4`, default `127.0.0.1:5000`; append all payload bytes in arrival order, ignoring datagram boundaries for framing. No retransmission or reorder restoration requirement.
- Defaults: 5 generated frames/sec; pseudo-random chunk size 1..96 bytes; numeric simulator seed 42. Sequence starts at 0, increments per generated frame with uint32 wraparound, and never resets on a fault.
- Stack: Node.js LTS, TypeScript, Node Buffer/bitwise operations, project-owned BitBuffer/CRC, `ws`, Vite, vanilla HTML/CSS/TypeScript, `node:test` and `node:assert`. One package; `ws` only external runtime dependency.
- WebSocket: `ws://127.0.0.1:8080`; only `receiver.status` (at most 4/sec) and `frame.valid` (each accepted frame), with ISO timestamps and exact PRD section 20 schemas.
- Metrics: state, synced, udpDatagramsReceived, udpBytesReceived, asmDetections, validFrames, crcFailures, formatFailures, sequenceGaps, resyncCount, framesPerSecond, bytesPerSecond, bufferedBits, currentBitAlignment. Synced is false only in HUNT. Label sequenceGaps "Frame sequence gaps", not "UDP packet loss".
- BitBuffer API: append, availableBits, readBit, match32, sliceBitsToBuffer, discardBits, compactIfNeeded. Any bit offset; extraction packs MSB-first into a new Buffer; head bit offset plus backing storage, periodic compaction; no ever-growing number array.
- HUNT scans each bit and retains at most the final 31 unsearchable bits. LOCK waits for 2080 bits from candidate ASM start. VERIFY extracts 256 bytes and checks CRC. On CRC failure, resume HUNT one bit after the FAILED ASM START, not after the candidate frame.
- EXTRACT validates payloadLength <= 246, decodes, updates metrics, and publishes accepted telemetry; consume the successful ASM + body, then directly LOCK on an available next ASM or return to HUNT. Invalid length increments formatFailures and uses the same failed-candidate resynchronization rule.
- Required impairment order: clean chunking, bit-offset prefix 1..7 bits, body bit-flip after CRC, bit-slip insertion/deletion before byte packetization. Drop/reorder/duplicate simulation and visual polish are optional after MVP.

## Current Architecture
- Initially the directory contained only `prd.md`; no source, package configuration, tests, existing documentation, or Git repository was present. The IDE-mentioned `deep-research-report.md` was not found on disk.
- One private ESM npm package with strict NodeNext TypeScript configuration for backend/tests. `src/shared` contains constants, types, CRC, and frame/payload primitives; `test` contains their native unit tests. `src/transmitter`, `src/receiver`, and `ui` remain placeholders.
- UI compilation/configuration will be added in Round 6, separate from Node-only backend typechecking. No receiver, sender, simulator, WebSocket server, or UI currently exists.

## Current Phase
Round 2 complete — Binary protocol primitives. Do not begin Round 3 without explicit user instruction.

Seven-round development plan (user roadmap; groups the PRD's implementation phases):
1. Understanding/foundation: inspect, read PRD, establish tooling/layout/context, document inconsistencies.
2. Binary primitives: constants, CRC, exact frame encoder/decoder, unit tests.
3. Synchronization core: BitBuffer, bit reads/extraction, ASM search, explicit FSM, rejection/recovery tests.
4. UDP transport: transmitter/receiver, arbitrary packetization, clean end-to-end reconstruction.
5. Faults/recovery: all alignments, corruption, false candidates, bit flip/slip, bounded memory, deterministic integration tests.
6. Observability/UI: metrics, WebSocket contracts, minimal single-page dashboard.
7. Final integration/demo: complete tests, deterministic demos, fixes, README/run commands, architecture documentation, PRD validation; no major new architecture.

## Implemented
- Package manifest with only PRD dependencies, exact dependency versions, Node/npm pins, and working typecheck/test commands.
- Dependencies installed successfully and `package-lock.json` generated: ws 8.18.3; development tools/types: TypeScript 5.9.2, tsx 4.20.5, Vite 7.1.3, @types/node 22.18.0, @types/ws 8.18.1.
- Backend/test TypeScript configuration, ignore rules, future component placeholders, and README documenting current APIs/check commands.
- Shared constants for exact PRD ASM, frame layout, telemetry offsets, CRC parameters, and clean transmission-unit sizes; shared FrameHeader, TelemetryPayload, FrameInput, FrameValidation, and DecodedFrame types.
- Project-owned non-reflected CRC-16/CCITT function shared by frame encoding and validation.
- `encodeTelemetry` / `decodeTelemetry`: 12-byte big-endian telemetry, signed centi-degree temperature, numeric wire bounds, and temperature rounding.
- `encodeFrame({ sequence, payload, flags? })`: exactly 256 bytes, derives payloadLength from a 0..246-byte Buffer, defaults flags to 0, zero padding, CRC over bytes 0..253 stored big-endian at 254..255, no ASM.
- `validateFrame` reports stored/calculated CRC, crcValid, and formatValid separately. `decodeFrame` reads header and copies meaningful payload; telemetry only for CRC/format-valid frames with at least 12 meaningful bytes. Invalid declared length returns formatValid false and an empty payload. Wrong body size throws RangeError.
- No UDP, BitBuffer, ASM scanning, FSM, simulator, metrics, resynchronization, WebSocket, or UI implemented.

## Tests Passing
- Round 2: `npm test` executed successfully: 25 tests, 25 passed, 0 failed/skipped/cancelled (4 CRC tests + 21 frame/payload/constants tests).
- CRC: fixed ASCII `123456789 -> 0x29B1`, determinism/input immutability, selected single-bit mutation, empty input `0xFFFF`.
- Required FRAME-1..11 passed: exact size, header offsets, big-endian sequence, payload/padding, CRC location/order/coverage, round trip, valid clean CRC, corruption flagging, payload length bounds, uint32 sequence boundaries, negative temperature.
- Additional tests passed: fixed PRD constants; exact telemetry bytes; extension bytes; centi-degree rounding; wire minima/maxima; invalid numbers for every input field; wrong frame lengths; every short payload length 0..11; full 246-byte payload; buffer ownership/input immutability.
- `npm run typecheck` executed successfully with source/tests under strict NodeNext configuration (exit 0). Native test execution required approved child-process access because the sandbox returned spawn EPERM.
- Round 1 foundation checks passed: dependency listing, local tool versions, manifest/lockfile agreement, Node pin, and config parsing with the then-expected no-input condition. No application build was claimed.
- PRD SHA-256 remained `C3281BED9A697503097909F10CB3797C435FEA86F5DE59D59CCB6955C94E0FDB` throughout edits.

## Known Issues
- No known defects in the Round 2 primitives. Receiver, transport, simulator, metrics, WebSocket, UI, integration tests, and demo commands remain future work by design.
- No existing-code/spec contradiction found. The PRD's eight implementation phases and the user's seven rounds describe compatible ordering, with BitBuffer/FSM grouped in Round 3 and WebSocket/UI grouped in Round 6.
- Round 2 request resolved short-payload decoding: lengths 0..11 are structurally valid with telemetry omitted. A later WebSocket publication policy for such non-default payloads still needs documentation; default demo frames contain 12 bytes.
- Sequence gaps require unsigned wraparound, but treatment of repeated/older valid sequences is not fully specified; document/test a forward-sequence policy when implementing metrics.
- UI requests ASM/failure/resync log entries, while WebSocket allows only status and valid-frame messages. In Round 6 derive log entries from observed status/counter changes; throttled status cannot guarantee every transient FSM event. Do not add message types without revising the requirement.
- No ambiguity changes the specified synchronization or failed-candidate search algorithm.
- Dependency installation required approved network access because the sandbox proxy refused registry connections; installation succeeded and is no longer a blocker.

## Decisions Made During Development
- Pin installed Node.js 22.19.0 (official LTS release) and npm 10.9.3; PRD locks LTS, not this particular version. `.nvmrc` and package engines agree.
- Use ESM/NodeNext and ES2022 for backend/tests; no build pipeline, framework, lint stack, or infrastructure added.
- Tests use `node --import tsx --test test/*.test.ts` and native assertions. No placeholder tests or protocol stubs.
- Dependency versions are explicit for reproducibility; retain generated package lock. Add receiver/transmitter/UI scripts only when their targets exist.
- Choose a 64 KiB defensive receive-buffer cap (PRD example) for later implementation, with safe reset plus recorded event. This is a development choice, not an implemented limit.
- Later alignment metrics must retain stream-origin bit accounting across discard/compaction so buffer-head changes cannot hide a bit slip. Exact resyncCount counting rule must be documented/tested when implemented.
- Round 2 frame API accepts raw payload Buffers; callers use `encodeTelemetry` for the default demo. Deriving length from the Buffer avoids inconsistent encoder header/payload input. No ASM wrapper implemented yet.
- Temperatures use `Math.round(Celsius * 100)` and validate the quantized signed int16 result; other fields must be integral and within their unsigned ranges. No automatic sequence wrap in encoder; generator owns wraparound later.
- CRC and format flags remain independent, including CRC-valid but format-invalid candidates. Bad CRC/format does not throw on a correctly sized body; decoded telemetry is suppressed. Caller must check both flags before accepting any frame.
- Decoded payload is an owned copy containing meaningful bytes only. Short valid payloads omit telemetry; malformed declared lengths produce no payload. These choices are documented/tested and leave future FSM control flow explicit.

## Files Added / Changed
- Round 1 foundation retained: package/lock/config, Node pin, ignore rules, and remaining placeholders.
- Round 2 added `src/shared/constants.ts`, `types.ts`, `crc16.ts`, `frame.ts`, `test/crc16.test.ts`, and `test/frame.test.ts`; removed obsolete `.gitkeep` in populated shared/test directories.
- Updated `README.md` and `context.md`. `prd.md`, package scripts/dependencies/lock, and TypeScript configuration unchanged in Round 2. Installed `node_modules/` remains ignored.

## Next Phase
Round 3: BitBuffer + bit-level ASM synchronization + explicit HUNT/LOCK/VERIFY/EXTRACT FSM + CRC-driven resynchronization. Implement arbitrary-bit reads/extraction, matching across appended chunks, head/discard/compaction and bounded noise buffering; wait for complete candidates; use shared validation; reject CRC/format-invalid candidates and search again one bit after failed ASM start; consume only successful units. Add deterministic BitBuffer/FSM tests including all alignments, fragmented markers/bodies, false locks with later real markers inside candidate regions, and recovery without restart. Update context after actual checks. Do not implement UDP, fault simulator, WebSocket, or UI in Round 3 unless later instructions change scope.

## Do Not Forget
- PRD wins over code/docs; no specification edits to accommodate implementation.
- One UDP message is not one frame. Simulator fragmentation and bit slips happen in the logical stream, not because UDP exposes partial datagrams/RF bits.
- Failed candidate recovery starts one bit after its ASM; search remaining buffered bits, including possible true markers inside false candidates.
- Keep incomplete candidates across messages; keep 31 trailing HUNT bits; process all available complete frames per callback; compact storage and bound memory.
- Protect mandatory tests A..J: CRC vector, frame round trip, split ASM, 100 fragmented clean frames with zero failures, offsets 1..7 (plus aligned baseline), corrupted frame rejection/recovery, false marker recovery, bit-slip reacquisition, bounded long noise, final UDP/WebSocket/UI demo.
- No databases, auth, HTTP frameworks/REST APIs, cloud/containers, brokers, heavy frontend frameworks, ML, hardware/RF processing, channel coding, full CCSDS stack, or unnecessary abstractions.
- Custom educational frame is not a fully compliant CCSDS TM frame; CRC does not repair data; WebSocket is only the dashboard bridge.

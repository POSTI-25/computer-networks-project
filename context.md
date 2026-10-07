# Project Development Context

## Source of Truth
- `prd.md` (read completely, all 36 sections, before changes in Rounds 1–3).
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
- The chunk-fed receiver core implements persistent buffering, bit-level ASM detection, FSM validation/rejection, and automatic recovery. Actual UDP integration and deliberate bit-slip fault simulation remain later work. UDP, CRC, FSMs, ASM concepts/value, Node.js, TypeScript, Buffer, WebSockets, and dashboards are standard building blocks. The specific receiver-side combination is the technical focus, not a proven patent claim.

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
- One private ESM npm package with strict NodeNext TypeScript configuration for backend/tests. `src/shared` contains binary primitives; `src/receiver` contains BitBuffer and the transport-independent Synchronizer. Native tests cover both layers; bit-string helpers exist only under `test`.
- `Synchronizer.push(Buffer)` returns zero or more validated `{ frame, bitAlignment, asmBitOffset }` results. The future UDP receiver will feed payload bytes into this API. No UDP socket, transmitter, simulator, WebSocket server, or UI exists. UI configuration will be added in Round 6, separate from Node typechecking.

## Current Phase
Round 3 complete — Bit-level synchronization core. Do not begin Round 4 without explicit user instruction.

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
- BitBuffer: owned backing Buffer, arbitrary-bit head, MSB-first reads/match32, byte-multiple nonaligned extraction, exact bit discard, periodic compaction, geometric growth, explicit invalid-range errors, hard 64 KiB allocation cap.
- Synchronizer: persistent chunk input, HUNT/LOCK/VERIFY/EXTRACT states, every-bit ASM hunting, incomplete-candidate waiting, shared CRC/format checks, valid-only extraction, exact successful-unit consumption, direct LOCK on adjacent ASM, one-bit-after-failed-ASM resynchronization.
- Internal snapshot counters/state: ASM detections, valid frames, CRC/format failures, candidate alignment, resyncCount, bufferResets, bufferedBits, storageBytes. Optional synchronous transition observer; no retained event history or rate metrics.
- Bounded noise hunting (<=31 trailing bits), 4 KiB input batching for arbitrary large pushes, safe capacity-fault reset and current-batch recovery with recorded reason and preserved stream position.
- No UDP, production fault simulator, throughput/FPS or sequence-gap metrics, WebSocket, or UI implemented. Full bit insertion/deletion recovery demonstrations remain Round 5.

## Tests Passing
- Round 3 final `npm test` run: 80 tests passed, 0 failed/skipped/cancelled. Includes all 25 unchanged Round 2 tests, 28 BitBuffer tests, and 27 Synchronizer tests. `npm run typecheck` passed (exit 0); native test runner used approved child-process access.
- BITBUF-1..8: MSB ordering, partial head/discard, append preserving tail, uint32 match at every alignment 0..7 and larger offsets, exact 2048-bit extraction at each alignment, cross-append markers, compaction with residual bits. Additional checks: bounds, uint32 sign bit, empty/reused buffers, owned copies, geometric tiny appends, cap enforcement and reuse.
- SYNC-1..11: all four state transitions, noise hunting, alignments 0..7 with one-byte chunks and exact decoded output, split ASM, fragmented frame, incomplete LOCK waiting, CRC rejection/later recovery, false candidates, consecutive direct LOCK, CRC-valid invalid-length rejection, and 1 MiB noise with exactly 31 retained bits then recovery.
- Critical false-lock test: failed ASM starts at bit 0; true ASM at bit 35 lies inside the failed 2080-bit candidate. Observed failure -> HUNT at bit 1, reacquired LOCK at bit 35/alignment 3, then valid frame after remaining bytes arrive. Whole-candidate discard would fail this test.
- Additional synchronization checks: marker beginning in the preceding tail's last bit, absolute alignment across compaction/inter-frame noise, 300 frames in one >64 KiB push, 100 frames using deterministic 1..96-byte chunks with zero failures, exact reacquisition counting, valid short payload, snapshot immutability, and injected public-buffer capacity failure recovering the next frame without restart.
- Round 2: `npm test` executed successfully: 25 tests, 25 passed, 0 failed/skipped/cancelled (4 CRC tests + 21 frame/payload/constants tests).
- CRC: fixed ASCII `123456789 -> 0x29B1`, determinism/input immutability, selected single-bit mutation, empty input `0xFFFF`.
- Required FRAME-1..11 passed: exact size, header offsets, big-endian sequence, payload/padding, CRC location/order/coverage, round trip, valid clean CRC, corruption flagging, payload length bounds, uint32 sequence boundaries, negative temperature.
- Additional tests passed: fixed PRD constants; exact telemetry bytes; extension bytes; centi-degree rounding; wire minima/maxima; invalid numbers for every input field; wrong frame lengths; every short payload length 0..11; full 246-byte payload; buffer ownership/input immutability.
- `npm run typecheck` executed successfully with source/tests under strict NodeNext configuration (exit 0). Native test execution required approved child-process access because the sandbox returned spawn EPERM.
- Round 1 foundation checks passed: dependency listing, local tool versions, manifest/lockfile agreement, Node pin, and config parsing with the then-expected no-input condition. No application build was claimed.
- PRD SHA-256 remained `C3281BED9A697503097909F10CB3797C435FEA86F5DE59D59CCB6955C94E0FDB` throughout edits.

## Known Issues
- No known defects in the binary primitives or synchronization core. UDP transport, simulator, full metrics, WebSocket/UI, network integration tests, and demo commands remain future work by design.
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
- Implemented the previously chosen 64 KiB defensive buffer cap. BitBuffer rejects over-cap append with BufferLimitError; Synchronizer catches it, abandons old retained bits/candidate, preserves absolute input position/counters, reports buffer_limit plus bufferResets, retries the current bounded batch, and hunts again. Fault path explicitly tested through public-method fault injection; normal noise/large pushes do not reset.
- BitBuffer keeps endBytes and headBit over owned storage; discard only advances the head (full consumption resets logical indices). Compact when >=1024 whole bytes are consumed or >=half the used bytes; also compact before growth. Remove only whole consumed bytes, preserve headBit modulo 8, and reuse allocation. Geometric allocation starts at 256 bytes, never exceeds 64 KiB, and may retain peak capacity for reuse.
- Synchronizer batches large pushes into 4096-byte pieces, processing each before further append. HUNT scans with a local bit offset, then bulk-discards scanned noise; matched candidate is normalized to buffer head and held there through LOCK/VERIFY. Separate logical headBitOffset survives physical compaction; candidate alignment = logical ASM start modulo 8.
- VERIFY uses shared decodeFrame once and requires both CRC and format validity before EXTRACT, as specified in the Round 3 request. CRC failure takes precedence if both flags are false; formatFailures counts only CRC-valid bad-length candidates. Failure discards exactly one bit at candidate head; success emits then discards exactly 2080 bits.
- resyncCount increments on the first ASM found after each failed candidate, even if that new candidate fails; the pending reacquisition flag clears at acquisition. Noise without failed validation does not count. Counts are tested; full receiver rate/sequence metrics remain later work.
- Optional transition observer is synchronous and observational (do not reenter push); no event history retained. Tests collect their own histories. Public stats return a copy and expose storage allocation for bounded-memory checks.
- Round 2 frame API accepts raw payload Buffers; callers use `encodeTelemetry` for the default demo. Deriving length from the Buffer avoids inconsistent encoder header/payload input. No ASM wrapper implemented yet.
- Temperatures use `Math.round(Celsius * 100)` and validate the quantized signed int16 result; other fields must be integral and within their unsigned ranges. No automatic sequence wrap in encoder; generator owns wraparound later.
- CRC and format flags remain independent, including CRC-valid but format-invalid candidates. Bad CRC/format does not throw on a correctly sized body; decoded telemetry is suppressed. Caller must check both flags before accepting any frame.
- Decoded payload is an owned copy containing meaningful bytes only. Short valid payloads omit telemetry; malformed declared lengths produce no payload. These choices are documented/tested and leave future FSM control flow explicit.

## Files Added / Changed
- Round 1 foundation retained: package/lock/config, Node pin, ignore rules, and remaining placeholders.
- Round 2 added `src/shared/constants.ts`, `types.ts`, `crc16.ts`, `frame.ts`, `test/crc16.test.ts`, and `test/frame.test.ts`; removed obsolete `.gitkeep` in populated shared/test directories.
- Round 3 added `src/receiver/bitBuffer.ts`, `synchronizer.ts`, `test/bitBuffer.test.ts`, `synchronizer.test.ts`, and `bitHelpers.ts`; removed receiver `.gitkeep`; updated `README.md` and `context.md`.
- `prd.md`, Round 2 code/tests, package scripts/dependencies/lock, and TypeScript configuration unchanged in Round 3. Installed `node_modules/` remains ignored.

## Next Phase
Round 4: UDP transmitter + UDP receiver + arbitrary logical-stream packetization + clean end-to-end fragmentation testing. Generate sequence/telemetry frames through shared primitives, prepend ASM outside the body, accumulate the outgoing logical stream, deterministically chunk into 1..96-byte payloads (seed 42 default), and send over localhost udp4. Feed every received message payload into the same persistent Synchronizer, process returned valid frames, and prove reconstruction over actual UDP including split markers/bodies and 100 clean frames with zero CRC failures. Add entry points/run scripts only with real implementations. No production impairment modes, WebSocket, or UI yet; update context after actual tests.

## Do Not Forget
- PRD wins over code/docs; no specification edits to accommodate implementation.
- One UDP message is not one frame. Simulator fragmentation and bit slips happen in the logical stream, not because UDP exposes partial datagrams/RF bits.
- Failed candidate recovery starts one bit after its ASM; search remaining buffered bits, including possible true markers inside false candidates.
- Keep incomplete candidates across messages; keep 31 trailing HUNT bits; process all available complete frames per callback; compact storage and bound memory.
- Protect mandatory tests A..J: CRC vector, frame round trip, split ASM, 100 fragmented clean frames with zero failures, offsets 1..7 (plus aligned baseline), corrupted frame rejection/recovery, false marker recovery, bit-slip reacquisition, bounded long noise, final UDP/WebSocket/UI demo.
- No databases, auth, HTTP frameworks/REST APIs, cloud/containers, brokers, heavy frontend frameworks, ML, hardware/RF processing, channel coding, full CCSDS stack, or unnecessary abstractions.
- Custom educational frame is not a fully compliant CCSDS TM frame; CRC does not repair data; WebSocket is only the dashboard bridge.

# Simulated Telemetry Ground Station

A software-only Computer Networks course project demonstrating application framing,
bit-level synchronization, CRC rejection, and automatic recovery above UDP.
The receiver is the technical focus; the eventual browser dashboard is an observer.

`prd.md` is the authoritative specification. `context.md` records development progress
and the seven-round roadmap. The custom 256-byte frame is CCSDS-inspired, not a
fully standards-compliant CCSDS TM Transfer Frame.

Round 4 includes binary primitives, the persistent bit-level synchronization/recovery
FSM, deterministic mock telemetry and packetization, and a clean localhost UDP link.
Deliberate impairment modes, WebSocket, and UI remain future work.

Use Node.js **22.19.0** and npm **10.9.3**. Install the locked dependencies with:

```text
npm ci
```

The stack is TypeScript, Node Buffer, `node:dgram`, a project-owned CRC implementation,
`ws`, Vite with vanilla HTML/CSS/TypeScript, and `node:test` / `node:assert`.
There is one package, with `ws` as its only external runtime dependency.

`src/shared/` holds protocol primitives and configuration; `src/transmitter/` holds
frame generation, packetization, and UDP sending; `src/receiver/` holds UDP input,
BitBuffer, and the FSM. Full metrics and the WebSocket bridge remain later work.
`test/` holds automated tests; `ui/` is a placeholder.

Run the implemented checks with:

```text
npm test
npm run typecheck
```

The tests use Node's native test runner via `tsx`, including localhost UDP tests on
ephemeral ports. Run the clean demo in two terminals, receiver first:

```text
npm run receiver
npm run transmitter
```

Stop the transmitter first with Ctrl+C, then the receiver. Valid frames appear in the
receiver console. The transmitter deliberately packetizes one logical stream into
arbitrary UDP datagrams; UDP delivers each datagram intact to the application.

Environment configuration (PowerShell: `$env:FRAME_RATE = '10'`, then run the command):

| Variable | Default |
|---|---|
| UDP_HOST | 127.0.0.1 |
| UDP_PORT | 5000 |
| FRAME_RATE | 5 |
| CHUNK_MIN_BYTES | 1 |
| CHUNK_MAX_BYTES | 96 |
| SIM_SEED | 42 |

Packetization uses project-owned Mulberry32 with a uint32 seed. The streaming
Packetizer retains its unfinished datagram and PRNG state across generated frames,
so datagrams may mix one frame's tail with the next ASM/body. Final `flush()` sends
the remaining bytes without padding, potentially shorter than the configured minimum.
Holding that tail can delay completion of the latest frame until the next generation
tick; a normal transmitter shutdown flushes it. The sender yields between datagrams
for local receive I/O, with no acknowledgements, reordering, or retransmission.

Mock values depend only on sequence: temperature `(2400 + sequence % 100) / 100`,
battery `7420 - sequence % 20`, altitude `520000 + sequence % 1000`, uptime `sequence`.
Uptime is a simulated counter, not measured wall-clock runtime. Generated sequences
start at zero and wrap as uint32. The receiver counts datagrams and bytes, passes every
payload unchanged to its persistent Synchronizer, and logs accepted frames.

`encodeTelemetry(values)` produces the 12-byte big-endian demo payload.
`encodeFrame({ sequence, payload, flags? })` accepts a Buffer of 0..246 meaningful
bytes, derives its declared length, defaults flags to zero, pads unused bytes with
zero, and appends CRC. It returns only the frame body, without ASM.

`validateFrame(body)` reports stored/calculated CRC and separate CRC/format validity.
`decodeFrame(body)` also returns header fields and an owned copy of meaningful
payload bytes. Both require exactly 256 bytes. An oversized declared payload length
is flagged as invalid and returns no payload bytes. Decoded telemetry is present only
when CRC and format are valid and at least 12 meaningful bytes exist. Short payloads
remain structurally valid; padding is never decoded as telemetry. The standalone
`decodeTelemetry(payload)` requires at least 12 bytes and reads the first 12.

Encoder numeric inputs are range-checked; temperature is rounded with `Math.round`
to signed int16 centi-degrees. Other wire fields require integers. Nonzero uint16
flags are supported by the primitive; the MVP demo will use zero.

`new Synchronizer().push(chunk)` accepts arbitrary byte chunks and returns zero or
more `{ frame, bitAlignment, asmBitOffset }` results. State persists across calls.
It searches at every bit offset, waits in LOCK for 2080 bits, validates with the shared
frame decoder in VERIFY, then emits and consumes a valid unit in EXTRACT. Failed CRC
or format validation resumes HUNT exactly one bit after the failed ASM start.
An immediately following buffered ASM takes EXTRACT directly to LOCK.

`state` and `stats` expose snapshots of synchronization state, counters, alignment,
and buffer usage. An optional synchronous transition observer passed to the constructor
can inspect short-lived VERIFY/EXTRACT states and failure reasons; it should only
observe transitions, without calling `push` recursively. No transition history is stored.
`resyncCount` counts the first ASM found after each failed candidate, even if that next
candidate also fails. Noise alone does not increment it. CRC failures take precedence
over format failures when both validation flags are false.

BitBuffer interprets bits MSB-first over owned backing storage and a logical head.
Nonaligned extraction joins adjacent bytes into an owned byte-aligned result; extraction
length must be divisible by eight. Invalid bit ranges throw RangeError. Discards advance
the head without copying; compaction removes consumed whole bytes while preserving the
partial byte. HUNT retains at most 31 bits. Storage grows geometrically up to 64 KiB;
the synchronizer processes large chunks in 4 KiB pieces. A defensive capacity fault
discards retained candidate state, records `bufferResets`/a `buffer_limit` transition,
and resumes hunting in the current piece while preserving the stream position.

Telemetry frames must be reconstructed independently of UDP message boundaries.
The simulator chooses fragmentation; UDP itself delivers datagrams. CRC detects
errors rather than repairing them. UDP, CRC, FSMs, the ASM, and WebSockets are standard
building blocks; the receiver-side combination is the project's technical focus.

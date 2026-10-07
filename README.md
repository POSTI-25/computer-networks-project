# Simulated Telemetry Ground Station

A software-only Computer Networks course project demonstrating application framing,
bit-level synchronization, CRC rejection, and automatic recovery above UDP.
The receiver is the technical focus; the eventual browser dashboard is an observer.

`prd.md` is the authoritative specification. `context.md` records development progress
and the seven-round roadmap. The custom 256-byte frame is CCSDS-inspired, not a
fully standards-compliant CCSDS TM Transfer Frame.

Round 3 includes the binary protocol primitives and a transport-independent persistent
BitBuffer plus bit-level synchronization/recovery FSM. UDP transport, the impairment
simulator, WebSocket, and UI remain future work.

Use Node.js **22.19.0** and npm **10.9.3**. Install the locked dependencies with:

```text
npm ci
```

The stack is TypeScript, Node Buffer, `node:dgram`, a project-owned CRC implementation,
`ws`, Vite with vanilla HTML/CSS/TypeScript, and `node:test` / `node:assert`.
There is one package, with `ws` as its only external runtime dependency.

`src/shared/` holds protocol primitives; `src/transmitter/` will hold the simulator and UDP
sender; `src/receiver/` holds BitBuffer and the FSM, with UDP input, metrics, and the
WebSocket bridge still to come; `test/` holds automated tests; `ui/` is a placeholder.

Run the implemented checks with:

```text
npm test
npm run typecheck
```

The tests use Node's native test runner via `tsx`. Receiver, transmitter, and UI run
scripts will be added alongside their implementations.

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

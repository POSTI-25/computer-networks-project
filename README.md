# Simulated Telemetry Ground Station

A software-only Computer Networks course project demonstrating application framing,
bit-level synchronization, CRC rejection, and automatic recovery above UDP.
The receiver is the technical focus; the eventual browser dashboard is an observer.

`prd.md` is the authoritative specification. `context.md` records development progress
and the seven-round roadmap. The custom 256-byte frame is CCSDS-inspired, not a
fully standards-compliant CCSDS TM Transfer Frame.

Round 2 implements protocol constants/types, CRC-16, telemetry payload encoding and
decoding, and the exact 256-byte frame encoder/decoder with validation and unit tests.
Receiver synchronization, UDP transport, simulator, WebSocket, and UI remain future work.

Use Node.js **22.19.0** and npm **10.9.3**. Install the locked dependencies with:

```text
npm ci
```

The stack is TypeScript, Node Buffer, `node:dgram`, a project-owned CRC implementation,
`ws`, Vite with vanilla HTML/CSS/TypeScript, and `node:test` / `node:assert`.
There is one package, with `ws` as its only external runtime dependency.

`src/shared/` holds protocol primitives; `src/transmitter/` will hold the simulator and UDP
sender; `src/receiver/` the persistent BitBuffer, FSM, UDP input, metrics, and WebSocket
bridge; `test/` the automated tests; and `ui/` the future Vite dashboard.

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

Telemetry frames must be reconstructed independently of UDP message boundaries.
The simulator chooses fragmentation; UDP itself delivers datagrams. CRC detects
errors rather than repairing them. UDP, CRC, FSMs, the ASM, and WebSockets are standard
building blocks; the receiver-side combination is the project's technical focus.

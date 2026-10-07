# Simulated Telemetry Ground Station

A software-only Computer Networks course project demonstrating application framing,
bit-level synchronization, CRC rejection, and automatic recovery above UDP.
The receiver is the technical focus; the eventual browser dashboard is an observer.

`prd.md` is the authoritative specification. `context.md` records development progress
and the seven-round roadmap. The custom 256-byte frame is CCSDS-inspired, not a
fully standards-compliant CCSDS TM Transfer Frame.

Round 1 contains configuration and directory placeholders only. Protocol primitives,
receiver, transmitter, tests, and UI are scheduled for subsequent rounds.

Use Node.js **22.19.0** and npm **10.9.3**. Install the locked dependencies with:

```text
npm ci
```

The stack is TypeScript, Node Buffer, `node:dgram`, a project-owned CRC implementation,
`ws`, Vite with vanilla HTML/CSS/TypeScript, and `node:test` / `node:assert`.
There is one package, with `ws` as its only external runtime dependency.

`src/shared/` will hold protocol primitives; `src/transmitter/` the simulator and UDP
sender; `src/receiver/` the persistent BitBuffer, FSM, UDP input, metrics, and WebSocket
bridge; `test/` the automated tests; and `ui/` the future Vite dashboard.

The configured `npm run typecheck` and `npm test` commands become usable in Round 2,
when TypeScript source and test files exist. At Round 1, typechecking reports no
inputs and no protocol tests exist. Receiver, transmitter, and UI run scripts will be
added alongside their implementations, rather than pointing at missing entry files.

Telemetry frames must be reconstructed independently of UDP message boundaries.
The simulator chooses fragmentation; UDP itself delivers datagrams. CRC detects
errors rather than repairing them. UDP, CRC, FSMs, the ASM, and WebSockets are standard
building blocks; the receiver-side combination is the project's technical focus.

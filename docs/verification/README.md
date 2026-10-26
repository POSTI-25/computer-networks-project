# Verification record

The existing source was verified on **25 October 2026 at 22:30 IST** using
**Node.js v22.19.0** and **npm 10.9.3**. The source revision tested was
`a446017bf45931a7b4c80b740c204d712097ef18`. Documentation and evidence additions
made after this run do not change the tested implementation.

| Command | Result | Saved output |
|---|---|---|
| `npm test` | 185 passed; 0 failed; 0 skipped | [Automated tests](automated-tests.txt) |
| `npm run typecheck` | Passed; exit code 0 | [Typecheck](typecheck.txt) |
| `npm run build` | Passed; exit code 0 | [Build](build.txt) |

[Machine-readable run details](verification.json) record the revision, runtime,
timestamp and command exit codes. Logs are a dated observation, not a guarantee
that every future environment or modification will produce the same outcome.

## Reproduce the checks

From the repository root, install the version in `.nvmrc`, then run:

```text
npm ci
npm test
npm run typecheck
npm run build
```

The automated suite covers CRC calculation and rejection, frame construction,
bit buffering, ASM alignment at positions 0 through 7, partial input, noise,
fault recovery, sequence metrics, bounded observations, guided recordings,
UDP reception and WebSocket publication. Tests use ephemeral localhost ports
and close their sockets when complete.

`test/integration.test.ts` includes real UDP delivery of 100 clean frames in
seeded 1–96-byte datagrams. `test/faultRecovery.test.ts` covers insertion and
deletion with small datagrams. `test/websocket.test.ts` verifies valid-only
telemetry publication after clean, flip, insertion and deletion input.

One test deliberately occupies a WebSocket port to verify startup failure and
socket cleanup. Its expected `EADDRINUSE` diagnostic appears near the end of the
log; that test passed.

## Demonstration evidence

Use the [demo guide](../demo-guide.md) to run the dashboard and the
[screenshot gallery](../screenshots/README.md) to inspect saved interface views.
Those screenshots were captured on 20–21 October 2026 and are separate from the
automated run recorded above. Guided replay timing is illustrative; it is not a
network throughput measurement.

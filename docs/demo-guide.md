# Ground Station: classroom presentation

## Start the visual lab

From the project directory, start these commands in separate terminals:

```powershell
npm run receiver
```

```powershell
npm run ui
```

Open http://127.0.0.1:5173. If upgrading from the old dashboard, restart the receiver
as well as refreshing the browser: the new trace and lesson messages require the
updated backend. The visual lab needs no additional dependencies.

Select **Guided lab**. It works without a transmitter. **Present** hides the large
introduction and requests fullscreen. If fullscreen is denied, the compact layout
still works. Use browser zoom if needed for the projector.

## Opening explanation (30 seconds)

“Our project simulates a spacecraft telemetry link. Sensor readings become frames,
then a continuous bitstream. Our packetizer splits that stream across messages.
The receiver must find frame boundaries, detect damaged data, and recover when bit
alignment changes. This view shows the actual receiver algorithm doing those jobs.”

Click the pipeline stages from left to right. Explain that bit faults are injected
before UDP packetization. UDP delivers each application datagram intact; it does
not split a received datagram into separate application messages.

## Experiment 1: reconstruct a clean frame (one minute)

Choose **Clean transmission**. Press **Next state** to acquire a marker (LOCK).
Press **Step** to add chunks and watch the persistent buffer fill. Press **Next
state** to reach VERIFY and again to reach EXTRACT.

- Chunk sizes and bits are real outputs of the packetizer in the recording.
- The marker is 32 bits. The body is 256 bytes. A complete unit needs 2,080 bits.
- A frame can span several chunks. The receiver retains the unfinished candidate.
- Matching CRC values and a valid payload length allow extraction.
- Only accepted frames update the telemetry panel.

Click the frame fields to explain the sequence, payload length, flags, padding, and
CRC coverage. The blocks are enlarged for readability and are not to scale.

## Experiment 2: reject corruption (one minute)

Choose **Flip one bit**. Use **Next state** to progress to the rejection at sequence
2. Compare the two CRC values and the red candidate in the validation strip.

“The simulator changed a bit after CRC generation. The receiver calculates a
different value, rejects the frame, advances one bit from its marker, and searches
again. CRC detects the damage; it does not repair it.”

Continue until sequence 3 is accepted. The final recording shows five accepted
frames, one CRC failure, one missing sequence, and one reacquisition.

## Experiment 3: recover a shifted stream (one minute)

Choose **Insert one bit**. Progress past sequence 2's rejection to the next LOCK.
The marker's alignment is now 1. Pause at this point and use the search-window
slider over the captured bits. Vertical dividers indicate original byte boundaries.
Only a window containing exactly `0x1ACFFC1D` matches.

“One inserted bit shifts every subsequent frame boundary. Searching only at byte
boundaries would miss the marker. Our receiver searches each bit position and
recovers valid telemetry without restarting.”

Continue to sequence 3's successful extraction. The recovery callout and accepted
telemetry confirm recovery. **Delete one bit** instead produces alignment 7.
**Start between bytes** prefixes three bits and starts at alignment 3 without a
CRC failure. Every experiment is isolated; switching or restarting it does not
reset the live receiver.

## Show the real network path

Switch to **Live receiver**. In a third terminal run:

```powershell
npm run transmitter -- --mode bit-insert --target-frame 50
```

Start with a fresh receiver for clean counters: stop the old transmitter, stop the
receiver, restart the receiver, then start the above command. At the default rate
the fault occurs roughly ten seconds into transmission. Do not restart during
the fault; recovery must happen within the same receiver run.

Live mode shows actual localhost UDP arrivals and receiver traces. **Freeze live
visuals** freezes only the browser view. Backend reception continues. Brief FSM
states can pass between display updates; Guided lab makes each transition visible.

## What the professor is seeing

| View | Source of evidence |
|---|---|
| Live receiver | Actual UDP datagrams received on localhost and real receiver transitions |
| Guided lab | Deterministic six-frame recording from the same engine, with chunks processed in memory |
| Pipeline and frame layout | Explanatory diagrams of the implementation; not remote spacecraft observations |
| ASM microscope | Actual buffered bits captured around an acquired marker; slider compares a 32-bit window |
| CRC comparison | Stored and calculated CRC values from real candidate validation |
| Telemetry | Generated readings decoded only from accepted frames |

Replay animation timing is illustrative. At chunk completion the counters and
buffer update to that chunk's resulting snapshot; transitions are expanded into
separate teaching steps. Simulated uptime equals the generated sequence number,
not wall-clock runtime. Live acceptance rates are sampled and can fluctuate.

The frame uses the real CCSDS marker with a custom educational body. It is not a
complete CCSDS TM Transfer Frame. There is no RF hardware, retransmission, FEC, or
automatic repair of damaged frames.

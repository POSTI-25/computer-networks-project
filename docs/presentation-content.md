# Simulated Telemetry Ground Station — PPT Content Brief

## Instructions for the PPT-making agent

Create **exactly 12 slides** using the numbered sections below. This file is a content and visual brief, not a finished deck.

- Audience: a Computer Networks professor and students seeing this project for the first time.
- Language: simple, conversational English. Explain each technical term when it first appears. Preserve the technical corrections in this brief.
- Put only **On-slide content** on the slides. Put **What I will say** in speaker notes. Use **Visual / diagram instructions** to build the visuals; do not paste those instructions onto slides.
- Use a readable 16:9 layout with large text. Follow the dashboard's light background, dark text, and teal accents. Use green for accepted data, red for rejected data, and amber for waiting or fault injection. Include text labels as well as colors.
- Draw diagrams using editable shapes and arrows. Use monospaced text for bits, hexadecimal values, and commands. Avoid decorative spacecraft images that crowd out the receiver explanation.
- Recreate simplified dashboard panels from the descriptions. Do not invent screenshots, measurements, or an animation that the application does not actually show.
- Frame diagrams and bit strings are explained individually below. Where a diagram is schematic, label it as such.
- The live dashboard and Guided lab are different modes. Do not present an in-memory guided recording as a real UDP transmission.
- Presenter name, registration number, team members, and faculty name were not provided. Leave those details out rather than inventing them.
- Aim for an 8–10 minute explanation followed by a short live demonstration.

### Accuracy rules for the entire deck

1. Readings are encoded into bytes; they are **not converted into CRC**. CRC is an additional check value.
2. **Our packetizer splits the telemetry stream** into chunks. UDP delivers each received datagram intact. Do not say UDP automatically fragments our telemetry frames.
3. Do not claim TCP automatically gives the application complete telemetry frames. TCP provides a byte stream; applications still need framing rules. HTTP is an application protocol, not an alternative transport at the same layer as UDP.
4. The custom body is **256 bytes including CRC**. The external ASM adds 4 bytes. A complete transmission unit is **260 bytes / 2,080 bits**.
5. Alignment 0–7 tells where the marker starts within a byte. It does not identify a damaged bit or a frame sequence number.
6. CRC detects corruption; it does not repair data. Matching CRC means no corruption was detected, not an absolute guarantee of perfect data.
7. Recovery means rejecting damaged candidates and finding later valid frames without restarting. It does not reconstruct the lost readings.
8. This is a software simulation using a CCSDS-inspired synchronization approach and a custom educational body. It is not an RF link or a complete CCSDS TM Transfer Frame implementation.

---

## Slide 1 — Simulated Telemetry Ground Station

### On-slide content

**Finding, checking, and recovering telemetry frames**

Computer Networks course project

- A mock spacecraft sends sensor readings.
- The receiver collects incoming pieces and finds complete frames.
- A visual ground station shows validation and recovery.

**Main question:** How do we keep decoding when data arrives in pieces or gets damaged?

### Visual / diagram instructions

Draw three connected objects:

```text
Mock spacecraft           Local simulated link           Ground station
Sensor readings    →     Pieces of a bitstream     →      Validated readings
```

Use a small spacecraft symbol and a laptop/ground-station symbol. Label the connection **Software simulation on one computer**. Avoid implying an actual satellite or radio transmission.

### What I will say

“Sir, the basic idea is to simulate space telemetry. Telemetry means sending measurements from a remote system to a receiving station. Here, our spacecraft is a program generating mock readings. We focus on how the receiver finds frames, checks them, and continues after damage.”

---

## Slide 2 — Why finding a frame is a problem

### On-slide content

**One incoming message does not necessarily contain one complete telemetry frame**

- A frame can span several messages.
- One message can contain the end of one frame and the start of another.
- Corruption can damage data; insertion or deletion can shift later boundaries.

**Our objective:** Identify, validate, and recover frames from a fragmented or corrupted logical stream.

**Our packetizer creates the chunks; UDP carries each chunk as one datagram.**

### Visual / diagram instructions

Use two horizontal rows with visibly different boundaries:

```text
Logical frames:    [       Frame A       ][       Frame B       ]
UDP datagrams:    [part 1][    part 2    ][part 3][part 4][part 5]
```

Place one datagram across the A/B frame boundary. Connect the rows with dashed lines to show that frame boundaries and datagram boundaries need not coincide. Caption: **Illustration; sizes are not to scale**.

### What I will say

“We cannot assume that each incoming message is a complete frame. We deliberately divide the logical stream into chunks before sending it through UDP. The receiver gets those chunks intact, but it must discover the telemetry boundaries itself. This is application-level framing. Using TCP would not remove the need to define those boundaries either.”

---

## Slide 3 — The project has three main components

### On-slide content

| Component | Its job |
|---|---|
| **Mock spacecraft transmitter** | Generate readings → build frames → inject a selected fault → split and send the stream. |
| **Ground-station receiver** | Receive datagrams → preserve bits → find ASM → validate and extract frames. |
| **Ground-station UI** | Display incoming pieces, receiver states, CRC results, alignment, and decoded readings. |

**Live data path: Transmitter → UDP → Receiver → WebSocket → Browser**

Small footer: **Node.js + TypeScript · UDP sockets · WebSocket · Vite browser UI**

### Visual / diagram instructions

Draw three large blocks, one per component. Inside the transmitter, include these smaller steps in order:

```text
Mock readings → Frame + CRC + ASM → Bit impairment → Packetizer
```

Inside the receiver:

```text
Persistent buffer → Synchronizer → CRC / format check → Accepted readings
```

Label the transmitter-to-receiver arrow **UDP: simulated downlink**. Label the receiver-to-browser arrow **WebSocket: observations**. Do not draw the browser as receiving UDP directly.

### What I will say

“There are three main parts. The transmitter creates the mock data and sends it. The receiver does the actual synchronization and validation work. The UI helps us see that work. UDP carries the telemetry chunks; WebSocket carries the receiver's observations to the browser.”

---

## Slide 4 — What we put into a frame

### On-slide content

**A complete transmission unit is 260 bytes = 2,080 bits**

| ASM | Sequence | Length | Flags | Payload + padding | CRC-16 |
|---|---|---|---|---|---|
| 4 bytes | 4 bytes | 2 bytes | 2 bytes | 246 bytes | 2 bytes |

- **ASM:** the “start here” pattern.
- **Header:** sequence, meaningful payload length, and flags.
- **Payload:** mock temperature, battery voltage, altitude, and uptime.
- **CRC:** an additional value for detecting corruption.

**256-byte body + 4-byte ASM = 260 bytes**

### Visual / diagram instructions

Draw the six labeled blocks from the table. Put a bracket under Sequence through CRC labeled **Custom frame body: 256 bytes**. Put a second bracket under all six blocks labeled **Transmission unit: 260 bytes**.

Group Sequence, Length, and Flags with a smaller **Header: 8 bytes** label. Under the payload, show **12 meaningful telemetry bytes + 234 zero-padding bytes in the default frame**. Label widths **Not to scale** so short fields remain readable.

### What I will say

“This is similar to a packet-format diagram, but it shows the entire unit. The readings become payload bytes. We add a sequence number, length, flags, and CRC to make a 256-byte body. Then we prepend a four-byte start marker. CRC is not a replacement for the readings; it is a check value included alongside them.”

---

## Slide 5 — Small boxes are arriving pieces; the buffer collects them

### On-slide content

**The small boxes are datagrams, not necessarily complete frames**

- Each box shows an arriving chunk's size and arrival number.
- The persistent buffer keeps unfinished data between arrivals.
- New bits are appended; processed bits are consumed or discarded.
- A complete candidate needs **2,080 bits**, starting from its ASM.

**Example: 1,752 retained bits + 384 new bits = 2,136 available bits**

### Visual / diagram instructions

Recreate the “Transport & Buffering” panel as a simple teaching diagram:

```text
[33 B] [48 B] [57 B] [48 B]  →  Persistent bit buffer
                                      ↓
                       Keep unfinished data for the next arrival
```

Below it, draw a buffer split into **2,080 candidate bits** plus **56 extra bits**. Label this as a **hypothetical clean candidate**. If that candidate passes and is consumed, 56 bits remain for subsequent processing. Do not claim this is the exact outcome of a screenshot involving a corrupted frame.

Include eight little binary groups labeled **Preview: first 8 bytes of the latest chunk**. Note **A preview, not the whole frame**.

### What I will say

“Think of separate envelopes bringing pieces of a letter. These boxes are the envelopes; the buffer is the table where we keep their contents. We do not throw away a partial frame when a message ends. In this example, the new arrival gives us enough bits to check a complete candidate. Persistent means retained between arrivals while the receiver runs, not permanently saved to disk.”

---

## Slide 6 — ASM tells us where a frame might start

### On-slide content

**ASM = Attached Sync Marker**

```text
Hex:     0x1ACFFC1D
Binary:  00011010 11001111 11111100 00011101
```

- A fixed 32-bit “START HERE” pattern before each body.
- The receiver searches for it **one bit at a time**.
- The marker may cross datagrams or byte boundaries.
- Finding ASM identifies a candidate; CRC and format still need checking.

### Visual / diagram instructions

Draw a stream with a highlighted 32-bit window over the exact binary marker above. Add a second schematic position shifted by one bit to illustrate the sliding comparison. Use vertical lines at byte boundaries.

Show this conceptual loop below:

```text
Compare 32 bits with ASM → No match? Move one bit → Compare again
                       → Match? Start collecting the candidate
```

Label the microscope control **32-bit marker-search window, not the entire frame**. If using animation, move a rectangle over a fixed stream rather than changing the bits themselves.

### What I will say

“ASM is a start sign in the incoming bits. The receiver checks 32 consecutive bits against this known pattern. If they do not match, it moves by one bit and tries again. A match tells us where a possible frame starts, but it does not prove that the following data is valid.”

---

## Slide 7 — The receiver follows four simple states

### On-slide content

| State | What the receiver is doing |
|---|---|
| **HUNT** | Search bit by bit for the ASM. |
| **LOCK** | ASM found. Wait for all 2,080 candidate bits. |
| **VERIFY** | Extract the 256-byte body; check CRC and payload length. |
| **EXTRACT** | Accept the valid frame, decode telemetry, and consume the unit. |

**FSM = Finite-State Machine: a set of states with clear transition rules**

### Visual / diagram instructions

Make a flowchart, not just four disconnected boxes:

```text
HUNT ── ASM found ──→ LOCK ── enough bits ──→ VERIFY
 ↑                      ↺ wait                  │
 │                                      CRC + format valid?
 │                                         /          \
 │                                       no            yes
 │                                        │             │
 └── resume search one bit after ASM ───────┘          EXTRACT
                                                       │
                         Next ASM already at head? ────┘
                              yes → LOCK
                              no  → HUNT
```

Keep conditions outside the state boxes. Green acceptance arrow, red rejection arrow. Make the return from EXTRACT clear: HUNT after an extraction is normal when no complete next marker is immediately available.

### What I will say

“The four states are simple: find, wait, check, and accept. HUNT finds the marker. LOCK waits for the rest. VERIFY checks the candidate. EXTRACT accepts the readings. If checks fail, we return to searching. If extraction finishes and the next marker is already buffered, we can go directly back to LOCK.”

---

## Slide 8 — Alignment tells where the marker starts

### On-slide content

**Alignment is a bit position inside a byte—not a frame number or an error location**

```text
Bit position:   0 1 2 3 4 5 6 7
One byte:      [· · · · · · · ·]
```

- **0:** marker begins at the first bit of a byte.
- **1:** marker begins at the second bit.
- **7:** marker begins at the eighth, last bit.

**Stream position 4,160 → alignment 0**
**Stream position 8,319 → alignment 7**

### Visual / diagram instructions

Recreate the UI's row of eight numbered cells. Put **Marker starts here** above the highlighted cell, not “frame 0” or “corrupted bit.” Show two examples side by side:

- Example A: highlight 0; label **ASM starts on a byte boundary**.
- Example B: highlight 7; show a 32-bit marker continuing across subsequent bytes.

Small equation: **Alignment = absolute marker start position modulo 8**.

### What I will say

“The 0–7 row confused me initially, so this distinction matters. A highlighted zero does not mean frame zero. It means the marker starts at the first bit of a byte. For example, the candidate at stream bit 4160 has alignment zero because 4160 is divisible by eight. Alignment also does not tell us which bit was corrupted.”

---

## Slide 9 — CRC checks the candidate; accepted bytes become readings

### On-slide content

**CRC = Cyclic Redundancy Check**

```text
Transmitter: calculate CRC → include it in the frame
Receiver:   calculate CRC again → compare the two values
```

**Example: stored 0x6AA9 = calculated 0x6AA9**

- CRC and format pass → accept and decode.
- CRC differs → reject the candidate.
- Rejected frames do not update telemetry.

**Decoded payload:** temperature · battery voltage · altitude · simulated uptime

### Visual / diagram instructions

Use two dashboard-like panels:

1. Left: **Stored CRC** and **Calculated CRC**, with a green equals sign. Caption **Example frame 656: CRC and format pass**.
2. Right: readable readings from that frame: **24.56 °C**, **7,404 mV**, **520,656 m**, **656 s simulated uptime**.

Put a validation gate between the raw candidate and telemetry. A red branch leads to **Rejected → resume search**, not to the telemetry panel.

Small footer: **CRC covers body bytes 0–253. The ASM and stored CRC are excluded.**

### What I will say

“The receiver does the same CRC calculation on the received body and compares the result with the transmitted value. If CRC and format pass, it decodes the bytes into readable measurements. The space-telemetry connection is these measurements about the spacecraft's condition. Here they are mock values. Our simulated uptime is generated from the sequence number, not actual elapsed program time. CRC detects damage; it does not fix it or locate the exact bad bit.”

---

## Slide 10 — A damaged frame does not stop the receiver

### On-slide content

**The key recovery behavior**

1. A candidate fails CRC or format validation.
2. The receiver rejects it and keeps running.
3. Search resumes **one bit after the failed candidate's ASM start**.
4. A later marker is found; its frame is checked normally.
5. Valid telemetry continues without restarting the receiver.

**Recovery skips damaged data—it does not repair the lost readings**

### Visual / diagram instructions

Draw a stream with three labeled units: **Frame 1: accepted**, **Frame 2: damaged candidate**, **Frame 3: accepted after recovery**. Use distinct accepted/rejected text labels.

Under the rejected marker, draw a magnified inset:

```text
Failed candidate ASM begins at bit k
                       ↓
Resume HUNT at bit k + 1 → scan remaining buffered bits → find next ASM
```

Do not draw an unconditional jump of 2,080 bits after a failure. The next genuine marker could be inside the rejected candidate's buffered region. Do not imply any ASM automatically passes CRC.

### What I will say

“This is the main recovery feature. If CRC fails, we do not terminate the receiver. We also do not assume where the next frame begins. We resume the bit-level search one bit after the failed candidate's marker. We then find another marker and validate its frame. Once a valid frame is found, decoding continues. The damaged readings are skipped, not repaired.”

---

## Slide 11 — Flip, insert, and delete produce different effects

### On-slide content

| Guided experiment | What changes | Later valid alignment |
|---|---|---|
| **Clean** | No fault; chunks still divide the stream. | 0 |
| **Start between bytes** | Prefix three bits before the stream. | 3 |
| **Flip one bit** | Change a bit's value; bit count stays the same. | 0 → 0 |
| **Insert one bit** | Add a bit; later boundaries move one bit later. | 0 → 1 |
| **Delete one bit** | Remove a bit; later boundaries move one bit earlier. | 0 → 7 |

**In each flip/insert/delete recording:** frame 2 rejected → frame 3 accepted → reception continues.

### Visual / diagram instructions

Make the comparison table the main visual. Add three compact schematic bit edits in a strip below it, highlighting the edited position:

```text
Original:  1 0 1 1 0 0
Flip:      1 0 0 1 0 0   ← change the third bit
Insert:    1 0 [1] 1 1 0 0 ← insert before the third bit
Delete:    1 0 [ ] 1 0 0 ← remove the third bit
```

These are **illustrative edits, not a screenshot of the actual target bytes**. The project's guided faults target a bit inside frame 2's body, after CRC generation. Do not claim the current UI highlights the actual edited bit; it visualizes resulting validation and alignment.

Put a small outcome note: **Clean/offset: 6 accepted, 0 CRC failures. Flip/insert/delete: 5 accepted, 1 CRC failure, 1 sequence gap, 1 reacquisition.** These are the deterministic six-frame guided recordings, not arbitrary live-run totals.

### What I will say

“All three faults damage frame 2, but their effects on later frames differ. A flip changes a value without moving boundaries. An insertion pushes later starts one bit forward. A deletion pulls them one bit backward, which appears as alignment seven. The receiver observes markers, checks, and positions; it is not told which fault happened. The selected experiment tells us the injected cause.”

---

## Slide 12 — Demonstrate the workflow and show recovery

### On-slide content

**Guided lab: repeatable walkthrough with the same receiver engine**

1. **Clean:** watch chunks accumulate → frame accepted.
2. **Flip one bit:** show CRC mismatch → frame 2 rejected.
3. **Insert one bit:** show later alignment 1 → valid telemetry resumes.

**Controls:** Restart · Play/Pause · Step · Next state · playback speed

**Live mode:** actual UDP arrivals → receiver observations → WebSocket dashboard

**What the project demonstrates:** framing, buffering, bit-level synchronization, error detection, and automatic recovery.

### Visual / diagram instructions

Use three numbered demonstration cards with one observation each: **Buffer fills**, **CRC rejects**, **Alignment shifts and recovery continues**. Below them, draw a clear distinction:

```text
Guided lab: six-frame recording; chunks processed in memory
Live mode: transmitter sends actual localhost UDP datagrams
```

Add a compact run strip with commands in **separate terminal boxes**:

```text
Terminal 1: npm run receiver
Terminal 2: npm run ui
Browser:    http://127.0.0.1:5173
Optional Terminal 3 for Live: npm run transmitter -- --mode clean
```

Use a closing callout: **Find the start → collect the frame → validate → decode → recover when needed**. Do not add a separate thank-you slide; this is slide 12.

### What I will say

“I will first use Guided lab because we can pause each transition. Next state skips to the next FSM change; Step advances one recorded step. Playback speed changes the walkthrough speed, not the network rate. We will compare a clean run, a flipped bit, and an inserted bit. Then I can switch to Live to show actual UDP traffic. The result is a receiver that finds and validates frames even when message boundaries do not match frame boundaries, and continues receiving after damage without restarting.”

### Presenter-only demonstration notes

- Guided lab needs the receiver and UI, but no running transmitter. Its recording uses the same frame builder, simulator, packetizer, synchronizer, and CRC implementation, with chunks processed in memory.
- Select an experiment and press Restart before explaining it. At “complete,” use Latest valid alignment to discuss the recovered frames; current alignment may be absent because the receiver has returned to HUNT.
- Pause at a rejected candidate to show the unequal CRC values. Then continue to a later accepted frame and inspect Latest valid alignment.
- The 0–7 row is alignment. The small chunk numbers are arrival counters. Frame sequence is a third, separate identifier.
- During guided playback, the FSM can pause within a chunk while buffer counters update at chunk completion. Do not treat a before-chunk bar and an end-of-chunk caption as a single instantaneous snapshot.
- A sequence gap counts missing accepted frame observations, not missing UDP datagrams. Reacquisition counts a marker found after a rejected candidate; startup acquisition alone does not count.
- The live receiver runs independently of the browser. Closing the dashboard or freezing its visuals does not stop UDP reception.
- For a fresh live fault demonstration, stop the old transmitter, restart the receiver to reset counters, and run `npm run transmitter -- --mode bit-insert --target-frame 50`. At the default 5 frames/second the fault occurs roughly ten seconds into transmission. Do not restart during the fault.
- Conclude with the scope: software-only, mock measurements, custom educational frame body; no RF hardware, retransmission, forward error correction, or repair of rejected readings.

---

## Local reference material for the PPT-making agent

These are supporting project files, not additional slides:

- `README.md`: architecture, frame format, run commands, and observation semantics.
- `docs/demo-guide.md`: classroom walkthrough and interpretation of dashboard panels.
- `src/transmitter/frameBuilder.ts`: generated sensor readings and ASM construction.
- `src/transmitter/bitstreamSimulator.ts`: controlled bit faults before packetization.
- `src/receiver/synchronizer.ts`: HUNT / LOCK / VERIFY / EXTRACT and recovery rules.
- `src/receiver/lessons.ts`: six-frame guided recordings, fault target frame 2.
- `ui/src/main.ts`: dashboard controls, alignment, CRC display, and guided playback.

Do not turn the presenter notes, accuracy rules, agent instructions, or references into extra slides.

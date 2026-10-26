# Project submission guide

Project: **CCSDS Inspired Software Telemetry Receiver and Ground Station**
Student: **Jahnavi Singh, 24BCE2055**

Slot: **F2**

Team: **5**, with Jahnavi Singh as the sole member
Course: **BCSE308P Computer Networks Lab, Fall Semester 2026-27**
Faculty: **Sreethar S.**

Repository URL: <https://github.com/POSTI-25/computer-networks-project>

## VTOP assignments

| Assignment | Required submission |
|---|---|
| 8 | Complete project report in PDF format |
| 9 | Project presentation in PPT or PPTX format |
| 10 | GitHub repository URL containing source and verification material |

For Assignment 10, submit the repository page URL above. The faculty notice
requires a URL; it does not prescribe a separate Word document or PDF. If the
actual VTOP assignment accepts only a file upload, use the prepared Assignment 10
repository document with its clickable URL. Check that field in VTOP before upload.

## Repository requirements mapped to this project

| Faculty requirement | Project material |
|---|---|
| Complete source code | `src/`, `ui/`, `test/` and root project configuration |
| Network simulation files, where applicable | Simulation implementation is in `src/transmitter/bitstreamSimulator.ts` and `packetizer.ts`; no Packet Tracer file is used |
| Dashboard screenshots | `docs/screenshots/` with dated descriptions |
| Configuration and supporting resources | `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.json`, `ui/vite.config.ts`; environment variables are documented in the README |
| Database files, where applicable | Not applicable; the project has no database |
| Description, requirements, installation, execution and expected results | Root `README.md` and `docs/demo-guide.md` |
| Testing and implementation verification | `test/`, `docs/verification/`, `docs/prd-audit.md` |
| Faculty access | The repository was observed to be public on 25 October 2026; verify accessibility again before final submission |

## Filename convention

The confirmed submission prefix is **F2_Team5**.

| Asset | Submission filename |
|---|---|
| Report for Assignment 8 | `F2_Team5_Report.pdf` |
| Presentation for Assignment 9 | `F2_Team5_PPT.pptx` |
| Presentation PDF preview | `F2_Team5_PPT.pdf` |
| Repository document, if VTOP requires a file | `F2_Team5_Github.pdf` |
| Source ZIP, if requested | `F2_Team5_SourceCode.zip` |
| Screenshot ZIP, if requested | `F2_Team5_Screenshots.zip` |

Use the assigned prefix for the report, presentation, repository submission
document, and any submitted source or screenshot ZIP. Preserve implementation
filenames such as `package.json`, `README.md` and TypeScript modules: the project
depends on their existing paths. A source ZIP is optional in the quoted notice;
complete source in the repository is required.

## Final submission checks

1. Use the prepared `F2_Team5` filenames for the submission assets.
2. Commit and push the prepared screenshots, logs and documentation to GitHub.
3. Open the repository while signed out and verify the new evidence is visible.
4. On another checkout, run `npm ci`, the verification commands and the demo guide.
5. Upload the report to Assignment 8 and the presentation to Assignment 9.
6. Submit the repository page URL in Assignment 10 and confirm VTOP records it.

Screenshots and documentation do not replace the complete executable source.
The dashboard, receiver and transmitter can be demonstrated from the instructions
in the repository; no executable-only submission is needed.

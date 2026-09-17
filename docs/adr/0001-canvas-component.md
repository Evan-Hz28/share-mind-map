# ADR 0001: Canvas component

- Status: Accepted
- Decision: mind-elixir
- Evidence date: 2026-09-16T15:16:47.679Z

## Context

Three installed browser canvas packages were evaluated through the same CloudDocumentV1 adapter using synthetic 100, 5,000, and 20,000 node samples. Raw measurements are in `docs/benchmarks/canvas/results.json`; the captured machine and browser context is in `docs/benchmarks/canvas/environment.json`.

## Decision

Decision: mind-elixir

Use mind-elixir for the phase 4 canvas boundary, subject to validation with representative business documents.

## Evidence

| Candidate | License | 5,000 first usable median (ms) | 20,000 first usable median (ms) | Gate result |
|---|---:|---:|---:|---|
| simple-mind-map | fail | 317.3 | 649.7 | license |
| mind-elixir | pass | 262 | 702.8 | pass |
| jsmind | pass | 1020.8 | 16371.5 | capability:undoHook, capability:label, capability:icon, performance:20000 |

Environment summary: {"schemaVersion":1,"capturedAt":"2026-09-16T15:16:47.679Z","os":{"platform":"linux","release":"6.18.33.2-microsoft-standard-WSL2","architecture":"x64"},"cpu":{"model":"AMD Ryzen 9 7940H w/ Radeon 780M Graphics","logicalCores":16},"memory":{"totalBytes":7912194048,"freeBytesAtCapture":2241261568},"runtime":{"node":"v24.16.0","pnpm":"11.5.0","playwright":"1.63.0","chromium":"153.0.8010.12"},"packageVersions":{"jsmind":"0.9.1","mind-elixir":"6.0.0-next.4","simple-mind-map":"0.14.0-fix.3"},"launchArguments":["--enable-precise-memory-info","--js-flags=--expose-gc"],"syntheticSamples":true}

## Known Gaps

- Samples are deterministic and synthetic; they are not representative company documents.
- Measurements describe this recorded Chromium and machine only, not production acceptance.
- Image behavior is capability-probed without production object storage integration.
- External cloud traffic is rejected; no candidate may depend on an external service for core rendering.

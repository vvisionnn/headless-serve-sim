# Logs Panel + Screen Recording

Status: complete; verified and isolated resources removed

## Goal

Ship a searchable live Logs panel and browser screen recording with touch
indicators for `headless-serve-sim`, then prove both with comprehensive tests and
an isolated real-simulator E2E.

## Success criteria

- Logs use the existing simulator log stream and expose connection state, pause,
  clear, text search, level selection, and process filtering.
- Log storage is bounded and high-volume delivery does not re-render the main app.
- Recording captures the visible simulator orientation plus single/multi-touch
  indicators, supports a generic device-frame option, downloads MP4 when the
  browser supports it and WebM otherwise, and cleans up every media resource.
- Both features work in standalone preview and remain compatible with embedded
  middleware.
- Unit/component/integration tests and real browser/simulator E2E pass.
- Full repository test/build checks pass at the end.

## Agreed public test seams

1. Log parsing, filtering, bounded storage, pause/clear behavior.
2. Recording MIME selection, geometry/composition, state, cleanup, and download.
3. React controls and visible states.
4. Browser behavior against one simulator created by this workflow.

## Isolation contract

- Snapshot all existing simulator UDIDs before creating anything.
- Create one uniquely named simulator and persist its UDID in `state.json`.
- Every boot, shutdown, erase, delete, helper, and E2E command must name that UDID.
- Never use `booted`, `--all`, or a device selected from another user's state.
- Clean up only the recorded workflow UDID and processes started by this workflow.

## Risks

- Unified logs can arrive faster than React can render.
- MediaRecorder MIME support varies by browser.
- Canvas recording must not leak animation frames, tracks, object URLs, or timers.
- MJPEG images and orientation transforms can taint or mis-size a compositor.
- Existing simulator/helper processes must remain untouched.

## Delivery slices

1. Investigate current UI/stream/test seams and lock the concrete design.
2. Logs model tests → Logs panel implementation → middleware level validation.
3. Recording model tests → compositor/recorder → Recording UI.
4. Narrow tests → typecheck/build → full tests.
5. Create isolated simulator → agent-browser E2E → artifact inspection.
6. Independent adversarial review → fix findings → repeat verification.
7. Code review and intentional commit.

## Locked design

### Logs

- Extract validated log level and child-stream framing/backpressure into
  `src/sim-log-stream.ts`.
- Add a bounded reducer/filter model in `src/client/utils/sim-logs.ts` and one
  stream hook in `src/client/hooks/use-sim-logs.ts`.
- Replace the console-only subscription with that single feed; retain console
  forwarding without creating a second `xcrun log stream` process.
- Add a resizable `LogsPanel` with Default/Info/Debug capture, literal search,
  process filter, pause/resume, clear, and live/reconnecting/paused status.
- Authenticate the log route and validate every server-side option.

### Recording

- Add a reusable browser recorder to the preview client and expose a narrow,
  public `SimulatorRecordingSource.snapshot()` ref from `SimulatorView`.
- Composite the active AVCC canvas or MJPEG image at fixed, even dimensions,
  applying current orientation, single/multi-touch indicators, and optional
  generic frame geometry.
- Use MediaRecorder at 30 FPS with explicit MP4/WebM capability probing; Auto
  prefers MP4 and falls back to WebM.
- Add a Recording inspector tool with format, touches, frame, Start/Stop,
  elapsed time, preview/download, and explicit unsupported/error states.
- Cancel and release rAF, timers, media tracks, chunks, and object URLs on stop,
  replacement, device change, stream loss, pagehide, and unmount.

### Test isolation correction

- Real-simulator test files will honor `HEADLESS_SERVE_SIM_E2E_UDID`, allowing
  the final full suite to target only the workflow-owned simulator. The default
  discovery behavior remains unchanged when that variable is absent.

## Design direction

Stay inside the existing compact Apple-tooling visual language. The memorable
element is functional: log severity reads as a restrained diagnostic signal, and
recording has one unmistakable live red state. No new typography or decorative
system is introduced.

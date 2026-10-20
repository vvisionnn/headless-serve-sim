# headless-serve-sim

headless-serve-sim is a local preview server for Apple simulators: iPhone (including the
foldable iPhone Duo), iPad and Apple Watch. It boots a device and streams it to a browser,
and it lets people, scripts and AI agents drive the device from the CLI. It runs headless
by default, so no Simulator.app window is needed (`--headed` opens one). It is a general
tool: keep docs, comments and examples free of any one consumer project.

It is distributed as a GitHub release (`headless-serve-sim-darwin-arm64.tar.gz`) that end
users install with mise (`mise use -g github:vvisionnn/headless-serve-sim`). It is **not**
published to npm, so never document `npx`, `bunx` or `npm install` for end users. Inside
this repo, contributors use bun.

## Repo map

- `packages/headless-serve-sim`: the CLI (`src/index.ts`), the preview server and middleware,
  and the "Stage" web UI (`src/client/**`).
- `packages/headless-serve-sim-client`: the shared React stream view and transport.
- `packages/headless-serve-sim-binary`: the Swift stream helper (`headless-serve-sim-bin`) and
  the native tools (camera injector and helper, accessibility settings, device motion,
  display observer).
- `skills/headless-serve-sim`: the agent skill for end users. It ships through the
  `.claude-plugin/` marketplace.
- `design/`: the self-contained "Stage" design preview (`design/serve-sim-design.html`) and
  `DESIGN.md`. The `design-system` skill holds the rules for the web UI.
- `design/promo`: the README's promo film, a frame-deterministic React composition.
  `mise run promo` renders it; `mise run promo:preview` gives a scrubbable player.
- `.claude/skills/release-and-monitor`: cuts and watches a release.

Toolchain: `mise install` (bun, node, gh), plus a full Xcode 26 or newer for the Swift build.
Apple Silicon only.

## Rules

- Test-driven development where possible.
- Prefer kebab-case for all TS/JS files.
- Avoid low-opacity for icons.
- `bun run check` must pass (format, lint, typecheck, test-safety, knip, hermetic tests).
- Hermetic tests (`bun run test`) cannot reach the host. `xcrun`, `simctl`, `open` and
  similar commands are blocked, and `TMPDIR` is sandboxed. Tests that need a real simulator
  live in `packages/headless-serve-sim/src/system-tests/` and only run with an explicitly
  leased device (`HEADLESS_SERVE_SIM_SYSTEM_TESTS`, `HEADLESS_SERVE_SIM_SYSTEM_TEST_UDID`).
- Several identifiers still say `serve-sim` (`SERVE_SIM_*` env vars, the `serve-sim:*`
  localStorage keys, the `/serve-sim-camera-` shm prefix, `design/serve-sim-design.html`).
  The code depends on these names, so don't rename them in a docs pass.

## E2E testing with agent-browser

The headless-serve-sim web UI streams the simulator and forwards input, so end-to-end
behavior can be driven from a browser with the `agent-browser` CLI:

1. Build: `bun run packages/headless-serve-sim/build.ts`. It rebuilds the CLI, the web UI and
   the `simcam/`, `simax/` and `simmotion/` tools into `packages/headless-serve-sim/dist/`.
   It copies the prebuilt Swift stream helper (`headless-serve-sim-bin`) rather than rebuilding
   it, so run `bun run build:swift` first if you changed the Swift stream helper.
2. Start the server: `node packages/headless-serve-sim/dist/headless-serve-sim.js --port 3399 [device]`.
   Name a device to boot and stream it. Leave it out to pick one in the Navigator.
3. Drive the UI: `agent-browser open http://localhost:3399`, then `snapshot`,
   `click @eN`, `upload input[type=file] <path>`, `screenshot <path>`, etc.
4. Tap inside the simulator with `agent-browser mouse move <x> <y> && mouse down && mouse up`.
   The canvas isn't in the AX tree, so use pixel coordinates from a screenshot.

## E2E testing via the headless-serve-sim CLI

For headless flows that don't need the browser, drive the simulator entirely
through `headless-serve-sim` subcommands against a running server. Always pass
`-d <udid>` when more than one helper may be running.

- `headless-serve-sim tap <x> <y> [-d udid]`: a single tap at normalized (0..1)
  screen coords. Prefer this over `headless-serve-sim gesture` for taps. Each `gesture`
  call opens its own WebSocket, so two back-to-back `begin`/`end` invocations
  land far enough apart to register as a long-press.
- `headless-serve-sim gesture '<json>' [-d udid]`: for drags or multi-step gestures
  that need explicit `begin`/`move`/`end` events.
- `headless-serve-sim button [home|lock|…] [-d udid]`: a hardware button.
- `headless-serve-sim screenshot [path] [-d udid]`: captures the device screen to a file.
- `headless-serve-sim camera …`: injects the camera dylib, hot-swaps the source, and toggles mirroring.
- `xcrun simctl openurl <udid> <url>`: deep-links into an app. This is faster than
  navigating to the screen by taps.

A typical camera e2e flow:

1. Rebuild.
2. Run `camera --stop-webcam`.
3. `simctl terminate` the app.
4. Run `camera <bundleId> --file <img> --mirror on` to re-inject.
5. Open the screen under test with `openurl`.
6. Tap the shutter, for example `tap 0.5 0.9`.
7. Verify the result with `screenshot`, or read the photo the app saved inside the simulator's data container.

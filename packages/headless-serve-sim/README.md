# headless-serve-sim

**Boot, stream and drive Apple simulators from your browser, your terminal or an AI agent, with no Simulator.app window.**

headless-serve-sim is a local preview server for the iOS Simulator and its siblings: iPhone (including the foldable iPhone Duo), iPad and Apple Watch. It boots a device itself, streams it to a browser as hardware-encoded H.264, and turns every simulator control into a CLI command, so a developer, a reviewer on a phone, or a coding agent can use the same simulator. Everything runs headless by default and works with any app: Swift, SwiftUI, UIKit, React Native, Flutter, or a website in Safari.

```sh
mise use -g github:vvisionnn/headless-serve-sim
headless-serve-sim
# → open http://localhost:3200 and pick a simulator
```

## Highlights

- **Headless by default.** Boots the device with `simctl` and streams it straight from SimulatorKit. You never need a Simulator window, although `--headed` opens one.
- **Smooth streaming.** Up to 60 fps H.264, decoded in the browser with WebCodecs, with adaptive bitrate. MJPEG is the fallback for browsers or VMs that can't use H.264.
- **The Stage UI.** A focused web workspace:
  - Navigator with every simulator on your Mac.
  - Device drawn at real size in Xcode's own hardware frame.
  - Dock for Home, rotation, appearance, keyboard and screenshots.
  - Inspector with Device, App, Capture and Activity tabs.
  - Console with Logs, Input, Accessibility and Web Inspector views.
  - ⌘K command palette.
- **Many devices at once.** Run one helper per simulator, view them side by side in the Wall, and target each one from scripts with `-d <udid>`.
- **Every control is a command.** Use `tap`, `gesture`, `button`, `type`, `rotate`, `screenshot`, `camera`, `permissions`, `status-bar`, `defaults`, `app-actions`, `document`, `ui`, `motion` and `events`. Each one is scriptable and returns JSON where that is useful.
- **Built for agents.** The bundled Claude Code plugin and Agent Skill teach coding agents to see the screen, read the accessibility tree and drive the device.
- **Real device input.** The browser supports:
  - Multi-touch (hold ⌥ to pinch).
  - Edge swipes and scrolling.
  - The Digital Crown on Apple Watch.
  - Hardware keyboard and clipboard bridging.
  - Hardware buttons on the frame.
- **Foldable support.** iPhone Duo hinge angle, pose and physical orientation are available from the UI and from `headless-serve-sim motion`.
- **Synthetic camera.** Feed an app's `AVCaptureSession` an animated test pattern, an image, a looping video or your Mac's webcam.
- **Capture and share.** Take screenshots and screen recordings (MP4/WebM, optionally with touches and the device frame). The QR-code phone preview lets anyone on your LAN use the simulator from a real phone.
- **Drag and drop.** Drop images and videos to add them to Photos, or drop an `.ipa` to install it.

## Requirements

- A Mac with Apple silicon. The release is arm64 only.
- Xcode 26 or newer, with at least one simulator runtime installed. headless-serve-sim loads SimulatorKit from your active Xcode (`xcode-select -p`), so the Command Line Tools alone are not enough. Xcode 27 is supported.
- The released binary is self-contained. It needs no Node.js, Bun or package manager.

## Install

headless-serve-sim ships as a GitHub release asset (`headless-serve-sim-darwin-arm64.tar.gz`). It is **not published to npm**, so `npx`, `bunx` and `npm install` will not find it.

### With mise (recommended)

[mise](https://mise.jdx.dev) installs straight from GitHub releases and keeps the binary on your `PATH`.

Install it globally:

```sh
mise use -g github:vvisionnn/headless-serve-sim
```

Or pin it per project in `mise.toml`:

```toml
[tools]
"github:vvisionnn/headless-serve-sim" = "latest" # or a fixed version, e.g. "0.0.42"
```

Run `mise install`, and `headless-serve-sim` is available in that directory. Pinning a version per project gives every contributor, and every CI run, the same build.

### From the release tarball

```sh
mkdir -p "$HOME/.local/headless-serve-sim"
curl -fL https://github.com/vvisionnn/headless-serve-sim/releases/latest/download/headless-serve-sim-darwin-arm64.tar.gz \
  | tar -xz -C "$HOME/.local/headless-serve-sim"
export PATH="$HOME/.local/headless-serve-sim:$PATH"   # add this to your shell profile
headless-serve-sim --help
```

The archive contains the `headless-serve-sim` executable and the `simcam/`, `simax/`, `simmotion/` and `native-sources/` folders. Keep the folders next to the executable, because the camera, accessibility-settings and motion tools are loaded from there.

### From source

See [Development](#development).

## Quick start

```sh
headless-serve-sim                          # open the simulator picker at http://localhost:3200
headless-serve-sim "iPhone 17 Pro"          # boot (if needed) and stream a specific device
headless-serve-sim "iPhone 17 Pro" "iPad Pro 13-inch (M5)"   # several devices at once
```

1. Run `headless-serve-sim`. It prints a `Local:` URL and a `Phone:` hint (the QR code in the preview toolbar). With an explicit `--host`, it prints a `Network:` URL instead.
2. Open the Local URL. Choose a simulator in the Navigator. It boots if necessary and starts streaming.
3. Click, swipe and type on the device. Use the dock under it for Home, rotation, appearance, keyboard and screenshots. Press ⌘K for every other action.

Devices can be given by name or UDID (see `xcrun simctl list devices`). Stopping the server with Ctrl-C leaves the simulators booted. Shut them down from the Navigator or with `xcrun simctl shutdown`.

## Using the preview

| Area                     | What it does                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Navigator** (⌘0)       | Every simulator on the Mac, grouped by runtime and searchable. Shows live, booted, booting and shut-down states, with Boot & stream and Shut down actions, and a host-memory summary.                                                                                                                                                                                                       |
| **Stage and dock**       | The device at its real physical size in Xcode's hardware frame. The device is resizable, and rotation animates. The dock has Home, Rotate, Appearance, Software keyboard, Screenshot and Accessibility overlay. Reload JS bundle appears for React Native apps. On iPhone Duo, a fold control sets Closed, Book or Open.                                                                    |
| **Inspector** (⌥⌘0)      | **Device:** appearance and accessibility, view scale, status bar, location trails, camera source. **App:** foreground app details, open URL, push payloads, keychain reset, permissions, document import, user defaults. **Capture:** screenshots, screen recording, stream quality, recent captures. **Activity:** CPU, memory, threads and disk for the app, plus live stream statistics. |
| **Console** (⌘J)         | **Logs:** `log stream` with search, process filter and level. **Input:** the event log. **Accessibility:** the AX hierarchy, with an overlay. **Web Inspector:** WebKit pages grouped by app, opened in Chrome DevTools.                                                                                                                                                                    |
| **Wall**                 | Every running simulator side by side, sized by device family. Click a tile to focus that device.                                                                                                                                                                                                                                                                                            |
| **Command palette** (⌘K) | Simulators, device actions, capture, panels, console, inspector, theme (Auto, Light or Dark) and sharing.                                                                                                                                                                                                                                                                                   |

**Keyboard shortcuts:**

- ⌘S: screenshot.
- ⇧⌘A: toggle appearance.
- ⇧⌘H: Home.
- ⌥⌘K: software keyboard.

While the simulator has focus, the keyboard and ⌘C, ⌘X and ⌘V go to the device.

**Phone preview.** Click the phone button in the toolbar and scan the QR code with a phone on the same network. The phone page shows the stream, touch input and a fullscreen toggle, nothing else. The link is tied to one simulator and works until the server stops.

By default only that phone page is reachable over the LAN, and the desktop controls stay on loopback. `--host 127.0.0.1` turns off LAN access entirely. Binding an explicit routable `--host` also exposes the desktop UI. Only do that on a network you trust, or behind a tunnel you control.

## CLI

```
headless-serve-sim [options] [devices...]
```

Leave out `devices` to choose one in the browser.

### Server options

| Option                | Description                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `-p, --port <port>`   | Starting port. The preview defaults to 3200 and scans upward if the port is busy, unless `-p` was given. Stream helpers default to 3100. |
| `--host <addr>`       | The interface to bind. The default `0.0.0.0` exposes only the phone viewer on the LAN. See [Using the preview](#using-the-preview).      |
| `--detach`            | Start the stream helper(s) in the background, print their JSON state, and exit. Needs an explicit device.                                |
| `--attach-only`       | With `--detach`, attach only to an already-booted simulator and never boot one.                                                          |
| `--no-preview`        | Run the stream helper in the foreground with no web UI. Needs an explicit device.                                                        |
| `--headed`            | Also open the simulator GUI: Simulator.app, or DeviceHub.app on Xcode 27+.                                                               |
| `--panes <list>`      | Panels to open on load: `none`, or a comma-separated list of `devices`, `inspector`, `devtools`, `logs` and `metrics`.                   |
| `--theme light\|dark` | Set the simulator appearance before opening. Needs an explicit device.                                                                   |
| `--codec auto\|mjpeg` | `auto` uses H.264 when the browser can decode it. `mjpeg` forces software JPEG, which suits VMs without a hardware encoder.              |
| `-q, --quiet`         | Print JSON only.                                                                                                                         |
| `-l, --list [device]` | Print the running streams as JSON.                                                                                                       |
| `-k, --kill [device]` | Stop one device's helper. With no device, stop every helper on this Mac.                                                                 |

### Commands

Device commands (`screenshot`, `ui`, `status-bar`, `permissions`, `defaults`, `app-actions`, `document`, `motion` and `camera`) accept `-d, --device <udid|name>`. Stream-input commands (`tap`, `gesture`, `button`, `type`, `rotate`, `ca-debug` and `memory-warning`) need `-d <udid>`; they do not resolve names. `events` uses `-p <preview-port>` instead. Without `-d`, a command uses the first running helper or the booted simulator. Always pass `-d` when more than one simulator is running.

| Command                                                                                                         | What it does                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tap <x> <y>`                                                                                                   | Tap at normalized `0..1` screen coordinates.                                                                                                                                                    |
| `gesture '<json>'`                                                                                              | Send a raw touch event, for example `'{"type":"begin","x":0.5,"y":0.5}'`, followed by `move` and `end`.                                                                                         |
| `button [name]`                                                                                                 | Press a hardware button: `home` (the default), `swipe_home`, `app_switcher`, `lock`, `side_button`, `siri`, `volume_up` or `volume_down`.                                                       |
| `type [text...]`                                                                                                | Type text, or read it with `--stdin` or `--file <path>`. Uses a US keyboard layout.                                                                                                             |
| `rotate <orientation>`                                                                                          | `portrait`, `portrait_upside_down`, `landscape_left` or `landscape_right`.                                                                                                                      |
| `screenshot [path]`                                                                                             | Save a screenshot. Options: `--type png\|jpeg\|tiff\|bmp`, `--display <id\|internal\|external>`, `--mask ignored\|alpha\|black`.                                                                |
| `ui [status] [--json]`<br>`ui <option> [value]`                                                                 | Read or change simulator-wide settings: `appearance`, `liquid-glass`, `color-filter`, `text-size`, `reduce-motion`, `increase-contrast`, `show-borders`, `reduce-transparency` and `voiceover`. |
| `status-bar override [flags]`<br>`status-bar clear`                                                             | Override the time, carrier, network, Wi-Fi, cellular and battery indicators, or clear the overrides.                                                                                            |
| `permissions grant\|revoke\|reset\|list`                                                                        | Manage privacy permissions per bundle ID: camera, photos, location, notifications, contacts and more.                                                                                           |
| `app-actions open-url <url>`<br>`app-actions push <bundle-id> --payload <json>`<br>`app-actions keychain-reset` | Open a URL or universal link, deliver a push notification, or reset the keychain.                                                                                                               |
| `defaults read\|write\|delete <domain> [key]`                                                                   | Inspect and edit an app's or suite's user defaults.                                                                                                                                             |
| `document import <file...> [--into <dir>]`                                                                      | Copy files into the Files app under On My iPhone/iPad.                                                                                                                                          |
| `camera <bundle-id> [--file <path> \| --webcam [name]]`                                                         | Launch an app with a synthetic camera feed. `camera switch`, `camera mirror` and `camera status` change or inspect the feed live.                                                               |
| `motion [status \| angle <0..180> \| orientation <name>]`                                                       | Set the foldable hinge angle and the physical orientation (iPhone Duo).                                                                                                                         |
| `ca-debug <flag> <on\|off>`                                                                                     | Toggle the `blended`, `copies`, `misaligned`, `offscreen` and `slow-animations` CoreAnimation debug flags.                                                                                      |
| `memory-warning`                                                                                                | Simulate a memory warning.                                                                                                                                                                      |
| `events [-p port] [-f] [-n N] [--json]`                                                                         | Print or follow the preview server's input event log.                                                                                                                                           |

Run `permissions`, `status-bar`, `defaults`, `app-actions` or `document` with no arguments to see their full usage. `ui` and `motion` print the current status with no arguments; use `ui --help`, `motion --help`, `camera --help` and `events --help` for their usage.

### Examples

```sh
headless-serve-sim -p 8080 --panes devices,logs          # custom port, with panels open
headless-serve-sim --theme dark "iPhone 17 Pro"          # start in Dark Mode
headless-serve-sim --detach -q "iPhone 17 Pro"           # background helper, JSON on stdout
headless-serve-sim --list                                # what's running
headless-serve-sim --kill "iPhone 17 Pro"                # stop just that device's helper

headless-serve-sim tap 0.5 0.9 -d "$UDID"
headless-serve-sim type "hello@example.com" -d "$UDID"
headless-serve-sim button lock -d "$UDID"
headless-serve-sim screenshot ./home.png -d "$UDID"
headless-serve-sim status-bar override --time 9:41 --battery-level 100 -d "$UDID"
headless-serve-sim permissions grant camera com.example.app -d "$UDID"
headless-serve-sim app-actions open-url "myapp://settings" -d "$UDID"
headless-serve-sim ui text-size increment -d "$UDID"
headless-serve-sim camera com.example.app --file ~/Movies/loop.mp4 -d "$UDID"
headless-serve-sim document import ~/report.pdf --into Reports -d "$UDID"
```

## Driving it from agents

headless-serve-sim is designed for coding agents and scripts as much as for people.

### Claude Code plugin

This repository is also a Claude Code plugin marketplace. Install the plugin to give Claude the `headless-serve-sim` skill:

```text
/plugin marketplace add vvisionnn/headless-serve-sim
/plugin install headless-serve-sim@headless-serve-sim
```

The skill lives in [`skills/headless-serve-sim`](https://github.com/vvisionnn/headless-serve-sim/tree/main/skills/headless-serve-sim). It follows the open Agent Skills format, so other agents can use it too: copy that folder into the agent's skills directory. It covers taps, gestures, buttons, rotation, camera injection, permissions, reading the accessibility tree, and handing the live preview to the user.

### Recipes for reliable automation

- **Pin the device.** Pass `-d <udid>` on every call. With parallel agents, give each agent its own simulator, for example one per git worktree.
- **Discover, don't guess.** Each running helper writes `$TMPDIR/headless-serve-sim/server-<udid>.json` with `pid`, `port`, `url`, `streamUrl` and `wsUrl`. Read your device's file, or `headless-serve-sim --list <udid>`. Helper ports start at 3100 and increase per device, so never hard-code them.
- **Pick the preview port.** Give each preview its own `-p`. In a script, run the server in the background and wait for the `Local:` line before using it.
- **Read the screen.** `<helper url>/ax` returns the accessibility tree. `/config` returns the screen size and orientation. `/foreground` returns the frontmost app's bundle ID. `headless-serve-sim screenshot` captures pixels.
- **Act.**
  - Use `tap` for taps. Each `gesture` call opens its own connection, so a separate begin and end can register as a long-press.
  - Swipes need at least one `move` between `begin` and `end`.
  - After a `rotate`, poll `/config` to confirm the new orientation.
  - `ca-debug slow-animations on` stretches transitions so frames can be captured.
- **Clean up only what you started.** Run `headless-serve-sim --kill <udid>`, or send SIGTERM to the `pid` from your state file. A bare `--kill` stops every helper on the Mac, including other agents'. headless-serve-sim never shuts simulators down on exit, so run `xcrun simctl shutdown <udid>` when you are done.

### Claude Code Desktop preview pane

To open the preview in Claude Code Desktop's preview pane, add a server to `.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "Simulator",
      "runtimeExecutable": "headless-serve-sim",
      "runtimeArgs": [],
      "port": 3200
    }
  ]
}
```

### Debug logging

Set `DEBUG=headless-serve-sim*` to trace the CLI, helper, state and middleware.

## How it works

```
 Simulator (CoreSimulator, booted headless)
        │  SimulatorKit IOSurface frames · Indigo HID input
        ▼
 headless-serve-sim-bin            one Swift helper per device (:3100, :3101, ...)
   /stream.avcc   H.264 (VideoToolbox), adaptive bitrate
   /stream.mjpeg  JPEG fallback
   /ws            touch, keys, buttons, rotation
   /ax /config /foreground /metrics
        │  state file: $TMPDIR/headless-serve-sim/server-<udid>.json
        ▼
 headless-serve-sim                preview server (:3200)
   serves the Stage UI, proxies each helper under /helper/<udid>,
   runs simctl-backed tools, log streaming, the Web Inspector bridge
        ▼
 Browser                           WebCodecs decode, input, inspector, console
```

- **The CLI and preview server** are TypeScript. The release compiles them with `bun build --compile` into a single executable that embeds the Swift helper.
- **The Swift helper** captures frames from SimulatorKit with no screen recording. It encodes them with VideoToolbox and injects input the way Simulator.app does. It links against the SimulatorKit of your active Xcode, which is why Xcode must be installed.
- **The native tools** sit next to the executable:
  - `simcam/`: the camera injector dylib and its host helper.
  - `simax/`: accessibility settings, applied live inside the simulator.
  - `simmotion/`: the hinge, pose and display observer for foldables.
- **One port does it all.** The preview proxies every helper's stream and WebSocket, so a remote viewer only needs port 3200.

## Embedding the preview (advanced)

The preview UI is also available as a Connect-style middleware (`simMiddleware`, from `packages/headless-serve-sim/src/middleware.ts`), which mounts at `/.sim` by default inside your own Node dev server. It is not published as a package. To use it, build it from source (see [Development](#development)) and import `packages/headless-serve-sim/dist/middleware.js`. Keep the `headless-serve-sim` CLI on your `PATH`, or pass `serveSimBin`, so the in-page tools can run. Most people should run the standalone server instead.

## Development

The repository is a Bun workspace:

- `packages/headless-serve-sim`: the CLI, the preview server and the web UI.
- `packages/headless-serve-sim-binary`: the Swift helper and native tools.
- `packages/headless-serve-sim-client`: the streaming client library.
- `design/`: the Stage design reference.
- `skills/headless-serve-sim`: the agent skill.

```sh
mise install                                   # bun, node and gh at the pinned versions
bun install
bun run build:swift                            # build the Swift helper and native tools
bun run --cwd packages/headless-serve-sim build   # build the CLI, the compiled binary and the UI
bun run --cwd packages/headless-serve-sim dev     # dev server with live reload (PORT, default 3200)
bun run check                                  # format, lint, typecheck, knip and the hermetic tests
```

The build writes `packages/headless-serve-sim/dist/headless-serve-sim` (the compiled binary) and `dist/headless-serve-sim.js`, which runs with Node 18 or newer. The binary package also has Swift self-tests (`bun run --cwd packages/headless-serve-sim-binary test:<name>`).

Contributor and agent conventions, including end-to-end testing with `agent-browser` and the CLI, are in [`AGENTS.md`](https://github.com/vvisionnn/headless-serve-sim/blob/main/AGENTS.md).

**Stream benchmark.** Run this against a dedicated, already-running helper. It needs `ffmpeg`.

```sh
bun run --cwd packages/headless-serve-sim benchmark:stream-quality -- \
  --url http://127.0.0.1:3100 --udid <dedicated-simulator-udid> \
  --format avcc --output /tmp/stream-quality
```

The benchmark plays a deterministic 60 Hz motion pattern on the device and records the public stream. It fails if any of these happen:

- A frame is torn or can't be decoded.
- The average falls below 55 fps.
- Any one-second window falls below 50 fps.
- Bandwidth goes above 8 Mbps.

Use `--format mjpeg` to measure the fallback path.

**Releases.** Pushing a `vX.Y.Z` tag runs CI on macOS. CI builds and tests the project, packages `headless-serve-sim-darwin-arm64.tar.gz`, and attaches it to a GitHub Release. mise picks it up from there.

## License

[Apache-2.0](https://github.com/vvisionnn/headless-serve-sim/blob/main/LICENSE)

## Acknowledgements

headless-serve-sim began as a fork of [EvanBacon/serve-sim](https://github.com/EvanBacon/serve-sim) by Evan Bacon. Thank you for the original idea and the foundation it is built on. The project was renamed so the two tools can be installed side by side without clashing. It is now maintained independently, with its own UI, device support and release flow. Please report issues for headless-serve-sim at [vvisionnn/headless-serve-sim](https://github.com/vvisionnn/headless-serve-sim/issues).

<div align="center">

<a href="https://github.com/vvisionnn/headless-serve-sim/blob/main/design/promo/renders/headless-serve-sim.mp4"><img src="https://raw.githubusercontent.com/vvisionnn/headless-serve-sim/main/design/promo/renders/readme.webp" width="100%" alt="headless-serve-sim: an iPhone simulator rises out of a dark room, the Stage UI assembles around it, other simulators join it on one floor, a terminal drives it, and the wordmark closes the film." /></a>

# headless-serve-sim

**Apple simulators, streamed to your browser.**

Boot an iPhone, iPad or Apple Watch simulator and use it from a browser tab,<br />a terminal or an AI agent. No Simulator.app window required.

[Install](#install) · [Quick start](#quick-start) · [CLI](#cli) · [Agents](#agents) · [How it works](#how-it-works) · [Development](#development)

</div>

<br />

## Install

```sh
mise use -g github:vvisionnn/headless-serve-sim
```

You need an Apple silicon Mac and Xcode 26 or newer with at least one simulator runtime. The binary is self-contained, so it needs no Node.js or Bun. It ships only as a GitHub release, not on npm.

<details>
<summary>Pin a version per project, or install without mise</summary>

<br />

Pin it in a project's `mise.toml`, so every contributor and every CI run gets the same build:

```toml
[tools]
"github:vvisionnn/headless-serve-sim" = "latest" # or a fixed version, e.g. "0.0.42"
```

Or unpack the release tarball yourself:

```sh
mkdir -p "$HOME/.local/headless-serve-sim"
curl -fL https://github.com/vvisionnn/headless-serve-sim/releases/latest/download/headless-serve-sim-darwin-arm64.tar.gz \
  | tar -xz -C "$HOME/.local/headless-serve-sim"
export PATH="$HOME/.local/headless-serve-sim:$PATH"   # add this to your shell profile
```

Keep the `simcam/`, `simax/`, `simmotion/` and `native-sources/` folders next to the executable, because the camera, accessibility-settings and motion tools load from there. headless-serve-sim loads SimulatorKit from your active Xcode (`xcode-select -p`), so the Command Line Tools alone are not enough.

</details>

## Quick start

```sh
headless-serve-sim                                         # pick a simulator at http://localhost:3200
headless-serve-sim "iPhone 17 Pro"                         # boot (if needed) and stream one device
headless-serve-sim "iPhone 17 Pro" "iPad Pro 13-inch (M5)" # several at once
```

Open the `Local:` URL it prints. Click, swipe and type on the device. The dock under it has Home, rotation, appearance, the keyboard and screenshots, and <kbd>⌘K</kbd> reaches everything else. Stopping the server leaves the simulators booted.

## What you get

|                                |                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Headless by default**        | Boots with `simctl` and streams straight from SimulatorKit. `--headed` opens the Simulator window if you want it.                       |
| **Smooth streaming**           | Up to 60 fps H.264, decoded with WebCodecs, with adaptive bitrate. MJPEG is the fallback.                                               |
| **The Stage**                  | The device at real size in Xcode's own hardware frame, with a Navigator, an Inspector, a Console and a <kbd>⌘K</kbd> palette around it. |
| **Every device at once**       | One helper per simulator. See them side by side in the Wall, and target each one from scripts with `-d <udid>`.                         |
| **Every control is a command** | Tap, type, rotate, take screenshots, grant permissions, override the status bar, push notifications and more, all from the CLI.         |
| **Built for agents**           | A Claude Code plugin and Agent Skill teach coding agents to see the screen, read the accessibility tree and drive the device.           |
| **Real input**                 | Multi-touch (hold <kbd>⌥</kbd> to pinch), edge swipes, the Digital Crown, hardware buttons, the hardware keyboard and the clipboard.    |
| **On your phone**              | Scan the QR code in the toolbar to use the live simulator from a real phone on your network.                                            |
| **And more**                   | A synthetic camera feed, screen recording, drag and drop for photos, videos and `.ipa` files, and the iPhone Duo's hinge and pose.      |

<details>
<summary>The Stage, panel by panel</summary>

<br />

| Area                              | What it does                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Navigator** <kbd>⌘0</kbd>       | Every simulator on the Mac, grouped by runtime and searchable, with live, booted, booting and shut-down states, Boot & stream and Shut down actions, and a host-memory summary.                                                                                                                                                                                                             |
| **Stage and dock**                | The device at its real physical size. It is resizable, and rotation animates. The dock has Home, Rotate, Appearance, Software keyboard, Screenshot and Accessibility overlay, plus Reload JS bundle for React Native apps and a fold control (Closed, Book or Open) on iPhone Duo.                                                                                                          |
| **Inspector** <kbd>⌥⌘0</kbd>      | **Device:** appearance and accessibility, view scale, status bar, location trails, camera source. **App:** foreground app details, open URL, push payloads, keychain reset, permissions, document import, user defaults. **Capture:** screenshots, screen recording, stream quality, recent captures. **Activity:** CPU, memory, threads and disk for the app, plus live stream statistics. |
| **Console** <kbd>⌘J</kbd>         | **Logs:** `log stream` with search, process filter and level. **Input:** the event log. **Accessibility:** the AX hierarchy, with an overlay. **Web Inspector:** WebKit pages grouped by app, opened in Chrome DevTools.                                                                                                                                                                    |
| **Wall**                          | Every running simulator side by side, sized by device family. Click a tile to focus that device.                                                                                                                                                                                                                                                                                            |
| **Command palette** <kbd>⌘K</kbd> | Simulators, device actions, capture, panels, console, inspector, theme (Auto, Light or Dark) and sharing.                                                                                                                                                                                                                                                                                   |

Shortcuts: <kbd>⌘S</kbd> screenshot, <kbd>⇧⌘A</kbd> appearance, <kbd>⇧⌘H</kbd> Home, <kbd>⌥⌘K</kbd> software keyboard. While the simulator has focus, the keyboard and <kbd>⌘C</kbd> <kbd>⌘X</kbd> <kbd>⌘V</kbd> go to the device.

**Phone preview.** The phone page shows the stream, touch input and a fullscreen toggle. Its link is tied to one simulator and works until the server stops. By default only that page is reachable over the LAN, and the desktop controls stay on loopback. `--host 127.0.0.1` turns LAN access off. Binding an explicit routable `--host` also exposes the desktop UI, so only do that on a network you trust, or behind a tunnel you control.

</details>

## CLI

```sh
headless-serve-sim tap 0.5 0.9 -d "$UDID"                  # normalized 0..1 screen coordinates
headless-serve-sim type "hello@example.com" -d "$UDID"
headless-serve-sim screenshot ./home.png -d "$UDID"
headless-serve-sim status-bar override --time 9:41 --battery-level 100 -d "$UDID"
headless-serve-sim permissions grant camera com.example.app -d "$UDID"
headless-serve-sim app-actions open-url "myapp://settings" -d "$UDID"
headless-serve-sim camera com.example.app --file ~/Movies/loop.mp4 -d "$UDID"
```

Pass `-d` whenever more than one simulator is running. Without it, a command uses the first running helper or the booted simulator.

<details>
<summary>Server options</summary>

<br />

```
headless-serve-sim [options] [devices...]
```

Leave out `devices` to choose one in the browser. Devices can be given by name or UDID (see `xcrun simctl list devices`).

| Option                | Description                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `-p, --port <port>`   | Starting port. The preview defaults to 3200 and scans upward if the port is busy, unless `-p` was given. Stream helpers default to 3100. |
| `--host <addr>`       | The interface to bind. The default `0.0.0.0` exposes only the phone viewer on the LAN.                                                   |
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

</details>

<details>
<summary>Commands</summary>

<br />

Device commands (`screenshot`, `ui`, `status-bar`, `permissions`, `defaults`, `app-actions`, `document`, `motion` and `camera`) accept `-d, --device <udid|name>`. Stream-input commands (`tap`, `gesture`, `button`, `type`, `rotate`, `ca-debug` and `memory-warning`) need `-d <udid>` and do not resolve names. `events` uses `-p <preview-port>` instead.

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

Run `permissions`, `status-bar`, `defaults`, `app-actions` or `document` with no arguments to see their full usage. `ui` and `motion` print the current status with no arguments. `ui --help`, `motion --help`, `camera --help` and `events --help` print their usage.

</details>

## Agents

This repository is also a Claude Code plugin marketplace. Install the plugin to give Claude the `headless-serve-sim` skill:

```text
/plugin marketplace add vvisionnn/headless-serve-sim
/plugin install headless-serve-sim@headless-serve-sim
```

The skill lives in [`skills/headless-serve-sim`](https://github.com/vvisionnn/headless-serve-sim/tree/main/skills/headless-serve-sim). It follows the open Agent Skills format, so other agents can use it too: copy the folder into the agent's skills directory. It covers taps, gestures, buttons, rotation, camera injection, permissions, reading the accessibility tree, and handing the live preview to the user.

<details>
<summary>Recipes for reliable automation</summary>

<br />

- **Pin the device.** Pass `-d <udid>` on every call. With parallel agents, give each agent its own simulator, for example one per git worktree.
- **Discover, don't guess.** Each running helper writes `$TMPDIR/headless-serve-sim/server-<udid>.json` with `pid`, `port`, `url`, `streamUrl` and `wsUrl`. Read your device's file, or run `headless-serve-sim --list <udid>`. Helper ports start at 3100 and increase per device, so never hard-code them.
- **Pick the preview port.** Give each preview its own `-p`. In a script, run the server in the background and wait for the `Local:` line before using it.
- **Read the screen.** `<helper url>/ax` returns the accessibility tree. `/config` returns the screen size and orientation. `/foreground` returns the frontmost app's bundle ID. `headless-serve-sim screenshot` captures pixels.
- **Act.** Use `tap` for taps: each `gesture` call opens its own connection, so a separate begin and end can register as a long-press. Swipes need at least one `move` between `begin` and `end`. After a `rotate`, poll `/config` to confirm the new orientation. `ca-debug slow-animations on` stretches transitions so frames can be captured.
- **Clean up only what you started.** Run `headless-serve-sim --kill <udid>`, or send SIGTERM to the `pid` from your state file. A bare `--kill` stops every helper on the Mac, including other agents'. headless-serve-sim never shuts simulators down on exit, so run `xcrun simctl shutdown <udid>` when you are done.
- **Trace.** Set `DEBUG=headless-serve-sim*` to trace the CLI, helper, state and middleware.

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

</details>

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

The CLI and preview server are TypeScript, compiled with `bun build --compile` into one executable that embeds the Swift helper. The helper captures frames from SimulatorKit with no screen recording, encodes them with VideoToolbox, and injects input the way Simulator.app does. It links against the SimulatorKit of your active Xcode, which is why Xcode must be installed. The preview proxies every helper's stream and WebSocket, so a remote viewer only needs port 3200.

<details>
<summary>Embedding the preview in your own dev server</summary>

<br />

The preview UI is also available as a Connect-style middleware (`simMiddleware`, from `packages/headless-serve-sim/src/middleware.ts`), which mounts at `/.sim` by default. It is not published as a package. To use it, build it from source and import `packages/headless-serve-sim/dist/middleware.js`. Keep the `headless-serve-sim` CLI on your `PATH`, or pass `serveSimBin`, so the in-page tools can run. Most people should run the standalone server instead.

</details>

## Development

```sh
mise install                                      # bun, node and gh at the pinned versions
bun install
bun run build:swift                               # the Swift helper and native tools
bun run --cwd packages/headless-serve-sim build   # the CLI, the compiled binary and the UI
bun run --cwd packages/headless-serve-sim dev     # dev server with live reload (PORT, default 3200)
bun run check                                     # format, lint, typecheck, knip and hermetic tests
```

| Path                                 | What lives there                                            |
| ------------------------------------ | ----------------------------------------------------------- |
| `packages/headless-serve-sim`        | The CLI, the preview server and the Stage web UI.           |
| `packages/headless-serve-sim-binary` | The Swift stream helper and the native tools.               |
| `packages/headless-serve-sim-client` | The streaming client library.                               |
| `design/`                            | The Stage design reference, and the promo film in `promo/`. |
| `skills/headless-serve-sim`          | The agent skill.                                            |

The build writes `packages/headless-serve-sim/dist/headless-serve-sim` (the compiled binary) and `dist/headless-serve-sim.js`, which runs with Node 18 or newer. The binary package also has Swift self-tests (`bun run --cwd packages/headless-serve-sim-binary test:<name>`).

The film at the top of this page is code, too. `mise run promo` renders it into `design/promo/renders/` on any machine, and `mise run promo:preview` rebuilds a scrubbable player while you edit it. See [`design/promo`](https://github.com/vvisionnn/headless-serve-sim/tree/main/design/promo).

Contributor and agent conventions, including end-to-end testing with `agent-browser` and the CLI, are in [`AGENTS.md`](https://github.com/vvisionnn/headless-serve-sim/blob/main/AGENTS.md). Pushing a `vX.Y.Z` tag runs CI on macOS, which builds and tests the project, packages `headless-serve-sim-darwin-arm64.tar.gz` and attaches it to a GitHub Release. mise picks it up from there.

<details>
<summary>Stream benchmark</summary>

<br />

Run it against a dedicated, already-running helper. It needs `ffmpeg`.

```sh
bun run --cwd packages/headless-serve-sim benchmark:stream-quality -- \
  --url http://127.0.0.1:3100 --udid <dedicated-simulator-udid> \
  --format avcc --output /tmp/stream-quality
```

The benchmark plays a deterministic 60 Hz motion pattern on the device and records the public stream. It fails on a torn or undecodable frame, an average below 55 fps, any one-second window below 50 fps, or bandwidth above 8 Mbps. Use `--format mjpeg` to measure the fallback path.

</details>

## License

[Apache-2.0](https://github.com/vvisionnn/headless-serve-sim/blob/main/LICENSE)

headless-serve-sim began as a fork of [EvanBacon/serve-sim](https://github.com/EvanBacon/serve-sim) by Evan Bacon. Thank you for the original idea and the foundation it is built on. The project was renamed so the two tools can be installed side by side without clashing. It is now maintained independently, with its own UI, device support and release flow. Please report issues for headless-serve-sim at [vvisionnn/headless-serve-sim](https://github.com/vvisionnn/headless-serve-sim/issues).

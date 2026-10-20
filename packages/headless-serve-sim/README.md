<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/vvisionnn/headless-serve-sim/main/design/promo/renders/readme-dark.webp" />
  <img src="https://raw.githubusercontent.com/vvisionnn/headless-serve-sim/main/design/promo/renders/readme-light.webp" width="100%" alt="headless-serve-sim: an iPhone slams in, sheds its simulator window, docks into the Stage UI and records itself, joins iPad, Watch and an unfolding iPhone Duo on one floor, takes commands from a terminal, and hands the frame to the wordmark." />
</picture>

<sub>🔊 The full film has sound: <a href="https://github.com/vvisionnn/headless-serve-sim/blob/main/design/promo/renders/headless-serve-sim-dark.mp4">watch dark</a> · <a href="https://github.com/vvisionnn/headless-serve-sim/blob/main/design/promo/renders/headless-serve-sim-light.mp4">watch light</a></sub>

<h1>headless-serve-sim</h1>

<p><b>Apple simulators, streamed to your browser.</b><br />
Drive an iPhone, iPad or Apple Watch from a browser tab, a terminal or an AI agent. No Simulator window.</p>

<p>
  <a href="https://github.com/vvisionnn/headless-serve-sim/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/vvisionnn/headless-serve-sim?style=flat-square&label=release&color=57606a&labelColor=24292f" /></a>
  <img alt="macOS on Apple silicon" src="https://img.shields.io/badge/macOS-Apple%20silicon-57606a?style=flat-square&labelColor=24292f&logo=apple" />
  <img alt="Xcode 26 or newer" src="https://img.shields.io/badge/Xcode-26%2B-57606a?style=flat-square&labelColor=24292f&logo=xcode" />
  <a href="https://github.com/vvisionnn/headless-serve-sim/blob/main/LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/github/license/vvisionnn/headless-serve-sim?style=flat-square&color=57606a&labelColor=24292f" /></a>
</p>

<p>
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#agents">Agents</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#development">Development</a>
</p>

</div>

## Install

```sh
mise use -g github:vvisionnn/headless-serve-sim
```

> [!NOTE]
> Needs an Apple silicon Mac and Xcode 26 or newer with a simulator runtime. The binary is self-contained (no Node.js or Bun), and ships only as a GitHub release, not on npm.

<details>
<summary>Pin a version per project, or install without mise</summary>

<br />

Pin it in a project's `mise.toml`, so every contributor and CI run gets the same build:

```toml
[tools]
"github:vvisionnn/headless-serve-sim" = "latest" # or a fixed version, e.g. "0.0.42"
```

Or unpack the release yourself:

```sh
mkdir -p "$HOME/.local/headless-serve-sim"
curl -fL https://github.com/vvisionnn/headless-serve-sim/releases/latest/download/headless-serve-sim-darwin-arm64.tar.gz \
  | tar -xz -C "$HOME/.local/headless-serve-sim"
export PATH="$HOME/.local/headless-serve-sim:$PATH"   # add this to your shell profile
```

Keep the `simcam/`, `simax/`, `simmotion/` and `native-sources/` folders next to the executable: the camera, accessibility-settings and motion tools load from there. SimulatorKit comes from your active Xcode (`xcode-select -p`), so the Command Line Tools alone are not enough.

</details>

## Quick start

```sh
headless-serve-sim                                         # pick a simulator at http://localhost:3200
headless-serve-sim "iPhone 17 Pro"                         # boot (if needed) and stream one device
headless-serve-sim "iPhone 17 Pro" "iPad Pro 13-inch (M5)" # several at once
```

Open the `Local:` URL, then click, swipe and type on the device. <kbd>⌘K</kbd> reaches everything. Stopping the server leaves the simulators booted.

## Features

<table>
  <tr>
    <td width="33%" valign="top"><b>Headless</b><br /><sub>Boots with <code>simctl</code> and streams straight from SimulatorKit. <code>--headed</code> opens the window if you want it.</sub></td>
    <td width="33%" valign="top"><b>60 fps</b><br /><sub>H.264 decoded with WebCodecs, adaptive bitrate, MJPEG fallback.</sub></td>
    <td width="33%" valign="top"><b>The Stage</b><br /><sub>The device at real size in its own hardware frame, with a Navigator, Inspector, Console and command palette.</sub></td>
  </tr>
  <tr>
    <td valign="top"><b>Every device at once</b><br /><sub>One helper per simulator, side by side in the Wall, each addressable with <code>-d &lt;udid&gt;</code>.</sub></td>
    <td valign="top"><b>Every control is a command</b><br /><sub>Tap, type, rotate, screenshot, permissions, status bar, push notifications and more.</sub></td>
    <td valign="top"><b>Built for agents</b><br /><sub>A Claude Code plugin and Agent Skill to see the screen, read the accessibility tree and drive the device.</sub></td>
  </tr>
  <tr>
    <td valign="top"><b>Real input</b><br /><sub>Multi-touch (<kbd>⌥</kbd> to pinch), edge swipes, Digital Crown, hardware buttons, keyboard and clipboard.</sub></td>
    <td valign="top"><b>On your phone</b><br /><sub>Scan the toolbar's QR code to use the live simulator from a real phone on your network.</sub></td>
    <td valign="top"><b>And more</b><br /><sub>Synthetic camera feeds, screen recording, drag-and-drop installs, and the iPhone Duo's hinge.</sub></td>
  </tr>
</table>

<details>
<summary>The Stage, panel by panel</summary>

<br />

| Area                              | What it does                                                                                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Navigator** <kbd>⌘0</kbd>       | Every simulator on the Mac, grouped by runtime and searchable, with Boot & stream, Shut down, and a host-memory summary.                                                                                                                                       |
| **Stage and dock**                | The device at its real size, resizable, with animated rotation. The dock has Home, Rotate, Appearance, Software keyboard, Screenshot, Accessibility overlay, Reload JS bundle (React Native) and, on iPhone Duo, the fold (Closed, Book, Open).                |
| **Inspector** <kbd>⌥⌘0</kbd>      | **Device:** appearance, accessibility, scale, status bar, location, camera. **App:** URLs, push, keychain, permissions, documents, user defaults. **Capture:** screenshots, recording, stream quality. **Activity:** CPU, memory, threads, disk, stream stats. |
| **Console** <kbd>⌘J</kbd>         | **Logs** (`log stream` with search and filters), **Input** event log, **Accessibility** tree with overlay, **Web Inspector** pages opened in Chrome DevTools.                                                                                                  |
| **Wall**                          | Every running simulator side by side, sized by device family. Click a tile to focus it.                                                                                                                                                                        |
| **Command palette** <kbd>⌘K</kbd> | Simulators, device actions, capture, panels, theme (Auto, Light, Dark) and sharing.                                                                                                                                                                            |

Shortcuts: <kbd>⌘S</kbd> screenshot, <kbd>⇧⌘A</kbd> appearance, <kbd>⇧⌘H</kbd> Home, <kbd>⌥⌘K</kbd> software keyboard. While the simulator has focus, the keyboard and <kbd>⌘C</kbd> <kbd>⌘X</kbd> <kbd>⌘V</kbd> go to the device.

**Phone preview.** The phone link is tied to one simulator and works until the server stops. By default only the phone page is reachable over the LAN; the desktop controls stay on loopback. `--host 127.0.0.1` turns LAN access off. Binding an explicit routable `--host` also exposes the desktop UI, so do that only on a network you trust or behind a tunnel you control.

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

Pass `-d` whenever more than one simulator is running; without it, a command uses the first running helper or the booted simulator.

<details>
<summary>Server options</summary>

<br />

```
headless-serve-sim [options] [devices...]
```

Leave out `devices` to choose in the browser. Give devices by name or UDID (see `xcrun simctl list devices`).

| Option                | Description                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `-p, --port <port>`   | Starting port. The preview defaults to 3200 and scans upward if busy, unless `-p` was given. Stream helpers start at 3100.  |
| `--host <addr>`       | The interface to bind. The default `0.0.0.0` exposes only the phone viewer on the LAN.                                      |
| `--detach`            | Start the stream helper(s) in the background, print their JSON state, and exit. Needs a device.                             |
| `--attach-only`       | With `--detach`, attach only to an already-booted simulator; never boot one.                                                |
| `--no-preview`        | Run the stream helper in the foreground with no web UI. Needs a device.                                                     |
| `--headed`            | Also open the simulator GUI: Simulator.app, or DeviceHub.app on Xcode 27+.                                                  |
| `--panes <list>`      | Panels to open on load: `none`, or a comma-separated list of `devices`, `inspector`, `devtools`, `logs` and `metrics`.      |
| `--theme light\|dark` | Set the simulator appearance before opening. Needs a device.                                                                |
| `--codec auto\|mjpeg` | `auto` uses H.264 when the browser can decode it; `mjpeg` forces software JPEG, which suits VMs without a hardware encoder. |
| `-q, --quiet`         | Print JSON only.                                                                                                            |
| `-l, --list [device]` | Print the running streams as JSON.                                                                                          |
| `-k, --kill [device]` | Stop one device's helper. With no device, stop every helper on this Mac.                                                    |

</details>

<details>
<summary>All commands</summary>

<br />

Device commands (`screenshot`, `ui`, `status-bar`, `permissions`, `defaults`, `app-actions`, `document`, `motion`, `camera`) accept `-d, --device <udid|name>`. Stream-input commands (`tap`, `gesture`, `button`, `type`, `rotate`, `ca-debug`, `memory-warning`) need `-d <udid>` and don't resolve names. `events` takes `-p <preview-port>` instead.

| Command                                                                                                         | What it does                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tap <x> <y>`                                                                                                   | Tap at normalized `0..1` screen coordinates.                                                                                                                           |
| `gesture '<json>'`                                                                                              | Send a raw touch event, e.g. `'{"type":"begin","x":0.5,"y":0.5}'`, then `move` and `end`.                                                                              |
| `button [name]`                                                                                                 | Press `home` (default), `swipe_home`, `app_switcher`, `lock`, `side_button`, `siri`, `volume_up` or `volume_down`.                                                     |
| `type [text...]`                                                                                                | Type text, or read it with `--stdin` or `--file <path>`. US keyboard layout.                                                                                           |
| `rotate <orientation>`                                                                                          | `portrait`, `portrait_upside_down`, `landscape_left` or `landscape_right`.                                                                                             |
| `screenshot [path]`                                                                                             | Save a screenshot. `--type png\|jpeg\|tiff\|bmp`, `--display <id\|internal\|external>`, `--mask ignored\|alpha\|black`.                                                |
| `ui [status] [--json]`<br>`ui <option> [value]`                                                                 | Read or change `appearance`, `liquid-glass`, `color-filter`, `text-size`, `reduce-motion`, `increase-contrast`, `show-borders`, `reduce-transparency` and `voiceover`. |
| `status-bar override [flags]`<br>`status-bar clear`                                                             | Override the time, carrier, network, Wi-Fi, cellular and battery indicators, or clear them.                                                                            |
| `permissions grant\|revoke\|reset\|list`                                                                        | Manage privacy permissions per bundle ID: camera, photos, location, notifications, contacts and more.                                                                  |
| `app-actions open-url <url>`<br>`app-actions push <bundle-id> --payload <json>`<br>`app-actions keychain-reset` | Open a URL or universal link, deliver a push notification, or reset the keychain.                                                                                      |
| `defaults read\|write\|delete <domain> [key]`                                                                   | Inspect and edit an app's or suite's user defaults.                                                                                                                    |
| `document import <file...> [--into <dir>]`                                                                      | Copy files into the Files app under On My iPhone/iPad.                                                                                                                 |
| `camera <bundle-id> [--file <path> \| --webcam [name]]`                                                         | Launch an app with a synthetic camera feed. `camera switch`, `camera mirror` and `camera status` change it live.                                                       |
| `motion [status \| angle <0..180> \| orientation <name>]`                                                       | Set the foldable hinge angle and the physical orientation (iPhone Duo).                                                                                                |
| `ca-debug <flag> <on\|off>`                                                                                     | Toggle the `blended`, `copies`, `misaligned`, `offscreen` and `slow-animations` CoreAnimation debug flags.                                                             |
| `memory-warning`                                                                                                | Simulate a memory warning.                                                                                                                                             |
| `events [-p port] [-f] [-n N] [--json]`                                                                         | Print or follow the preview server's input event log.                                                                                                                  |

Run `permissions`, `status-bar`, `defaults`, `app-actions` or `document` with no arguments for full usage. `ui` and `motion` print the current status with no arguments; `ui`, `motion`, `camera` and `events` take `--help`.

</details>

## Agents

This repository is a Claude Code plugin marketplace. Install the plugin to give Claude the `headless-serve-sim` skill:

```text
/plugin marketplace add vvisionnn/headless-serve-sim
/plugin install headless-serve-sim@headless-serve-sim
```

The [skill](https://github.com/vvisionnn/headless-serve-sim/tree/main/skills/headless-serve-sim) follows the open Agent Skills format, so other agents can use it too: copy the folder into the agent's skills directory.

<details>
<summary>Recipes for reliable automation</summary>

<br />

- **Pin the device.** Pass `-d <udid>` on every call. Give each parallel agent its own simulator, for example one per git worktree.
- **Discover, don't guess.** Each helper writes `$TMPDIR/headless-serve-sim/server-<udid>.json` with `pid`, `port`, `url`, `streamUrl` and `wsUrl`, and `headless-serve-sim --list <udid>` prints it. Helper ports start at 3100 and increase per device, so never hard-code them.
- **Pick the preview port.** Give each preview its own `-p`. In a script, run the server in the background and wait for its `Local:` line.
- **Read the screen.** `<helper url>/ax` returns the accessibility tree, `/config` the screen size and orientation, `/foreground` the frontmost app's bundle ID. `headless-serve-sim screenshot` captures pixels.
- **Act.** Use `tap` for taps: each `gesture` call opens its own connection, so a separate begin and end can read as a long-press. Swipes need at least one `move`. After `rotate`, poll `/config` for the new orientation. `ca-debug slow-animations on` stretches transitions for capture.
- **Clean up only what you started.** `headless-serve-sim --kill <udid>`, or SIGTERM the `pid` from your state file. A bare `--kill` stops every helper on the Mac, including other agents'. Simulators stay booted on exit; `xcrun simctl shutdown <udid>` when you're done.
- **Trace.** `DEBUG=headless-serve-sim*` traces the CLI, helper, state and middleware.

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

The CLI and preview server are TypeScript, compiled with `bun build --compile` into one executable that embeds the Swift helper. The helper captures frames from SimulatorKit without screen recording, encodes them with VideoToolbox, and injects input the way Simulator.app does, linking against your active Xcode's SimulatorKit. The preview proxies every helper, so a remote viewer only needs port 3200.

<details>
<summary>Embedding the preview in your own dev server</summary>

<br />

The preview UI is also a Connect-style middleware (`simMiddleware`, from `packages/headless-serve-sim/src/middleware.ts`), mounted at `/.sim` by default. It isn't published as a package: build from source and import `packages/headless-serve-sim/dist/middleware.js`. Keep the `headless-serve-sim` CLI on your `PATH`, or pass `serveSimBin`, so the in-page tools can run. Most people should run the standalone server instead.

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

| Path                                 | What lives there                                  |
| ------------------------------------ | ------------------------------------------------- |
| `packages/headless-serve-sim`        | The CLI, the preview server and the Stage web UI. |
| `packages/headless-serve-sim-binary` | The Swift stream helper and the native tools.     |
| `packages/headless-serve-sim-client` | The streaming client library.                     |
| `design/`                            | The Stage design reference and the promo film.    |
| `skills/headless-serve-sim`          | The agent skill.                                  |

The build writes the compiled binary to `packages/headless-serve-sim/dist/headless-serve-sim`, plus `dist/headless-serve-sim.js` for Node 18 or newer. Conventions, including end-to-end testing with `agent-browser` and the CLI, are in [`AGENTS.md`](https://github.com/vvisionnn/headless-serve-sim/blob/main/AGENTS.md). Pushing a `vX.Y.Z` tag builds, tests and publishes `headless-serve-sim-darwin-arm64.tar.gz` as a GitHub Release, where mise picks it up.

The film at the top is code too: `mise run promo` renders it on any machine, and `mise run promo:preview` gives a scrubbable player. See [`design/promo`](https://github.com/vvisionnn/headless-serve-sim/tree/main/design/promo).

<details>
<summary>Stream benchmark</summary>

<br />

Run it against a dedicated, already-running helper. It needs `ffmpeg`.

```sh
bun run --cwd packages/headless-serve-sim benchmark:stream-quality -- \
  --url http://127.0.0.1:3100 --udid <dedicated-simulator-udid> \
  --format avcc --output /tmp/stream-quality
```

It plays a deterministic 60 Hz motion pattern on the device and records the public stream. It fails on a torn or undecodable frame, an average below 55 fps, any one-second window below 50 fps, or bandwidth above 8 Mbps. `--format mjpeg` measures the fallback.

</details>

## License

[Apache-2.0](https://github.com/vvisionnn/headless-serve-sim/blob/main/LICENSE). headless-serve-sim began as a fork of [EvanBacon/serve-sim](https://github.com/EvanBacon/serve-sim) by Evan Bacon — thank you for the original idea and foundation. It was renamed so both tools can be installed side by side, and is now maintained independently. Report issues at [vvisionnn/headless-serve-sim](https://github.com/vvisionnn/headless-serve-sim/issues).

---
name: headless-serve-sim
description: Boot, stream, see and drive Apple simulators (iPhone, foldable iPhone Duo, iPad, Apple Watch) headlessly with the headless-serve-sim CLI, with no Simulator.app window. Use it to tap, swipe, pinch, type, press hardware buttons, rotate or fold a simulator, and to read its accessibility tree to find UI elements. It also takes screenshots, verifies UI in a running app, and injects a fake camera feed. It grants or resets privacy permissions (including push notifications), overrides the status bar, and sets dark mode, text size, VoiceOver and other accessibility options. It reads and writes user defaults, opens deep links, sends test pushes and toggles CoreAnimation debug overlays. Use it to stream a simulator to a browser or phone for a human, or to run several simulators and parallel agents on one Mac. Trigger on "simulator", "iOS sim", "tap the button", "screenshot the app", "preview the app", "headless simulator" or "serve-sim".
license: Apache-2.0
---

# headless-serve-sim

[headless-serve-sim](https://github.com/vvisionnn/headless-serve-sim) is a local preview server and CLI for Apple simulators. It boots a simulator if needed and captures its screen through Apple's private SimulatorKit framework. It streams the screen as hardware H.264, with MJPEG as a fallback, and accepts touch, keyboard and hardware-button input over a WebSocket. It runs headless by default: no Simulator.app window is needed for streaming, input, accessibility, rotation or screenshots. A browser UI is included for the humans watching. Agents drive everything else from the command line.

This skill covers the CLI surface, the mental model, which command to reach for, and the gotchas that cost time. It is project-agnostic: it works with any app (SwiftUI, UIKit, React Native, Flutter, web views) in any repository.

## Prerequisites

Check these on the first use in a session. If one is missing, tell the user what to install and stop.

| Requirement | Check | Notes |
|---|---|---|
| Apple Silicon Mac | `arch -arm64 /usr/bin/true` | Release builds are arm64 only. |
| Full Xcode 26 or newer, with at least one simulator runtime | `xcrun simctl list runtimes` | The command line tools alone are not enough: the helper loads SimulatorKit from the active Xcode (`xcode-select -p`). Xcode 27 (DeviceHub) is supported. |
| `headless-serve-sim` on `PATH` | `command -v headless-serve-sim` | Install with mise (see below). |
| macOS 14+ | `sw_vers -productVersion` | The native helpers target macOS 14 or newer. Xcode 26 already requires a newer macOS, so this is normally satisfied. |
| Node.js 18+ | `node --version` | The CLI is a self-contained binary and does not need it, but this skill's helper scripts do, and `scripts/check-prereqs.sh` fails without it. |

`scripts/check-prereqs.sh` runs these checks. If it exits non-zero, show its message to the user.

### Installing the CLI

headless-serve-sim is distributed as GitHub release assets. It is **not on npm**, so never suggest `npx`, `bunx` or `npm install`. Install it with [mise](https://mise.jdx.dev):

```sh
mise use -g github:vvisionnn/headless-serve-sim       # global
```

To pin it for one repository, add it to that repository's `mise.toml`:

```toml
[tools]
"github:vvisionnn/headless-serve-sim" = "latest"   # or a pinned version, e.g. "0.0.42"
```

Without mise, download `headless-serve-sim-darwin-arm64.tar.gz` from the [latest release](https://github.com/vvisionnn/headless-serve-sim/releases/latest) and extract it. Keep every folder from the archive (`simcam/`, `simax/`, `simmotion/` and `native-sources/`) next to the `headless-serve-sim` binary, because the camera, accessibility-settings and motion features load them from there.

## Mental model

```text
 Simulator (booted by the CLI; no window)
     │  SimulatorKit IOSurface frames          ▲ HID touch / buttons / keys
     ▼                                         │
 helper (headless-serve-sim-bin), one per device, 127.0.0.1:3100+
     /stream.avcc (H.264)  /stream.mjpeg  /ws (input)  /config  /ax  /foreground
     │
     ├── state file: $TMPDIR/headless-serve-sim/server-<UDID>.json
     │        {pid, port, device, url, streamUrl, wsUrl, headed}
     │
     ├── CLI subcommands (tap, gesture, button, type, rotate, ca-debug, memory-warning)
     │        find the helper through the state file and talk to /ws
     │
     └── preview server (headless-serve-sim [device]), :3200+
              browser UI for humans, proxies the helper at /helper/<UDID>/
```

- **Helper.** There is one helper process per simulator, each on its own port starting at 3100. `--detach` starts one and exits, leaving it running in the background. The helper keeps running until `--kill`; it does not stop when a preview server exits.
- **Preview.** `headless-serve-sim [device]` runs a foreground web server, from port 3200, for humans to watch and interact with. Agents rarely need it, except to hand a link to a person.
- **Two kinds of subcommands.**
  - **Stream input commands need a running helper:** `tap`, `gesture`, `button`, `type`, `rotate`, `ca-debug` and `memory-warning`. They fail with "No headless-serve-sim server running" if there is none.
  - **Device commands work on any booted simulator:** `screenshot`, `permissions`, `ui`, `status-bar`, `defaults`, `app-actions`, `document`, `motion` and `camera`. They wrap `simctl` or run small tools inside the simulator.
- **`-d` picks the target.** Device commands accept `-d <UDID|name>`. Stream input commands accept only `-d <UDID>`; a name is not resolved and the command fails with "No headless-serve-sim server running".
  - Without it, stream input commands take the *first live state file*, and device commands take the *first booted simulator*. Both are guesses when more than one simulator is running.
  - For device commands, names are matched exactly and case-insensitively against every installed simulator. A UDID is unambiguous.
  - **Pass `-d <UDID>` on every call in scripts.**
- **Coordinates are normalized 0..1**, measured on the screen as it currently looks (the screenshot's orientation), with (0,0) top-left. After a rotation you still think in what-you-see coordinates; the helper maps them onto the panel.
- **Headless is the default.** `--headed` also opens Simulator.app (DeviceHub.app on Xcode 27+). headless-serve-sim never shuts a simulator down on exit; that is your job.

## Starting and stopping

| Goal | Command | Output and notes |
|---|---|---|
| Start a helper for automation | `headless-serve-sim --detach "<UDID or name>"` | Boots the device if needed, waits for boot, prints `{url, streamUrl, wsUrl, port, device}` and exits. With several devices it prints `{devices:[…]}`. Idempotent: if a helper already runs for the device, it prints that helper's state. A device argument is required. |
| Attach without booting | `headless-serve-sim --detach --attach-only "<UDID>"` | Fails if the device is not already booted. |
| Preview for a human | `headless-serve-sim "<UDID or name>"` | Foreground server. Prints `- Local:   http://localhost:3200`, or the next free port. With no device, it opens a simulator picker. Add `-p <port>` for a fixed port; this fails instead of scanning if the port is busy. |
| Preview options | `--headed`, `--panes devices,inspector,logs,devtools,metrics\|none`, `--theme light\|dark`, `--codec mjpeg`, `--host <addr>` | `--codec mjpeg` is for VMs that cannot encode H.264. `--host 127.0.0.1` keeps everything local. |
| What is running | `headless-serve-sim --list [UDID]` | Always prints JSON: `{running:false}`, a single `{running:true, url, streamUrl, wsUrl, port, device, pid}`, or `{running:true, streams:[…]}`. |
| Stop one helper | `headless-serve-sim --kill "<UDID>"` | Stops that device's helper and removes its state file. Does not shut the simulator down. |
| Stop every helper | `headless-serve-sim --kill` | Affects every agent on the machine. Avoid it when anything else may be using the Mac. |

In the JSON, `url` is the **helper** base URL (`http://127.0.0.1:3100`), not the preview UI, and `streamUrl` is its MJPEG endpoint. Read ports from this output or from the state file; never assume 3100 or 3200.

## Which command do I use?

| I want to… | Use | Reference |
|---|---|---|
| Tap something | `headless-serve-sim tap <x> <y> -d <UDID>` | [gestures.md](references/gestures.md) |
| Tap an element by its label | `curl <helper>/ax`, compute the centre, then `tap` | [workflows.md](references/workflows.md#1-tap-an-element-by-accessibility-label) |
| Swipe, scroll, drag or pull down | `gesture` (begin → move… → end), or one WebSocket for precise timing | [gestures.md](references/gestures.md) |
| Pinch or zoom | A WebSocket client sending multi-touch frames. The CLI cannot pinch. | [gestures.md](references/gestures.md#pinch-two-fingers) |
| Type text | `headless-serve-sim type "hello" -d <UDID>`, or pass `--stdin` or `--file` | US keyboard ASCII only. Focus the field first. |
| Home, lock, Siri, volume | `headless-serve-sim button <name>` | [buttons-rotation.md](references/buttons-rotation.md) |
| Rotate | `headless-serve-sim rotate landscape_left`, then confirm with `/config` | [buttons-rotation.md](references/buttons-rotation.md) |
| Fold the iPhone Duo or set physical pose | `headless-serve-sim motion angle 130`, or `motion orientation faceUp` | [device-settings.md](references/device-settings.md#motion-foldables-and-physical-orientation) |
| See the screen | `headless-serve-sim screenshot /tmp/shot.png -d <UDID>`, then read the image | [device-settings.md](references/device-settings.md#screenshots-and-recordings) |
| Record video | `xcrun simctl io <UDID> recordVideo out.mp4`, or the preview's Capture tab | [device-settings.md](references/device-settings.md#screenshots-and-recordings) |
| Check which app is in front | `curl <helper>/foreground` | [endpoints.md](references/endpoints.md) |
| Open a deep link or URL | `headless-serve-sim app-actions open-url <url>` (or `xcrun simctl openurl <UDID> <url>`) | [device-settings.md](references/device-settings.md#app-actions-urls-push-keychain) |
| Send a test push | `headless-serve-sim app-actions push <bundle-id> --payload '{"aps":{…}}'` | [device-settings.md](references/device-settings.md#app-actions-urls-push-keychain) |
| Grant or reset permissions | `headless-serve-sim permissions grant camera <bundle-id>` | [permissions.md](references/permissions.md) |
| Dark mode, text size, VoiceOver, reduce motion… | `headless-serve-sim ui appearance dark`, `ui text-size large`, … | [device-settings.md](references/device-settings.md#ui-settings-appearance-and-accessibility) |
| Clean status bar for screenshots | `headless-serve-sim status-bar override --time 9:41 --battery-level 100` | [device-settings.md](references/device-settings.md#status-bar) |
| Read or write app preferences | `headless-serve-sim defaults read <bundle-id>` | [device-settings.md](references/device-settings.md#user-defaults) |
| Put files in the Files app | `headless-serve-sim document import a.pdf --into Inbox` | [device-settings.md](references/device-settings.md#files-app-documents) |
| Fake the camera | `headless-serve-sim camera <bundle-id> --file img.png` | [camera.md](references/camera.md) |
| Find rendering problems | `headless-serve-sim ca-debug blended on` | [ca-debug.md](references/ca-debug.md) |
| Simulate a memory warning | `headless-serve-sim memory-warning` | |
| Read device logs | `xcrun simctl spawn <UDID> log stream --style compact --predicate '…'` | The preview's Console has a Logs view for humans. |
| See what a human did in the preview | `headless-serve-sim events -p <preview-port> [-f] [--json]` | It records input sent from the browser, not CLI input. |
| Show the simulator to the user | Run the preview in the background and give them the URL | [workflows.md](references/workflows.md#7-show-the-simulator-to-a-human) |
| Run several simulators or agents in parallel | One simulator, helper and preview port per agent, always with `-d <UDID>` | [parallel-agents.md](references/parallel-agents.md) |

Commands that print usage when run with no arguments: `permissions`, `document`, `status-bar`, `defaults` and `app-actions`. These reject `--help`. `ui` and `motion` print their current status with no arguments and accept `--help`. `screenshot` with no arguments captures to `./screenshot-<timestamp>.png`.

## Critical gotcha: `tap` vs `gesture`

`tap` sends `begin` and `end` over **one** WebSocket, about 40 ms apart, which is a clean tap.

Each `gesture` call opens its **own** WebSocket, sends one event and closes it. Two separate `gesture` calls for `begin` and `end` land more than 100 ms apart, and iOS reads that as a **long press**.

- Use `tap` for every single tap.
- Use `gesture` only for swipes and drags, and include at least one `move` between `begin` and `end`.
- When timing matters (flicks, fast scrolls, pinches), keep every event on one WebSocket, as shown in [gestures.md](references/gestures.md).

## Seeing the screen

Agents verify with **screenshots and the accessibility tree**, not the video stream:

- `headless-serve-sim screenshot <path> -d <UDID>` writes a PNG at full device resolution. Read the image file to look at it. `xcrun simctl io <UDID> screenshot <path>` is equivalent.
- `curl -s <helper>/ax` returns the accessibility tree of the foreground app as nested JSON, with `type`, `AXLabel`, `AXValue`, `AXUniqueId`, `frame` and `children`. Frames are in **points**. Normalize by the root element's `frame` (`.[0].frame.width/height`), not by `/config`, whose sizes are in pixels.
- `curl -s <helper>/foreground` returns `{bundleId, pid}`.

If an accessibility lookup finds no match, report "not found". Do not tap a guessed coordinate.

## Showing the simulator to a human

The browser preview is for people. To give the user a live view, start the preview server in the background, wait for its `- Local:` line, and share that URL (default `http://localhost:3200`). Then use a preview or browser tool if your host provides one, and always print the URL as a fallback. The page's toolbar has a QR code that opens the stream on a phone on the same Wi-Fi. Full recipe: [workflows.md](references/workflows.md#7-show-the-simulator-to-a-human).

## Cleanup

When you finish, unless the user wants things left running:

```sh
headless-serve-sim camera --stop-webcam -d "$UDID"    # if you started a camera feed
headless-serve-sim status-bar clear -d "$UDID"         # if you overrode it
headless-serve-sim --kill "$UDID"                      # your helper only
kill <preview-pid>                                     # if you started a preview server
xcrun simctl shutdown "$UDID"                          # if you booted the simulator
```

Only stop what you started. A bare `--kill` stops every helper on the Mac, including other agents' helpers.

## Anti-patterns

- **Installing through npm.** Do not use `npx`, `bunx` or `npm i`. Use mise or the release tarball.
- **Pixel coordinates.** Always use normalized 0..1 values.
- **Using `gesture` for a tap.** Use `tap`.
- **Omitting `-d` when more than one simulator is booted.** The command lands on whichever device the CLI finds first.
- **Using `xcrun simctl … booted` when several simulators are booted.** Pass the UDID.
- **Assuming ports.** Read `url` and `wsUrl` from `--detach` or `--list` output, or from `$TMPDIR/headless-serve-sim/server-<UDID>.json`.
- **Expecting `--detach` to give a browser URL.** `--detach` starts only the helper. The UI is the preview server.
- **Inventing button names.** The valid names are `home`, `swipe_home`, `app_switcher`, `lock`, `siri`, `side_button`, `volume_up` and `volume_down`. An unknown name is silently ignored: the helper only logs it.
- **Assuming a rotation landed.** Poll `<helper>/config` until `interfaceOrientation` changes. Apps that lock orientation never rotate.
- **Leaving camera feeds, status-bar overrides or helpers behind.**

## Reference index

- [references/gestures.md](references/gestures.md): touch JSON, edges, swipe and drag recipes, a one-socket WebSocket client, and pinch.
- [references/buttons-rotation.md](references/buttons-rotation.md): the eight buttons, the four orientations, and verifying rotation.
- [references/device-settings.md](references/device-settings.md): screenshots and recording, `ui`, `status-bar`, `defaults`, `app-actions`, `document` and `motion`.
- [references/permissions.md](references/permissions.md): granting, revoking and resetting privacy permissions, including push notifications.
- [references/camera.md](references/camera.md): camera injection from a placeholder, an image or video, or a webcam; mirroring and hot-swapping.
- [references/ca-debug.md](references/ca-debug.md): the CoreAnimation debug overlays.
- [references/endpoints.md](references/endpoints.md): the helper and preview HTTP/WebSocket surface and the state file.
- [references/parallel-agents.md](references/parallel-agents.md): several simulators, parallel agents, ports and isolation.
- [references/workflows.md](references/workflows.md): end-to-end recipes covering AX taps, deep links, camera, rendering debug, clean slate and human preview.

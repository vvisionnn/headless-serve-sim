# HTTP and WebSocket endpoints reference

Most agents should use the CLI. Use these endpoints to read state cheaply (`/ax`, `/config`, `/foreground`) or to stream input from a long-running process over one WebSocket.

## Contents

- Discovering the live URLs (state files)
- Helper endpoints (per device, port 3100+)
- WebSocket input frames
- Preview server endpoints (port 3200+)
- Security notes

## Discovering the live URLs

Each running helper has a state file at `$TMPDIR/headless-serve-sim/server-<UDID>.json`:

```json
{
  "pid": 12345,
  "port": 3100,
  "device": "<UDID>",
  "url": "http://127.0.0.1:3100",
  "streamUrl": "http://127.0.0.1:3100/stream.mjpeg",
  "wsUrl": "ws://127.0.0.1:3100/ws",
  "headed": false
}
```

Read the file for the device you care about. Do not glob the directory and pick the first entry; other agents may own those files.

```sh
HELPER=$(jq -r .url "$TMPDIR/headless-serve-sim/server-$UDID.json")
```

You can also ask the CLI. These commands always print JSON:

| Command | Output |
|---|---|
| `headless-serve-sim --list "$UDID"` | `{running:true, url, streamUrl, wsUrl, port, device, pid}` or `{running:false, device}` |
| `headless-serve-sim --list` | `{running:false}`, a single object as above, or `{running:true, streams:[…]}` |
| `headless-serve-sim --detach "$UDID"` | `{url, streamUrl, wsUrl, port, device}`. With several devices it prints `{devices:[…]}`. It starts the helper if needed and is idempotent. |

Ports are not fixed. Helpers take the first free port from 3100 upward, skipping ports that other state files claim. Always read the port; never hard-code it.

## Helper endpoints

The helper is the per-device Swift process (`headless-serve-sim-bin`). By default it listens on `127.0.0.1` only. Every response carries `Access-Control-Allow-Origin: *`.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/ax` | The accessibility tree of the foreground app: `[root]`, where each node has `type`, `AXLabel`, `AXValue`, `AXUniqueId`, `role_description`, `enabled`, `frame {x,y,width,height}` (in points) and `children`. The root's `frame` is the whole screen. `?timeoutMs=N` bounds the walk (a partial tree is marked `truncated: true`). `?grid=0` skips the slower hit-test discovery pass. Returns 503 `{error:"ax_unavailable"}` when there is no tree. |
| `GET` | `/foreground` | `{bundleId, pid}` of the frontmost app. Returns 503 when it cannot be resolved. |
| `GET` | `/config` | `{width, height, orientation, interfaceOrientation, displayId?, activeDisplay?, …}`. Sizes are in **pixels**. |
| `GET` | `/health` | `{status:"ok"}`, for liveness checks. |
| `GET` | `/metrics` | CPU, memory, threads and disk counters for the foreground app. |
| `GET` | `/stream-metrics` | Capture and encoder counters. |
| `GET` | `/stream.avcc` | H.264 as a length-prefixed AVCC byte stream. This is the default video stream; browsers decode it with WebCodecs. |
| `GET` | `/stream.mjpeg` | MJPEG, `multipart/x-mixed-replace`, usable in an `<img>` tag. `?raw=1` returns the same JPEGs as a plain byte stream for `fetch()` readers. |
| `GET` (upgrade) | `/ws` | Binary input WebSocket (see below). |

To see the screen, use `headless-serve-sim screenshot`, not a frame from the stream.

## WebSocket input frames

Every message is one binary frame: a type byte, followed by a UTF-8 JSON body (or no body).

| Byte | Body | Purpose |
|---|---|---|
| `0x03` | `{type:"begin"\|"move"\|"end", x, y, edge?, space?}` | Single touch. Use `space:"interface"` for coordinates in the current orientation, as the CLI does. |
| `0x04` | `{button}`, or `{usagePage, usage, phase?}` | Hardware button. See [buttons-rotation.md](buttons-rotation.md). |
| `0x05` | `{type, x1, y1, x2, y2, space?}` | Two-finger touch (pinch, rotate). |
| `0x06` | `{type:"down"\|"up", usage}` | Keyboard key, as a USB HID usage on page 0x07. `headless-serve-sim type` is simpler. |
| `0x07` | `{orientation}` | Rotate: `portrait`, `portrait_upside_down`, `landscape_left` or `landscape_right`. |
| `0x08` | `{option, enabled}` | CoreAnimation debug flag. See [ca-debug.md](ca-debug.md). |
| `0x09` | none | Memory warning. |
| `0x0A` | `{delta}` | Rotate the Apple Watch Digital Crown. |
| `0x0D` | `{dx, dy, x?, y?}` | Wheel scroll, emulated as a drag. |
| `0x0E` | none | Toggle the software keyboard. |

On connect, the helper pushes a screen-config frame (tag `0x82` plus JSON) and sends another whenever the screen changes. Input-only clients can ignore these frames. For a complete example client, see [gestures.md](gestures.md#one-websocket-for-precise-gestures).

## Preview server endpoints

`headless-serve-sim [device]` serves the browser UI and its API at the root of its port (3200+). The page and these routes are mainly for the UI itself; agents seldom need them.

| Path | Purpose |
|---|---|
| `/` | The preview page. |
| `/api`, `/api/events` | Current preview state (JSON), and the same state as an SSE stream. |
| `/helper/<UDID>/…` | A proxy to that device's helper (for example `/helper/<UDID>/ax` or `/helper/<UDID>/ws`), so the page only needs the preview port. |
| `/ax`, `/appstate` | SSE streams of accessibility snapshots and foreground-app changes. |
| `/logs` | SSE simulator log stream. Needs the per-process token. |
| `/events/log`, `/events/log/stream` | The input event log (what was sent from the page). `headless-serve-sim events` reads it. |
| `/grid/api`, `/grid/api/start`, `/grid/api/attach`, `/grid/api/shutdown`, `/grid/api/memory` | The Wall and Navigator: list simulators, boot and stream one, attach to one, shut one down, and report host memory. |
| `/exec`, `/exec-ws` | Run host commands for the page. Needs a bearer token. |
| `/devtools…` | Web Inspector bridge for web views in apps. |
| `/phone/<token>/<UDID>` | The phone viewer behind the QR code. |

The same routes are available as Connect-style middleware (`simMiddleware`, mounted at `/.sim` by default) when you build headless-serve-sim from source. The middleware is not part of the release tarball and is not published to any package registry.

## Security notes

- Helpers bind to `127.0.0.1` by default and have no authentication. Do not expose a helper port directly; share the preview instead.
- With the default `--host 0.0.0.0`, the preview's phone viewer is reachable on the LAN through the unguessable `/phone/<token>/…` link. Every other route, including the desktop UI, the helper proxy and `/exec`, answers loopback requests only. Passing an explicit routable `--host` also exposes the desktop UI and the token-gated `/exec` route, so only do that on a trusted network. Use `--host 127.0.0.1` to keep everything local.
- The `/exec` token is random for each server process and is handed to the page. It is not written to the state file.

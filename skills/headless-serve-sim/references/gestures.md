# Gestures reference

## Contents

- Coordinate system
- `tap`
- `gesture` JSON shape
- Edge values
- Recipes: swipe, scroll, pull down, swipe back
- One WebSocket for precise gestures
- Pinch (two fingers)
- Why `tap` beats two `gesture` calls

## Coordinate system

All coordinates are normalized floats in `[0, 1]`:

- `(0, 0)` is the top-left of the screen, `(1, 1)` is the bottom-right, and `(0.5, 0.5)` is the centre.
- They describe the screen **as it currently looks**, which is the orientation of a screenshot. After `rotate landscape_left` you keep using what-you-see coordinates. The CLI tags every touch with `"space":"interface"`, and the helper maps it onto the raw panel.

To convert from accessibility frames, which are in points, divide by the size of the AX root frame. To convert from screenshot pixels, divide by the image size. See [workflows.md](workflows.md#1-tap-an-element-by-accessibility-label).

## `tap`

```sh
headless-serve-sim tap 0.5 0.9 -d "$UDID"
```

This sends `begin` and `end` on one WebSocket about 40 ms apart, which iOS reads as a real tap. Use it for every single tap.

## `gesture` JSON shape

```sh
headless-serve-sim gesture '{"type":"begin","x":0.5,"y":0.5}' -d "$UDID"
```

| Field | Type | Required | Values |
|---|---|---|---|
| `type` | string | yes | `"begin"`, `"move"` or `"end"` |
| `x`, `y` | number | yes | `0.0` to `1.0` |
| `edge` | integer | no | `0` to `4`, see below |

Each `gesture` call opens a WebSocket, sends **one** event, waits about 50 ms and closes the socket. A complete touch is `begin`, then one or more `move` events, then `end`, sent as separate calls in order. The time between calls (around 100 to 200 ms, mostly process start-up) is part of the gesture, so CLI swipes are slow, deliberate drags rather than flicks.

The CLI `gesture` command accepts single-touch JSON only. Multi-touch JSON (`x1`/`y1`/`x2`/`y2`) sent through it is dropped by the helper. For a pinch, see [Pinch (two fingers)](#pinch-two-fingers).

## Edge values

`edge` marks a touch as a system edge gesture.

| Value | Edge | Typical effect |
|---|---|---|
| `0` | none | A regular touch. This is the default, so you can leave `edge` out. |
| `1` | left | Back gesture in navigation stacks |
| `2` | top | Notification Center (left side) or Control Center (top-right) |
| `3` | bottom | Go home or app switcher on Face ID devices |
| `4` | right | Right-edge swipe |

For going home, `headless-serve-sim button swipe_home` already performs the correct bottom-edge swipe.

## Recipes

Always include at least one `move`. A `begin` followed directly by `end` is a press, not a swipe.

### Scroll content up (finger moves up)

```sh
D=(-d "$UDID")
headless-serve-sim gesture '{"type":"begin","x":0.5,"y":0.75}' "${D[@]}"
headless-serve-sim gesture '{"type":"move","x":0.5,"y":0.5}'   "${D[@]}"
headless-serve-sim gesture '{"type":"move","x":0.5,"y":0.25}'  "${D[@]}"
headless-serve-sim gesture '{"type":"end","x":0.5,"y":0.25}'   "${D[@]}"
```

The delay before the first `move` makes iOS treat the touch as a held press that then drags. Scroll views still scroll, but a cell under the finger can briefly highlight, and a list with long-press actions may open its context menu. When that matters, use one WebSocket (below).

### Pull down Notification Center (top edge)

```sh
headless-serve-sim gesture '{"type":"begin","x":0.3,"y":0.01,"edge":2}' -d "$UDID"
headless-serve-sim gesture '{"type":"move","x":0.3,"y":0.4,"edge":2}'   -d "$UDID"
headless-serve-sim gesture '{"type":"end","x":0.3,"y":0.6,"edge":2}'    -d "$UDID"
```

### Swipe back from the left edge

```sh
headless-serve-sim gesture '{"type":"begin","x":0.01,"y":0.5,"edge":1}' -d "$UDID"
headless-serve-sim gesture '{"type":"move","x":0.5,"y":0.5,"edge":1}'   -d "$UDID"
headless-serve-sim gesture '{"type":"end","x":0.9,"y":0.5,"edge":1}'    -d "$UDID"
```

## One WebSocket for precise gestures

For flicks, fast scrolls, long precise drags or anything timing-sensitive, keep every event on **one** connection to the helper's `/ws`. Each message is a single binary frame: one type byte followed by UTF-8 JSON.

| Byte | Payload |
|---|---|
| `0x03` | single touch `{type, x, y, edge?, space?}` |
| `0x05` | two-finger touch `{type, x1, y1, x2, y2, space?}` |

Include `"space":"interface"` so the coordinates follow the current orientation, as the CLI does. Without it, coordinates are raw panel space.

Get the URL from the state file (`.wsUrl`) or from `headless-serve-sim --list "$UDID"`. The script below works with any runtime that has a global `WebSocket` (Node 22+, Bun, Deno) and has no dependencies:

```js
// swipe.mjs. Usage: node swipe.mjs ws://127.0.0.1:3100/ws
const ws = new WebSocket(process.argv[2]);
ws.binaryType = "arraybuffer";
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

const frame = (type, payload) => {
  const json = new TextEncoder().encode(JSON.stringify({ space: "interface", ...payload }));
  const msg = new Uint8Array(1 + json.length);
  msg[0] = type;
  msg.set(json, 1);
  ws.send(msg);
};
const touch = (type, x, y) => frame(0x03, { type, x, y });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fast upward flick: ~150 ms total
touch("begin", 0.5, 0.8);
for (let i = 1; i <= 8; i++) { await sleep(16); touch("move", 0.5, 0.8 - (0.6 * i) / 8); }
touch("end", 0.5, 0.2);

await sleep(50);
ws.close();
```

The helper also sends a JSON screen-config frame (tag `0x82`) when the socket connects. Input-only clients can ignore it.

## Pinch (two fingers)

Pinching needs the `0x05` multi-touch frame on one socket. Reuse the script above with:

```js
const pinch = (type, x1, y1, x2, y2) => frame(0x05, { type, x1, y1, x2, y2 });

// Zoom in: fingers move apart
pinch("begin", 0.45, 0.5, 0.55, 0.5);
for (let i = 1; i <= 10; i++) {
  await sleep(16);
  const d = 0.05 + (0.25 * i) / 10;
  pinch("move", 0.5 - d, 0.5, 0.5 + d, 0.5);
}
pinch("end", 0.2, 0.5, 0.8, 0.5);
```

Reverse the direction to zoom out. Rotate the two points around the centre for a two-finger rotation. Multi-touch has no `edge`.

## Why `tap` beats two `gesture` calls

iOS measures how long a finger stays down. `tap` holds for about 40 ms on one socket. Two `gesture` processes, one for `begin` and one for `end`, are separated by process start-up and a socket handshake (roughly 150 ms), which crosses the long-press threshold. There is never a reason to build a tap out of `gesture` calls.

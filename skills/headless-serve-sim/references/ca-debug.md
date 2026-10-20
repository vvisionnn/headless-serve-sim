# CoreAnimation debug flags reference

The `headless-serve-sim ca-debug <option> <on|off>` command toggles CoreAnimation render-debug overlays on the running simulator. These are the same flags Simulator.app exposes under **Debug → Color Blended Layers**, etc. Each maps to a private `-[SimDevice setCADebugOption:enabled:]` call, made by the stream helper. The command therefore needs a running helper (`headless-serve-sim --detach "$UDID"`) and accepts `-d <UDID>` (names are not resolved).

## Valid options and aliases

| Canonical option | Aliases accepted | What it shows |
|---|---|---|
| `debug_color_blended` | `blended` | Green = layer is opaque (good). Red = layer is blended (costs GPU). Use to find unnecessary transparency. |
| `debug_color_copies` | `copies`, `copied` | Highlights layers that triggered a CPU-side copy. Frequent copies kill frame rate. |
| `debug_color_misaligned` | `misaligned` | Magenta/yellow tints when a layer's pixels do not align to physical pixels. Indicates blurry text or images. |
| `debug_color_offscreen` | `offscreen` | Yellow tint when a layer is rendered off-screen (e.g., for masks, shadows, `cornerRadius` on non-opaque content). Off-screen passes are expensive. |
| `debug_slow_animations` | `slow-animations` | Slows all CoreAnimation animations by ~10×. Useful for catching jank, dropped frames, and choreography bugs. |

## On / off values

The CLI accepts any of these for the second argument, case-insensitive: `on`, `off`, `1`, `0`, `true`, `false`.

## Typical use

```sh
# Find blended layers in your app
headless-serve-sim ca-debug blended on -d "$UDID"
headless-serve-sim screenshot /tmp/blended.png -d "$UDID"
headless-serve-sim ca-debug blended off -d "$UDID"

# Slow animations ~10x to inspect a transition frame by frame
headless-serve-sim ca-debug slow-animations on -d "$UDID"
xcrun simctl io "$UDID" recordVideo /tmp/transition.mp4 &   # stop with: kill -INT $!
# ... trigger the transition ...
headless-serve-sim ca-debug slow-animations off -d "$UDID"
```

Toggle individually — combining `offscreen` and `blended` makes the screen unreadable.

## Notes

- Settings persist until the next simulator reboot or until you turn them off explicitly.
- The flags affect the simulator's rendering pipeline directly; performance numbers in Instruments will differ from a real device. Use these for **qualitative** debugging (find the problem), not quantitative measurement.
- These options correspond to the same flags real-device Xcode uses, so insights transfer.

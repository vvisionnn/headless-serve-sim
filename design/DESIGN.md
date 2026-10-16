# serve-sim — "Stage" design

Preview: `serve-sim-design.html` (self-contained; open from disk). Rebuild with
`bun run build.ts` (`--watch` to iterate). All data is mocked.

## Idea

The browser is a quiet room and the simulator is the only lit object in it.
Chrome is neutral Liquid Glass that floats over the stage. The interface has
no colour of its own: hue comes from the simulator screen, which lights the
stage around it ("screen light"), and from small status marks.

## Layout — one model for every surface

```
╭ Navigator ╮  [◧] iPhone 17 Pro ⌄          ● 0:12 Stop       [⊞ ▯ ⊟] [⌕ ⌘K] [◨]  ╭ Inspector ╮
│ Simulators │                                                                    │ Device App │
│ by runtime │                  ( screen light )                                  │ Capture    │
│ live dots  │                 ▕  real bezel  ▏                                   │ Activity   │
│            │                  ⌂ ⟲ ☀ │ ◉ ⏺ │ ♿ ⌨ │ ↻   ← device dock          │            │
│ 3 of 5 ▮▮▮ │  ╭ Console: Logs · Input · Accessibility · Web Inspector ───────╮ │            │
╰────────────╯  ╰──────────────────────────────────────────────────────────────╯ ╰────────────╯
```

- **Navigator** (left): every simulator on the Mac, grouped by runtime. Replaces the device picker and the grid panel's list.
- **Stage** (centre): the device, drawn from Simulator.app's own nine-slice artwork, fitted to whatever space the panels leave. Its controls float in a dock directly under it, so a control sits next to what it acts on.
- **Inspector** (right): four tabs: Device, App, Capture, and Activity (which now holds the stream stats).
- **Console** (bottom drawer): Logs, Input, Accessibility tree, and Web Inspector. These are the things you read from the device.
- **Wall**: every running simulator side by side. Clicking one flies it into the stage as the same object.
- **⌘K**: one palette for every action, tool, and simulator.

## Tokens

- Type: SF Pro (Text/Display/Rounded) and SF Mono, using the macOS sizes `caption2 … large`. Tracking is set per size. Every number is mono.
- Colour: `label`, `label-2`, `label-3`, `fill`, `group`, `ink`, `on-ink`. Selection is ink (graphite in light mode, white in dark mode). Hue only appears in green/orange/red status marks and the record button.
- Materials: `.glass` (panels), `.glass-sm` (toolbar capsules), `.glass-pop` (menus, popovers). Inside a panel the only container is the inset grouped list (`Section`/`Row`, System Settings shape).
- Themes: Auto (follows the OS), Light, and Dark. A theme switch sweeps outward from the pointer.

## Motion

- Springs only for anything a person can touch: `ui` 0.35 s, `snappy` 0.22 s, and `surface` 0.5 s, all critically damped.
- Bounce (`momentum`) only follows a throw: a flicked toast, the fullscreen button on the phone page, or a console resize past its limit.
- Every animation starts from the on-screen value, so any of them can be interrupted.
- Signature moments:
  - The device rises in on load.
  - Panels re-fit the stage on a spring.
  - An app zooms out of its icon on the device and back into it.
  - Changing the simulator's appearance plays a circular reveal.
  - A screenshot flashes, then a thumbnail lifts off the screen and lands in the corner.
  - Recording morphs the record button into a timer and puts a red capsule in the toolbar.
  - Hardware buttons push out under the pointer and in when pressed.
- `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast` are all honoured.

## Libraries

React 19, Tailwind v4, Motion, and Base UI (the primitives ReUI builds on: Select, Menu, Popover, Tooltip). Components adapted from ReactBits patterns:

| Component | ReactBits source |
|---|---|
| Segmented control | RubberSegment |
| Switch | SquishSwitch |
| Slider | ElasticSlider |
| Device dock | Dock |
| Toasts | SwipeToast |
| Rolling metrics | Counter |

Patterns adapted from ReUI: Kbd, Badge, NumberField (stepper), Filters (log chips), and Tree (accessibility).

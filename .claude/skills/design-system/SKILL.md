---
name: design-system
description: >-
  The canonical visual design system for the headless-serve-sim WEB INTERFACE — a quiet,
  monochrome "floating cards on a dotted canvas" language: white cards with 18px corners
  and one soft shadow float on a #f0f0f0 dot-grid canvas; inside a card, sections are FLAT
  and divided by 1px #ededed rules; every control is a soft-cornered rectangle (no pills, no
  stadium switches, no circular buttons) and the SHAPE FOLLOWS THE DATA — a boolean is a
  one-line row with a soft-rectangle switch and its state in mono, a short enum is a
  segmented block with a near-black selected fill, a long enum is a portaled menu, numbers
  live in bordered mono chips, and ranges use a tall 40px track with a white knob. Type is
  six named tokens (text-eyebrow/micro/value/body/heading/display) and a raw text-[Npx] is
  a bug. There is NO hue anywhere: emphasis is #1c1c1c on white. The device is drawn
  with the installed profile's real Simulator.app nine-slice artwork, floating bare on the
  canvas with its own drop shadow. Use this skill whenever building, restyling, reviewing,
  or laying out ANY part of the serve-sim web UI: files under
  packages/headless-serve-sim/src/client/** or the presentational SimulatorToolbar;
  choosing colors, radius, borders, spacing, dividers, fonts, or motion; implementing the
  toolbar card, the collapsible inspector, inspector sections, the device bezel, tool
  blocks, panels, buttons, inputs, segmented groups, sliders, value chips, tables, badges,
  or the CPU/MEM readout. Trigger it even when the request just says "match the design",
  "apply the design system", "use the design tokens", or "round the buttons" — if the edit
  touches how the serve-sim web page LOOKS, consult this skill first.
---

# serve-sim Web Design System

How the **headless-serve-sim web interface** must look: **white cards floating on a dotted
gray canvas**, monochrome, with one control vocabulary — soft-cornered rectangles — and no
color at all.

**Component reference:** every shape below is already implemented in
[`packages/headless-serve-sim/src/client/components/design-system.tsx`](../../../packages/headless-serve-sim/src/client/components/design-system.tsx).
Use those components; do not re-derive the class strings.

## Scope & hard boundary

Edit **presentation only**: `packages/headless-serve-sim/src/client/**` and the
presentational `packages/headless-serve-sim-client/src/simulator/SimulatorToolbar.tsx`.

**Never touch core** (it sends bytes, reads the stream, or talks to the device):
`SimulatorView.tsx`; the WebSocket / `sendWs` / `onStream*` / keyboard-HID effects in
`client.tsx`; `use-mjpeg-stream` / `use-avcc-stream` / `avcc-fallback`; any
transport/codec/gateway/stream file in `headless-serve-sim-client`; all server / Swift /
middleware code. A restyle is a **visual refit only** — no feature, behavior, data, or
streaming logic changes. Preserve every handler, `ref`, `data-*`, `aria-*`, and any
conditional keyed on a class or inline style.

Styling is **Tailwind v4** (utility classes + `@theme` tokens in `global.css`) with inline
`style={}` for dynamic values; `SimulatorToolbar.tsx` uses inline CSS-in-JS. Match
whichever the file already uses — don't introduce a new styling system.

## The three laws

### Law 1 — Surface: cards float, sections are flat

- **The page is a dotted canvas.** `#f0f0f0` with a 1px `#d7d7d7` dot on a 16px grid —
  the `.ds-canvas` class. Nothing else in the tree paints a page background.
- **Every top-level surface is a floating white card**: `bg-panel`, `rounded-panel`
  (18px), `shadow-panel`, **no border**. Cards are separated by a real gutter (20px) and
  inset from the viewport (24px), so the canvas shows between and around them.
- **Inside a card, structure is flat.** Sections have **no card of their own** — no
  border, no radius, no nested fill. One `1px #ededed` rule divides them, and nothing
  else. Never nest a card in a card.
- **Shadows are for floating things only**: cards, overlay panels, dropdowns, toasts, the
  device. An inline block never casts one.

### Law 2 — Controls: one shape, no hue, no legacy widgets

Every control is a **soft-cornered rectangle**. Radius scales with height: ~7px for chips
and small badges (`rounded-chip`), 8px for compact controls (`rounded-sm`), 12px for
buttons, segments, inputs and sliders (`rounded-card`), 18px for cards (`rounded-panel`).

**There are no stadium/pill shapes in this system. `--radius-pill` does not exist.**

### Control follows the data, not the house style

The shape is chosen by what the value IS. Picking one control and forcing
everything through it is how this panel ended up with five wrapped buttons for a
colour filter and a wall of Off/On pairs for five booleans.

| The value is… | Control | Notes |
|---|---|---|
| a boolean state | `SettingSwitch` | one row: label, state in mono (`off`/`on`), 44×24 soft-rectangle track with a rounded-square knob. **Never** an `Off`/`On` segment pair — five of those turn a settings list into a wall of buttons. |
| an enum, ≤4 options, labels ≤14 chars | `SegmentedGroup` | all options visible; the options are the interface |
| an enum, 5+ options **or** any long label | `Select` (`components/select.tsx`) | a portaled menu. "Red/Green (Protanopia)" does not belong in a segment. **It MUST carry a disclosure caret and be sized as a field (~168px, white fill, value left-aligned).** |
| a continuous range | `Slider` | 40px track, filled part darker, 28px knob |
| free text | input, `rounded-sm`, hairline border | |
| an action | button, `rounded-card`; the one primary per block is the near-black fill | |
| an icon-only action | `SquareIconButton` | a 34px soft square, never a circle |

`fitsSegments()` in `simulator-settings-tool.tsx` encodes the enum threshold —
use it rather than eyeballing each call site.

- **Selection is near-black, never colored.** Selected segment / primary fill =
  `bg-accent-solid` (`#1c1c1c`) with `text-on-accent`. Unselected = `bg-panel-deep`
  (`#f7f7f7`) + `border-divider` + `text-fg-2`. **Never `text-white`** — `on-accent`
  flips in dark mode; `white` doesn't.
- **Numbers are mono, in a bordered chip.** `ValueChip`: `font-mono`, `rounded-chip`,
  `border-control-border`, on white. Every readout wears it, so a value is never
  mistaken for a label.
- **Sliders are tall.** A 40px `rounded-card` track, the filled part one shade darker
  (`--color-track-fill`) than the rest (`--color-track`), with a 28px white knob riding
  inside it. Use the `Slider` component; `--ds-slider-fill` carries the percentage.
- **A panel toggle is not a chevron.** A chevron already means "disclose this
  section" throughout the panel body; reusing it for collapse is the same
  mistake as the picker wearing a switch's shape. `PanelToggleIcon` draws the
  panel itself — a rounded rect with a divided side rail, filled while open,
  hollow when collapsed, mirrored to the edge the panel lives on.
- **A picker must never be mistakable for a switch.** Measured, they had once
  become the same: both `8px` radius, both `#e6e6e6` border, both right-aligned
  to the same x, neither with a glyph — 11px of width was the only difference.
  A picker now has a **caret**, a white fill and 168px of width; a switch is a
  44×24 grey track with no glyph. Check any new control pair the same way:
  compare `borderRadius`, `backgroundColor`, width and glyph presence.
- **Two or three short options become equal grid columns** filling the row, so a
  segmented set reads as one control instead of loose buttons; longer sets wrap.
- **Focus is a crisp ring**, `2px var(--color-accent-solid)`, never a glow.
- **Status colors are the only color**, and only as small dots or short badge text —
  never a large fill.

### Law 3 — Layout: cards on the canvas, device bare

```
 ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
 ·  ╭────────╮   ╭──────────────╮   ╭──────────╮ ·
 ·  │ACTIVITY│   │ ds-sim ⌂ ◑ ⧉ ↻│   │INSPECTOR │ ·
 ·  │        │   ╰──────────────╯   │  ────────│ ·
 ·  │ gauges │    ╭────────────╮    │  section │ ·
 ·  │        │    ╢██ screen ██╟    │  ────────│ ·
 ·  │        │    ╰────────────╯    │  section │ ·
 ·  ╰────────╯   (real artwork,     ╰──────────╯ ·
 ·                buttons visible)               ·
 ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
```

- **Root:** `.ds-canvas`, `display:flex; align-items:center; **justify-content:
  space-between**; height:100vh; width:100vw; overflow:hidden`, `padding: 24`.
  **The panels anchor to the window's left and right edges — always 24px from
  the border, expanded or collapsed.** They must never drift inward to sit
  against the device. Under `justify-center` + a gap the collapsed rails bunched
  up beside the phone and read as hanging off it; the centre column is now
  `flex-1` so the device centres in whatever space the panels leave.
- **Left / right cards** (Activity, Inspector): full canvas height
  (`100vh − 2×24`), `rounded-panel`, `shadow-panel`, **collapsed by default** to a 52px
  rail, expanding to 380px. Expanding shrinks the device's available width; it never
  floats over the device. The content panel is laid out at full expanded width at all
  times and anchored to its edge, so expanding reveals rather than reflows.
- **Centre column:** the device title bar card (**56px** tall — it carries a two-line
  title plus five 32px actions and was cramped at 44), its width following the device
  with a ~420px floor so the device name never truncates, a 14px gap, then the device.
  The panels keep their OWN header height (64px) so the two tune independently.
- **The device is bare** — it sits directly on the canvas with its own drop shadow, no
  card behind it. This keeps the side-button nubs visible.

## The device bezel — real Simulator.app artwork, never an approximation

The installed device profile (`config.deviceFrameSpec`) already carries everything:
`insetsPx`, per-corner `screenRadiiPx`, `outerRadiiPx`, `cutout`, and **`artwork`** — the
nine-slice PNGs (corners, edge strips, and each side-button image) that Simulator.app
itself draws. `prepareDeviceFrameArtwork()` composites them.

Rules:

- **Never hand-roll a corner radius for the device.** Apple's continuous-curvature shape
  is baked into the artwork; a CSS `border-radius` on the bezel will not match it.
- **Stack: artwork first, screen composited over it.** The artwork is a whole device, not
  a mask with a hole — putting it on top lets its nine-slice edges cover the live screen.
  This mirrors `paintRecordingFrameAtScale` in `screen-recorder.ts`.
- **Clip the screen to `screenRadiiPx`**, per corner, scaled — and permute the corners
  with the rotation.
- Fit the **whole artwork**, not the screen: the artwork bounds are wider than the screen
  because the buttons stick out. `fitDeviceBezel()` in `utils/bezel-geometry.ts` does
  this, converting the device-type screen-width cap into a scale ceiling.
- Profiles with no artwork fall back to a dark shell at `outerRadiiPx`; profiles with no
  frame at all (vision) fall back to `BareScreen`.

## Tokens — `global.css` `@theme`

Keep token NAMES stable (the tree uses `bg-page` / `bg-panel` / `text-fg` / …); the values
below are the system. Default LIGHT, with dark via `prefers-color-scheme` overriding the
same vars, so Tailwind utilities re-theme without a single class change.

```css
--color-page: #f0f0f0;          /* the dotted canvas */
--color-canvas-dot: #d7d7d7;
--color-panel: #ffffff;         /* every floating card */
--color-panel-deep: #f7f7f7;    /* unselected segment / recessed fill */
--color-surface-3: #fbfbfb;     /* inputs, icon buttons */
--color-hover: #f0f0f0;
--color-divider: #ededed;       /* every hairline, inside cards only */
--color-control-border: #e6e6e6;/* chips, icon buttons */
--color-inset: #ffffff;         /* card body: sections divide by rule, not gutter */
--color-track: #efefef;         /* slider track, unfilled */
--color-track-fill: #d9d9d9;    /* slider track, filled */
--color-thumb: #ffffff;         /* slider knob */

--color-fg: #1a1a1a;  --color-fg-2: #6e6e6e;  --color-fg-3: #9a9a9a;

--color-accent: #1a1a1a;        /* interactive text */
--color-accent-solid: #1c1c1c;  /* selected fill + focus ring */
--color-on-accent: #ffffff;     /* label ON an accent fill — flips in dark */
--color-accent-tint: rgba(0,0,0,0.05);

--color-success: #178a3f;  --color-danger: #cf3b30;  --color-warning: #c26a1a;

--radius-panel: 18px;  --radius-card: 12px;  --radius-sm: 8px;  --radius-chip: 7px;

--shadow-panel:   0 1px 2px rgba(0,0,0,.04), 0 10px 30px rgba(0,0,0,.07);
--shadow-device:  0 2px 6px rgba(0,0,0,.08), 0 14px 40px rgba(0,0,0,.16);
--shadow-overlay: 0 12px 40px rgba(0,0,0,.14);
```

Use the generated utilities, never raw hex.

## Type — six named levels, and nothing else

Sizes AND weights are **tokens**, not call-site literals. `text-[15px]` anywhere
is a bug, and so is re-declaring weight next to a token.

| Token | Size / weight | Tracking | Role |
|---|---|---|---|
| `text-eyebrow` | 12px / **700** / uppercase | **0.06em** | card + section titles |
| `text-micro` | 11px / 500 | — | stat rows, tick captions |
| `text-value` | 13px / 500 | — | numbers, mono readouts, secondary text |
| `text-body` | 14px / **500** | -0.003em | field labels, rows, segment + button labels |
| `text-heading` | 18px / 650 | -0.012em | empty-state and disconnected titles |
| `text-display` | 28px / 600 | -0.02em | the one big number on a gauge |

**Weight is the primary lever, not size.** A 15px/400 label on white reads thin
and unresolved; 14px/500 reads solid at a *smaller* size. Never set body text
below 500 — `font-normal` on a label undoes the scale.

**A section title must out-rank the rows beneath it.** It does that with caps +
700 weight + **tight** 0.06em tracking, which packs the letters into a solid
block. This was previously 11px/600 at 0.18em: smaller than the 15px labels it
introduced, and so widely tracked that it dispersed — a section header that is
the smallest, lightest, most scattered thing in its own section is inverted.
Tight tracking anchors; wide tracking floats.

Selection needs `font-semibold` (600) to out-weigh the 500 base.

Verify no size or weight has escaped the scale:

```
rg -o 'text-\[[0-9.]+px\]' -g '*.tsx' packages/headless-serve-sim/src/client
rg -n 'text-body[^"]*font-normal' -g '*.tsx' packages/headless-serve-sim/src/client
```

Both must return nothing. Data is never uppercase; hierarchy never comes from colour.

## Panel structure — three levels, grouped by function

A panel is not a list of tools. Sixteen sections as flat peers is unnavigable:
nothing tells you what anything is FOR. Group by **what the tool acts on**.

```
INSPECTOR                    <- panel title   text-eyebrow (12/700 CAPS, tight)
  Current App / SpringBoard  <- pinned context, not a tool
┌ DEVICE ─────────────────┐  <- group label   text-micro 700 CAPS text-fg-3,
│  › Simulator            │     on a bg-panel-deep band, STICKY to the scroll top
│  › Status Bar           │  <- section       text-body font-semibold, SENTENCE case
│  › Location   1.53 km   │     status right-aligned, mono
└─────────────────────────┘
```

Inspector groups: **Device** (Simulator, Status Bar, Location, Camera) ·
**App** (Actions, Permissions, User Defaults, Documents) · **Capture**
(Screenshot, Screen Recording) · **Inspect** (Accessibility, Connection Stats,
Logs, WebKit DevTools, Simulators). Activity uses the same shape: **Live**
(gauges) · **Counters**.

**Only the panel title and the group label are uppercase.** Section titles are
sentence case at `text-body font-semibold` — CAPS on every level is shouting,
and it made sections compete with the panel title instead of sitting under it.

`SectionGroup` is a **real flex item** (`flex shrink-0 flex-col`), never
`display:contents`. Under `contents` the group's box disappears, the scroll
container's `shrink-0` stops applying, and every section inside collapses to
zero height in a bounded flex column — the panel renders as empty bands.

### Section anatomy

```
[block: border-t border-divider, no radius, no nested fill]
  [header  px-5 min-h-[56px]]
     › CHEVRON (leading, order-first)   <- right when closed, down when open
     Title (text-body font-semibold, mr-auto)
     [status, right-aligned, mono, text-value]
  [body  px-5 pb-4 pt-1  flex-col gap-3]  <- NO rule under the title
```

Collapsible sections use `CollapsibleSection` (native `<details>`, CSS-only
height transition). Hand-rolled `open && …` bodies match the same anatomy.

### Fit inside the panel

The panel is 380px. Anything that can be long — a filesystem path, a bundle id —
must wrap (`break-all line-clamp-2`), not sit in a `whitespace-nowrap` ellipsis:
a value clipped to 380px of a 1775px string shows the user nothing. Audit with:

```js
el.scrollWidth > el.clientWidth   // must be false for every non-scroller
```

## Motion

**`cubic-bezier(0.4, 0, 0.6, 1)`**, ~0.3s for color/background/transform, ~0.24s for
opacity, 320ms for the rail width. Restrained — never bouncy, never a spring, never long.
Hover shifts the **fill**, never a shadow.

## Self-check before finishing

- No `rounded-pill`, no stadium switch, no `Off`/`On` segment pair for a boolean, no
  circular button, no `text-white` on an accent fill.
- `rg -o 'text-\[[0-9.]+px\]' -g '*.tsx' packages/headless-serve-sim/src/client` returns
  NOTHING — every size is a scale token.
- Each control matches its data type per the table in Law 2 (a 5-option enum is a menu,
  not five wrapped buttons).
- Cards float (18px + shadow, no border); sections inside them are flat and rule-divided;
  no card nested in a card.
- No hue: grep for blue/green/red outside `--color-success|danger|warning`, and check
  those only appear as small dots or badge text.
- Numbers are mono; section titles use `text-eyebrow`.
- Device: artwork under the screen, screen clipped to `screenRadiiPx`, whole artwork
  fitted, buttons visible, no hand-rolled radius.
- Layout: panels pinned 24px from the window's left/right edges in BOTH states
  (measure `getBoundingClientRect().left` and `innerWidth - right`); device centred
  in the remaining bay; rails collapsed by default and never overlapping the device.
- No core file touched; every control still works; `bun run typecheck` passes and
  `bun run packages/headless-serve-sim/build.ts` succeeds.

**The client is inlined into the preview HTML at build time — restart the server after
every rebuild or you will be looking at the old bundle.**

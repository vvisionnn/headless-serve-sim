---
name: design-system
description: >-
  The canonical visual design system for the headless-serve-sim WEB INTERFACE — Apple's
  apple.com marketing language: a light, airy SF Pro system where structure is flat (0px,
  shadowless bars/sections/frames) and CONTROLS are rounded (980px pill buttons, ~12px
  cards/inputs), built on white + #f5f5f7 surfaces with one blue (#0066cc text / #0071e3
  fill) and quiet cubic-bezier(0.4,0,0.6,1) motion — combined with this project's fixed
  layout law (centered topbar+device-frame = 100vh assembly with a full-height collapsible
  right inspector, top + right attached). Use this skill whenever building, restyling,
  reviewing, or laying out ANY part of the serve-sim web UI: files under
  packages/headless-serve-sim/src/client/** or the presentational SimulatorToolbar;
  choosing colors, radius, borders, spacing, dividers, fonts, or motion; implementing the
  top bar, the collapsible inspector, inspector blocks, the device frame, tool cards,
  panels, buttons, inputs, selects, switches, tables, badges, or the CPU/MEM readout.
  Trigger it even when the request just says "match the design", "apply the design system",
  "make it look like apple", "use the design tokens", or "round the buttons" — if the edit
  touches how the serve-sim web page LOOKS, consult this skill first.
---

# serve-sim Web Design System

This is how the **headless-serve-sim web interface** must look and lay out: **Apple's
apple.com marketing language** — light, spacious, one typeface, flat scaffolding with pill
controls — wrapped around this project's fixed layout skeleton.

**Full extracted reference:** [references/apple-com-design-system.md](references/apple-com-design-system.md)
(palette, type scale, component recipes, motion, evidence). Read it for any exact value
not listed below. This SKILL.md is the actionable contract.

## Scope & hard boundary

Edit **presentation only**: `packages/headless-serve-sim/src/client/**` and the
presentational `packages/headless-serve-sim-client/src/simulator/SimulatorToolbar.tsx`.

**Never touch core** (it sends bytes, reads the stream, or talks to the device):
`SimulatorView.tsx`; the WebSocket / `sendWs` / `onStream*` / keyboard-HID effects in
`client.tsx`; `use-mjpeg-stream` / `use-avcc-stream` / `avcc-fallback`; any
transport/codec/gateway/stream file in `headless-serve-sim-client`; all server / Swift /
middleware code. This is a **visual refit only** — no feature, behavior, data, or
streaming logic changes. Every control keeps working exactly as before. Preserve every
handler, `ref`, `data-*`, `aria-*`, and any conditional keyed on a class/inline style.

Styling is **Tailwind v4** (utility classes + `@theme` tokens in `global.css`) with inline
`style={}` for dynamic values; `SimulatorToolbar.tsx` uses inline CSS-in-JS. Match
whichever the file already uses — don't introduce a new styling system.

## The two laws

### Law 1 — Look: flat structure, pill controls, one blue, on white

Apple.com's signature is the **contrast between flat scaffolding and rounded controls**.
Do not flatten everything (that was the rejected prior design) and do not round
everything. Split them:

- **Structural shells are flat: `0px` radius, no shadow.** The top bar, the inspector
  bar, the device-frame container, and the **device screen itself** are square-cornered
  and shadowless. They tile flush and attach edge-to-edge. Layer them by **fill shift**
  (`#fff` canvas → `#f5f5f7` surface → `#e8e8ed`), never by elevation.
- **Controls are rounded: pills + soft cards.** Buttons are **full `980px` pills**;
  cards / tool blocks / inputs / selects / menus use **`~12px`**; icon buttons are
  **circles** (`50%`); badges are pills. This is where the rounding lives.
- **One blue, almost no other color.** Interactive text/links → `#0066cc`
  (`text-accent`); the single filled primary button → `#0071e3` (`bg-accent-solid`) with
  white label; focus ring → `1px #0071e3`, `1px` offset. Status colors (green/red/orange)
  appear only as **small** dots/badges, never large fills.
- **Hairlines, not shadows.** Separate sections/rows with a single `1px #d2d2d7`
  (`border-divider`) rule. A real soft shadow is allowed ONLY for a true floating overlay
  (dropdown / popover / toast): `0 4px 24px rgba(0,0,0,0.12)`. Never on inline blocks.
- **Type carries hierarchy, not color.** SF Pro only. Body `17px/400`; headings
  `SF Pro Display 600`; eyebrows `12px #6e6e73`. Keep **negative tracking** (`-0.022em`
  at body, tighter as size grows). No blue or colored headings.
- **Generous space.** Apple under-fills. Let whitespace and fill shifts separate things;
  use comfortable padding (12–24px in dense UI), not cramped 0–2px.

### Law 2 — Layout: KEEP the skeleton exactly (this is the one thing not from apple.com)

The structural skeleton is fixed and must be preserved verbatim — only its *styling*
changes to the apple.com language. The geometry, centering, and attach behavior stay:

```
            ┌──────────────────────────────┬─────┐
            │ TOP BAR  (device · CPU · MEM) │  ▣  │  ← inspector height
            ├──────────────────────────────┤  I  │     = top bar + frame
   centered │                              │  N  │
   in page  │        DEVICE FRAME          │  S  │  collapsed (default): rail,
            │   (flat 0px frame; screen     │  P  │  top toggle styled like top bar
            │    is now FLAT too, radius 0;  │  …  │
            │    fills height, width by      │     │  expanded: widens, shows stacked
            │    aspect ratio)               │     │  cards (some always shown, some
            └──────────────────────────────┴─────┘  <details>-collapsible)
              left column width = frame width
```

- **Centered assembly.** The page root is `display:flex; align-items:center;
  justify-content:center; height:100vh; width:100vw; overflow:hidden`, canvas `#ffffff`.
  The whole assembly (top bar + frame + inspector) is centered in the viewport.
- **Left column = top bar + device frame, stacked.** Top bar + frame height = `100vh`.
  The column width equals the device-frame width; the **top bar's width follows the frame
  width** on every resize (attached on top).
- **Top bar:** fixed height **44px**, frosted (`rgba(255,255,255,0.8)` +
  `backdrop-filter: blur(20px) saturate(1.8)`), `0px` radius, a `1px #d2d2d7` bottom
  keyline, no margin, attaches flush to the frame. Holds the device picker/title, action
  buttons (home, appearance, AX, rotate, RN-reload — as **circular icon buttons**), and
  the **CPU + MEM** readout that auto-collapses responsively (full → compact → hidden as
  the bar narrows).
- **Device frame:** flat `0px` container with a `1px #d2d2d7` border, fills the height
  under the top bar. Fit it inside `availH = 100vh − 44` and `availW = 100vw −
  inspectorWidth`, preserving aspect ratio; set the column width to the resulting frame
  width. **The streamed screen is now FLAT — `borderRadius: 0`, no superellipse.** ("All
  flat": the device sits flush in a flat frame.)
- **Inspector bar:** right of the left column, `height = topBar + frame` (NOT 100vh — it
  must never change the page height; make its body scrollable), attached flush, `0px`
  radius, a `1px #d2d2d7` keyline on its **leading (left) edge**, frosted/`#ffffff`.
  **Collapsed by default** to a ~44px rail whose **top header matches the top bar** (same
  44px, same bottom keyline) and holds the single expand/collapse toggle. Expanded
  (~360px) reveals a vertical stack of **soft cards** (`~12px` radius) separated by
  `1px #d2d2d7` dividers; some always shown, some `<details>`-collapsible. Expanding grows
  `inspectorWidth`, which shrinks the frame's `availW` (frame recomputes) — it pushes from
  the frame's edge, never floats over the screen.
- The wide surfaces (Connection Stats, Simulators grid, WebKit DevTools) keep their
  existing overlay behavior, launched from inspector entries.

## Tokens — `global.css` `@theme` (light default + dark via prefers-color-scheme)

Keep token NAMES stable (the tree already uses `bg-page` / `bg-panel` / `text-fg` / …);
remap the VALUES to apple.com and ADD radius tokens. Default LIGHT; provide Apple dark via
`@media (prefers-color-scheme: dark)` overriding the same vars (Tailwind v4 utilities read
the vars, so the override cascades).

```css
@theme {
  /* Surfaces — light, layered by fill shift */
  --color-page:          #ffffff;   /* canvas */
  --color-panel:         #ffffff;   /* bars / inspector base (frost via backdrop) */
  --color-panel-bg:      #ffffff;
  --color-panel-overlay: rgba(255,255,255,0.8);
  --color-panel-deep:    #f5f5f7;   /* cards / tool blocks */
  --color-surface-2:     #f5f5f7;
  --color-surface-3:     #fafafc;
  --color-hover:         #e8e8ed;   /* row / control hover on white */
  --color-divider:       #d2d2d7;   /* EVERY hairline */

  /* Text — weight/size ranks, never color */
  --color-fg:            #1d1d1f;
  --color-fg-2:          #6e6e73;
  --color-fg-3:          #86868b;

  /* One blue */
  --color-accent:        #0066cc;   /* interactive text / links */
  --color-accent-solid:  #0071e3;   /* single filled primary + focus */
  --color-accent-tint:   rgba(0,113,227,0.10);

  /* Status — small accents only */
  --color-success:       #03a10e;
  --color-danger:        #e30000;
  --color-warning:       #f56300;

  /* Radius — rounding lives on controls, not structure */
  --radius-pill:         980px;     /* buttons, badges, segmented */
  --radius-card:         12px;      /* cards, inputs, menus, blocks */
  --radius-sm:           8px;       /* compact controls, rows */

  /* Type */
  --font-system:  "SF Pro Text", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-display: "SF Pro Display", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono:    "SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-page:#000000; --color-panel:#1d1d1f; --color-panel-bg:#1d1d1f;
    --color-panel-overlay:rgba(29,29,31,0.8); --color-panel-deep:#161617;
    --color-surface-2:#161617; --color-surface-3:#1d1d1f; --color-hover:#2c2c2e;
    --color-divider:#424245; --color-fg:#f5f5f7; --color-fg-2:#a1a1a6; --color-fg-3:#86868b;
    --color-accent:#2997ff; --color-accent-solid:#0071e3; --color-accent-tint:rgba(41,151,255,0.12);
    --color-success:#30d158; --color-danger:#ff453a; --color-warning:#ff9f0a;
  }
}
```

Set `:root { color-scheme: light dark; }` (UA chrome follows). Use the generated
utilities, never raw hex: surfaces → `bg-page` / `bg-panel` / `bg-panel-deep` /
`bg-surface-2` / `bg-hover`; borders → `border-divider`; text → `text-fg` / `text-fg-2` /
`text-fg-3`; interactive text → `text-accent`; filled button → `bg-accent-solid`; rounding
→ `rounded-pill` / `rounded-card` / `rounded-sm` (or `rounded-full` for circles).

## Component recipes (mapped to this codebase)

- **Top bar** (`SimulatorToolbar.tsx`): 44px, frosted white, `0` radius, bottom
  `1px #d2d2d7` keyline, no shadow. Action buttons → **circular** (`borderRadius:'50%'`),
  transparent, glyph `#1d1d1f`, hover faint `#e8e8ed` circle. Add the CPU/MEM readout with
  responsive collapse.
- **Inspector shell** (`inspector-bar.tsx`): full-(topbar+frame)-height right bar, `0`
  radius, leading `1px #d2d2d7` keyline, frosted/`#ffffff`, scrollable body; 44px top
  header matching the top bar with the toggle (a circular icon button).
- **Tool block / card** (`CollapsibleSection` + tool components): `rounded-card`
  (`12px`), `bg-panel-deep` (`#f5f5f7`), no shadow; stack with `1px #d2d2d7` dividers or
  small gaps; comfortable padding (`px-3 py-2.5`). Keep the `<details>` mechanics + chevron.
- **Buttons:** primary (rare, single) = `bg-accent-solid` `#0071e3`, white label,
  `rounded-pill`, `padding: 8px 16px` (compact pill). Secondary = `bg-panel-deep`
  `#f5f5f7`, `text-fg`, `rounded-pill`. Tertiary = transparent, `1px` accent border +
  `text-accent`, `rounded-pill`. Icon buttons = `rounded-full`, transparent, hover
  `#e8e8ed`.
- **Inputs / selects / switches:** `1px #d2d2d7` border, `bg-surface-3`/`bg-panel`,
  `rounded-card`, text `#1d1d1f`, placeholder `#86868b`; focus → `1px #0071e3` ring +
  `1px` offset (`outline`, not shadow). Pill-shape the toggle tracks.
- **Tables / data rows** (connection stats, grid, ax tree, user-defaults): header text
  `#86868b` 12px; cells `#1d1d1f` 13–14px; each row a `1px #d2d2d7` bottom border; hover
  row `#f5f5f7`. Wrap in a `rounded-card` container; no inner radius on cells.
- **CPU / MEM** (`TopBarMetrics`): keep the sparkline math; label `#86868b`, value crisp;
  line colors stay semantic (CPU green/amber/red, MEM blue). `rounded-pill` chips.
- **Badges / status dots:** `rounded-pill`, 11–12px, tinted fill (`accent-tint` /
  `success`@10% / `danger`@10%) or solid status color. Small.
- **Toasts / overlays / dropdown menus:** `rounded-card`, the one place a real
  `0 4px 24px rgba(0,0,0,0.12)` (dark: `rgba(0,0,0,0.5)`) shadow is OK.
- **Boot empty state, device picker, grid tiles:** apple cards (`rounded-card`,
  `#f5f5f7`, hairline dividers), SF Pro Display title, generous space.

## Motion

Apple's authentic curve: **`cubic-bezier(0.4, 0, 0.6, 1)`** (decelerate), ~**0.3s** for
color/background/transform, ~**0.24s** for opacity. Restrained — **never bouncy, never a
spring, never long**. Inspector expand/collapse, top-bar responsive collapse, hovers, and
`<details>` open/close all use this curve. (Hover = shift the **fill**, not a shadow.)

## Self-check before finishing

- Structural shells (top bar, inspector, device frame, **device screen**) are `0px` and
  shadowless; controls (buttons/badges = pill, cards/inputs = `12px`, icon buttons =
  circle) are rounded. Grep for stray `borderRadius`/`rounded-*` that contradict this.
- Colors come from the tokens; no leftover dark-DocC values (`#1d1d1f` page bg, `#2997ff`
  as the light accent, `#000` canvas in light mode) and no raw hex in components.
- Type is SF Pro with negative tracking; no colored headings.
- Layout skeleton intact: centered; top bar 44px width-follows the frame; frame fits
  `100vh − 44`; inspector = topBar+frame height, collapsed by default, doesn't change page
  height; device screen flat.
- No core file touched; every control still works; the build compiles
  (`bun run packages/headless-serve-sim/build.ts`).

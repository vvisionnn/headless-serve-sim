---
name: design-system
description: >-
  The canonical visual design system for the headless-serve-sim WEB INTERFACE — an
  Apple "DocC" dark developer-tool register (square rectangular blocks, 1px hairline
  dividers, no shadows, no rounded web chrome, SF Pro type, a single #2997ff accent)
  plus the project's exact layout law (width-following top bar + device frame = 100vh,
  full-height collapsible right inspector). Use this skill whenever building, restyling,
  reviewing, or laying out ANY part of the serve-sim web UI: files under
  packages/headless-serve-sim/src/client/** or the presentational SimulatorToolbar;
  choosing colors, radius, borders, spacing, dividers, or fonts; implementing the top
  bar, the collapsible side inspector, inspector blocks, the device frame, tool cards,
  panels, buttons, inputs, selects, switches, tables, or the CPU/MEM readout. Trigger
  it even when the request just says "match the new design", "flatten the UI",
  "apply the design system", "square the corners", or "use the design tokens" — if the
  edit touches how the serve-sim web page LOOKS, consult this skill first.
---

# serve-sim Web Design System

This is how the **headless-serve-sim web interface** must look and lay out. It is the
Apple **DocC dark developer-tool register** — engineered, not decorated — combined with
this project's specific redesigned layout.

**Full extracted reference:** [references/apple-design-system.md](references/apple-design-system.md)
(palette, type hierarchy, component prompts, evidence notes). Read it when you need
depth or an exact value not listed below. This SKILL.md is the actionable contract.

## Scope & hard boundary

Edit **presentation only**: `packages/headless-serve-sim/src/client/**` and the
presentational `packages/headless-serve-sim-client/src/simulator/SimulatorToolbar.tsx`.

**Never touch core** (it sends bytes, reads the stream, or talks to the device):
`SimulatorView.tsx`; the WebSocket / `sendWs` / `onStream*` / keyboard-HID effects in
`client.tsx`; `use-mjpeg-stream` / `use-avcc-stream` / `avcc-fallback`; any
transport/codec/gateway/stream file in `headless-serve-sim-client`; and all server /
Swift / middleware code. This is a **visual refit only** — no feature, behavior, data,
or streaming logic changes. Every control keeps working exactly as before.

Styling is **Tailwind v4** (utility classes + `@theme` tokens in `global.css`) with
inline `style={}` for dynamic values; `SimulatorToolbar.tsx` uses inline CSS-in-JS.
Match whichever the file already uses — don't introduce a new styling system.

## The two laws

Everything reduces to two laws. When in doubt, re-read these.

### Law 1 — Shape: square blocks, hairline dividers, no shadows

- **`0px` radius on every web element.** Bars, blocks, buttons, inputs, selects,
  cards, panels, badges, toasts, the device-frame border, the inspector — all square.
  Replace every `rounded-*`, `rounded-[Npx]`, `borderRadius`, `border-radius` with no
  radius. The ONLY rounded thing on the page is the **streamed device screen itself**
  (its `imgBorderRadius` / superellipse clip in `client.tsx`) — *simulator is
  simulator, web is web.* Leave that one untouched; square everything around it.
- **`1px solid #424245` hairline dividers are the primary structural device.** Separate
  sections, rows, panels, and bars with a single hairline — not with shadows, not with
  thick borders, not with gaps. Borders carry the structure.
- **No drop shadows for structure.** Delete `shadow-*` and `boxShadow` used for
  elevation. Layer surfaces by **fill shift** instead (`#000 → #1d1d1f → #161617`). A
  real shadow `rgba(0,0,0,.5)` is allowed ONLY for a true floating overlay
  (menu/popover/toast), never for inline blocks.
- **Compression: minimal/zero padding.** Let dividers do the spatial work. Collapse
  generous padding (`p-3.5`, `py-6`, `gap-3`, …) toward `0–8px`. No decorative spacing
  between attached elements (bars attach flush to the frame with no gap).
- **No low-opacity glyphs.** Keep icons/text crisp (≥0.6 alpha). Prefer the `--text-*`
  tokens over `text-white/30`-style washes.

### Law 2 — Layout: width-following top bar + device frame = 100vh, full-height right inspector

The page is a single flush assembly, **left-aligned**, filling the viewport height:

```
┌──────────────────────────────┬─────┐  ← inspector height = 100vh
│ TOP BAR  (device · CPU · MEM) │  ▣  │     (= top bar + device frame)
├──────────────────────────────┤  I  │
│                              │  N  │  collapsed (default): thin rail,
│        DEVICE FRAME          │  S  │  top toggle styled like the top bar
│   (rect block border;        │  P  │
│    screen keeps its radius;   │  …  │  expanded: widens, shows stacked
│    fills height, width by     │     │  square blocks (some always shown,
│    aspect ratio)              │     │  some <details>-collapsible)
└──────────────────────────────┴─────┘
   left column width = frame width      ↑ 1px #424245 keyline on inner edge
```

- **Page root:** `#000` canvas, no padding, `display:flex; flex-direction:row;
  height:100vh; width:100vw; overflow:hidden`. The assembly is **left-aligned**; any
  leftover width to the right of the inspector is bare canvas. No centering.
- **Left column = top bar + device frame, stacked, height `100vh`.** Its width equals
  the device-frame width.
- **Top bar:** fixed height (target **44px**), `bg #1d1d1f`, bottom edge a single
  `1px #424245` keyline, `0` radius, no margin. It **attaches flush** to the frame and
  its width follows the frame width on every resize. Holds the device picker/title, the
  action buttons (home, appearance, AX, rotate, RN-reload), and the **CPU + MEM**
  readout. CPU/MEM **auto-collapse responsively**: full label+sparkline when wide →
  compact value-only → hidden as the bar narrows.
- **Device frame:** `flex:1`, fills the height under the top bar. It is a rectangular
  block with a `1px #424245` **web border** (square). Size it to **fit** within
  `availableHeight = 100vh − topBarHeight` and `availableWidth = 100vw −
  inspectorWidth`, preserving the device aspect ratio; set the left-column width to the
  resulting frame width so the top bar matches. Height is the primary constraint
  (portrait phones fill the full height; top bar + frame = 100vh). For very wide
  devices that would overflow width, clamp to width and top-align. The streamed screen
  inside keeps its native corner radius.
- **Inspector bar:** on the right of the left column, `height:100vh`, attached flush
  (no gap), `bg #1d1d1f`, a `1px #424245` keyline on its **leading (left) edge**, `0`
  radius. **Collapsed by default.** Its **top header matches the top bar** (same 44px
  height, same bottom keyline, same chrome) and holds the single expand/collapse toggle
  — the inspector only opens when that toggle is tapped. Collapsed = a thin rail
  (~44px). Expanded = widens (~320px) revealing a vertical stack of **square blocks**
  separated by `1px #424245` dividers; some blocks are always shown, some are
  `<details>`-collapsible (reuse `CollapsibleSection`). Expanding the inspector grows
  `inspectorWidth`, which reduces the frame's `availableWidth` (the frame recomputes) —
  it pushes from the frame's right edge, it does not float over the screen.
- The four legacy right-rail panels (Tools, Connection Stats, plus Grid & WebKit
  DevTools) consolidate **into the inspector**. Tool sections and Connection-Stats
  become inline blocks. Grid and WebKit-DevTools (which need real width) may open as a
  wide surface from a block trigger — but their entry point lives in the inspector.
  Keep every tool's existing functionality.

## Tokens — rewrite `global.css` `@theme` to these

Map the dark-tool palette into the existing token names so the whole tree inherits it.
Keep token NAMES stable where components already use them; change the VALUES.

```css
@theme {
  /* Canvas + surfaces (layer by fill shift, not shadow) */
  --color-page:          #000000;  /* canvas (was #0a0a0a) */
  --color-panel:         #1d1d1f;  /* panels, inspector, top bar, blocks */
  --color-panel-bg:      #1d1d1f;  /* opaque now — no translucent panels in the dense register */
  --color-panel-overlay: rgba(20,20,22,0.92);
  --color-panel-deep:    #161617;  /* nested / secondary fill */
  --color-surface-2:     #161617;
  --color-surface-3:     #111111;  /* raised alt */
  --color-hover:         #2c2c2e;  /* row / control hover */
  --color-divider:       #424245;  /* EVERY hairline rule */

  /* Text (Tailwind utilities: text-fg / text-fg-2 / text-fg-3) */
  --color-fg:            #f5f5f7;
  --color-fg-2:          #a1a1a6;
  --color-fg-3:          #86868b;

  /* Accent — one blue for all interactive text/links */
  --color-accent:        #2997ff;  /* was #a5b4fc */
  --color-accent-solid:  #0071e3;  /* the single filled primary button */
  --color-accent-tint:   rgba(0,113,227,0.18); /* selected-row fill */

  /* Status / figure colors (badges, dots, charts) — keep crisp, ≥0.6 alpha */
  --color-success:       #30d158;  /* live dot / ok (Apple system green, dark) */
  --color-danger:        #ff453a;  /* error (Apple system red, dark) */
  --color-warning:       #ffd60a;  /* caution */
  --color-info:          #2997ff;

  /* Type */
  --font-system: "SF Pro Text", -apple-system, system-ui, "Helvetica Neue", sans-serif;
  --font-display: "SF Pro Display", -apple-system, system-ui, sans-serif;
  --font-mono:   "SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

These tokens are **already defined** in `global.css` (Tailwind v4 `@theme`). Use the
generated utilities — never raw hex or alpha washes:
- surfaces → `bg-page` (#000) / `bg-panel` (#1d1d1f) / `bg-panel-deep` or `bg-surface-2` (#161617) / `bg-surface-3` (#111) / `bg-hover` (#2c2c2e)
- every border/divider → `border-divider` (#424245)
- text → `text-fg` / `text-fg-2` / `text-fg-3` — re-map `text-white/90`→`text-fg`, `text-white/55`→`text-fg-2`, `text-white/40`→`text-fg-3`, and bare `text-white`→`text-fg`
- interactive text / links / selected → `text-accent` (`bg-accent`, `border-accent`); the single filled primary button → `bg-accent-solid`
- faint fills like `bg-white/8` → `bg-surface-2` / `bg-surface-3`; bare `bg-white` / `border-white` → a token, never raw white

## Type rules

- Headings: `--font-display`, weight **600**. Body/UI: `--font-system`, weight **400**.
- Weight and size mark hierarchy — **never color**. No blue headings.
- Tight body tracking ~`-0.022em` (`tracking-[-0.022em]`) at 13–17px; near-zero on
  display. Tight line heights (headings ~1.1, body ~1.45).
- Eyebrows / section kickers: 11–12px, `--color-text-3`, used above block titles.
- Links: no underline by default; underline on hover; accent color only.

## Component recipes (mapped to this codebase)

- **Top bar** (`SimulatorToolbar.tsx`): drop `borderRadius:24` → `0`; replace
  `boxShadow`/border with a bottom `1px solid #424245` keyline; `bg #1d1d1f`; buttons
  `borderRadius:6`→`0`, hover bg `#2c2c2e`, idle glyph `rgba(255,255,255,.8)`. Make it
  the width-following 44px bar; add the CPU/MEM readout (reuse `useAppMetrics`) with
  responsive collapse.
- **Inspector shell** (`Panel.tsx` / new InspectorBar): full-height right bar, `0`
  radius, leading `1px #424245` keyline, opaque `#1d1d1f`, no drop shadow; 44px top
  header matching the top bar with the expand/collapse toggle.
- **Block** (`CollapsibleSection`): `rounded-[10px]`→none, `border-white/8`→
  `border-divider`, `bg-panel`; separate stacked blocks with a single `1px #424245`
  bottom divider; tight padding (`px-3 py-2` → `px-2 py-1.5` or less). Keep the
  `<details>` mechanics and chevron.
- **Buttons:** ghost/tool = transparent, `1px solid #424245`, `0` radius, label
  `#f5f5f7`, hover `#2c2c2e`. Primary (rare, single) = solid `#0071e3`, white label,
  `0` radius. Icon buttons = `0` radius, hover `#2c2c2e`.
- **Inputs / selects / switches:** `1px solid #424245`, `bg #1d1d1f`, `0` radius, text
  `#f5f5f7`, placeholder `#86868b`; focus border → `#2997ff`. Square the toggle tracks.
- **Tables / data rows** (connection stats, grid, ax tree, user-defaults): square;
  header text `#86868b` 12px; cells `#f5f5f7` 13–14px; each row a `1px #424245` bottom
  border; hover row `#2c2c2e`; optional faint `#161617` zebra. No outer radius.
- **CPU / MEM** (`MetricsHud` logic): keep the sparkline math; restyle into the top
  bar — label `#86868b`, value crisp; line colors stay semantic (CPU green/amber/red,
  MEM `#2997ff`). Square any container.
- **Toasts / overlays:** square; the one place a real `rgba(0,0,0,.5)` shadow is OK.
- **Boot empty state, device picker, grid tiles, badges:** square, hairline-divided,
  token colors, tight padding.

## Motion

Short and restrained: ~250–320ms, `cubic-bezier(0.4,0,0.6,1)` (decelerate). Never
bouncy, never long. Inspector expand/collapse and responsive top-bar collapse animate
width/opacity at this duration.

## Build-time gotchas (validated against the codebase)

- **Square the *web frame*, keep the *screen* rounded.** No component file sets the
  streamed screen's corner radius — that lives only in the orchestrator-owned shell.
  Don't add or remove a screen radius; just square your file's own chrome.
- **Bare white tokens count too.** Re-map `text-white`, `bg-white`, `border-white`
  (not only the `/NN` alpha variants), and `h-px bg-white/8` hairlines → `bg-divider`.
- **Keep true floating-overlay shadows.** Dropdown menus, popovers, and toasts may
  keep ONE real `rgba(0,0,0,.5)` shadow (they float over content). Remove only
  *structural / inline* shadows used for elevation between adjacent blocks.
- **Visual-only.** Preserve every handler, `ref`, `data-*`, `aria-*`, and any
  conditional keyed on a class or inline style. Don't rename state or change logic.
- **Stay in your file.** Edit only your assigned file; match the styling system it
  already uses (Tailwind utilities vs inline CSS-in-JS) — don't introduce a new one.

## Self-check before finishing

- No `rounded*` / `borderRadius` / `border-radius` left on web chrome (device screen
  radius excepted). Grep to confirm.
- Every separator is a `1px #424245` hairline; no structural shadows remain.
- Colors come from the tokens above; no stray legacy `#a5b4fc`/`#0a0a0a`/`#1c1c1e`.
- Top bar + device frame fill `100vh`; top bar width follows the frame; inspector is
  full-height, collapsed by default, with a top-bar-styled toggle.
- No core file touched; every control still works; the build compiles.

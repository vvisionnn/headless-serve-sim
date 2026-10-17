---
name: design-system
description: >-
  The canonical visual design system for the headless-serve-sim WEB INTERFACE — the "Stage"
  design: the browser is a quiet room and the simulator is the only lit object in it.
  Neutral Liquid Glass chrome (.glass / .glass-sm / .glass-pop) floats over a vignetted
  stage; the device is drawn with Simulator.app's own nine-slice artwork and its screen
  lights the stage around it. Layout is Navigator (left) · Stage + device dock · Inspector
  (right, tabs Device/App/Capture/Activity) · Console drawer (Logs/Input/Accessibility/Web
  Inspector) · Wall · ⌘K palette · toasts. Inside a panel the only container is the inset
  grouped list (Section/Row, System Settings shape). Colour is semantic tokens only
  (label, label-2/3/4, fill, group, ink, on-ink); selection is ink; hue appears only in
  green/orange/red status marks and the record button. Type is the macOS scale
  (caption2 … large) with every number in mono. Motion is springs (spring.ui / snappy /
  surface / momentum / rotate from lib/motion.ts). Auto/Light/Dark themes via [data-theme].
  Use this skill whenever building, restyling, reviewing, or laying out ANY part of the
  serve-sim web UI: files under packages/headless-serve-sim/src/client/**; choosing
  colours, radius, spacing, fonts, materials or motion; adding a control, panel, inspector
  section, console view, toast, or palette command. Trigger it even when the request just
  says "match the design" or "use the design tokens".
---

# serve-sim web design system — "Stage"

The approved reference is the self-contained preview in [`design/`](../../../design/)
(`design/serve-sim-design.html`, source in `design/src`, rationale in `design/DESIGN.md`).
The shipped client must look like it. When in doubt, open the preview and compare.

## Scope & hard boundary

Edit presentation in `packages/headless-serve-sim/src/client/**`. Never change streaming or
input core while restyling: `SimulatorView`, the WebSocket / `sendWs` / `onStream*` /
keyboard-HID effects in `client.tsx`, the mjpeg / avcc hooks and fallback, and anything in
`headless-serve-sim-client`'s transport. Preserve every handler, `ref`, `data-*` and `aria-*`.

Stack: React 19, Tailwind v4 (`@theme` tokens in `global.css`), Motion (`motion/react`),
Base UI (`@base-ui/react`: Select, Menu, Popover, Tooltip), lucide-react icons, `cn()`
(clsx + tailwind-merge, extended for the custom font sizes).

## Where things live

| Piece | File |
| --- | --- |
| Shell layout, state, shortcuts | `client.tsx` (`AppWithConfig` → `ShellContext`) |
| Shared shell state contract | `shell/shell-context.tsx` (`useShell()`, `useOptionalShell()`) |
| Toolbar, dock, toasts, stage effects | `shell/toolbar.tsx`, `shell/device-dock.tsx`, `shell/toasts.tsx`, `shell/stage-effects.tsx` |
| Navigator, palette, phone link | `shell/navigator.tsx`, `shell/command-palette.tsx`, `shell/phone-link.tsx` |
| Inspector + tabs | `inspector/inspector.tsx`, `inspector/{device,app,capture,activity}-tab.tsx` |
| Console views | `console/console-panel.tsx`, `console/{logs,input,accessibility,web}-view.tsx` |
| Full-page scenes | `scenes/{wall,empty,disconnected}-scene.tsx` |
| Primitives | `ui/*` — Button, IconButton, Segmented, Switch, Slider, Select, Section, Row, RowIcon, InfoRow, Disclosure, TextField, TextArea, Stepper, ValueChip, Badge, StatusDot, Kbd, Shortcut, Tip, RollingNumber, AreaChart, Sparkline, GlassGroup |
| Motion tokens | `lib/motion.ts` — `spring`, `project()`, `rubberband()` |
| Theme | `lib/theme.ts` — `useTheme()`, `THEME_BOOT_SCRIPT` (inlined in the page head) |

Use the primitives. Don't re-derive their class strings.

## Surfaces

- **Stage:** `.stage-bg` — a soft floor falling into a vignette. Nothing else paints a page background.
- **Panels** (navigator, inspector, console): `.glass`, `rounded-[24px]` (console `rounded-[22px]`), inset 10px from the window, sliding in on `spring.surface`. On windows under 1080px they float over the stage instead of resizing it.
- **Toolbar capsules:** `GlassGroup` (`.glass-sm`, full radius). The toolbar itself is transparent.
- **Menus, popovers, palette, toasts:** `.glass-pop` with `.menu-pop` (materialize from the trigger via `--transform-origin`).
- **Inside a panel:** only `Section` → `.group-box` → `Row`s with an inset hairline. No cards in cards; no borders around sections.

## Colour

Semantic tokens only (`text-label`, `text-label-2/3`, `bg-fill`, `bg-fill-2/3`, `bg-group`, `bg-control`, `bg-ink`, `text-on-ink`, `border-separator`). Selection and primary actions are **ink** (graphite in light, white in dark). Hue is reserved for status (`green`/`orange`/`red`), the record button, and the AX overlay (blue boxes, orange when hot). Never hard-code a grey. Icons stay at full label colour, not low opacity: use `text-label-2/3` for disabled states.

## Type

macOS sizes: `text-caption2`, `caption`, `footnote`, `body` (default 13px), `headline`, `title3`, `title2`, `title1`, `large`, `numeral`. Each carries its own tracking. Sentence case everywhere. Every number, id, path, port or timestamp is `font-mono` (tabular). Long values wrap with `[overflow-wrap:anywhere]` or clamp; nothing overflows the 296px inspector content width.

## Controls follow the data

boolean → `Switch` · 2–4 short options → `Segmented` · long enum → `Select` · range → `Slider` (with `ticks` for stepped values) · bounded integer → `Stepper` · read-only value → `InfoRow` / `ValueChip` · rare or advanced group → `Disclosure`. Destructive actions confirm inline (morph), not with a modal.

## Device & stage

- The bezel is `components/device-bezel.tsx`: Simulator.app's own artwork from the profile's `DeviceFrameSpec`, with real pressable controls that push out under the pointer. Never hand-draw a device.
- Under the device: the **contact shadow**, then the **device dock** (`.glass`, 50px, magnifying icons with rising labels). Duo adds the fold capsule below the dock.
- **Screen light:** `ScreenGlow` + `useScreenColors()` sample the largest painted stream surface into a 2×2 canvas about once a second. Blend and strength are theme tokens (`--glow-blend`, `--glow-strength`).
- The device rises in on load and re-fits on a spring whenever a panel opens or the console resizes.

## Motion

Springs for anything a person can touch (`spring.ui` 0.35s, `snappy` 0.22s, `surface` 0.5s, all critically damped). Bounce (`spring.momentum`) only after a throw: flicked toasts, the phone page's fullscreen button, a console resize past its limit (`rubberband`). Every animation starts from the on-screen value so it can be interrupted. One driving value per morph: the record button's width, height, timer and mark all derive from a single spring `p` so the capsule never overshoots one way and snaps back another. `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast` are honoured in `global.css`.

## Shortcuts

⌘0 navigator · ⌥⌘0 inspector · ⌘J console · ⌘K palette · ⌘S screenshot · ⇧⌘A appearance · ⇧⌘H home · ⌥⌘K software keyboard. Shell shortcuts are captured before keystroke forwarding so they never reach the simulator.

## Self-check before finishing

1. Compare against `design/serve-sim-design.html` in light and dark.
2. No raw greys, no `text-[Npx]`, no low-opacity icons, no nested cards.
3. Numbers are mono; labels are sentence case; long values wrap.
4. Every animated value is a spring from `lib/motion.ts` and is interruptible.
5. `bun run check` passes (format, lint, typecheck, knip, hermetic tests).

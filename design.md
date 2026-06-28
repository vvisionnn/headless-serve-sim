# Apple Developer — Design System

> Extracted live from `developer.apple.com` (landing), `developer.apple.com/design/`,
> and `developer.apple.com/documentation/` via `agent-browser eval` (DOM + computed
> styles + CSS variables + stylesheet rules). Synthesized for reuse by AI agents
> building a **dark developer-tool web UI**: top-bar chrome, a collapsible side
> inspector, rectangular content blocks, hairline dividers, and minimal radius.
>
> Values marked **(observed)** are read directly from the live site. Values marked
> **(inferred)** are reasonable rules synthesized to fill gaps for the dark tool
> consumer. Apple ships *two* visual registers and this doc captures both:
> the **marketing register** (rounded pills, big editorial type, generous air) and
> the **developer-tool / DocC register** (rectangular, hairline-divided, dense,
> theme-aware). **Prioritize the DocC register** — it is the closest analog to the
> consumer.

---

## Visual Theme & Atmosphere

Apple's developer surfaces feel **precise, quiet, and structural**. Nothing shouts.
The system is built on near-neutral grays layered against pure black (dark) or pure
white (light), with a single restrained blue carrying every interactive signal.
Type does the heavy lifting: a tight, high-contrast SF Pro hierarchy where weight and
size — not color or decoration — establish rank. Surfaces are separated not by
shadows or heavy borders but by **1px hairline keylines** and subtle fill shifts
(black → `#111` → `#1d1d1f`). Corners are effectively square in the dense content
register; rounding only appears on marketing tiles (18px) and chrome pills (full
radius). The result reads as engineered rather than decorated — content sits in
crisp rectangular blocks divided by thin rules, the way a well-set technical
document or a native macOS inspector does.

Motion is deliberately understated: short color/opacity transitions on the order of
~300ms using Apple's signature deceleration easing, never bouncy, never long. The
overall mood an agent should reproduce: **restraint, structural clarity, hairline
precision, and a single confident accent.** Whitespace is purposeful in marketing
contexts and compressed-but-legible in tool contexts; the dark developer tool should
lean toward the compressed end — minimal padding, dividers doing the spatial work.

### Key Characteristics

- **Hairline-divider system** — surfaces separated by `1px solid` keylines
  (`#D2D2D7` light / `#424245` dark), not shadows or thick borders.
- **Square content, rounded chrome** — content blocks `0px` radius; only marketing
  tiles round (18px) and nav/CTA pills go fully round (980px).
- **Neutral-gray layering** — three near-black surfaces (`#000` / `#1d1d1f` / `#111`)
  in dark; three near-white (`#FFF` / `#F5F5F7` / `#FAFAFA`) in light.
- **One accent, two blues** — conservative `#0066CC` (doc/tool links) and brighter
  `#2997FF` (dark-mode links/glyphs); `#0071E3` for filled primary buttons.
- **Weight-driven type rank** — SF Pro Display for headings (600), SF Pro Text for
  body (400), with tight negative tracking on body and near-zero on display.
- **Theme-aware tokens** — full light/dark token mirror; neutrals invert, the blue
  accent shifts brighter in dark.

---

## Color Palette & Roles

Apple exposes a large CSS-variable token system. Below are the load-bearing roles
for a dark tool, with both theme variants. All hex **(observed)** unless noted.

### Primary / Accent

| Role | Light | Dark | Notes |
|---|---|---|---|
| Link / interactive (tool, conservative) | `#0066CC` | `#2997FF` | DocC link color. Use this for the dev tool. |
| Link / glyph (marketing) | `#0071E3` | `#2997FF` | Brighter marketing blue. |
| Filled primary button bg | `#0071E3` | `#0071E3` | Stable across themes (`--color-button-background`). |
| Filled primary button text | `#FFFFFF` | `#FFFFFF` | |
| Accent — light blue (hover/secondary) | `#7DC1FF` | `#7DC1FF` | |
| Accent fill / selection tint | `rgba(0,113,227,.5)` | `rgba(0,113,227,.5)` | Navigator item hover. |

> **Two-blue rule:** the developer tool should use the **conservative `#0066CC`** for
> links on light surfaces and **`#2997FF`** on dark surfaces. Reserve the solid
> `#0071E3` pill for the single primary action.

### Neutral Scale (text + glyph)

| Role | Light | Dark |
|---|---|---|
| Text primary | `#1D1D1F` | `#F5F5F7` |
| Text secondary | `#6E6E73` | `#A1A1A6` |
| Text tertiary / muted | `#86868B` | `#86868B` |
| Label on emphasis | `#000` | `#FFFFFF` |
| Eyebrow / caption gray | `#6E6E73` | `#86868B` |

### Surface & Overlay (layering)

| Role | Light | Dark | Token |
|---|---|---|---|
| Canvas / base | `#FFFFFF` | `#000000` | `--color-fill` |
| Surface primary (panels, cards) | `#FAFAFA` | `#1D1D1F` | `--color-background-primary` / `--fill-tertiary` |
| Surface secondary | `#F5F5F7` | `#161617` | `--fill-secondary` |
| Surface raised / alt | `#F5F5F7` | `#111111` | `--fill-tertiary-alt` |
| Hover surface | `#F5F5F7` | `#2C2C2E` | `--color-background-hover` |
| Code / inset fill | `#F9FAFA` | `#333336` | `--color-code-background` |
| Global nav bg | `#FAFAFC` | `#1D1D1F` / `#161617` | `--r-globalnav-background-opened` |

### Borders & Dividers (the signature)

| Role | Light | Dark |
|---|---|---|
| **Hairline divider / keyline** | `#D2D2D7` | `#424245` |
| Card / block border | `#D2D2D7` | `rgba(255,255,255,.25)` |
| Card shadow color (barely-there) | `rgba(0,0,0,.04)` | `rgba(255,255,255,.04)` |
| Strong shadow (overlays only) | `rgba(0,0,0,.5)` | `rgba(0,0,0,.5)` |

> **All dividers are `1px solid`.** This is the single most important reusable trait
> for the consumer. Use `#424245` on dark surfaces for every rule, table line, panel
> edge, and section separator.

### Semantic / Status (figure colors — used for badges, asides, syntax)

| Role | Hex (stable across themes) |
|---|---|
| Green (success) | `#03A10E` |
| Red (error/warning) | `#FF3037` |
| Orange (deprecated) | `#F56300` |
| Yellow (caution) | `#936D00` (light) / `#FFB50F` (dark) |
| Teal (tip) | `#00C2BB` / `#7DFFE4` (dark) |
| Purple (experimental) | `#A95ED2` |
| Pink | `#F14BF1` |

Asides pair each figure color with a dark tinted background, e.g. warning
`#FF3037` text on `#330000`, tip `#00C2BB` on `#002D2B`, deprecated `#F56300` on
`#290D00`. **(observed)**

### Code Syntax (dark — for a developer tool, highly relevant)

| Token | Hex |
|---|---|
| Plain text | `#FFFFFF` |
| Keywords | `#FF7AB2` |
| Strings | `#FF8170` |
| Numbers / characters | `#D9C97C` |
| Comments | `#7F8C98` |
| Type declarations | `#6BDFFF` |
| Other type names | `#DABAFF` |
| Function / method names | `#B281EB` |
| Preprocessor / macros | `#FFA14F` |
| URLs | `#6699FF` |
| Code line highlight | `rgba(41,151,255,.08)` |

### Quick Color Reference (dark tool — copy/paste)

```
--bg:            #000000   /* canvas */
--surface-1:     #1d1d1f   /* panels, side inspector, cards */
--surface-2:     #161617   /* nested / secondary fill */
--surface-3:     #111111   /* raised alt */
--hover:         #2c2c2e   /* row/control hover */
--divider:       #424245   /* every hairline rule */
--text:          #f5f5f7   /* primary text */
--text-2:        #a1a1a6   /* secondary text */
--text-3:        #86868b   /* muted / captions */
--accent:        #2997ff   /* links, interactive (dark) */
--accent-solid:  #0071e3   /* filled primary button */
--code-bg:       #333336
```

---

## Typography Rules

### Font Family

```
Display / headings: "SF Pro Display", -apple-system, "Helvetica Neue", Arial, sans-serif
Body / UI:          "SF Pro Text", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif
Code:               "SF Mono", ui-monospace, Menlo, Monaco, monospace
```

Apple swaps SF Pro **Display** for sizes ≥ ~24px and SF Pro **Text** below that. If
SF Pro is unavailable, `-apple-system` / system-ui reproduces it on Apple devices;
otherwise Helvetica Neue / Inter is the closest fallback. **(observed for family;
fallback chain partly inferred)**

### Hierarchy (observed computed values)

| Role | Font | Size | Weight | Line height | Tracking | Color (dark) |
|---|---|---|---|---|---|---|
| Display H1 / hero | SF Pro Display | 40px | 600 | 44px | `normal` (~0) | `#F5F5F7` |
| Section H2/H3 | SF Pro Display | 32px | 600 | 36px | +0.128px | `#F5F5F7` |
| Subhead / lead ¶ | SF Pro Display | 21px | 400 | 25px | +0.231px | `#F5F5F7` |
| Body | SF Pro Text | 17px | 400 | 25px | **−0.374px** | `#F5F5F7` |
| Body small / meta | SF Pro Text | 14px | 400 | 20px | −0.224px | `#A1A1A6` |
| Eyebrow / overline label | SF Pro Text | 12px | 400 | 16px | −0.12px | `#6E6E73` |
| Nav link | SF Pro Text | 17px | 600 | — | — | `rgba(255,255,255,.8)` |
| Filled button label | SF Pro Text | 17px | 400 | — | — | `#000` / `#FFF` |

> Larger Apple display type (52–80px hero on full marketing pages) also exists but is
> out of register for a dense dev tool; the 40/32/21/17/14/12 ladder above is the
> reusable scale.

### Principles

- **Negative tracking on body, near-zero on display.** Body text is tightened
  (−0.374px @ 17px ≈ −0.022em). This compactness is part of the brand — reproduce it.
- **Weight, not color, marks hierarchy.** Headings are 600; body 400. There is no
  bold-blue heading convention. Keep headings the same neutral text color as body.
- **Tight line heights.** Headings run ~1.1× (40/44, 32/36); body ~1.47× (17/25).
- **Eyebrows are uppercase-feel small gray labels** at 12px sitting above section
  titles, in secondary gray — used as section kickers.
- **Links carry no underline by default;** underline appears on hover only. Link
  color is the only place the blue accent touches text. **(observed)**

---

## Component Stylings

### Buttons

Two button families. **For the dark dev tool, prefer the rectangular/ghost variants
and reserve one filled pill for the primary action.**

**Filled pill (primary CTA — marketing register):**
- Light surface action: bg `#F5F5F7`, text `#000`; primary action: bg `#0071E3`,
  text `#FFF`.
- Radius `980px` (fully round), padding `9px 16px`, font 17px/400, border
  `1px solid transparent`. Small chrome variant (nav "Sign in"): 12px, padding
  `3px 10px`, height 24px. **(observed)**

**Rectangular / tool button (inferred for consumer, grounded in DocC controls):**
- Radius `0px` (or ≤4px if softening needed), `1px solid #424245` border on dark,
  bg transparent → `#2c2c2e` on hover, text `#F5F5F7`, label 13–14px.
- Selected/active: bg tinted `rgba(0,113,227,.5)` or text → accent.

**Text / chevron link (heavily used):**
- No background, accent color (`#2997FF` dark / `#0066CC` light), 17px/400,
  no underline default → underline on hover. Often paired with a trailing chevron
  glyph. This is Apple's default "more" affordance. **(observed)**

### Cards & Containers

- **Developer-tool / content blocks: `0px` radius, no shadow.** Separation comes from
  a `1px #424245` hairline border and/or a fill shift to `#1d1d1f`. **(observed in
  DocC + landing content cards.)**
- **Marketing tiles: `18px` radius**, fill `#F5F5F7` (light) / `#1d1d1f` (dark),
  no border, no shadow. Used only in editorial grids. **(observed)**
- Link-block cards in dark get a faint `rgba(255,255,255,.25)` border and a barely
  perceptible `rgba(255,255,255,.04)` shadow — effectively "shadow-as-hint," never
  a drop shadow. **(observed)**

### Inputs & Forms

**(partly inferred — grounded in DocC filter/search field):**
- Field: `1px solid #424245` border, bg `#1d1d1f` (or `#333336` for inset search),
  radius `0px`–`6px`, text `#F5F5F7`, placeholder `#86868B`.
- Focus: border → accent `#2997ff` (no glow ring in the dense register; a subtle
  `box-shadow: 0 0 0 1px #2997ff` is acceptable).
- Padding ~`8px 12px`; font 14–17px.

### Navigation

**Top bar (global nav):**
- Height **`44px`** fixed, bg `#1D1D1F` (dark) / `#FAFAFC` (light), links 17px/600 at
  `rgba(255,255,255,.8)` → full white on hover. Sticky/translucent (`backdrop-filter`
  blur) when scrolled. Color transition `0.32s cubic-bezier(0.4,0,0.6,1)`.
  **(observed)** — map this directly onto the consumer's top bar.

**Side navigator / inspector (DocC left rail — the model for the collapsible
inspector):**
- Vertical list, rows at 17px (compress to 13–14px for a tool), row padding
  `0 20px`, line-height 25px. No item borders; the rail is separated from content by
  a single `1px #424245` keyline on its trailing edge.
- Current item: accent-tinted background / accent text. Hover:
  `rgba(0,113,227,.5)` tint or `#2c2c2e`. Collapsible hierarchy with disclosure
  chevrons. **(observed structure; exact row metrics partly inferred.)**

### Image Treatment

- Photography is full-bleed, high-contrast, product-forward; illustration is minimal.
- In the content register images sit in square frames (no radius); in marketing tiles
  they inherit the 18px tile rounding. No borders on imagery. **(observed)**

### Distinctive Components — Asides / Callouts

Apple's doc **asides** are a signature pattern worth reusing for a dev tool:
left-accent-bar callouts. Each type = a figure color + dark tinted bg + matching
left border. E.g. Note: `#9A9A9E` on `#323232`; Warning: `#FF3037` on `#330000`;
Tip: `#00C2BB` on `#002D2B`; Deprecated: `#F56300` on `#290D00`. Rectangular,
`0px` radius, `1px` or 3px left accent border. **(observed)**

---

## Layout Principles

### Spacing System

Apple's spacing is anchored to a ~**8px base** with a recurring 17px-derived rhythm.
Observed section values: `8`, `20`, `25.5`, `51`px (note `25.5 = 51/2`, and `51 = 3×17`).
**(observed)**

```
Reusable scale (dark tool):  4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64
Section vertical rhythm:     ~25.5px / 51px between major content blocks
Control / row padding:       4–12px (the tool register is tight)
```

> **Compression as identity for the tool:** the consumer wants minimal/zero padding.
> Lean on dividers (not whitespace) to separate; use 0–8px block padding and let the
> `1px #424245` rules carry the structure.

### Grid & Container

- Content max-width **`980px`** (`--sc-section-content`); responsive content width
  `87.5%` of viewport (`--sc-viewport-content-responsive`). **(observed)**
- Gallery/card grids: card width ~`310px`, column gap `24px`. **(observed)**
- For a full-bleed tool shell, override the 980px cap — use the top bar + side
  inspector as the frame and let content fill remaining width.

### Whitespace Philosophy

Marketing pages are airy; the developer/doc register is **dense and rule-divided.**
Reproduce the dense register: tight padding, hairline separation, content packed into
rectangular blocks. Whitespace is a tool, not a default.

### Border Radius Scale

| Context | Radius |
|---|---|
| Content blocks / tables / inspector / fields | **`0px`** (the default for the tool) |
| Soft control (optional) | `4–6px` |
| Marketing tile | `18px` |
| Code block | `15px` (marketing) → `0px` for tool |
| Pill button / chrome | `980px` (fully round) |

> **Radius rule for the consumer: default to `0px`.** Only the single primary CTA
> may use the pill; everything structural is square.

---

## Depth & Elevation

Apple **avoids shadows for structure.** Elevation is communicated by:

1. **Hairline borders** (`1px #424245` dark / `#D2D2D7` light) — the primary
   separator.
2. **Fill shifts** — `#000 → #1d1d1f → #161617` step a surface "up."
3. **Barely-there shadows** — only `rgba(255,255,255,.04)` (dark) / `rgba(0,0,0,.04)`
   (light) on the rare raised card; never a visible drop shadow.
4. **Real shadows reserved for true overlays** (menus, popovers): `rgba(0,0,0,.5)`.

There is **no z-layer shadow ramp.** For the dark tool: separate panels with
dividers and fill shifts; use a single strong shadow only for floating overlays.
**(observed)**

---

## Do's and Don'ts

**Do**
- Use `1px solid #424245` hairline dividers as the primary structural device.
- Keep content blocks square (`0px` radius).
- Drive hierarchy with SF Pro weight/size, not color.
- Tighten body tracking (~−0.022em) to match the brand feel.
- Use exactly one accent blue per surface (`#2997FF` on dark) for all interactive text.
- Layer surfaces by fill (`#000`/`#1d1d1f`/`#161617`), not by shadow.
- Keep motion short (~300ms) with `cubic-bezier(0.4,0,0.6,1)` deceleration.

**Don't**
- Don't add drop shadows for structure or rounded corners to content blocks.
- Don't introduce a second accent hue or colored headings.
- Don't pad generously in the tool register — let dividers do the spacing work.
- Don't underline links by default (underline on hover only).
- Don't use bouncy/long animations or parallax in the tool register.
- Don't use low-opacity icons or text below ~0.6 alpha (keep glyphs crisp).

---

## Responsive Behavior

### Breakpoints (observed — Apple's canonical set)

| Breakpoint | Role |
|---|---|
| `320px` | small phone floor |
| `734 / 735px` | phone → tablet |
| `1068 / 1069px` | tablet → desktop |
| `1440px` | large desktop |

Container caps at `980px` content with `87.5%` fluid width below. **(observed)**

### Collapsing Strategy

- **Top bar** stays 44px; on narrow widths the link cluster collapses into a menu
  trigger (hamburger), nav background gains blur/translucency. **(observed pattern)**
- **Side inspector** collapses to a slide-over / toggle below the tablet breakpoint;
  the `1px` keyline becomes the panel's leading edge. **(inferred for consumer,
  grounded in DocC navigator collapse.)**
- Multi-column card grids reflow to single column under ~734px.

### Touch Targets

Interactive rows/controls should hold ≥44px touch height on touch widths even though
the visual row may be denser on desktop (Apple's 44px HIG minimum). **(inferred, HIG.)**

---

## Interaction Patterns

- **Hover:** links underline + slightly brighten; nav links fade `rgba(255,255,255,.8)
  → #fff` over `0.32s`; rows tint to `#2c2c2e` or `rgba(0,113,227,.5)`. **(observed)**
- **Scroll:** top bar becomes sticky and translucent (backdrop blur); content does not
  parallax in the tool register. **(observed)**
- **Theme toggle:** neutrals invert wholesale via the light/dark token mirror; the
  blue accent shifts brighter in dark (`#0066CC → #2997FF`); dividers go
  `#D2D2D7 → #424245`; code/syntax colors swap to the dark syntax set. **(observed)**
- **Motion feel:** crisp and restrained. Durations ~0.3s, easing
  `cubic-bezier(0.4,0,0.6,1)` (decelerate) and `cubic-bezier(0.645,0.045,0.355,1)`
  (in-out). Never bouncy. **(observed)**

---

## Content & Messaging Patterns

- **Headlines:** confident, plain, present-tense, often imperative — "Design
  incredible apps and games," "Discover agentic coding in Xcode." Short, no hype
  punctuation. **(observed)**
- **CTAs:** verb-first and concrete — "Watch now," "Try it now," "Sign up now,"
  "Read now," "Take the survey." Single clear action per block. **(observed)**
- **Body:** technical-but-accessible; precise nouns, minimal adjectives. Trust comes
  from specificity, not adjectives.
- **Eyebrows:** short category labels above titles ("Explore Get Started,"
  "Stay Updated"). **(observed)**
- **Voice for the tool:** direct, technical, sparse. Match Apple's "say it once,
  precisely" tone — no marketing fluff in a developer surface.

---

## Agent Prompt Guide

Drop-in instructions for an agent restyling the dark developer tool.

### Global directive

> Build a **dark developer-tool UI in the Apple DocC register.** Canvas `#000`,
> panels `#1d1d1f`, nested fills `#161617`. Separate everything with **`1px solid
> #424245` hairline dividers** — no drop shadows, no rounded corners on content
> (`0px` radius). Text `#f5f5f7` primary / `#a1a1a6` secondary in SF Pro
> (Display 600 for headings, Text 400 for body, body tracking −0.022em). One accent:
> `#2997ff` for all interactive text/links (no underline until hover). Tight padding;
> let dividers carry the structure. Motion ≤300ms, `cubic-bezier(0.4,0,0.6,1)`.

### Example Component Prompts

**Top bar**
> 44px-tall top bar, bg `#1d1d1f`, 17px/600 nav links at `rgba(255,255,255,.8)`
> brightening to `#fff` on hover over 0.32s `cubic-bezier(0.4,0,0.6,1)`. Bottom edge
> is a single `1px #424245` keyline. Sticky + translucent (backdrop blur) on scroll.
> No radius, no shadow.

**Side inspector (collapsible)**
> Left/right rail on `#1d1d1f`, separated from content by one `1px #424245` keyline on
> its inner edge. List rows: 13–14px SF Pro Text, `#f5f5f7`, padding `4px 12px`, hover
> bg `#2c2c2e`, selected = `#2997ff` text on `rgba(0,113,227,.18)`. Disclosure chevron
> for collapsible groups. Square corners. Collapses to a toggle below 1068px.

**Content block / card**
> Rectangular block, `0px` radius, bg `#1d1d1f`, separated by `1px #424245` borders —
> no shadow. Title in SF Pro Display 17–21px/600 `#f5f5f7`; body 13–14px/400 `#a1a1a6`.
> Tight internal padding (8–12px). Trailing chevron-text link in `#2997ff`.

**Primary button + ghost button**
> Primary: solid `#0071e3` bg, white 13–14px label, radius `6px` (or pill `980px` only
> if it's the single hero action), padding `8px 14px`, no border. Ghost/secondary:
> transparent bg, `1px solid #424245` border, `#f5f5f7` label, hover bg `#2c2c2e`,
> `0px`–`6px` radius.

**Table / data grid**
> Square table, header row text `#86868b` 12px, cells `#f5f5f7` 13–14px. Every row
> separated by a `1px #424245` bottom border. No outer radius, no zebra fill (or a
> faint `#161617` zebra). Hover row → `#2c2c2e`.

**Code block**
> bg `#333336` (or `#1d1d1f`), `0px` radius for the tool, SF Mono 13px, plain text
> `#fff`, keywords `#ff7ab2`, strings `#ff8170`, types `#6bdfff`, comments `#7f8c98`,
> numbers `#d9c97c`. Optional active-line highlight `rgba(41,151,255,.08)`.

**Aside / callout**
> Rectangular callout, `0px` radius, 3px left accent border + dark tinted bg matching
> the type — Note `#9a9a9e`/`#323232`, Warning `#ff3037`/`#330000`, Tip
> `#00c2bb`/`#002d2b`, Deprecated `#f56300`/`#290d00`. Title in the accent color,
> body in `#f5f5f7`.

### Iteration Guide

- **Too soft / generic?** Remove radius (→ `0px`), delete shadows, add more `1px
  #424245` dividers, tighten padding.
- **Too flat / muddy?** Step a panel up a fill (`#000 → #1d1d1f → #161617`) instead of
  adding a border or shadow.
- **Too loud?** Cut accent usage to links + the single primary button; make headings
  neutral text color, not blue.
- **Off-brand type?** Switch headings to SF Pro Display 600, body to SF Pro Text 400,
  and apply −0.022em body tracking.
- **Motion feels cheap?** Shorten to ~250–320ms, swap easing to
  `cubic-bezier(0.4,0,0.6,1)`, drop any bounce/scale.

---

## Observed Pages

| Surface | URL | Register | Default theme |
|---|---|---|---|
| Developer landing | `developer.apple.com/` | Marketing (rounded pills, editorial) | Dark (`#000`) |
| Design | `developer.apple.com/design/` | Marketing/editorial (18px tiles) | Light (`#FFF`) |
| Documentation (DocC) | `developer.apple.com/documentation/swift` | Developer-tool (hairline, dense) | Light, full dark token set present |

## Evidence Notes

- **Strong / observed:** full light + dark CSS-variable token sets, computed type
  hierarchy, hairline divider colors, radius values, nav height (44px), content
  max-width (980px), section spacing values, breakpoints, easing curves, syntax
  colors, button computed styles.
- **Inferred (clearly labeled inline):** the *rectangular tool-button*, *input/form*,
  and *side-inspector row metrics* are synthesized for the dark-tool consumer —
  grounded in DocC controls but Apple ships these mostly inside native apps, so exact
  web pixel values were extrapolated from the DocC navigator + filter field rather
  than read off a single element.
- **Gaps:** DocC's resolved dark *nav* token values (`--color-nav-dark-*`) are
  indirections that point to further variables not all resolvable from the light-mode
  DOM; their concrete hexes were inferred from the surrounding dark surface scale
  (`#1d1d1f` / `#161617` / `#424245`). Disabled/focus-ring states for tool controls
  were not directly observable and are proposed conservatively.

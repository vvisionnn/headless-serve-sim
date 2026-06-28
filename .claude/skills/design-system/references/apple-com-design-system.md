# Apple.com Design System

> Extracted live from `https://www.apple.com/` (homepage, light default) via DOM +
> computed-style inspection. This is a design **rulebook**: enough for another agent to
> rebuild Apple's marketing-web language — color, type, components, motion, spacing —
> without seeing the site. Dark-mode values are Apple's canonical system colors and are
> labelled as inferred where they were not scraped from the (light-locked) homepage.

---

## 1. Visual Theme & Atmosphere

Apple.com is **calm, bright, and spacious** — a gallery, not a dashboard. The product is
the hero; the UI gets out of the way. The mood comes from four moves working together:

- **Light, airy canvas.** Pure white (`#ffffff`) and a single light gray (`#f5f5f7`)
  alternate down the page to separate sections. There is almost no chrome — no boxes
  around things, no visible grid, no heavy borders. Negative space *is* the layout.
- **One typeface, many sizes.** Everything is San Francisco (SF Pro). Hierarchy is built
  entirely from **size and weight**, never color or decoration. A 56px/600 headline next
  to 17px/400 body is the whole system.
- **Flat structure, rounded controls.** Big structural surfaces — the nav bar, content
  sections, the footer — are **perfectly flat with 0px corners and no shadow**. The only
  rounded things are *interactive*: buttons are full **pills (980px)**, cards soften to
  ~12–18px. This contrast (square scaffolding, pill controls) is a signature.
- **Restrained, decelerating motion.** Hover and state changes ease in `cubic-bezier(0.4,
  0, 0.6, 1)` over ~0.3s. Nothing bounces, nothing springs, nothing is fast. Motion feels
  *expensive and quiet*.

The net feeling is **premium retail**: a clean white table, one device under a spotlight,
a blue "Learn more" pill, and a lot of room to breathe.

---

## 2. Color Palette & Roles

Apple's tokens come from its **"Spektr" (`--sk-*`) system**. Roles matter more than hex.

### Light mode (default — observed)

| Role | Hex | Token | Use |
| --- | --- | --- | --- |
| Canvas | `#ffffff` | `--sk-fill` / body bg | Page background, primary surface |
| Surface secondary | `#fafafc` | `--sk-fill-secondary` | Subtle raised fill |
| **Surface tertiary** | `#f5f5f7` | `--sk-fill-tertiary` | The workhorse: alternating sections, cards, footer, neutral buttons |
| Faint fill | `#e8e8ed` | `--sk-fill-gray-quaternary` | Tracks, wells, hover on light |
| **Text primary** | `#1d1d1f` | `--sk-body-text-color` | Headlines + body (near-black, never pure black) |
| Text secondary | `#6e6e73` | `--sk-glyph-gray-secondary` | Captions, sublabels, footer body |
| Text tertiary | `#86868b` | `--sk-glyph-gray-tertiary` | Eyebrows, disabled, finest print |
| **Link blue** | `#0066cc` | `--sk-body-link-color` | Text links ("Learn more ›") |
| **Fill blue** | `#0071e3` | `--sk-fill-blue` | Filled primary button + focus ring |
| Divider | `#d2d2d7` | `--sk-fill-gray-tertiary` | Hairline rules, borders |
| Success | `#008009` glyph / `#03a10e` fill | `--sk-glyph/fill-green` | Positive status |
| Warning | `#b64400` glyph / `#f56300` fill | `--sk-glyph/fill-orange` | Caution |
| Danger | `#e30000` | `--sk-fill-red` | Errors, destructive |
| Yellow | `#ffe045` | `--sk-fill-yellow` | Highlights |

**Primary on white is the rule.** Color is almost absent except for **one blue**
(`#0066cc` text / `#0071e3` fill). Status colors appear only as small accents (dots,
badges), never as large fills.

### Dark mode (Apple canonical — inferred, not scraped from the light homepage)

Apple's homepage is light-locked; these are Apple's standard dark system values, used on
its dark product sections and in the HIG. Map 1:1 to the light roles above.

| Role | Hex | Use |
| --- | --- | --- |
| Canvas | `#000000` | Page background |
| Surface | `#1d1d1f` | Cards, bars, raised fill |
| Surface deep | `#161617` | Nested / secondary fill |
| Surface hover | `#2c2c2e` | Row / control hover |
| Text primary | `#f5f5f7` | Headlines + body |
| Text secondary | `#a1a1a6` | Sublabels |
| Text tertiary | `#86868b` / `#6e6e73` | Eyebrows, finest print |
| Link blue | `#2997ff` | Text links (brighter for contrast) |
| Fill blue | `#0071e3` (hover `#0077ed`) | Filled primary button |
| Divider | `#424245` | Hairline rules |
| Success / Danger / Warning | `#30d158` / `#ff453a` / `#ff9f0a` | Status accents (dark variants) |

---

## 3. Typography Rules

### Font Family
- **`"SF Pro Text"`** for body and UI ≤ ~28px; **`"SF Pro Display"`** for large text ≥ ~28px
  (Apple swaps the optical face around 28px). `"SF Pro Icons"` for glyphs.
- Stack: `"SF Pro Text", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif`
  (swap `Text`→`Display` for the display stack).

### Hierarchy (observed computed values)

| Role | Family | Size / Line | Weight | Tracking | Color |
| --- | --- | --- | --- | --- | --- |
| Hero / headline | Display | 56px / 60px | 600 | -0.28px (~-0.005em) | `#1d1d1f` |
| Section title (h3) | Display | 40px / 44px | 600 | normal | `#1d1d1f` |
| Sub-headline (intro) | Display | 28px / 32px | 400 | +0.196px | `#1d1d1f` |
| Page title (h1) | Text | 34px / 50px | 600 | -0.374px | `#1d1d1f` |
| **Body** | Text | **17px / 25px** | 400 | **-0.374px (-0.022em)** | `#1d1d1f` |
| Sub / caption | Text | 14px / 20px | 400 | -0.016em | `#6e6e73` |
| **Eyebrow / footnote** | Text | 12px / 16px | 400 | -0.01em | `#6e6e73` |

### Principles
- **Hierarchy = size + weight only.** Never tint a heading to rank it. No blue headings.
- Body weight is **400**; headings are **600** (Apple rarely uses 700+). 500 for emphasis.
- Tracking is **negative and tightens as size grows** (~-0.022em at body, → near-zero at
  display). This is the single most "Apple" type detail — keep it.
- Line height is tight on display (~1.07) and comfortable on body (~1.47).
- Links: no underline at rest; underline on hover; **blue only**.

---

## 4. Component Stylings

### Buttons — the signature pill
- **Primary (filled):** bg `#0071e3`, white text, radius **`980px`** (full pill), padding
  **`11px 21px`**, 17px/400, tracking -0.374px, no border, no shadow. Hover: darken the
  fill (Apple shifts the fill, not a shadow).
- **Secondary (neutral pill):** bg `#f5f5f7`, text `#1d1d1f`, same 980px pill + padding.
- **Tertiary (outline pill):** transparent bg, **1px blue border + blue text**, 980px.
- **Text link CTA:** blue `#0066cc`, no chrome, often with a trailing chevron `›`;
  underline on hover.
- **Icon button:** circular tap target (radius `50%`), transparent, glyph in
  `#1d1d1f`/secondary; hover fills a faint circle. (Apple's nav search/bag.)
- Compact density: scale padding down to `~8px 16px` and font to 14px for toolbar pills,
  keeping the full-pill radius.

### Cards & Containers
- Fill `#f5f5f7` (or `#fafafc`), radius **~12–18px**, **no border, no shadow** — separated
  from the page by fill contrast alone. Large editorial tiles go to ~28px.
- Generous internal padding (Apple sections use 40–80px; in a dense UI, 16–24px).

### Inputs & Forms
- Field: subtle fill (`#fafafc` / `#f5f5f7`) or 1px `#d2d2d7` border, radius **~12px**
  (search fields go full pill), text `#1d1d1f`, placeholder `#86868b`.
- **Focus:** 1px `#0071e3` ring + `1px` offset (`--sk-focus-color`), not a glow.

### Navigation (global nav)
- **44px** tall, `position: fixed`, `z-index: 9999`, background **`rgba(255,255,255,0.8)`
  with `backdrop-filter: saturate(1.8) blur(20px)`** (frosted), **0px radius, no shadow**,
  a hairline `#d2d2d7` bottom edge when scrolled.
- Nav items ~12px, `#1d1d1f` at ~0.8 alpha, hover → full opacity. Evenly spaced, centered.

### Badges / Status
- Small **pill** (980px), 11–12px, tinted fill or solid status color, used sparingly.

### Image Treatment
- Product photography on white/light, often full-bleed, no border, no rounding on the
  image itself unless it's inside a rounded card. High-res, generous margins.

### Footer
- Fill `#f5f5f7`, 12px text in `#6e6e73`, hairline `#d2d2d7` dividers, dense link columns.

---

## 5. Layout Principles

- **Centered content columns** (~980–1024px) inside a full-bleed canvas (up to 2560px).
  Sections are full-width bands; their *content* is centered and width-capped.
- **Vertical rhythm by section.** The page is a stack of full-width sections that
  alternate `#ffffff` / `#f5f5f7`. Section padding is large (44px top nav offset; 48–80px
  section padding observed).
- **Flat scaffolding.** Structural surfaces (nav, sections, footer) are 0px-radius and
  shadowless. Layering is done by **fill shift**, never elevation.
- **Whitespace philosophy:** when unsure, add space. Apple under-fills; density comes only
  in functional UI (nav, footer link grids).

### Border Radius Scale
| Token | Value | Applies to |
| --- | --- | --- |
| `pill` | `980px` | Buttons, badges, segmented controls, search fields |
| `card` | `12–18px` | Cards, panels, inputs, menus, tool blocks |
| `sm` | `8px` | Compact controls, list rows, small chips |
| `circle` | `50%` | Icon buttons, avatars, dots |
| `flat` | `0px` | **Nav bars, sections, footers, structural shells** |

### Spacing System
- Type-relative rhythm: `0.4em` between stacked siblings, `0.8em` paragraph→element,
  `1.6em` paragraph→headline. In px: an **8px base** scale (8 / 12 / 16 / 20 / 24 / 32 /
  48 / 64 / 80).
- Pill padding `11px 21px`; nav height 44px; content gutters ≥16px.

---

## 6. Depth & Elevation

- **Near-zero elevation.** Apple builds depth with **fill contrast** (`#fff → #f5f5f7 →
  #e8e8ed`), not shadows. Structural blocks cast **no shadow**.
- **Frosted overlays** are the one exception: the nav and any sticky bar use
  `backdrop-filter: blur(20px) saturate(1.8)` over a translucent fill.
- **Floating layers** (dropdown menus, dialogs, popovers) get a single soft shadow —
  roughly `0 4px 24px rgba(0,0,0,0.12)` (light) / `rgba(0,0,0,0.5)` (dark) — never inline
  blocks.

---

## 7. Do's and Don'ts

**Do**
- Build hierarchy with size + weight in one typeface (SF Pro).
- Keep structural surfaces flat (0px, no shadow); reserve rounding for controls (pills).
- Use exactly one accent blue; let white space and fill shifts do the separating.
- Keep negative tracking on type; tighten as size grows.
- Animate with `cubic-bezier(0.4, 0, 0.6, 1)` at ~0.3s; shift fills on hover, not shadows.

**Don't**
- Don't tint headings or use color for hierarchy.
- Don't add borders/shadows to structural blocks, or round the big scaffolding.
- Don't use pure black (`#000`) for text in light mode — use `#1d1d1f`.
- Don't make motion fast, bouncy, or springy.
- Don't crowd: under-fill rather than over-fill.

---

## 8. Responsive Behavior

- **Breakpoints (observed):** small ≥320px, medium ≥834px, large ≥1024px.
- Nav collapses to a hamburger below ~834px; content columns go single-column and
  edge-padded (≥16px gutters).
- Type scales down per breakpoint (hero 56px → ~40px → ~32px on mobile).
- Touch targets ≥44px. Hover affordances become tap states on touch.

---

## 9. Agent Prompt Guide

**Hero block:**
> Full-width white section, centered column ≤980px. SF Pro Display headline 48–56px/600,
> tracking ~-0.005em, `#1d1d1f`; a 24–28px/400 subhead below in `#1d1d1f`. Two pill
> buttons centered: a filled `#0071e3` white-text pill ("Learn more") and an outline
> blue-text pill ("Buy"), both 980px radius, 11px 21px padding. Generous vertical space.

**Card / tile:**
> `#f5f5f7` fill, 18px radius, no border or shadow, 24px padding. SF Pro Display 24px/600
> title, 17px/400 `#1d1d1f` body, optional 13px `#6e6e73` caption. Separated from siblings
> by fill contrast and whitespace, not lines.

**Primary button:**
> 980px pill, bg `#0071e3`, white 17px/400 label, padding 11px 21px, no shadow. Hover
> darkens the fill over 0.3s `cubic-bezier(0.4,0,0.6,1)`. Focus = 1px `#0071e3` ring, 1px
> offset.

**Top nav bar:**
> 44px fixed bar, `rgba(255,255,255,0.8)` + `backdrop-filter: blur(20px) saturate(1.8)`,
> 0px radius, hairline `#d2d2d7` bottom edge. ~12px nav items in `#1d1d1f` at 0.8 alpha,
> evenly spaced; icon buttons are circular hover targets.

### Iteration Guide
- Too busy? Remove borders/shadows, increase whitespace, drop to one accent.
- Too plain? Add a frosted bar, a pill CTA, or a single `#f5f5f7` card band — not color.
- Wrong mood? Check tracking (must be negative) and that structure is flat while controls
  are pills.

---

## Appendix — Evidence Notes

- **Observed** (live computed styles, apple.com homepage, 1280px viewport, light): all
  light-mode hex, the type table, `980px` pill (`.button` bg `#0071e3`; `.button-neutral`
  bg `#f5f5f7`, padding 11px 21px), nav `44px` / `rgba(255,255,255,0.8)` / blur(20px)
  saturate(1.8) / z-index 9999, radius census (980px ×35 dominant, 5px, 50%), motion
  `color 0.32s cubic-bezier(0.4,0,0.6,1)` (×204) + `opacity 0.24s` same curve, `--sk-*`
  Spektr token names and values.
- **Inferred / canonical** (labelled in §2): the dark-mode palette — Apple's homepage is
  light-locked and shipped no `prefers-color-scheme: dark` token block, so dark values are
  Apple's standard system dark colors, mapped role-for-role to the observed light tokens.

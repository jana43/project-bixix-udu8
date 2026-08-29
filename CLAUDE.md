# CLAUDE.md — Project Coding Standards

Shoppable Videos — a **Shopify Theme App Extension** that plays a merchant's videos on
their storefront, with tagged products stuck to the frame. Six layouts, each an **app
block** merchants drop into their theme via the theme editor: carousel, story bar, grid,
masonry, stacked and floating bubble.

The extension lives in [extensions/shoppable-videos/](extensions/shoppable-videos/). The
carousel and story bar are rendered by **Preact**, built from
[sje-shoppable-scripts/](sje-shoppable-scripts/); the other four are Liquid skeletons for
now.

> ⚠️ There is also a `CLUADE.md` in this folder (note the spelling). It describes a
> **different extension** — breadcrumbs, the `brd--` prefix, `extensions/breadcrumbs/`.
> Ignore it. This file is the one that applies here.

---

## 1. Modularity — never write everything in one file

- Each snippet has **one responsibility**. Keep files small and composable.
- The **six blocks** in [blocks/](extensions/shoppable-videos/blocks/) are entry points
  only: resolve the widget from the metafield, draw the heading, hold the `{% schema %}`.
  Four of them ([SJE_Grid](extensions/shoppable-videos/blocks/SJE_Grid.liquid),
  `SJE_Masonry`, `SJE_Stacked`, `SJE_FloatingBubble`) are a **single `{% render %}` line**
  plus their schema. Keep them that way — shared markup belongs in the snippet.
- [snippets/sje-widget.liquid](extensions/shoppable-videos/snippets/sje-widget.liquid) is
  the shared skeleton markup and the editor-only notices.
  [snippets/sje-mount.liquid](extensions/shoppable-videos/snippets/sje-mount.liquid) is the
  mount point, the widget data, and the lazy loader — the loading rules live there **once**,
  keyed by layout, so a page with three carousels fetches one script.
- ⚠️ `{% render %}` runs in an **isolated scope**: `block` is NOT visible inside a snippet.
  Everything arrives as a parameter. That is why `widget_id`, `heading_scale` and the rest
  are passed explicitly rather than read off `block.settings`.
- ⚠️ **Liquid content in a theme app extension is capped at 100 KB** — every `.liquid` file
  under `blocks/` and `snippets/` counted together, comments included (they are stripped at
  render time, not at upload). Going over fails the deploy outright. Assets are NOT counted.
  Check before adding a large snippet: `wc -c blocks/*.liquid snippets/*.liquid`.
  Currently ~37 KB.
- ⚠️ **No angle-bracket tag names in JS comments.** Shopify's Liquid parser tokenises HTML
  *inside a `<script>` body*, so `// … an empty <ol>` is parsed as a real element that never
  closes and the build dies. Write "list", "script tag" instead. `{% comment %}` blocks ARE
  raw, so Liquid comments may say `<ol>` freely.
- ⚠️ **Never `{% render %}` a snippet from inside a `<style>` or `<script>` tag.** Shopify
  wraps every rendered snippet in `<!-- BEGIN app snippet: … -->`. In HTML those are
  harmless comments; inside a stylesheet `<!--` parses as a CSS token and takes the first
  rule after it down with it — silently.
- The Preact side follows the same rule: one component per file in
  [sje-shoppable-scripts/src/components/](sje-shoppable-scripts/src/components/), shared
  concerns in [src/lib/](sje-shoppable-scripts/src/lib/) (`mount`, `settings`, `sje`,
  `sticker`, `portal`, `tokens`, `icons`).

## 2. CSS naming — `sje-` prefix on every class and id

- **Every** class name and id in this extension is prefixed with `sje-` to avoid collisions
  with the merchant's theme, with **BEM** underneath it.
  - ✅ `.sje-widget`, `.sje-widget__item`, `.sje-widget--story-bar`, `#sje-carousel-123456`
  - ❌ `.widget`, `.video-item`, `.carousel`
- Three tiers, applied consistently:
  - **Block:** `.sje-widget`, `.sje-mount`, `.sje-scroller`
  - **Element (`__`):** `.sje-widget__items`, `.sje-widget__item`, `.sje-widget__heading`,
    `.sje-widget__notice`
  - **Modifier (`--`):** `.sje-widget--carousel`, `.sje-widget--pad-large`, `.sje-mount--{layout}`
- The prefix extends past class names, and all of it is the same convention:
  - **ids:** `id="sje-{{ layout }}-{{ widget_id }}"`
  - **data attributes:** `data-sje-widget-id`, `data-sje-settings`, `data-sje-portal`
  - **custom properties:** `--sje-standard-font-size`, `--sje-heading-font-size` (§3)
  - **keyframes:** `@keyframes sje-widget-pulse`
  - **globals:** `window.SJE.widgets`, `window.SJE.scripts`
  - **asset filenames:** `sje-widget.css`, `sje-carousel.js`, `sje-stories.js`
- ⚠️ The layout is **`story-bar`, not `stories`**. That string is the contract between the
  block's class, the mount point's id and `mountAll()`. The script FILE is `sje-stories.js`
  — the one place the two names differ, and it is deliberate.

## 3. Sizing — two standard tokens, and `calc()` for everything else

**Every font size and every piece of spacing in this extension is a multiple of one of two
tokens.** They are declared once, on `:root`, in
[assets/sje-widget.css](extensions/shoppable-videos/assets/sje-widget.css):

```css
:root {
  --sje-standard-font-size: 14px;
  --sje-standard-spacing: 8px;
}
```

These are the **only magic numbers** in the extension. Everything else is derived:

```css
/* read a variable with var(), then multiply */
.sje-widget__heading { margin-block-end: calc(var(--sje-standard-spacing, 8px) * 1.5); }
.sje-widget__notice  { font-size:        calc(var(--sje-standard-font-size, 14px) * 1); }
```

### The multiplier scale

Spacing, radii and hairlines — the small end:

| Desktop value | Written as | Where |
|---|---|---|
| 3px | `calc(var(--sje-standard-spacing, 8px) * 0.375)` | the Lightbox's progress bar |
| 4px | `* 0.5` | the play glyph's optical nudge |
| 6px | `* 0.75` | |
| 8px | `* 1` | card radius |
| 12px | `* 1.5` | row gap, heading margin |
| 16px | `* 2` | story-bar gap, the Lightbox gutter |
| 24px | `* 3` | the widget's block margin |
| 48px | `* 6` | the title scrim's top padding |
| 14px text | `calc(var(--sje-standard-font-size, 14px) * 1)` | |

**Component geometry derives from the same spacing token** — the large end:

| Desktop value | Written as | Where |
|---|---|---|
| 20px | `* 2.5` | default icon glyph |
| 28px | `* 3.5` | the play glyph |
| 40px | `* 5` | the Lightbox's controls |
| 64px | `* 8` | the play button |
| 72px | `* 9` | the story circle |
| 96px | `* 12` | the floating bubble |
| 140px / 220px | `* 17.5` / `* 27.5` | the stacked card's `clamp()` |
| 150px | `* 18.75` | the short masonry card |
| 160px | `* 20` | the grid track, the masonry column |
| 240px | `* 30` | the card height |

The large multipliers are not round, and that is fine: each is **exact** against the 8px
desktop base, so nothing shifts there, and the whole layout steps down together on a phone.
Prefer an existing multiplier over inventing one; a value that fits nowhere on either table
is usually a sign it belongs on the short list below.

### Responsive behaviour is TWO declarations

The whole of the extension's responsive typography and spacing lives in the existing
breakpoint. Nothing else in the extension carries a media query:

```css
/* 750px is the breakpoint Shopify's own themes use for this. */
@media screen and (max-width: 749px) {
  :root {
    --sje-standard-font-size: 12px;
    --sje-standard-spacing: 6px;
  }
}
```

Change those two values and every gap, padding, margin, inset, radius and font size in the
CSS, the Liquid `style` attributes and the Preact components follows. **Do not add a
breakpoint to a rule.** If something needs to respond to the viewport, it should be derived
from a token instead.

### ⚠️ Three things that will bite

1. **`:root`, never `.sje-widget`.** Two things render OUTSIDE the widget wrapper and would
   inherit nothing from it: the Lightbox, which Preact renders into `<body>` (see
   [src/lib/portal.tsx](sje-shoppable-scripts/src/lib/portal.tsx) for why), and the floating
   bubble, which is `position: fixed`.
2. **Every read carries the fallback literal** — `var(--sje-standard-spacing, 8px)`, never
   bare `var(--sje-standard-spacing)`. `sje-widget.css` has failed to load on the storefront
   before (two attempts are recorded in the header of `sje-widget.liquid`), and an undefined
   custom property makes the whole `calc()` **invalid** — the declaration is dropped, not
   defaulted. For a skeleton with no intrinsic height that means it disappears. With the
   fallback, a sheet that never arrives costs only the mobile step-down.
3. **`calc(var(--x) * 1.5)`, never `calc(--x * 1.5)`.** The second is invalid CSS and fails
   silently.

### What genuinely cannot be derived

A short list, and every entry is on it because deriving it would make the thing **less**
responsive or is simply not a length:

- **Viewport units** — the carousel's `70vh`, the stacked card's `22vw`. Already relative to
  the viewport. Pinning them to a px token would freeze them.
- **Percentages and fractions** — the `--pad-*` container widths (70/90/98%, with their own
  mobile step), `width: 100%`, `1fr`, `border-radius: 50%`. A proportion of something else,
  not a step on a scale.
- **Ratios** — `aspect-ratio: 9 / 16`, `line-height: 1.4`. Unitless by definition.
- **Hairlines and zeroes** — the notice's `1px dashed` border, `padding: 0` resets. One
  device pixel is one device pixel; zero has no scale.
- **The breakpoint itself** — `749px` lives in the media query and nowhere else. Nothing in
  Liquid or TS should know that number; `useTokenPx()` exists so the JS side can respond to
  it without being told what it is.

Two more, for reasons of their own:

- **Sticker size stays frame-relative.** `sticker.size` is a percentage of the *video frame*,
  set per-video in the admin app, not a theme setting — and the badge has to look the same on
  the storefront as it does in the app's position editor. Only its legibility floors
  (`MIN_PRICE_SIZE`, `MIN_PRICE_PADDING` in
  [Sticker.tsx](sje-shoppable-scripts/src/components/Sticker.tsx)) come off the scale.
- ⚠️ **Tap targets are the tightest thing on the scale.** The Lightbox's controls are
  `* 5` — 40px on desktop, **30px on a phone**. That still clears the 24px minimum a pointer
  target has to meet, but there is no room left. If the mobile spacing token is ever taken
  below 6px, raise `CONTROL_STEPS` in
  [Lightbox.tsx](sje-shoppable-scripts/src/components/Lightbox.tsx) rather than letting the
  target follow it down.

### What the mobile step actually costs

`8px → 6px` is a 25% cut, and geometry rides it. Worth knowing before changing either token:

| | Desktop | ≤749px |
|---|---|---|
| Card height | 240px | 180px |
| Story circle | 72px | 54px |
| Floating bubble | 96px | 72px |
| Grid track (min) | 160px | 120px |
| Lightbox control | 40px | 30px |

The grid one is the least obvious: a smaller track means **more columns**, so a 375px phone
fits three videos across instead of two. If that reads as too dense, the lever is the mobile
`--sje-standard-spacing` value — not a `@media` rule on the grid.

## 4. Inline styles are deliberate — and they still use `var()`

The Liquid skeletons and every Preact component style themselves **inline**, on purpose. Two
attempts at loading `sje-widget.css` on the storefront failed (`asset_url`, which resolves
against the THEME's assets, and then the schema's `stylesheet` key), and beyond that a class
name of ours can collide with the merchant's theme and their reset can undo ours. An inline
declaration cannot fail to apply and wins both.

**Reaching for a custom property does not give any of that back.** The declaration is still
inline and still beats the theme; only the *value* arrives from the sheet, and the fallback
in rule 2 above covers a sheet that never loads. What it buys is that inline styles step
down at the breakpoint along with everything else — which inline numbers can never do,
since a `style` attribute cannot carry a media query.

- In **Liquid**, hold the expression in a variable — it appears a dozen times per file and
  the 100 KB cap counts source bytes:
  ```liquid
  {%- assign sje_sp = 'var(--sje-standard-spacing, 8px)' -%}
  {%- assign sje_fs = 'var(--sje-standard-font-size, 14px)' -%}
  <div style="margin:calc({{ sje_sp }} * 3) auto;">
  ```
  Use `{%- capture -%}` rather than `{%- assign -%}` for any style string that interpolates
  one of them.
- In **Preact**, use the `sp()` and `fs()` helpers from
  [src/lib/tokens.ts](sje-shoppable-scripts/src/lib/tokens.ts) — the one place the token
  names and their base values are written on the JS side:
  ```tsx
  style={{ gap: sp(1.5), borderRadius: sp(1), fontSize: fs(1) }}
  ```
- Where a **number** is genuinely needed rather than a length — a scroll step, a diameter
  passed to an SVG — read the live token with `useTokenPx(ref, SPACING_VAR, BASE_SPACING)`.
  It re-reads on `resize`, so the number is right on both sides of the breakpoint and the
  breakpoint itself stays in the stylesheet. Never hardcode a second copy of a value the
  CSS already draws.
- The `font` shorthand cannot take a `calc()` size — the slash before `line-height` turns
  ambiguous. Write `fontFamily` / `fontSize` / `lineHeight` separately.
- ⚠️ SVG icons are sized through **CSS**, not the `width`/`height` attributes. SVG2 maps
  those attributes onto the CSS properties, but browsers are uneven about accepting a
  `calc()` in the attribute position. `IconProps.size` therefore takes `number | string`
  and [icons.tsx](sje-shoppable-scripts/src/lib/icons.tsx) puts it in `style`; the `viewBox`
  does the scaling either way.
- The `columns` shorthand has the same problem — it parses `<column-width> || <column-count>`
  positionally. Write `column-count` and `column-width` long-hand.

## 5. Merchant settings feed tokens, never raw properties

A size setting sets a **variable's value** on the wrapper; everything downstream scales from
the calc chain. Never write a merchant value straight into `font-size`.

```liquid
{%- assign heading_mult = block.settings.heading_scale | default: 175 | divided_by: 100.0 -%}
<h2 style="--sje-heading-font-size:calc({{ sje_fs }} * {{ heading_mult }});
           font-size:var(--sje-heading-font-size);">
```

Size settings are expressed as a **percentage of the relevant token**, `"unit": "%"`, not as
absolute px — so a merchant's choice scales with the breakpoint instead of standing still
while everything around it tightens.

| Setting | Range | Default | Means |
|---|---|---|---|
| `heading_scale` (all six blocks) | 100–400%, step 25 | 175 | ×1.75 the standard font size |
| `arrow_scale` (carousel only) | 200–1000%, step 50 | 500 | ×5 the standard spacing = 40px |

- ⚠️ **Changing what a setting MEANS requires a new setting id.** These were once
  `heading_size` and `arrow_size` in px. Keeping the ids while switching to a percentage
  would have reinterpreted every merchant's saved `24` as 24% — a 3.4px heading on every
  existing install. A new id means the old value is ignored and the new default applies.
- `arrow_scale` never touches CSS: it travels as JSON through `data-sje-settings` into
  `readSettings()`, is clamped there against the same range the schema states (the attribute
  is hand-editable, so it is coerced rather than trusted), and `Carousel` turns it into
  pixels against the live token.
- Shopify caps a range setting's `unit` at **3 characters**.

## 6. Liquid & accessibility conventions

- Use whitespace-control tags (`{%- -%}`) to keep rendered HTML clean. The **one** exception
  is inside an HTML tag's attribute list, where the whitespace *is* the separator: a `-%}`
  between two attributes glues them into one.
- ⚠️ **The `&nbsp;` in each skeleton is LOAD-BEARING.** Themes commonly hide empty elements
  (`div:empty { display: none }`), and a placeholder has no content of its own. One character
  stops the selector matching; `font-size:0;line-height:0` keeps it from taking up space.
  The same reasoning is why the mount point sets `display:block` inline.
- ⚠️ **Every skeleton states a real HEIGHT.** `aspect-ratio` alone does not work: these are
  empty divs, and in a flex row an item sized only by a ratio takes its cross size from a
  line whose height comes from the items — circular, so it resolves to 0 and the row
  measures `W × 0`. Use a ratio only where the height is definite (the carousel's cards) or
  once they hold real content.
- A block that cannot find its widget renders **nothing** on the storefront, and an
  explanatory `.sje-widget__notice` in the theme editor only (`request.design_mode`). Four
  reasons, four messages: no ID, no widget, switched off, no videos. Keep them distinct — a
  merchant staring at an empty section has no other way to tell which applies.
- A colour setting left alone comes back **blank**, and writing it anyway would stop the
  heading inheriting the theme's own colour. Emit `color:` only inside an
  `{%- if … != blank -%}`.
- Cards are real `<button>`-behaving elements (`role="button"`, `tabIndex={0}`, Enter/Space
  handled, `aria-label`), and decorative layers are `aria-hidden`. The badge is
  `pointer-events: none` so the card underneath stays the single target.

## 7. The Preact bundles are build output

- `assets/sje-carousel.js` and `assets/sje-stories.js` are **generated**. Never edit them.
  Source is [sje-shoppable-scripts/src/](sje-shoppable-scripts/src/); rebuild with
  `cd sje-shoppable-scripts && npm run build` (runs `tsc -b`, then `build.mjs`).
- Each entry is built **alone**, in library mode, so every file is flat and self-contained.
  A shared chunk would 404: each asset is fetched on its own by a hardcoded Liquid URL.
- `src/app.tsx`, `src/main.tsx`, `src/app.css` and `src/index.css` are the **Vite dev page**
  and ship nothing. Do not put extension styling in them.
- Nothing takes effect on the storefront until the bundles are rebuilt.

# CLAUDE.md — Project Coding Standards

Shoppable Videos — a **Shopify Theme App Extension** that plays a merchant's videos on
their storefront, with tagged products stuck to the frame. Seven layouts, all **app blocks**
merchants drop into a section via the theme editor: carousel, story bar, grid, stacked,
banner, product row and floating bubble.

> **Masonry is retired.** Its block, its CSS and the `sje-widget` skeleton snippet it was the
> last user of are all deleted, and it is gone from the admin's `WidgetLayout` catalog.
> `parseWidget` does not validate against that catalog, so a widget saved as a masonry still
> loads and shows its raw id where a layout name would be — retired, not broken. It has no
> block to install.

The extension lives in [extensions/shoppable-videos/](extensions/shoppable-videos/). **Every
layout is Preact now**, built from [sje-shoppable-scripts/](sje-shoppable-scripts/) — there
are no Liquid-only layouts left, which is why `snippets/sje-widget.liquid` is gone.

> ⚠️ There is also a `CLUADE.md` in this folder (note the spelling). It describes a
> **different extension** — breadcrumbs, the `brd--` prefix, `extensions/breadcrumbs/`.
> Ignore it. This file is the one that applies here.

---

## 1. Modularity — never write everything in one file

- Each snippet has **one responsibility**. Keep files small and composable.
- The **six blocks** in [blocks/](extensions/shoppable-videos/blocks/) are entry points
  only: resolve the widget from the metafield, draw the heading, hold the `{% schema %}`.
  Three snippets carry what they share: **`sje-mount`** (the mount point, the widget data and
  the lazy loader), **`sje-heading`** and **`sje-notice`**. The last two exist because the
  markup was identical in five and seven blocks respectively, and because of the byte cap
  below — put shared markup there, not in a sixth copy.
- ⚠️ **`SJE_FloatingBubble` draws nothing where it sits.** It is an ordinary
  `"target": "section"` block, but everything it shows is `position: fixed` and rendered
  into `<body>` through `Portal`. Consequences, and none of them should be "tidied" away:
  - **No wrapper geometry, no heading, no `padding` setting**, and **no `.sje-widget`
    class** — that class is what `.page-width:has(.sje-widget)` keys off to widen a
    merchant's container, which would blow out the padding of a section this block puts
    nothing in.
  - It is the only layout with **no skeleton**: bones hold a gap open, and this reserves no
    gap. It is also the only one whose mount point takes **no `height`** — see the branch
    in `sje-mount`.
  - The `Portal` is not optional. `position: fixed` is only fixed to the viewport while no
    ancestor has a `transform`, `filter` or `contain`, and themes put those on section
    wrappers freely.
  - ⚠️ **It was an app embed (`"target": "body"`) for one release and is not any more.**
    An embed cannot be added twice, which guaranteed one bubble per page — but it also
    appears on EVERY page of the storefront, and choosing which pages get a bubble matters
    more. Do not switch it back. The "only one" guarantee is bought back at runtime by
    `usePageBubble` in `Bubble.tsx`: the first bubble to mount claims the page through
    `SJE.bubbleClaimed` and the rest render nothing.
- [snippets/sje-mount.liquid](extensions/shoppable-videos/snippets/sje-mount.liquid) is the
  mount point, the widget data, and the lazy loader — the loading rules live there **once**,
  keyed by layout, so a page with three carousels fetches one script.
- ⚠️ `{% render %}` runs in an **isolated scope**: `block` is NOT visible inside a snippet.
  Everything arrives as a parameter. That is why `widget_id`, `heading_scale` and the rest
  are passed explicitly rather than read off `block.settings`.
- ⚠️ **Liquid content in a theme app extension is capped at 100 KB** — every `.liquid` file
  under `blocks/` and `snippets/` counted together, comments included (they are stripped at
  render time, not at upload). Going over fails the deploy outright. Assets are NOT counted.
  Check before adding a large snippet: `wc -c blocks/*.liquid snippets/*.liquid`.
  Currently **~56 KB of 100**.
- ⚠️ **The `.liquid` files carry NO comments, and that is deliberate — do not add any.**
  They were heavily commented and it put the extension over the cap: comments are stripped
  at render time, not at upload, so every word counted. They were removed wholesale, which
  is where the headroom came from (98 KB → 56 KB). **This file is now the only home for that
  reasoning**, along with the headers in
  [sje-shoppable-scripts/src/](sje-shoppable-scripts/src/), which cost nothing because
  `assets/*.js` is not counted. If you find yourself wanting to explain something in a
  `.liquid` file, write it here or in the component instead.
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
  - **asset filenames:** `sje-widget.css`, `sje-carousel.js`, `sje-stories.js`,
    `sje-stacked.js`, `sje-grid.js`, `sje-bubble.js`, `sje-banner.js`,
    `sje-product-videos.js`
- ⚠️ The layout is **`story-bar`, not `stories`**. That string is the contract between the
  block's class, the mount point's id and `mountAll()`. The script FILE is `sje-stories.js`.
  **`floating-bubble` / `sje-bubble.js`** is the same deliberate mismatch. Those are the only
  two; every other layout's file is named for it exactly.

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
   before (`asset_url`, which resolves against the THEME's assets, and then the schema's
   `stylesheet` key), and an undefined
   custom property makes the whole `calc()` **invalid** — the declaration is dropped, not
   defaulted. For a skeleton with no intrinsic height that means it disappears. With the
   fallback, a sheet that never arrives costs only the mobile step-down.
3. **`calc(var(--x) * 1.5)`, never `calc(--x * 1.5)`.** The second is invalid CSS and fails
   silently.

### What genuinely cannot be derived

A short list, and every entry is on it because deriving it would make the thing **less**
responsive or is simply not a length:

- **Viewport units** — the carousel's and the stacked deck's `70vh`. Already relative to the
  viewport. Pinning them to a px token would freeze them.
- **Percentages and fractions** — the `--pad-*` container widths (70/90/98%, with their own
  mobile step), `width: 100%`, `1fr`, `border-radius: 50%`. A proportion of something else,
  not a step on a scale.
- **Ratios** — `aspect-ratio: 9 / 16`, `line-height: 1.4`. Unitless by definition.
- **Hairlines and zeroes** — the notice's `1px dashed` border, `padding: 0` resets. One
  device pixel is one device pixel; zero has no scale.
- **The breakpoint itself** — `749px` lives in the media query and nowhere else. Nothing in
  Liquid or TS should know that number; `useTokenPx()` exists so the JS side can respond to
  it without being told what it is. That is also why the floating bubble's `show_on_mobile`
  is the one setting in the extension answered by a **class** (`.sje-bubble--desktop-only`)
  rather than inline: the question it asks *is* the breakpoint. There is exactly **one**
  `@media (max-width: 749px)` block in `sje-widget.css` and new rules go inside it — a
  second one is a second place to change the breakpoint.
- **How many cards go across** — `--sje-across-count`, and the only KIND of merchant setting
  here that is not a multiple of a token. A count is not a length: it cannot step down by
  25% with everything else, and no arithmetic turns "four across a desktop" into "two across
  a phone". That is a judgement, so the merchant makes it twice (`columns`,
  `columns_mobile`), the block writes both onto the wrapper as `--sje-across-desktop` and
  `--sje-across-mobile`, and `sje-widget.css` picks between them **inside the one media query
  that already exists**. Everything that reads it writes the merchant's desktop count as
  the `var()` fallback, so a sheet that never loads costs the mobile count and nothing
  else.

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
| Lightbox control | 40px | 30px |

⚠️ The grid **used to be on this table**, as a 160px minimum track that became 120px on a
phone. It is off it because the arithmetic ran the wrong way: a smaller track means MORE
columns, so a merchant with a narrow section got two across on desktop and three on a
phone. How many go across is a merchant setting now — see the entry above. Masonry, which
had the same track, is retired.

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

Size settings are expressed as a **hundredth of the relevant token**, not as absolute px —
so a merchant's choice scales with the breakpoint instead of standing still while everything
around it tightens.

⚠️ The `"unit"` on every one of these is **`"x"`**, and the number beside it is still a
hundredth: `175` means ×1.75, `500` means ×5. The unit is a label the theme editor prints
next to the number and nothing reads it, so it does not have to agree with the arithmetic —
but the `info` strings do, and they say "a multiple of" rather than "a percentage of" for
that reason. If the numbers should ever read as true multiples (`1.75` rather than `175`),
that is a change of MEANING and needs new setting ids — see the warning below.

| Setting | Range | Default | Means |
|---|---|---|---|
| `heading_scale` (all but the bubble) | 100–400, step 25 | 175 | ×1.75 the standard font size |
| `arrow_scale` (carousel, stacked) | 200–1000, step 50 | 500 | ×5 the standard spacing = 40px |
| `card_radius` (all but the story bar) | 0–400, step 25 | 100 | ×1 the standard spacing = 8px |
| `banner_height` (banner) | 25–100, step 5 | 60 | **`vh`, not a token** — already relative, and only read when `banner_ratio` is `fixed` |
| `bubble_scale` (bubble) | 600–2400, step 100 | 1200 | ×12 the standard spacing = 96px wide |
| `bubble_offset` (bubble) | 0–800, step 50 | 200 | ×2 the standard spacing = 16px from each edge |

`bubble_scale` and `bubble_offset` stay CSS `calc()` all the way to the `style` attribute —
`Bubble` never resolves either to a number, because nothing measures the bubble, it only
draws it. `bubble_offset` is a **floor**: the component takes `max(offset,
env(safe-area-inset-*))` so a corner bubble clears a notch or a home indicator.

⚠️ The grid's three counts — `columns` (1–8, default 4), `columns_mobile` (1–4, default 2)
and `videos_shown` (1–48, default 8) — are **not on this scale**. They are plain integers
and carry no `unit`, because a count is not a hundredth of anything. `videos_shown` is a
count rather than a number of rows on purpose: rows would mean a different number of videos
on a phone than on a desktop, and the Liquid skeleton cannot know which it is drawing for.

- ⚠️ **`shuffle` is a BLOCK setting, not a widget field.** Every one of the seven schemas
  offers "Shuffle videos", `readSettings` parses it, and `widgetMedia(widget, shuffle)`
  takes it as an argument. It used to be saved on the widget in the app, beside its name and
  its media list, and it moved for the reason this whole file gives for settings living on
  the mount point: the widget is the merchant's CONTENT and every block showing it shows the
  same thing, while how one placement presents it is that placement's. A widget's metafield
  written before the move still has the old field — nothing reads it, and `sje-mount` no
  longer copies it onto the page.
- ⚠️ **Changing what a setting MEANS requires a new setting id.** These were once
  `heading_size` and `arrow_size` in px. Keeping the ids while switching to a percentage
  would have reinterpreted every merchant's saved `24` as 24% — a 3.4px heading on every
  existing install. A new id means the old value is ignored and the new default applies.
- `arrow_scale` never touches CSS: it travels as JSON through `data-sje-settings` into
  `readSettings()`, is clamped there against the same range the schema states (the attribute
  is hand-editable, so it is coerced rather than trusted), and the layout turns it into
  pixels against the live token.
- ⚠️ `arrow_position` has a fifth value, **`sides`**, offered only by the stacked block and
  drawn only by `Stacked` — one arrow either side OF THE CARDS rather than a strip under a
  row. `RailArrows` renders nothing for it, so a rail handed it by a hand-edited attribute
  gets no arrows rather than misplaced ones.
- Shopify caps a range setting's `unit` at **3 characters**, and a block's schema `name` at
  **25**. Both fail the deploy outright rather than being truncated, and the `name` one is
  easy to trip: every block here is `Videos — <layout>` for that reason, and
  `Shoppable Videos — Floating bubble` (34) has already broken a build once. The em dash
  counts as one character. Check with:
  `python -c "import json,re,io;[print(len(json.loads(re.search(r'{% schema %}(.*?){% endschema %}',io.open(f,encoding='utf-8').read(),re.S).group(1))['name']),f) for f in __import__('glob').glob('extensions/shoppable-videos/blocks/*.liquid')]"`

### The banner is the exception to three rules

Worth knowing before editing it, because each looks like a mistake otherwise:

- **It plays the FULL video, not the preview clip.** `videoUrlOf` reads
  `media.sources`; `previewUrlOf` reads `media.previewSources`. Same shape, different
  ladder, and a banner looping three seconds reads as broken. It also takes the LARGEST rung
  (`BANNER_RUNGS`), where a story circle takes the smallest.
- **It overrides the media's `stickerPosition`.** `Sticker`'s `at` prop exists for this one
  caller. The stored position is a percentage of a 9:16 frame measured in the app's editor;
  a banner is a wide box with the video cropped to fill it, and the editor knew nothing about
  the heading and button the merchant later typed. So the badge goes to the far side of the
  copy on both axes — `badgeSpot()` reads that off `content_position`, the block's nine-cell
  dropdown, as two small "opposite end" tables rather than nine hand-written pairs. Its SIZE
  is measured against `height × 9/16` — the frame the video would occupy — and not the
  banner's width, which would draw a 392px badge across a 1400px hero.
- **It answers `shuffle` by ROTATING.** Off, the merchant's first video loops forever. On,
  each video ends and hands over to the next in the shuffled order. Every other layout uses
  shuffle only to reorder a row.

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
  measures `W × 0`. Use a ratio only where the width or height is definite — the carousel's
  cards, whose height comes from a row of a stated height, and the **grid's**, whose width
  comes from a track — or once they hold real content. The grid is the one layout here that
  states no height anywhere, and that is why.
- A block that cannot find its widget renders **nothing** on the storefront, and an
  explanatory `.sje-widget__notice` in the theme editor only. Four reasons, four messages:
  no ID, no widget, switched off, no videos. Keep them distinct — a merchant staring at an
  empty section has no other way to tell which applies. They live in
  **`snippets/sje-notice.liquid`**, which also owns the `request.design_mode` check, so a
  block is one `{% render %}` per branch. The floating bubble passes a `frame`: it is an app
  embed and renders below the footer, where a notice in the flow is off-screen.
- A colour setting left alone comes back **blank**, and writing it anyway would stop the
  heading inheriting the theme's own colour. Emit `color:` only inside an
  `{%- if … != blank -%}`.
- Cards are real `<button>`-behaving elements (`role="button"`, `tabIndex={0}`, Enter/Space
  handled, `aria-label`), and decorative layers are `aria-hidden`. The badge is
  `pointer-events: none` so the card underneath stays the single target.

## 7. The Preact bundles are build output

- `assets/sje-carousel.js`, `assets/sje-stories.js`, `assets/sje-stacked.js`,
  `assets/sje-grid.js`, `assets/sje-bubble.js`, `assets/sje-banner.js` and
  `assets/sje-product-videos.js` are **generated**. Never edit them.
  Source is [sje-shoppable-scripts/src/](sje-shoppable-scripts/src/); rebuild with
  `cd sje-shoppable-scripts && npm run build` (runs `tsc -b`, then `build.mjs`).
- Each entry is built **alone**, in library mode, so every file is flat and self-contained.
  A shared chunk would 404: each asset is fetched on its own by a hardcoded Liquid URL.
- `src/app.tsx`, `src/main.tsx`, `src/app.css` and `src/index.css` are the **Vite dev page**
  and ship nothing. Do not put extension styling in them.
- Nothing takes effect on the storefront until the bundles are rebuilt.

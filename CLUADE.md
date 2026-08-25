# CLAUDE.md — Project Coding Standards

BreadCrumb Navigations & Categories — a **Shopify Theme App Extension** that renders
a breadcrumb trail (Home > Collection > Product, etc.) as an **app block** merchants
can drop into their theme via the theme editor.

The extension lives in [extensions/breadcrumbs/](extensions/breadcrumbs/).

---

## 1. Modularity — never write everything in one file

- Each snippet has **one responsibility**. Keep files small and composable.
- The **block** ([blocks/breadcrumbs.liquid](extensions/breadcrumbs/blocks/breadcrumbs.liquid))
  is the entry point only: it injects the stylesheet, sets CSS variables from merchant
  settings, renders the trail, and holds the `{% schema %}`. It contains **no**
  per-page trail logic and **no** raw markup for individual crumbs.
- Dispatch by page type lives in
  [snippets/breadcrumbs-trail.liquid](extensions/breadcrumbs/snippets/breadcrumbs-trail.liquid),
  not the block — the block renders it once per half of the trail (see §4), and the
  `{% case %}` should only be written once.
- Per-page-type trail logic lives in its own snippet:
  `breadcrumbs-product`, `breadcrumbs-collection`, `breadcrumbs-page`,
  `breadcrumbs-blog`, `breadcrumbs-article`, `breadcrumbs-search`. Each takes a `part` param
  (`'path'` or `'current'`) and emits only that half.
- The **visitor path** — a trail built from the route this shopper took — is three
  snippets, split by responsibility, not one:
  [breadcrumbs-visitor-store](extensions/breadcrumbs/snippets/breadcrumbs-visitor-store.liquid)
  (the sessionStorage contract, no DOM),
  [breadcrumbs-visitor-record](extensions/breadcrumbs/snippets/breadcrumbs-visitor-record.liquid)
  (one step per page in) and
  [breadcrumbs-visitor-apply](extensions/breadcrumbs/snippets/breadcrumbs-visitor-apply.liquid)
  (rebuilds the path half from it). It is the one part of the trail that runs in
  JS, because a route is per-shopper and per-visit and the page HTML is cached
  for everyone. Crawlers and the JSON-LD keep the server-rendered tree — see §4.
  ⚠️ The extension is a **section app block** (`"target": "section"`), so it runs
  only on the templates the merchant dropped it into. Nothing that must happen on
  EVERY page can assume the block is there. Reaching home resets the route, and
  that rule needs a second, deferred claim for exactly this reason: no merchant
  places a breadcrumb block on the home page, since it renders no trail there, so
  `breadcrumbs-visitor-record` also checks `document.referrer` on the next page
  and resets before recording. Both claims produce the same route, and the rewind
  in `store.record` makes a double reset harmless.
  There were once two opt-in debug panels (`breadcrumbs-visitor-debug`,
  `subcategories-debug`, each with its own CSS asset). They were removed along
  with their `debug` block settings to win back Liquid budget — they cost ~21 KB
  of the 100 KB cap. Don't reintroduce a panel without checking the budget first.
- A single crumb is rendered **only** through the reusable
  [snippets/breadcrumbs-item.liquid](extensions/breadcrumbs/snippets/breadcrumbs-item.liquid)
  (params: `label`, `url`, `is_current`). Do not hand-write `<li><a>` crumbs anywhere else.
- ⚠️ **Liquid content in a theme app extension is capped at 100 KB** — every
  `.liquid` file under `blocks/` and `snippets/` counted together, comments
  included (they are stripped at render time, not at upload). Going over fails
  the deploy outright: `Extension Liquid content size exceeds 100 KB limit`.
  Assets are NOT counted. Check the running total before adding a large snippet:
  `wc -c blocks/*.liquid snippets/*.liquid`.
- All CSS therefore lives in **assets**, not in `<style>` tags:
  [assets/breadcrumbs.css](extensions/breadcrumbs/assets/breadcrumbs.css) (base
  layer first, then the four overflow modes) and
  [assets/subcategories.css](extensions/breadcrumbs/assets/subcategories.css).
  Each block injects its own with
  `{{ 'breadcrumbs.css' | asset_url | stylesheet_tag }}`. This is what keeps the
  Liquid budget spendable on trail logic — the CSS alone was 31 KB of it — and
  the files stay static because merchant settings reach them as **CSS variable
  values set inline on the wrapper** (§3). Never inline style *rules* into markup.
  There are exactly TWO exceptions: that inline variable block, and the
  `custom_css` block setting — merchant-authored CSS is per-block data, so it
  cannot be a static asset. It is emitted in a `<style>` tag after the sheet so
  an equal-specificity override wins, with the closing-bracket sequence stripped
  (`| escape` would break the child combinator; see the block for the full note).
- ⚠️ **No angle-bracket tag names in JS comments.** Shopify's Liquid parser
  tokenises HTML *inside a `<script>` body*, so `// … an empty <ol>` in a comment
  is parsed as a real element that never closes, and the build dies with
  `Attempting to end parsing before HtmlElement 'ol' was closed`. Write "list",
  "script tag", "an img/onerror payload" instead. Note the asymmetry that makes
  this surprising: `{% comment %}` blocks ARE raw, which is why the block's Liquid
  comments have always been free to say `<ol>` in prose.
- ⚠️ **Never `{% render %}` a snippet from inside a `<style>` or `<script>` tag.**
  Shopify wraps every rendered snippet in an app extension with
  `<!-- BEGIN app snippet: … -->` / `<!-- END app snippet -->`. In HTML those are
  harmless comments; inside a stylesheet `<!--` parses as a CSS token and the text
  after it becomes a garbage prelude, so the parser discards it **together with the
  first rule that follows** — one rule, silently, with the rest of the sheet parsing
  normally. Moving the CSS into assets retired the case that used to bite here (the
  base layer and the overflow modes had to be sibling snippets, never nested), but
  the rule still stands for the `<script>` snippets, which the block renders as
  siblings for exactly this reason.

## 2. CSS naming — `brd--` prefix on every class and id

- **Every** class name and id in this extension is prefixed with `brd--` to avoid
  collisions with the merchant's theme.
  - ✅ `.brd--nav`, `.brd--list`, `.brd--item`, `.brd--link`, `.brd--current`, `#brd--...`
  - ❌ `.nav`, `.breadcrumb-item`, `.link`
- Use BEM-ish modifiers with the same prefix: `.brd--item--home`, `.brd--link--active`.

## 3. CSS variables + `calc()` — single source of truth for sizing

- Declare **global base tokens** once on the `.brd--nav` scope: at minimum a base
  **font size**, **gap**, and **padding**. These are the only "magic numbers".
  ```css
  .brd--nav {
    --brd--fs: 14px;   /* base font size */
    --brd--gap: 8px;   /* base gap / spacing */
    --brd--pad: 4px;   /* base padding      */
  }
  ```
- Every other size is **derived** from a base token with `calc()` and a multiplier —
  never a new hard-coded value.
  ```css
  /* read a variable with var(), then multiply */
  .brd--item::before { font-size: calc(var(--brd--fs) * 0.8); }
  .brd--link         { padding:   calc(var(--brd--pad) * 0.5) calc(var(--brd--pad) * 0.75); }
  ```
- ⚠️ Correct syntax is `calc(var(--brd--fs) * 0.8)`. Writing `calc(--brd--fs * 0.8)`
  (no `var()`) is invalid CSS and silently fails.
- Merchant settings feed the base tokens by setting the **variable values** inline on
  the `.brd--nav` wrapper (e.g. `style="--brd--fs: {{ block.settings.font_size }}px"`).
  Everything downstream scales automatically from the calc chain.

## 4. Liquid & accessibility conventions

- The trail is wrapped in `<nav aria-label="…">` and split across **two** lists:
  `<ol class="brd--list">` holds Home + the ancestors, `<ol class="brd--current-list">`
  holds the current page alone. Each crumb is an `<li class="brd--item">`, and the
  current one is marked `aria-current="page"`.
  The split exists because Liquid cannot see the viewport: the merchant picks an
  overflow mode per breakpoint, and `two-line` needs `overflow-x` on the ancestor path
  *only*. A single `<ol>` scrolls all of its children, so the current page has to be
  its own container. Keep the two lists side by side in the other three modes.
- Don't confuse `.brd--current-list` (the `<ol>`) with `.brd--current` (the `<span>`
  inside the current crumb). The variant styles target the span.
- Overflow is decided in **CSS, not Liquid**, and **no mode ever hides a crumb**.
  Emit the full trail always and let the mode decide how it flows: `ellipsis` keeps
  it to one line, freezes the first crumb (`position: sticky`) and marks the part
  scrolled out of view with a "…" drawn *inside* that frozen crumb, so scrolling
  reveals what the marker stands for. Never shorten the trail server-side and never
  `display: none` a crumb — crawlers get no JS, and hidden crumbs leave the
  accessibility tree.
- The one thing CSS cannot do is **measure**, so
  [snippets/breadcrumbs-fit.liquid](extensions/breadcrumbs/snippets/breadcrumbs-fit.liquid)
  puts two flags on the nav: `.brd--fits` (the trail fits, so no frozen crumb and no
  marker) and `.brd--scrolled` (`scrollLeft > 0`, so show the marker). It also lands
  the reader on the END of the trail, where the current page is. That snippet is the
  ONLY place a layout is measured — don't add width maths to the other snippets.
- A per-page-type snippet answers a third `part`, `'origin'`, with a token rather
  than markup: `tree` when the path half came from the merchant's tree metafield,
  `collection` when the shop has a tree in use but this product fell outside it,
  `fallback` when nothing arranged is at stake (page, blog, article, search,
  `/collections`, or a product in a shop with no tree), and nothing at all where
  there is no path half to speak of. The block puts it on the nav as
  `data-brd-origin`, and **that attribute is the whole precedence rule** — a
  recorded route replaces a `fallback` path, and replaces `tree`/`collection`
  only when the merchant switched `visitorPathPriority` on. Work it out in the
  trail snippets, never in the block: answering it means redoing the source
  search, and the block must not carry a second, coarser copy of the rule. It
  once did — a shop-wide "has a tree, so the tree wins" clamp on `brd_visitor` —
  and that switched the *recorder* off too, so page/blog/article/search trails,
  which can never resolve through a tree of collections, lost the visitor path
  with no tree path to show instead.
  Note `tree` is emitted for a **top-level** in-tree collection too, where the
  `path` pass emits no crumbs at all — "in the tree with no ancestors" is still
  the merchant's arrangement.
- The visitor path never reaches the JSON-LD. One shopper's route is not a fact
  about the page, so the structured data stays built from the server's crumbs.
- **Plan gate** — `app.metafields.breadcrumbs.subscription.value.features` lists
  what the shop's plan grants: `breadcrumbStyle[]`, `overflowMode[]`,
  `visitorPath` (boolean). A MISSING metafield is permissive everywhere (a shop
  not yet synced keeps prior behaviour); once present, it narrows. The visitor
  path checks it in the block (`brd_sub`, folded into `brd_visitor`) — that gate
  answers "does the feature run", and nothing else; who wins is `data-brd-origin`
  above. Style/overflow check it in breadcrumbs-resolver, client-side,
  because that is where those choices are already resolved — `granted()` filters
  the catalog, and the styleId fallback is "own pick if granted, else DEFAULT if
  granted, else the plan's first granted id" — never straight to DEFAULT, which
  may itself be a paid-only style a downgraded shop no longer has.
- **Metafield namespaces** — two owners, two namespaces, and they are not
  interchangeable. Data written onto a **collection** lives in
  `shopgears_breadcrumbs` and is read plainly:
  `collection.metafields.shopgears_breadcrumbs.path` (ancestors) and
  `collection.metafields.shopgears_breadcrumbs.children` (sub-categories) — no
  brackets, no `$app:` prefix. Data owned by the **AppInstallation** keeps its
  own names and must not be renamed to match:
  `app.metafields.category_tree.tree_enabled`, `…category_tree.treeexist`,
  `…breadcrumbs.active_config`, `…breadcrumbs.subscription`. Renaming that
  second group breaks four working reads — the tree switch, the treeexist flag,
  the resolver's config and the plan gate.
- Use whitespace-control tags (`{%- -%}`) to keep rendered HTML clean.
  The **one** exception is inside an HTML tag's attribute list, where the
  whitespace *is* the separator: a `-%}` between two attributes glues them into
  one. See the `data-brd-origin` conditional in the block.
- Resolve URLs through Shopify routes/objects (`routes.root_url`, `collection.url`,
  `article.url`) — never hard-code paths.
- Every user-facing string is translatable via `locales/en.default.json` or a merchant
  setting; nothing user-visible is hard-coded in a snippet.

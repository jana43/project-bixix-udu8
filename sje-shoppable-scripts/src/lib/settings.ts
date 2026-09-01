// src/lib/settings.ts
// The block's own theme-editor settings, as the components see them.
//
// These are NOT the widget. A widget is the merchant's content, saved in the
// app and shared by every block that shows it; these are one block's
// appearance, saved in the theme and belonging to that one placement. Two
// carousels of the same widget can have arrows in different places, which is
// why they arrive per mount point rather than on `window.SJE`.
//
// `sje-mount` writes `block.settings` onto the mount point as JSON. Keys are
// therefore the snake_case ids from the `{% schema %}`, and everything here is
// optional-by-attitude for the same reason as `sje.ts`: a block saved before a
// setting existed simply has no key for it, and a merchant who never opened
// the block has no saved settings at all.

/**
 * Where a layout's arrows sit.
 *
 * `left`, `center` and `right` are places in the STRIP under the row — see
 * `RailArrows`. `sides` is the odd one out and means something else entirely:
 * one arrow either side OF THE CARDS, vertically centred on them. Only a
 * layout that knows where its cards are can place those, which today is
 * `Stacked`, where it is the default.
 */
export type ArrowPosition = "hidden" | "left" | "center" | "right" | "sides";

/**
 * How the full-screen player presents the video's products.
 *
 * - `sticker`     the same badge the preview card draws, pinned to the frame
 *                 where the merchant placed it.
 * - `free-scroll` a rail of every tagged product, scrolled independently of
 *                 the video. NOT BUILT YET — see `Lightbox`.
 * - `hidden`      nothing; just the video.
 *
 * Separate from `stickerOnPreview` because the two views are not the same
 * problem. A card is one of a dozen in a scrolling row and a badge on each can
 * read as clutter; the player is one video the shopper chose, where there is
 * room to show the whole outfit.
 */
export type PlayerProducts = "sticker" | "free-scroll" | "hidden";

/** What, if anything, rings a story circle. */
export type RingStyle = "gradient" | "solid" | "none";

/** Where a row of story circles sits when it is narrower than the widget. */
export type RowAlignment = "left" | "center" | "right";

/**
 * What a thumbnail shows before it is opened.
 *
 * - `video` the three-second preview clip, muted and looping while the
 *           thumbnail is in view. What a shoppable video is for.
 * - `image` the poster, and nothing else. No clip is fetched, no decoder is
 *           started, and a row of twenty costs twenty images.
 *
 * ⚠️ The PREVIEW only. Opening one still plays the whole video either way —
 * this is the same scoping as `stickerOnPreview`, and for the same reason: a
 * thumbnail in a row and a video the shopper chose are not the same problem.
 *
 * Deliberately named for the thumbnail rather than for the story bar it was
 * written for. The grid has since adopted it under the same id — where it
 * matters more than anywhere else, since a grid can put twenty clips on screen
 * at once — and the carousel can do the same without a second name for it.
 */
export type PreviewMode = "video" | "image";

/**
 * The floating bubble's outline.
 *
 * - `circle`    a 1:1 round thumbnail, like a story circle or a chat launcher.
 *               The video is `object-fit: cover` on a square, so a portrait
 *               clip shows its middle band.
 * - `rectangle` the 9:16 frame every other layout draws, at bubble scale, with
 *               the block's own corner radius. Shows the whole composition,
 *               and takes roughly twice the height for the same width.
 */
export type BubbleShape = "circle" | "rectangle";

/** Which corner of the VIEWPORT the floating bubble is pinned to. */
export type BubblePosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * How the product row decides which of a widget's videos to show.
 *
 * It is the one layout that knows what the shopper is looking at — its block
 * is restricted to product templates, and passes the product's id down — so it
 * is the one layout that can answer this at all.
 *
 * - `tagged-first` every video, with this product's first. Never empty, which
 *                  is why it is the default: a merchant whose widget happens to
 *                  hold nothing tagged with this product still gets a row.
 * - `tagged`       only videos tagged with this product. The block renders
 *                  NOTHING when there are none, which is a real answer rather
 *                  than a failure — a "shop this product's videos" row with
 *                  somebody else's videos in it is worse than no row.
 * - `all`          the widget's own order, ignoring the product entirely.
 */
export type ProductFilter = "tagged-first" | "tagged" | "all";

/**
 * How the banner's video fills its box.
 *
 * - `cover`   fills it, cropping whatever does not fit. The right answer for a
 *             video shot for the shape the merchant chose.
 * - `contain` fits the whole frame in, leaving bars. The right answer for a
 *             PORTRAIT video in a wide banner — which is most of this app's
 *             library — where `cover` would show a narrow vertical slice of
 *             the middle and crop the subject out entirely.
 *
 * The bars are the block's `banner_background`, not a guess: a widget dropped
 * into someone else's theme cannot know what colour the page is.
 */
export type BannerFit = "cover" | "contain";

/**
 * Where the banner's copy sits, as one of nine cells.
 *
 * `"<vertical>-<horizontal>"`, and the halves are read separately — the block
 * turns them into `align-items`, `justify-content` and `text-align`, and
 * `Banner` turns them into the corner the product badge keeps out of.
 *
 * ⚠️ A NEW id (`content_position`), not the old `content_alignment` widened
 * from three values to nine. Reusing the id would have reinterpreted a saved
 * `"left"` as a value outside the new vocabulary — CLAUDE.md §5.
 */
export type BannerPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface SJESettings {
  /**
   * Play this widget's videos in a random order, drawn once per page load.
   *
   * ⚠️ Was a property of the WIDGET, saved in the app beside its name and its
   * media list; it is a property of the BLOCK now, and every layout's schema
   * offers it. That follows the split at the top of this file: the widget is
   * the content, and how one placement presents it is the placement's. Two
   * carousels of the same widget can now differ in this as they already could
   * in everything else.
   *
   * OFF by default, and deliberately not the old widget field's value — there
   * is no way for a block to inherit it, since the block is where the merchant
   * now says so.
   *
   * On the banner and the bubble it means more than an order: both show ONE
   * video, so shuffling is what makes which one vary. The banner also plays
   * through the widget rather than looping. See `Banner`.
   */
  shuffle: boolean;
  arrowPosition: ArrowPosition;
  /**
   * The arrow button's diameter as a PERCENTAGE of the standard spacing token
   * — 500 means five spacings, which is 40px on desktop and 30px on a phone.
   *
   * A percentage rather than a diameter in px so the control scales with the
   * rest of the widget at the breakpoint, instead of staying stubbornly the
   * same size while everything around it tightens. `Carousel` turns it into
   * pixels against the live token; see `lib/tokens.ts`.
   */
  arrowScale: number;
  /**
   * Whether the sticker product's badge shows on the PREVIEW videos — the
   * short autoplay clips on the cards in the row.
   *
   * The full-screen player has its own control, `playerProducts`, because it
   * has more than two answers there.
   *
   * Per PLACEMENT, not per media — `AppMedia.showSticker` in the app is the
   * merchant saying "this video has no badge at all", and it still wins. This
   * one is a merchant saying "not in THIS carousel".
   */
  stickerOnPreview: boolean;
  /** How the full-screen player shows the video's products. */
  playerProducts: PlayerProducts;
  /**
   * The preview card's corner radius, as a PERCENTAGE of the standard spacing
   * token — 100 means one spacing, which is 8px on desktop and 6px on a phone.
   *
   * A percentage rather than a radius in px for the same reason as every other
   * size setting here: it steps down at the breakpoint with the card it is
   * rounding, instead of staying put while the card shrinks around it. `0` is
   * square corners.
   *
   * Read by the layouts with rectangular cards — the carousel and the stacked
   * deck. The story bar's circles have a shape of their own and ignore it.
   */
  cardRadius: number;

  // ── Grid only ──

  /**
   * How many cards the grid puts across the widget on a DESKTOP, and how many
   * on a phone.
   *
   * ⚠️ Neither of these reaches a component as a number. A column count is the
   * one merchant setting in this extension that cannot be derived from a token
   * — it is not a length, so it cannot be a multiple of the spacing token and
   * cannot step down by 25% with everything else, and no arithmetic turns
   * "four across on a desktop" into "two across on a phone". That is a
   * judgement, and it is the merchant's to make twice.
   *
   * So the block writes both onto the wrapper as `--sje-across-desktop` and
   * `--sje-across-mobile`, and `sje-widget.css` picks between them inside the
   * ONE media query the extension has. `Grid` reads `columns` only to write it
   * as the `var()` fallback, so a stylesheet that never loads costs the mobile
   * count and nothing else; `columnsMobile` is never read on this side at all,
   * and is here so that `readSettings` remains the one description of what a
   * block can be set to.
   */
  columns: number;
  columnsMobile: number;
  /**
   * How many videos the grid draws before the Show more button.
   *
   * A COUNT and not a number of rows, deliberately: rows would mean a
   * different number of videos on a phone than on a desktop, and the Liquid
   * skeleton — which cannot know which it is drawing for — would then have to
   * guess and be wrong on one of them. A count is the same everywhere and only
   * the wrapping changes.
   */
  videosShown: number;

  // ── Floating bubble only ──

  /** Round, or the 9:16 frame the other layouts draw. */
  bubbleShape: BubbleShape;
  /** Which corner of the viewport it is pinned to. */
  bubblePosition: BubblePosition;
  /**
   * The bubble's WIDTH as a hundredth of the standard spacing token — 1200
   * means twelve spacings, which is 96px on desktop and 72px on a phone.
   *
   * Width and not height, for both shapes: a circle's width is its diameter,
   * and a rectangle takes its height from the 9:16 ratio. One number therefore
   * means the same thing — how much of the page's WIDTH the bubble spends —
   * whichever shape the merchant picked, which is the dimension that actually
   * competes with the content underneath.
   */
  bubbleScale: number;
  /**
   * How far the bubble sits from the two viewport edges it is pinned to, again
   * as a hundredth of the spacing token. 200 is 16px on desktop, 12px on a
   * phone.
   *
   * A floor, not the final number: the component takes the larger of this and
   * `env(safe-area-inset-*)`, so a bubble in a bottom corner clears the home
   * indicator on a phone that has one instead of sitting under it.
   */
  bubbleOffset: number;
  /**
   * Whether the shopper can close the bubble.
   *
   * Remembered for the tab — `sessionStorage`, so it is gone on the next visit
   * rather than for good. A shopper who has said no once should not be asked
   * again on every page of the same browse, and should not be shut out of it
   * for ever either.
   */
  bubbleDismissible: boolean;
  /**
   * Whether the bubble is drawn on a phone at all.
   *
   * ⚠️ The only setting in this extension answered by a CLASS rather than
   * inline, and it has to be: "is this a phone" is the breakpoint, the
   * breakpoint lives in `sje-widget.css` and nowhere else (CLAUDE.md §3), and
   * a `style` attribute cannot carry a media query. The cost is that a
   * stylesheet that fails to load leaves the bubble showing on a phone the
   * merchant hid it from — the mildest degradation on offer, and the same
   * bargain the `--pad-*` widths already make.
   */
  showOnMobile: boolean;

  // ── Product row only ──

  /** Which of the widget's videos this product page shows. */
  productFilter: ProductFilter;
  /**
   * The product the page is about, as the STOREFRONT numeric id — `"123"`, not
   * `gid://shopify/Product/123`.
   *
   * ⚠️ The odd one out in this file: not a setting the merchant typed, but the
   * page's own context, written by the block as `data-sje-product-id` and read
   * here because `readSettings` already has the node and nothing else does.
   * Adding a second parser and a second prop to carry one string would be more
   * machinery than the string is worth.
   *
   * `undefined` on every other layout, and on a product template Liquid could
   * not resolve. `ProductVideos` falls back to showing everything, which is
   * the same answer as `all` — a row is better than a blank.
   *
   * ⚠️ The stored products carry GIDs. `numericId` in `lib/sje.ts` is what
   * makes the two comparable; do not compare these strings directly.
   */
  productId?: string;

  // ── Banner only ──

  /**
   * Whether tapping the banner opens the full-screen player.
   *
   * OFF is a real choice, not a degraded one: a banner whose call to action is
   * its button should not also be one big link to somewhere else, and a
   * shopper who meant to press the button and hit the video instead has been
   * taken away from it.
   *
   * When it is off the banner draws no `role="button"` and takes no focus —
   * an announced control that opens nothing is worse than no control.
   */
  bannerOpensPlayer: boolean;
  /** How the banner's video fills its box. */
  bannerFit: BannerFit;
  /**
   * Whether the banner draws the sticker product's badge.
   *
   * Its own key rather than `stickerOnPreview`, which means "on the thumbnails
   * in a row" — a banner has no thumbnails, and a merchant who turned badges
   * off in their carousel has said nothing about their hero.
   */
  bannerSticker: boolean;
  /**
   * Which of nine cells the banner's copy sits in.
   *
   * Read by the component ONLY to keep the product badge out of its way — the
   * copy itself is drawn by the block, in Liquid, and this never sees it. See
   * `badgeSpot` in `Banner`.
   *
   * The block also has a `content_width`, which is NOT here: it only ever
   * becomes a `max-width` on an element Liquid draws, and nothing on this side
   * has a use for it.
   */
  contentPosition: BannerPosition;

  // ── Circles, and the two keys that outgrew them ──
  //
  // One settings shape covers every layout, and a block simply has no key for
  // a setting its schema does not declare — the defaults below fill in. That
  // is cheaper than a second parser and a second interface for the sake of
  // five keys, and it means a setting shared by two layouts is read one way.
  //
  // Which is exactly what happened: `previewMode` and `lazyLoad` were written
  // for the story bar and the grid now offers both, unchanged and under the
  // same ids. Everything above `previewMode` is still circles only.

  /**
   * The circle's diameter as a PERCENTAGE of the standard spacing token — 900
   * means nine spacings, which is 72px on desktop and 54px on a phone.
   *
   * A percentage rather than a diameter in px for the same reason as
   * `arrowScale`: it scales with the rest of the widget at the breakpoint
   * instead of standing still while everything around it tightens.
   */
  circleScale: number;
  /** What rings the circle, or `none` for a bare thumbnail. */
  ringStyle: RingStyle;
  /**
   * The ring's two colours. `ringFrom` alone is used for a solid ring; the
   * gradient runs `from` to `to` around the circle.
   */
  ringFrom: string;
  ringTo: string;
  /**
   * The ring's thickness, again as a percentage of the spacing token — 50
   * means half a spacing, so 4px on desktop and 3px on a phone.
   */
  ringScale: number;
  /** Whether each circle is captioned with its video's title. */
  showTitles: boolean;
  /** Whether a thumbnail plays its preview clip or stays a still. */
  previewMode: PreviewMode;
  /**
   * Whether the block waits for the shopper before loading anything.
   *
   * ON (the default), twice over: the BUNDLE is not fetched until the first
   * pointer, key or scroll — that half lives in `sje-mount.liquid`, because a
   * script cannot defer its own download — and then each circle downloads
   * nothing until it scrolls into view, with `loading="lazy"` on the poster
   * and no video element created at all until the circle has been seen once.
   *
   * OFF, both gates open: the bundle is requested with the page and every
   * circle fetches its poster and its clip immediately.
   *
   * ⚠️ BOTH halves or neither. Wiring this to the media alone left the switch
   * looking broken — the component cannot load anything early while the
   * bundle carrying it is still waiting for a pointer.
   *
   * Off is a real choice, not a mistake: a short story bar above the fold is
   * entirely visible anyway, and lazy loading there means the shopper watches
   * it assemble. On a long row it is expensive, which is why the default is on
   * and the merchant is the one who decides.
   *
   * Read by the story bar and by the grid. The bundle gate in
   * `sje-mount.liquid` is generic — it opens for any block whose settings say
   * `lazy_load == false` — so a layout adopting this key gets both halves.
   *
   * ⚠️ LOADING only. Playback is still gated on visibility either way: a clip
   * running where nobody can see it is waste in every configuration, and this
   * setting has no business turning that off.
   */
  lazyLoad: boolean;
  /**
   * Where the circles sit when there are too few to fill the widget.
   *
   * Only visible when the row does NOT overflow — a row long enough to scroll
   * has no spare space to distribute, so every alignment looks the same and
   * the shopper is at whatever scroll position they left it at.
   */
  rowAlignment: RowAlignment;
}

const ARROW_POSITIONS: readonly string[] = ["hidden", "left", "center", "right", "sides"];
const PLAYER_PRODUCTS: readonly string[] = ["sticker", "free-scroll", "hidden"];
const RING_STYLES: readonly string[] = ["gradient", "solid", "none"];
const ROW_ALIGNMENTS: readonly string[] = ["left", "center", "right"];
const PREVIEW_MODES: readonly string[] = ["video", "image"];
const BUBBLE_SHAPES: readonly string[] = ["circle", "rectangle"];
const PRODUCT_FILTERS: readonly string[] = ["tagged-first", "tagged", "all"];
const BANNER_FITS: readonly string[] = ["cover", "contain"];
const BANNER_POSITIONS: readonly string[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
const BUBBLE_POSITIONS: readonly string[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

/** Matches the `{% schema %}` defaults, for a block that has never been saved. */
export const DEFAULT_SETTINGS: SJESettings = {
  shuffle: false,
  arrowPosition: "center",
  arrowScale: 500,
  stickerOnPreview: true,
  playerProducts: "sticker",
  cardRadius: 100,
  columns: 4,
  columnsMobile: 2,
  videosShown: 8,
  bubbleShape: "circle",
  bubblePosition: "bottom-right",
  bubbleScale: 1200,
  bubbleOffset: 200,
  bubbleDismissible: true,
  showOnMobile: true,
  productFilter: "tagged-first",
  bannerOpensPlayer: true,
  bannerFit: "cover",
  bannerSticker: true,
  contentPosition: "middle-left",
  circleScale: 900,
  ringStyle: "gradient",
  ringFrom: "#f5a623",
  ringTo: "#d6249f",
  ringScale: 50,
  showTitles: true,
  previewMode: "video",
  lazyLoad: true,
  rowAlignment: "center",
};

/**
 * The range the size setting is clamped to, as a percentage of the spacing
 * token — 200% to 1000%, so 16px to 80px at the desktop base.
 *
 * The schema states the same numbers, so the editor cannot send anything
 * outside them — but the value also arrives through a `data-` attribute anyone
 * can edit, and a negative or absurd diameter should not be able to break the
 * row's layout.
 */
const MIN_ARROW_SCALE = 200;
const MAX_ARROW_SCALE = 1000;

/**
 * The story circle's range, as a percentage of the spacing token — 500% to
 * 2000%, so 40px to 160px at the desktop base.
 *
 * The floor is where a poster stops being recognisable as anything; the
 * ceiling is where a "row of circles" stops reading as a story bar and starts
 * reading as a grid of badly cropped photos.
 */
/**
 * The card radius range, as a percentage of the spacing token — 0% to 400%,
 * so square corners up to 32px at the desktop base.
 *
 * The ceiling is where a 9:16 card's corners start eating the video rather
 * than framing it; past that a merchant wanting a pill shape is really asking
 * for the story bar.
 */
const MIN_CARD_RADIUS = 0;
const MAX_CARD_RADIUS = 400;

/**
 * The grid's ranges.
 *
 * One column is a legitimate choice — a single stacked feed on a phone — and
 * the ceilings are where a 9:16 card stops being watchable: eight across a
 * desktop is a 100px-wide video, and four across a 375px phone is 80px.
 *
 * The Show more ceiling is a page-weight decision rather than a layout one.
 * Forty-eight cards is already a lot of posters to put on one page, and a
 * merchant who wants every video of a bigger widget visible at once is asking
 * for something the button is there to avoid.
 */
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 8;
const MIN_COLUMNS_MOBILE = 1;
const MAX_COLUMNS_MOBILE = 4;
const MIN_VIDEOS_SHOWN = 1;
const MAX_VIDEOS_SHOWN = 48;

/**
 * The bubble's ranges, as hundredths of the spacing token.
 *
 * 600 is 48px, which is the floor at which a 9:16 clip is still recognisable
 * as a scene rather than a smudge — and it is also the pointer-target minimum
 * with room to spare. 2400 is 192px: past that a "floating bubble" is a video
 * player parked over the merchant's content, and a shopper on a small laptop
 * has lost a corner of the page to it.
 *
 * The offset floor is 0 on purpose. A bubble flush to the corner is a real
 * design, and the safe-area inset still keeps it off a phone's home indicator.
 */
const MIN_BUBBLE_SCALE = 600;
const MAX_BUBBLE_SCALE = 2400;
const MIN_BUBBLE_OFFSET = 0;
const MAX_BUBBLE_OFFSET = 800;

const MIN_CIRCLE_SCALE = 500;
const MAX_CIRCLE_SCALE = 2000;

/** The ring's range: a quarter of a spacing to one and a half. */
const MIN_RING_SCALE = 25;
const MAX_RING_SCALE = 150;

/** The mount point's attribute, in `dataset` spelling. */
const ATTRIBUTE = "sjeSettings";

function asArrowPosition(value: unknown): ArrowPosition {
  return typeof value === "string" && ARROW_POSITIONS.includes(value)
    ? (value as ArrowPosition)
    : DEFAULT_SETTINGS.arrowPosition;
}

/**
 * A checkbox setting, defaulting to ON.
 *
 * Only an explicit `false` turns it off — the same rule `parseWidget` uses for
 * `enabled` in the app. A block saved before this setting existed has no key
 * for it at all, and a badge that was showing should not vanish because the
 * app learned a new option.
 */
function asFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  // Liquid writes a real boolean, but a hand-edited attribute could say
  // "false" as a string, which is truthy and would read as ON.
  if (value === "false") return false;
  if (value === "true") return true;
  return fallback;
}

function asPlayerProducts(value: unknown): PlayerProducts {
  return typeof value === "string" && PLAYER_PRODUCTS.includes(value)
    ? (value as PlayerProducts)
    : DEFAULT_SETTINGS.playerProducts;
}

/**
 * A percentage-of-token setting, clamped to the range its schema states.
 *
 * The editor cannot send anything outside the range — but the value also
 * arrives through a `data-` attribute anyone can edit, and an absurd diameter
 * should not be able to break a row's layout.
 */
function asScale(value: unknown, fallback: number, low: number, high: number): number {
  // Liquid writes a range setting as a number, but a hand-edited attribute
  // could be anything, so it is coerced rather than trusted.
  const scale = typeof value === "number" ? value : Number(value);
  if (!isFinite(scale)) return fallback;
  return Math.round(Math.min(high, Math.max(low, scale)));
}

/**
 * A whole-number COUNT, clamped to the range its schema states.
 *
 * The same arithmetic as `asScale` under a second name, and deliberately so: a
 * count is not a hundredth of a token, and reading `asScale(parsed.columns, 4,
 * 1, 8)` would suggest four columns meant four hundredths of something.
 */
const asCount = asScale;

function asPreviewMode(value: unknown): PreviewMode {
  return typeof value === "string" && PREVIEW_MODES.includes(value)
    ? (value as PreviewMode)
    : DEFAULT_SETTINGS.previewMode;
}

function asBubbleShape(value: unknown): BubbleShape {
  return typeof value === "string" && BUBBLE_SHAPES.includes(value)
    ? (value as BubbleShape)
    : DEFAULT_SETTINGS.bubbleShape;
}

function asBubblePosition(value: unknown): BubblePosition {
  return typeof value === "string" && BUBBLE_POSITIONS.includes(value)
    ? (value as BubblePosition)
    : DEFAULT_SETTINGS.bubblePosition;
}

function asBannerFit(value: unknown): BannerFit {
  return typeof value === "string" && BANNER_FITS.includes(value)
    ? (value as BannerFit)
    : DEFAULT_SETTINGS.bannerFit;
}

function asBannerPosition(value: unknown): BannerPosition {
  return typeof value === "string" && BANNER_POSITIONS.includes(value)
    ? (value as BannerPosition)
    : DEFAULT_SETTINGS.contentPosition;
}

function asProductFilter(value: unknown): ProductFilter {
  return typeof value === "string" && PRODUCT_FILTERS.includes(value)
    ? (value as ProductFilter)
    : DEFAULT_SETTINGS.productFilter;
}

function asRowAlignment(value: unknown): RowAlignment {
  return typeof value === "string" && ROW_ALIGNMENTS.includes(value)
    ? (value as RowAlignment)
    : DEFAULT_SETTINGS.rowAlignment;
}

function asRingStyle(value: unknown): RingStyle {
  return typeof value === "string" && RING_STYLES.includes(value)
    ? (value as RingStyle)
    : DEFAULT_SETTINGS.ringStyle;
}

/**
 * A colour setting, or the default when the merchant left it alone.
 *
 * ⚠️ Shopify writes an untouched `color` setting as an EMPTY STRING, not as a
 * missing key — so `parsed.ring_from ?? default` keeps the empty string and
 * paints an invisible ring. It has to be tested for content, not for
 * existence.
 */
function asColour(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

/**
 * Read one mount point's settings, falling back to the defaults for anything
 * missing or malformed.
 *
 * Never throws: a block whose settings failed to serialise should cost the
 * merchant their arrow placement, not the whole widget.
 */
export function readSettings(node: HTMLElement): SJESettings {
  // ⚠️ Carried through BOTH bail-outs below. It is the page's context rather
  // than one of the merchant's settings, so a block whose settings attribute is
  // missing or unparseable has not said anything about which product this is —
  // dropping it there would silently turn every product row into a plain one.
  const context = { productId: node.dataset.sjeProductId || undefined };

  const raw = node.dataset[ATTRIBUTE];
  if (!raw) return { ...DEFAULT_SETTINGS, ...context };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.warn("[SJE] could not read block settings — using defaults");
    return { ...DEFAULT_SETTINGS, ...context };
  }

  return {
    shuffle: asFlag(parsed.shuffle, DEFAULT_SETTINGS.shuffle),
    arrowPosition: asArrowPosition(parsed.arrow_position),
    arrowScale: asScale(
      parsed.arrow_scale,
      DEFAULT_SETTINGS.arrowScale,
      MIN_ARROW_SCALE,
      MAX_ARROW_SCALE,
    ),
    stickerOnPreview: asFlag(parsed.sticker_on_preview, DEFAULT_SETTINGS.stickerOnPreview),
    playerProducts: asPlayerProducts(parsed.player_products),
    cardRadius: asScale(
      parsed.card_radius,
      DEFAULT_SETTINGS.cardRadius,
      MIN_CARD_RADIUS,
      MAX_CARD_RADIUS,
    ),
    columns: asCount(parsed.columns, DEFAULT_SETTINGS.columns, MIN_COLUMNS, MAX_COLUMNS),
    columnsMobile: asCount(
      parsed.columns_mobile,
      DEFAULT_SETTINGS.columnsMobile,
      MIN_COLUMNS_MOBILE,
      MAX_COLUMNS_MOBILE,
    ),
    videosShown: asCount(
      parsed.videos_shown,
      DEFAULT_SETTINGS.videosShown,
      MIN_VIDEOS_SHOWN,
      MAX_VIDEOS_SHOWN,
    ),
    bubbleShape: asBubbleShape(parsed.bubble_shape),
    bubblePosition: asBubblePosition(parsed.bubble_position),
    bubbleScale: asScale(
      parsed.bubble_scale,
      DEFAULT_SETTINGS.bubbleScale,
      MIN_BUBBLE_SCALE,
      MAX_BUBBLE_SCALE,
    ),
    bubbleOffset: asScale(
      parsed.bubble_offset,
      DEFAULT_SETTINGS.bubbleOffset,
      MIN_BUBBLE_OFFSET,
      MAX_BUBBLE_OFFSET,
    ),
    bubbleDismissible: asFlag(parsed.bubble_dismissible, DEFAULT_SETTINGS.bubbleDismissible),
    showOnMobile: asFlag(parsed.show_on_mobile, DEFAULT_SETTINGS.showOnMobile),
    productFilter: asProductFilter(parsed.product_filter),
    bannerOpensPlayer: asFlag(parsed.banner_opens_player, DEFAULT_SETTINGS.bannerOpensPlayer),
    bannerFit: asBannerFit(parsed.banner_fit),
    bannerSticker: asFlag(parsed.banner_sticker, DEFAULT_SETTINGS.bannerSticker),
    contentPosition: asBannerPosition(parsed.content_position),
    // From its OWN attribute, not from the settings JSON — the page's context
    // rather than something the merchant typed. Blank reads as absent: Liquid
    // writes an empty string for a product it could not resolve, and `""` is
    // not a product id.
    ...context,
    circleScale: asScale(
      parsed.circle_scale,
      DEFAULT_SETTINGS.circleScale,
      MIN_CIRCLE_SCALE,
      MAX_CIRCLE_SCALE,
    ),
    ringStyle: asRingStyle(parsed.ring_style),
    ringFrom: asColour(parsed.ring_from, DEFAULT_SETTINGS.ringFrom),
    ringTo: asColour(parsed.ring_to, DEFAULT_SETTINGS.ringTo),
    ringScale: asScale(
      parsed.ring_scale,
      DEFAULT_SETTINGS.ringScale,
      MIN_RING_SCALE,
      MAX_RING_SCALE,
    ),
    showTitles: asFlag(parsed.show_titles, DEFAULT_SETTINGS.showTitles),
    previewMode: asPreviewMode(parsed.preview_mode),
    lazyLoad: asFlag(parsed.lazy_load, DEFAULT_SETTINGS.lazyLoad),
    rowAlignment: asRowAlignment(parsed.row_alignment),
  };
}

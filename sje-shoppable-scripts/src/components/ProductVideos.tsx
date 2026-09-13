// src/components/ProductVideos.tsx
// A compact row of videos for the product page, sized by the space it is given.
//
// The carousel's near-twin, and the differences are all consequences of where
// it lives. A product page's main column is a fraction of the width a section
// gets on a home page, and it already holds the gallery, the price and the buy
// button — so this row has to fit into whatever is left rather than claim a
// screenful of it.
//
// ── The three things that differ from `Carousel` ──
//
//   1. A card takes its WIDTH from the row, not its height from the viewport.
//      The carousel is a 70vh group whose cards get their width from a 9:16
//      ratio; that reads as enormous in a 500px product column. Here the
//      merchant says how many cards should be visible and each one is that
//      fraction of the container — so the row fits its parent by construction,
//      at any width, with no measurement and no `vh` anywhere. See `CARD`.
//   2. It knows what the shopper is looking at. The block is restricted to
//      product templates and passes the product's id down, so the row can put
//      that product's videos first — or show only those. See `ordered`.
//   3. There is no heading height to subtract and no fixed group height, so
//      the row is exactly as tall as one card and the block is as tall as the
//      row plus its heading.
//
// Everything else is the carousel's: the same previews, the same badge, the
// same arrows, the same full-screen player.
//
// Styling is inline for the same reason the Liquid skeletons are: this renders
// inside a merchant's theme, where a class name of ours may collide with
// theirs and their reset may undo ours. Inline wins both.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  widgetMedia,
  posterOf,
  previewUrlOf,
  taggedWith,
  type SJEMedia,
} from "../lib/sje";
import { useVideoImpression } from "../lib/analytics";
import { observeInView } from "../lib/inView";
import { useElementWidth } from "../lib/useElementWidth";
import { useHold, usePlaybackFrozen } from "../lib/playback";
import { useLiveProducts, type LiveProducts } from "../lib/products";
import { stickyProduct } from "../lib/sticker";
import { useRail } from "../lib/rail";
import { sp } from "../lib/tokens";
import { Lightbox } from "./Lightbox";
import { RailArrows } from "./RailArrows";
import { Sticker } from "./Sticker";
import type { PreviewMode, ProductFilter } from "../lib/settings";
import type { WidgetProps } from "../lib/mount";

/** The space between cards, in standard spacings. Matches the carousel's row. */
const GAP_STEPS = 1.5;

/** How much of a card must be showing before it counts as watched. */
const VISIBLE_ENOUGH = 0.5;

/**
 * One card's width, as a fraction of the row.
 *
 * ⚠️ Pure CSS, and that is the point of the whole layout. `n` cards visible
 * with `n - 1` gaps between them means each card is `(100% - gaps) / n` — and
 * `100%` here is the row's own content box, so the answer is right at every
 * container width without anything measuring anything. The skeleton writes the
 * identical string, so the handover is invisible; a JS-measured width could not
 * be in the skeleton at all.
 *
 * `--sje-across-count` is the merchant's cards-per-view, switched at the
 * breakpoint by `sje-widget.css` because a count is not a length and cannot be
 * derived from the spacing token. Shared with the grid, which asks the same
 * question about columns — one mechanism, not two. The fallback is the
 * merchant's DESKTOP answer rather than a constant, so a stylesheet that fails
 * to load costs the mobile count and nothing else.
 *
 * ⚠️ `var()` inside `calc()` inside a division: the multiplier has to be a
 * plain number for `/` to be valid, which it is — the count is unitless. Do
 * not be tempted to make it a length.
 */
const CARD = (desktop: number): string =>
  `calc((100% - ${sp(GAP_STEPS)} * (var(--sje-across-count, ${desktop}) - 1))` +
  ` / var(--sje-across-count, ${desktop}))`;

const FILL = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
} as const;

/**
 * The widget's videos, arranged for the product this page is about.
 *
 * Stable across renders in the two cases that matter: `all` and a missing
 * product id hand back the input array itself, and the two filtered cases
 * build from a `media` that `widgetMedia` already memoised.
 *
 * ⚠️ `tagged` can legitimately return NOTHING, and the caller draws nothing
 * rather than falling back. A row headed "as seen in our videos" showing
 * videos of a different product is worse than no row, and a silent fallback
 * would hide the merchant's own mistake from them.
 */
function ordered(
  media: SJEMedia[],
  filter: ProductFilter,
  productId: string | undefined,
): SJEMedia[] {
  // No product to ask about — a product template Liquid could not resolve, or
  // a hand-edited mount point. Showing the widget as-is is the same answer as
  // `all`, and a row beats a blank.
  if (filter === "all" || !productId) return media;

  const mine = media.filter((item) => taggedWith(item, productId));
  if (filter === "tagged") return mine;

  // `tagged-first`: this product's videos, then everything else in the
  // widget's own order. A `Set` rather than a second `taggedWith` pass per
  // item, because that walks every tagged product of every media again.
  const seen = new Set(mine.map((item) => item.id));
  return [...mine, ...media.filter((item) => !seen.has(item.id))];
}

interface CardProps {
  media: SJEMedia;
  /** One card's width, as the CSS length `CARD` builds. */
  width: string;
  /**
   * Held still while a full-screen player is up ANYWHERE on the page — not
   * only this block's. The card is still on screen as far as the observer is
   * concerned, so without this every preview on the page would go on looping
   * — and decoding — behind the overlay, in competition with the one video
   * the shopper is actually watching. See `lib/playback.ts`.
   */
  frozen: boolean;
  /** Live product data for the badge. See `useLiveProducts`. */
  live: LiveProducts;
  /** Whether this placement draws the badge on its cards at all. */
  sticker: boolean;
  /** Whether this card plays its preview clip or stays a still. */
  mode: PreviewMode;
  /** Whether its media waits until the shopper can see it. */
  lazy: boolean;
  /** The corner radius in spacing steps, from the block's `card_radius`. */
  radius: number;
  onOpen: () => void;
}

function Card({
  media,
  width,
  frozen,
  live,
  sticker,
  mode,
  lazy,
  radius,
  onOpen,
}: CardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // The badge's stored size is a percentage of the frame, and the frame is
  // this card — whose width is a fraction of the row, so it is only known once
  // laid out.
  const cardWidth = useElementWidth(cardRef);

  const [inView, setInView] = useState(false);
  // Whether the video element may exist yet. Under lazy loading the card has
  // to have been seen once; with it off, from the first render. Either way it
  // then STAYS mounted, so scrolling back resumes from what is already
  // buffered instead of re-fetching.
  const [seen, setSeen] = useState(!lazy);

  // The merchant can flip the setting with the theme editor open, and the
  // initialiser above only ever runs once.
  useEffect(() => {
    if (!lazy) setSeen(true);
  }, [lazy]);

  const poster = posterOf(media);
  // Not `media.previewUrl` — that is the ladder's head, which is the 1080p
  // encode. See `previewUrlOf`.
  const preview = previewUrlOf(media);

  /** Whether this card has a clip to play AND is meant to play it. */
  const plays = mode === "video" && Boolean(preview);

  useEffect(() => {
    const el = cardRef.current;
    // Guarded INSIDE the effect rather than by not calling it: a hook cannot
    // be conditional, and the setting is a merchant's to change while the
    // theme editor is open.
    //
    // ⚠️ This runs whether or not lazy loading is on. It answers two
    // questions, and only one of them is about loading: it decides when the
    // element may be created, AND it drives play/pause. A clip running where
    // nobody can see it is waste in every configuration.
    if (!el || !plays) return;

    return observeInView(el, VISIBLE_ENOUGH, (visible) => {
      setInView(visible);
      if (visible) setSeen(true);
    });
  }, [plays]);

  // `inView`, not `seen`: the impression is the card being on screen, and with
  // lazy loading off `seen` starts true for every card in the widget whether
  // the shopper ever scrolled to it or not.
  useVideoImpression(media.id, inView);

  useEffect(() => {
    const video = videoRef.current;
    // Null in still mode — there is no element, so there is nothing to drive.
    if (!video) return;

    // As a property, not only as the `muted` attribute below: some browsers
    // read that attribute at parse time only, and this element is created by
    // script — without this, autoplay is refused as "not muted".
    video.muted = true;

    if (inView && !frozen) {
      // Rejects when the browser refuses autoplay anyway. A still poster is a
      // fine outcome, so the rejection is deliberately swallowed.
      void video.play().catch(() => {});
      return;
    }

    video.pause();

    // A card that is merely covered keeps its place, so closing the player
    // drops the shopper back where they were. Only one that actually left the
    // viewport is rewound.
    if (!inView) video.currentTime = 0;
  }, [inView, seen, frozen]);

  return (
    <div
      class="sje-product-videos__card"
      ref={cardRef}
      // A real button, not a div with a click handler: this is the one thing
      // on the card a shopper can do, and it should be reachable by keyboard
      // and announced as an action.
      role="button"
      tabIndex={0}
      aria-label={media.title ? `Play ${media.title}` : "Play video"}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // Space scrolls the page otherwise, which is the opposite of opening.
        event.preventDefault();
        onOpen();
      }}
      style={{
        // ⚠️ `0 0 auto` with an explicit `width`, not `0 0 <width>`. A flex
        // basis of a `calc()` containing a percentage resolves against the
        // flex container in a way browsers have disagreed about; a stated
        // width with no grow and no shrink is the same intent, unambiguously.
        flex: "0 0 auto",
        width,
        // The width is definite, so the ratio has a real number to work from
        // and the row is exactly one card tall. Nothing here states a height.
        aspectRatio: "9 / 16",
        borderRadius: sp(radius),
        overflow: "hidden",
        background: "rgba(0,0,0,0.08)",
        position: "relative",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {poster && (
        <img
          class="sje-product-videos__poster"
          src={poster}
          alt={media.title || ""}
          loading={lazy ? "lazy" : "eager"}
          style={FILL}
        />
      )}

      {plays && seen && (
        <video
          class="sje-product-videos__video"
          ref={videoRef}
          src={preview!}
          poster={poster}
          muted
          loop
          playsInline
          // ⚠️ `none` is what makes lazy loading actually lazy: the element
          // existing is not the same as the clip being fetched.
          preload={lazy ? "none" : "auto"}
          // The card is decoration around the poster; nothing here is a
          // control, so it stays out of the accessibility tree.
          aria-hidden="true"
          tabIndex={-1}
          style={FILL}
        />
      )}

      {sticker && <Sticker media={media} frameWidth={cardWidth} live={live} />}
    </div>
  );
}

export function ProductVideos({ widget, settings }: WidgetProps) {
  const all = widgetMedia(widget, settings.shuffle);
  const media = ordered(all, settings.productFilter, settings.productId);

  // The badges' products, fetched once for the whole row. Gathered here rather
  // than per card so the requests go out together and the skeletons clear
  // together — a row that filled in one badge at a time would read as broken
  // rather than as loading. Duplicates cost nothing: the cache in
  // `products.ts` is keyed by product id.
  const live = useLiveProducts(
    media.flatMap((item) => {
      const product = stickyProduct(item);
      return product ? [product] : [];
    }),
  );

  const rail = useRail(GAP_STEPS, media.length);

  // Which card is open full screen, or `null` for none. An index into `media`
  // — the FILTERED list, so the player moves between the cards the shopper can
  // actually see rather than jumping to a video this page never offered.
  const [openAt, setOpenAt] = useState<number | null>(null);

  // A widget re-saved with fewer videos while the player is open would leave
  // the index pointing past the end. Treating that as closed is cheaper than
  // an effect, and correct on the very render that shrinks the list.
  const playerOpen = openAt !== null && openAt < media.length;

  // ── The two halves of the page-wide pause ──
  //
  // This block SAYS a player is open, and separately ASKS whether one is —
  // its own included, which is why the two are not the same expression. See
  // `lib/playback.ts`.
  useHold(playerOpen);
  const frozen = usePlaybackFrozen();

  // Empty is a real outcome here, not only the "widget has no videos" case
  // every other layout guards: `tagged` on a product with none of the widget's
  // videos tagged to it lands exactly here, and drawing nothing is the answer.
  // See `ordered`.
  if (media.length === 0) return null;

  const open = playerOpen ? openAt : null;
  const width = CARD(settings.columns);

  return (
    <div class="sje-product-videos" style={{ display: "flex", flexDirection: "column" }}>
      <div
        ref={rail.ref}
        // The class carries one thing only: the WebKit scrollbar rule, which
        // is a pseudo-element and so cannot be written inline. Everything the
        // layout depends on stays in `style`, where the theme cannot reach it.
        class="sje-product-videos__row sje-scroller"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: sp(GAP_STEPS),
          overflowX: "auto",
          overflowY: "hidden",
          // Firefox. WebKit's equivalent is in the stylesheet.
          scrollbarWidth: "none",
        }}
      >
        {media.map((item, i) => (
          <Card
            key={item.id}
            media={item}
            width={width}
            frozen={frozen}
            live={live}
            sticker={settings.stickerOnPreview}
            mode={settings.previewMode}
            lazy={settings.lazyLoad}
            // A hundredth of the spacing token, as every size setting here is
            // — `sp()` takes the multiplier, so 100 is one spacing.
            radius={settings.cardRadius / 100}
            onOpen={() => setOpenAt(i)}
          />
        ))}
      </div>

      <RailArrows
        position={settings.arrowPosition}
        scale={settings.arrowScale}
        spacing={rail.spacing}
        atStart={rail.atStart}
        atEnd={rail.atEnd}
        onPrev={() => rail.scrollByItem(-1)}
        onNext={() => rail.scrollByItem(1)}
      />

      {open !== null && (
        <Lightbox
          items={media}
          index={open}
          live={live}
          products={settings.playerProducts}
          widgetId={widget.id}
          onIndex={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </div>
  );
}

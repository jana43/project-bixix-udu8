// src/components/ProductRail.tsx
// Every product tagged on a video, as a row the shopper scrolls along the
// bottom of the full-screen player.
//
// ── The card ──
//
//   .--------------------------------.
//   |  .------.   Product name over   |
//   |  | img  |   up to two lines     |
//   |  '------'   $1,100.00           |
//   '--------------------------------'
//
// Landscape, not portrait: the thumbnail on the left, the name and price
// stacked beside it. A rail runs across the bottom of a 9:16 frame, which is
// the one direction there is no room in — a tall card eats the video, a wide
// one takes a strip.
//
// The other half of `PlayerProducts`. A sticker pins ONE product to one spot
// on the frame, which is right on a card in a row — small, glanceable, out of
// the way. It is the wrong shape for a video the shopper chose to open: there
// is room there for the whole outfit, and pinning one of five products to the
// frame makes the other four invisible.
//
// Scrolled independently of the video, which is what "free-scroll" names: the
// video keeps playing while the shopper moves along the row.
//
// Prices come from the same cache the badge uses (`lib/products.ts`), keyed by
// product id — so a product already fetched for its sticker costs no second
// request when it appears here.
//
// Every size is a multiple of a standard token, read through `sp()` / `fs()`
// so it steps down at the breakpoint with the rest of the widget — CLAUDE.md
// §3 and §4.
import { useLiveProducts } from "../lib/products";
import { formatPrice, percentOff } from "../lib/money";
import { productUrl } from "../lib/shopify";
import { NBSP, NOT_EMPTY } from "../lib/notEmpty";
import { fs, sp } from "../lib/tokens";
import type { SJEMedia, SJEProduct } from "../lib/sje";

/**
 * The card's width — `* 24`, so 192px on desktop and 144px on a phone.
 *
 * A token multiple rather than a fraction of the stage, because the stage is
 * 9:16 and a fraction of it would make the cards narrower on exactly the
 * screens where a name has least room. This way two and a bit are in view on a
 * phone and two and a half on a desktop, and the card is the same shape on
 * both.
 */
const CARD_STEPS = 24;

/** The thumbnail, square: `* 6` — 48px desktop, 36px on a phone. */
const THUMB_STEPS = 6;

/** The grey a skeleton pulses. Opaque — it sits over video, not over a page. */
const SKELETON_FILL = "#cfcfcf";

/** The was-price and the saving. Muted grey, and a red the eye stops on. */
const WAS_COLOUR = "#6b6b6b";
const SALE_COLOUR = "#b3261e";

interface ProductRailProps {
  media: SJEMedia;
  /**
   * A card was tapped — the player opens its product sheet on that product.
   *
   * Omitted, a card is a plain link to the product page. That is the fallback
   * rather than the design: leaving for the product page ends the video.
   */
  onOpen?: (productId: string) => void;
}

export function ProductRail({ media, onOpen }: ProductRailProps) {
  const tagged = media.products ?? [];

  // Fetched HERE rather than with the carousel's batch, deliberately. The
  // carousel fetches one product per video — the one its badge shows — and
  // pulling every tagged product of every video on the page would turn a row
  // of twelve videos into fifty requests on load, for a rail nobody may open.
  // Asking when the player opens costs one round trip the shopper is already
  // waiting through, and the module-level cache means a product that was
  // already fetched for its badge resolves instantly.
  const live = useLiveProducts(tagged);

  if (tagged.length === 0) return null;

  return (
    <div
      // The stage toggles play/pause on click. Scrolling the rail, or tapping
      // a product in it, must not also pause the video behind it.
      onClick={(event) => event.stopPropagation()}
      // The class carries one thing: the WebKit scrollbar rule, which is a
      // pseudo-element and so cannot be written inline.
      class="sje-scroller"
      style={{
        position: "absolute",
        insetInline: 0,
        // Clear of the progress hairline at the very bottom.
        bottom: sp(0.375),
        // Bottom-up scrim, so the cards read over a bright frame.
        padding: `${sp(4)} ${sp(1.5)} ${sp(1.5)}`,
        background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent)",
        display: "flex",
        gap: sp(1),
        overflowX: "auto",
        // Firefox. WebKit's half is the `.sje-scroller` rule in the stylesheet.
        scrollbarWidth: "none",
        // A swipe that runs out of rail must not drag the page behind the
        // dialog, and must not be read as a swipe on the video either.
        overscrollBehavior: "contain",
      }}
    >
      {tagged.map((product) => (
        <Card
          key={product.id}
          product={live.byId.get(product.id) ?? product}
          waiting={!live.byId.has(product.id) && !live.settled}
          onOpen={onOpen && (() => onOpen(product.id))}
        />
      ))}
    </div>
  );
}

interface CardProps {
  product: SJEProduct;
  /** Its price is still being fetched; show the shape, not a stale number. */
  waiting: boolean;
  /** Open the sheet on this product instead of following the link. */
  onOpen?: () => void;
}

function Card({ product, waiting, onOpen }: CardProps) {
  return (
    // Still an anchor even though the ordinary tap opens a sheet, and that is
    // the point of doing it this way round: the href is REAL, so the card is
    // middle-clickable, openable in a new tab, offered by "Copy link address",
    // and announced as a link. `onOpen` only intercepts the plain left-click.
    //
    // `handle` is always present on a tagged product; the `#` is only for the
    // impossible case, and is inert rather than wrong.
    <a
      href={product.handle ? productUrl(product.handle) : "#"}
      onClick={(event) => {
        // Scrolling the rail must not also pause the video behind it.
        event.stopPropagation();
        if (!onOpen) return;

        // A modified click is the shopper asking for a new tab or window, and
        // a middle click is not a left click at all. Both are left to the
        // browser — intercepting them is how a link stops behaving like one.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        event.preventDefault();
        onOpen();
      }}
      style={{
        flex: "0 0 auto",
        width: sp(CARD_STEPS),
        display: "flex",
        alignItems: "center",
        gap: sp(1),
        padding: sp(0.75),
        boxSizing: "border-box",
        borderRadius: sp(1),
        background: "#fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          // Stated both ways — an empty box sized only by a ratio collapses,
          // and a product with no photo leaves this empty. CLAUDE.md §6.
          flex: "0 0 auto",
          width: sp(THUMB_STEPS),
          height: sp(THUMB_STEPS),
          borderRadius: sp(0.75),
          overflow: "hidden",
          background: waiting ? SKELETON_FILL : "#fff",
          ...NOT_EMPTY,
        }}
        class={waiting ? "sje-skeleton" : undefined}
      >
        {NBSP}
        {product.imageUrl && (
          <img
            src={product.imageUrl}
            alt=""
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
      </div>

      {/* `min-width: 0` is what lets the clamp and the ellipsis engage: without
          it a flex item refuses to shrink below its text's natural width, and
          a long product name pushes the card wider instead of wrapping. */}
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div
          style={{
            fontSize: fs(0.7),
            lineHeight: 1.3,
            color: "#111",
            // Two lines, then an ellipsis. A product name is longer than a
            // card is wide far more often than not.
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {product.title}
        </div>

        {waiting ? (
          // A grey bar the height of the price line, so the card does not
          // resize when the numbers land.
          <div
            class="sje-skeleton"
            style={{
              marginBlockStart: sp(0.25),
              // An explicit height, not a font size: `NOT_EMPTY` zeroes the
              // text so the placeholder character cannot be seen, which also
              // zeroes any height the line box would have given it. This is
              // exactly as tall as the price line it stands in for.
              height: `calc(${fs(0.85)} * 1.2)`,
              background: SKELETON_FILL,
              borderRadius: sp(0.25),
              ...NOT_EMPTY,
            }}
          >
            {NBSP}
          </div>
        ) : (
          // Wraps, because three pieces do not always fit a card this wide —
          // and a saving pushed onto its own line still reads correctly, while
          // one clipped mid-number does not.
          <div
            style={{
              marginBlockStart: sp(0.25),
              display: "flex",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: sp(0.5),
            }}
          >
            <span
              style={{
                fontSize: fs(0.85),
                lineHeight: 1.2,
                fontWeight: 700,
                color: "#111",
                whiteSpace: "nowrap",
              }}
            >
              {product.price ? formatPrice(product.price) : NBSP}
            </span>

            {product.compareAtPrice && (
              <span
                style={{
                  fontSize: fs(0.65),
                  lineHeight: 1.2,
                  color: WAS_COLOUR,
                  textDecoration: "line-through",
                  whiteSpace: "nowrap",
                }}
              >
                {formatPrice(product.compareAtPrice)}
              </span>
            )}

            {percentOff(product) !== null && (
              <span
                style={{
                  fontSize: fs(0.6),
                  lineHeight: 1.2,
                  fontWeight: 700,
                  color: "#fff",
                  background: SALE_COLOUR,
                  padding: `${sp(0.25)} ${sp(0.5)}`,
                  borderRadius: sp(0.375),
                  whiteSpace: "nowrap",
                }}
              >
                {`-${percentOff(product)}%`}
              </span>
            )}
          </div>
        )}
      </div>
    </a>
  );
}

// src/components/Sticker.tsx
// The sticker product's badge, layered over a video frame.
//
// ── The shape ──
//
//   .-----------------------.
//   |              .------. |
//   |              |  +3  | |   the other products tagged on this video
//   |              '------' |
//   |        (image)        |   fills the card, edge to edge
//   |                       |
//   |-----------------------|
//   |         $230          |   the price, a strip inside the same outline
//   '-----------------------'
//
// ONE card, not three interlocking pieces. The photo is the badge — it runs to
// the outline on three sides — and the two labels are laid into it: the price
// on a strip across the foot, the "+N" tucked into the top-right corner, drawn
// only when the video carries more products than the one on the badge.
//
// ── What this replaced, and why the old problem is gone ──
//
// The previous design was three separate outlined boxes stacked with a
// negative margin, the price bar deliberately WIDER than the image so it broke
// the silhouette. It worked, but it cost: three outlines and three white
// grounds punched a far bigger hole in the video than the labels needed, and
// the overlapping seams could not carry a shadow — a plain `0 1px 4px` smeared
// grey across both joins, and confining it to the sides failed too, because
// the bar's ends were rounded and a horizontally-offset blur wraps around a
// corner. That is why the bar ended up with no shadow at all.
//
// None of that applies to one rectangle. There are no seams, so the card takes
// one ordinary shadow and the whole workaround is gone. Do not reintroduce the
// stacked construction without reintroducing that problem with it.
//
// Sized from a measured PIXEL width: every dimension inside is a proportion of
// the badge's own width, and a font size cannot be a percentage of its own box.
//
// ⚠️ THE ADMIN MIRRORS THIS. `StickerBadge.tsx` in the app's
// `components/shoppable_videos/sub-components/` draws the same shape from the
// same proportions, because the app's position editor is the merchant's only
// preview of what lands on the storefront. The two codebases do not build
// together and nothing enforces the pairing but this comment. Change them
// together, or the editor starts lying about where the merchant's badge ends
// up.
import { stickerOf, LABEL_REFERENCE_SIZE } from "../lib/sticker";
import { NBSP, NOT_EMPTY } from "../lib/notEmpty";
import { BADGE_WEIGHT, BASE_SPACING, bfs, sp } from "../lib/tokens";
import { formatPrice } from "../lib/money";
import type { LiveProducts } from "../lib/products";
import type { SJEMedia, SJEProduct } from "../lib/sje";

interface StickerProps {
  media: SJEMedia;
  /**
   * The frame's width in CSS pixels — the box the percentages are of. `0`
   * means not yet measured, and draws nothing.
   */
  frameWidth: number;
  /**
   * What the store said about the tagged products, from `useLiveProducts`.
   * Omitted entirely — as on the Vite dev page — the badge draws from the
   * stored copy and never shows a skeleton.
   */
  live?: LiveProducts;
  /**
   * Makes the badge itself tappable — the full-screen player passes this to
   * open its product sheet.
   *
   * ⚠️ Omitted, the badge stays `pointer-events: none`, and that is the right
   * default: on a CAROUSEL CARD the card is the button, and a badge that
   * swallowed the tap would leave a dead patch in the middle of it where the
   * video refuses to open. CLAUDE.md §6. Only the player, where the card is
   * behind and there is nothing to open, hands one of these over.
   */
  onOpen?: () => void;
  /**
   * Where to put the badge, overriding the position the merchant set on the
   * media. Percentages of the frame, as `stickerPosition` is.
   *
   * ⚠️ For the ONE case where the stored position cannot mean what it says:
   * the banner. Every other layout draws the video in a 9:16 frame, so a badge
   * placed at 80%/82% in the app's editor lands exactly where the merchant put
   * it. A banner is a wide box with the video cropped to fill it, so the frame
   * the percentages were measured against is not on screen any more — and the
   * banner also has the merchant's heading and button to keep clear of, which
   * the editor knew nothing about. `Banner` therefore places it opposite the
   * copy instead. Size and rotation are still the merchant's.
   */
  at?: { x: number; y: number };
}

/**
 * The badge for `media`, positioned, or nothing when there is none to draw.
 *
 * Every "the merchant never chose" is already resolved by `stickerOf`, so
 * there is no defaulting here: by this point the position, size and rotation
 * are numbers, and the product is a product.
 */
export function Sticker({ media, frameWidth, live, onOpen, at }: StickerProps) {
  const sticker = stickerOf(media);
  if (!sticker || frameWidth <= 0) return null;

  const widthPx = (frameWidth * sticker.size) / 100;
  // The badge's size against the fixed reference the label sizes are stated
  // at — NOT against the default, which is free to move. The labels scale by
  // this rather than by `widthPx`; see `labelSteps` and `LABEL_REFERENCE_SIZE`.
  const scale = sticker.size / LABEL_REFERENCE_SIZE;

  const fresh = live?.byId.get(sticker.product.id);
  // Three states, and the middle one is why `settled` exists. No answer AND
  // the batch still running means waiting — draw a skeleton. No answer once it
  // has settled means the request failed, and the stored copy is better than
  // an empty box. An answer is an answer.
  //
  // The stored copy is deliberately NOT shown while waiting: a price that
  // changes under the shopper a moment after they read it is worse than one
  // that arrives a moment late.
  const waiting = live !== undefined && !fresh && !live.settled;

  return (
    <div
      class="sje-sticker"
      // Centred on its point and then rotated, exactly as the admin's editor
      // places it — the order matters, and `translate` before `rotate` is what
      // makes the badge spin about its own middle rather than swing around
      // the corner it is anchored by.
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? "Shop the products in this video" : undefined}
      onClick={
        onOpen &&
        ((event: MouseEvent) => {
          // The stage toggles play/pause on click. Opening the sheet must not
          // also pause the video behind it.
          event.stopPropagation();
          onOpen();
        })
      }
      onKeyDown={
        onOpen &&
        ((event: KeyboardEvent) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          // Space scrolls the page otherwise, and the page is behind a modal.
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        })
      }
      style={{
        position: "absolute",
        left: `${at?.x ?? sticker.x}%`,
        top: `${at?.y ?? sticker.y}%`,
        transform: `translate(-50%, -50%) rotate(${sticker.rotation}deg)`,
        // On a card the card is the button, and the badge is a label on it —
        // pointers pass straight through so there is no dead patch in the
        // middle of it. In the player there is no card underneath and the
        // badge is the way into the sheet, so it takes the tap itself.
        pointerEvents: onOpen ? "auto" : "none",
        cursor: onOpen ? "pointer" : undefined,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <Badge
        product={fresh ?? sticker.product}
        widthPx={widthPx}
        others={sticker.others}
        scale={scale}
        waiting={waiting}
      />
    </div>
  );
}

// The badge's WIDTH is sized from the frame, not from the standard tokens, and
// that is deliberate: `sticker.size` is a percentage of the video the merchant
// placed it on, set per-video in the app, and the badge has to stay in step
// with the app's position editor.
//
// The TEXT is not. The price used to be `widthPx * 0.15` under a floor, which
// made a badge on the Lightbox's big stage carry noticeably larger text than
// the same badge on a card — text is to be read, not part of the artwork that
// should grow with it. Both labels below are steps on the BADGE's own type
// token, so they are the same size wherever the badge is drawn — and they step
// UP at the breakpoint rather than down, because a price on a phone is the
// last thing that should get harder to read. See `STICKER_FONT_VAR`.
const PRICE_STEPS = 0.6;
const CHIP_STEPS = 0.55;

/**
 * The smallest a label may get, in the same steps.
 *
 * `MIN_STICKER_SIZE` is 12 against a reference of 32, so the slider's bottom
 * is `scale = 0.375` — which would take the price to 0.22 steps, about 3px, a
 * grey smudge rather than a number. A badge the merchant shrank right down
 * should get small text, not unreadable text.
 *
 * It does real work at the small end and none at the large. On a DESKTOP a
 * price runs 6.3px at the slider's minimum, 7.35px at the default and 10.5px
 * at its maximum; on a phone the badge token is 16px rather than 14px, so the
 * same three are 7.2px, 8.4px and 12px.
 */
const MIN_LABEL_STEPS = 0.45;

/**
 * A label's size in steps, for a badge scaled to `scale`.
 *
 * ⚠️ Scaled by the merchant's SIZE SETTING, not by the badge's pixel width,
 * and the difference matters. Pixel width varies with the frame — the same
 * badge is roughly three times wider on the Lightbox's stage than on a card —
 * so sizing text from it made one video's price render at two noticeably
 * different sizes depending on where the shopper was looking at it. The size
 * setting is one number per media, so the price is the same everywhere and
 * still answers the slider the merchant is dragging.
 */
const labelSteps = (steps: number, scale: number): number =>
  Math.max(MIN_LABEL_STEPS, steps * scale);

const MIN_PAD = BASE_SPACING * 0.5;

/**
 * The card's proportions, and the one place the shape is described.
 *
 * The image area is SQUARE — `height: widthPx` — so the card as a whole comes
 * out a little taller than it is wide once the price strip is added. That is
 * the sketch, and it is also what a product photo wants: a square crop loses
 * least of whatever the merchant happened to upload.
 */
function metrics(widthPx: number) {
  return {
    radius: widthPx * 0.16,
    pad: Math.max(widthPx * 0.06, MIN_PAD),
    /** The chip is a small thing on a big one — its own, tighter, geometry. */
    chipRadius: widthPx * 0.09,
    chipPad: Math.max(widthPx * 0.035, MIN_PAD * 0.5),
  };
}

/**
 * The outline the card carries, and the rule between the photo and the price.
 *
 * A real stroke rather than the dark edge of a shadow: the badge sits on
 * video, and a shadow alone leaves the boundary weakest exactly where the
 * frame behind it happens to be dark.
 */
const STROKE = "rgba(0,0,0,0.22)";
const HAIRLINE = `1px solid ${STROKE}`;

/** Lifts the card off the video. One card, one shadow — see the header. */
const SHADOW = "0 1px 4px rgba(0,0,0,0.25)";

/**
 * The grey a skeleton pulses.
 *
 * ⚠️ OPAQUE, and it has to be. The obvious value is the `rgba(0, 0, 0, 0.08)`
 * the Liquid skeletons use, and it is wrong here: those sit on the theme's own
 * background, which is usually white, so a translucent black reads as grey.
 * This one sits on a VIDEO. Replacing the badge's white ground with a 92%-
 * transparent tint does not make a grey square, it makes a window — the frame
 * shows straight through, and on dark footage the skeleton is invisible.
 *
 * That was the first bug behind "the image skeleton never appears": it was
 * appearing the whole time, and you could see the video through it.
 *
 * The second was the value. `#e4e4e4` fixed the video and lost to the CARD: an
 * unloaded card draws `rgba(0, 0, 0, 0.08)` on the theme's white, which is
 * about `#ebebeb`, and a skeleton the same colour as the box behind it is no
 * more visible than a transparent one. This grey is chosen to clear BOTH — it
 * is well below the card's placeholder and well above black footage.
 *
 * Inline, NOT in the `.sje-skeleton` rule, and that is load-bearing too: the
 * boxes wearing that class also carry inline styling of their own, and an
 * inline `background` beats a class every time. The class carries the
 * keyframes and nothing else.
 */
const SKELETON_FILL = "#cfcfcf";

/**
 * The floor under the card, in both directions.
 *
 * `sticker.size` is a percentage of the frame, so a badge on a narrow card
 * comes out genuinely small — 32px of image has been seen — and a photo that
 * small is not read as a product, it is read as a speck. Three steps on the
 * standard scale is the smallest square that still says "a picture goes here".
 *
 * It floors the real image as well as the skeleton: the two must be the same
 * size or the badge jumps when the photo lands.
 */
const MIN_IMAGE = sp(3);

const LABEL = {
  display: "block",
  lineHeight: 1.2,
  // A `var()`, not a number: this is the one weight in the extension that goes
  // UP on a phone — 600 on a desktop, 700 below the breakpoint.
  //
  // 600 is right on a desktop, where a 700 face at these sizes starts closing
  // its own counters (the bowl of a 6px "0" fills in) and is wider besides. On
  // a phone the badge sits on video that has been compressed harder and is
  // being read further from the eye, and the heavier face is what survives it.
  // See `STICKER_FONT_VAR`.
  fontWeight: BADGE_WEIGHT,
  color: "#111",
  textAlign: "center",
  // A price never breaks across two lines mid-number.
  whiteSpace: "nowrap",
} as const;

interface BadgeProps {
  product: SJEProduct;
  widthPx: number;
  /** How many other products are tagged. `0` draws no chip. */
  others: number;
  /**
   * The badge's size against `LABEL_REFERENCE_SIZE` — `0.875` at the current
   * default, `0.375` at the slider's minimum and `1.25` at its maximum. The
   * labels scale with it; see `labelSteps`.
   */
  scale: number;
  /**
   * The store has not answered yet. The card keeps its exact shape and greys
   * out the two things that come off the network — the photo and the price —
   * so nothing moves when they land.
   *
   * ONE component for both states rather than a card and a matching skeleton,
   * deliberately: the whole job of a skeleton is to be the same shape as the
   * thing it stands in for, and two components that have to agree on a shape
   * are two components that can stop agreeing. The chip is drawn for real
   * either way — its count comes from the stored media, not from the network,
   * so there is nothing about it to wait for.
   */
  waiting: boolean;
}

function Badge({ product, widthPx, others, scale, waiting }: BadgeProps) {
  const { radius, pad, chipRadius, chipPad } = metrics(widthPx);

  return (
    <div
      class="sje-sticker__card"
      // Announced as busy rather than as a product while it waits, so a screen
      // reader is not told about a price that is not there yet.
      role={waiting ? "status" : undefined}
      aria-label={waiting ? "Loading product" : undefined}
      style={{
        position: "relative",
        // ⚠️ `min-width` plus `max-content`, NOT a fixed `width`, and this is
        // the whole of the "nothing gets hidden" guarantee.
        //
        // The card was `width: widthPx` and `overflow: hidden`, which meant a
        // price too long for the card was silently cut off at the outline —
        // "$600.0", "$2,629." — and "$1,2…" is not a price: a shopper cannot
        // tell whether the missing digits are cents or thousands. There is no
        // font size that fixes this in general, because the number of
        // characters is the store's to decide, not ours.
        //
        // So the badge is at LEAST `widthPx` and grows to whatever its price
        // needs. A short price gets the square card the design asks for; a
        // long one gets a slightly wider card and a slightly landscape crop,
        // which is a far smaller cost than an unreadable number. It grows
        // symmetrically, because the wrapper centres it on its anchor point.
        // The larger of the two floors, in CSS rather than JS, because one of
        // them is a token and the other is a number: `widthPx` is the size the
        // merchant chose, and `MIN_IMAGE` is the legibility floor under it.
        minWidth: `max(${MIN_IMAGE}, ${widthPx}px)`,
        width: "max-content",
        background: "#fff",
        border: HAIRLINE,
        boxShadow: SHADOW,
        boxSizing: "border-box",
        borderRadius: radius,
        // Clips the photo, and the price strip's bottom corners, to the card's
        // own radius — which is why neither of them states a radius of its own.
        overflow: "hidden",
      }}
    >
      <div
        class={waiting ? "sje-sticker__photo sje-skeleton" : "sje-sticker__photo"}
        style={{
          position: "relative",
          // A real HEIGHT, not `aspect-ratio` alone — the same rule the Liquid
          // skeletons follow, and for the same reason. A product with no
          // stored image leaves this box empty, and an empty box sized only by
          // a ratio resolves to zero: the badge would render as a price strip
          // with nothing above it.
          // Two widths, doing two different jobs. The fixed one is what the
          // card measures itself against — a definite width contributes
          // exactly itself to the parent's `max-content`, so the photo never
          // drags the card out to the natural size of whatever the merchant
          // uploaded. The percentage one is what fills the card when a long
          // price has widened it: a percentage resolves to `auto` during
          // intrinsic sizing, so it cannot feed back into the measurement it
          // depends on, and then wins over `width` once the card's own width
          // is known.
          width: widthPx,
          minWidth: "100%",
          height: widthPx,
          minHeight: MIN_IMAGE,
          // White under the photo, grey only while there is no photo. A
          // product shot is very often cut out on white or has a transparent
          // background, and grey behind one of those reads as a dirty edge
          // around the product rather than as loading.
          background: waiting ? SKELETON_FILL : "#fff",
          // A product with no stored photo leaves this box empty, and an empty
          // box is one a theme may hide outright. See `NBSP`.
          ...NOT_EMPTY,
        }}
      >
        {NBSP}
        {!waiting && product.imageUrl && (
          <img
            class="sje-sticker__image"
            src={product.imageUrl}
            alt=""
            loading="lazy"
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}

        {/* Laid INTO the corner of the photo rather than hung off the card,
            which is what keeps the badge one rectangle. Inset by `pad` on both
            sides so the card's own rounded corner still reads behind it.

            `inset-inline-end` rather than `right`, so it moves to the other
            corner on a right-to-left storefront along with everything else. */}
        {others > 0 && (
          <div
            class="sje-sticker__chip"
            style={{
              position: "absolute",
              top: pad,
              insetInlineEnd: pad,
              padding: `${chipPad}px ${chipPad * 1.75}px`,
              borderRadius: chipRadius,
              background: "#fff",
              border: HAIRLINE,
              boxSizing: "border-box",
            }}
          >
            <span
              class="sje-sticker__chip-label"
              style={{ ...LABEL, fontSize: bfs(labelSteps(CHIP_STEPS, scale)) }}
              // Spelt out for a screen reader, which would otherwise announce
              // "plus three" and leave the shopper to guess at three of what.
              aria-label={`${others} more product${others === 1 ? "" : "s"} in this video`}
            >
              +{others}
            </span>
          </div>
        )}
      </div>

      {/* The strip is drawn while waiting even though there is no price yet:
          almost every product has one, and a card that grows a whole strip the
          moment the number lands is worse than one that fills a strip it
          already had. */}
      {(waiting || product.price) && (
        <div class="sje-sticker__price" style={{ borderBlockStart: HAIRLINE, padding: `${pad}px ${pad * 1.5}px` }}>
          {waiting ? (
            <div
              class="sje-sticker__price-skeleton sje-skeleton"
              style={{
                background: SKELETON_FILL,
                // Exactly as tall as the line the real price occupies, so the
                // strip is the same height before and after. Stated rather
                // than left to the text, because `NOT_EMPTY` zeroes the
                // placeholder character — and with it the line box it would
                // otherwise have given this box.
                height: `calc(${bfs(labelSteps(PRICE_STEPS, scale))} * 1.2)`,
                borderRadius: chipRadius * 0.5,
                ...NOT_EMPTY,
              }}
            >
              {NBSP}
            </div>
          ) : (
            <span class="sje-sticker__price-text" style={{ ...LABEL, fontSize: bfs(labelSteps(PRICE_STEPS, scale)) }}>
              {formatPrice(product.price!)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

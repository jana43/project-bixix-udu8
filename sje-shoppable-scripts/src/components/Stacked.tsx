// src/components/Stacked.tsx
// A deck of 9:16 cards with one in front, the rest falling away either side.
//
// The same widget as the carousel, arranged as a stack instead of a row. The
// card in the middle is full size and is the one playing; its neighbours are
// scaled down step by step, drawn behind it, and dimmed. Tapping the middle
// card opens `Lightbox`; tapping any other brings it to the middle.
//
// ── Why this is NOT a scroller ──
//
// The carousel and the story bar are both `useRail`: a real overflow scroller
// the browser moves, with arrows that nudge it. This is not, and could not
// usefully be. A stack has an ACTIVE CARD — one index, in front, playing — and
// every size, every offset and every z-index on screen is a function of the
// distance from it. That is state, not scroll position, and deriving it from
// `scrollLeft` would mean recomputing five transforms on every scroll event to
// reproduce something an integer already says exactly.
//
// It is also why `arrow_position` grew a `sides` value here. A rail's arrows
// belong under the row, because the row is what they move. A stack's belong
// either side of the card, because the card is what they move — and `sides` is
// the default for this layout for that reason.
//
// Styling is inline for the same reason the Liquid skeletons are: this renders
// inside a merchant's theme, where a class name of ours may collide with
// theirs and their reset may undo ours. Inline wins both.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { widgetMedia, posterOf, previewUrlOf, type SJEMedia } from "../lib/sje";
import { useVideoImpression } from "../lib/analytics";
import { observeInView } from "../lib/inView";
import { useHold, usePlaybackFrozen } from "../lib/playback";
import { useLiveProducts, type LiveProducts } from "../lib/products";
import { stickyProduct } from "../lib/sticker";
import { BASE_SPACING, sp, SPACING_VAR, useTokenPx } from "../lib/tokens";
import { useMedia } from "../lib/useMedia";
import { Lightbox } from "./Lightbox";
import { Arrow, RailArrows } from "./RailArrows";
import { Sticker } from "./Sticker";
import type { WidgetProps } from "../lib/mount";

/**
 * How many cards are drawn either side of the middle one.
 *
 * Two. Three begins to look like a fan rather than a stack, and the fifth card
 * out is 45% of the size of the one in front — small enough that a shopper
 * reads it as texture rather than as a video they could choose.
 */
const DEPTH = 2;

/**
 * How tall the card in front is, as a share of the viewport.
 *
 * ⚠️ The STAGE states this, not the widget — see the note beside
 * `.sje-widget--stacked` in `sje-widget.css`, which deliberately has no height
 * of its own. A deck is one card with company, and this is the height of that
 * one card, not a group the heading and the arrows are then subtracted from.
 *
 * ⚠️ PAIRED three ways, and all three must agree or the deck breaks outright:
 * here, the stacked row in `sje-mount.liquid`, and the ABSENCE of a height on
 * `.sje-widget--stacked`. If the CSS ever gets one back, the stage below has
 * to go back to `flex: 1 1 auto` with it — a stage sized `1 1 auto` inside a
 * container with no height resolves to nothing, because every card in it is
 * absolutely positioned and contributes no content height. That renders
 * blank, with the skeleton before it looking perfectly fine.
 *
 * 75vh rather than the carousel's 70, and measured on the card rather than on
 * a group, so it is the larger change it looks. A taller card is a WIDER card
 * at 9:16, and width is the whole problem on a short wide screen: at 1280x551
 * a 70vh group left cards 174px across, which even seven of them could not
 * stretch over a 1152px block without pulling apart. Height is the only lever
 * that makes a card bigger — its width follows by ratio, never the reverse.
 */
const CARD_VH = "75vh";

/**
 * The widest the front card may be, as a share of the stage.
 *
 * A ceiling for the opposite case: a tall narrow phone, where 75vh of height
 * asks for a card wider than the block it sits in. Without it the front card
 * fills the width edge to edge, there is nowhere for a neighbour to show, and
 * the deck reads as a single cropped video.
 *
 * ⚠️ Paired with `max-width: 72%` on the stacked skeleton's card.
 */
const MAX_CARD_FRACTION = 0.72;

/**
 * The most cards the deck will show either side on a very wide block.
 *
 * ⚠️ `DEPTH` is what an ordinary block gets; this is the ceiling `deck()` may
 * raise it to when there is width going spare. Growing the deck is the only
 * lever that exists once `MAX_STEP` is reached: the cards cannot spread
 * further without separating, and they cannot get bigger either, because
 * their width comes from the stage's HEIGHT and that is fixed at 70vh.
 *
 * Three, not more. The fourth card out is 45% of the front one, and past that
 * the shape stops reading as a deck with depth and starts reading as a fan of
 * offcuts.
 */
const MAX_DEPTH = 3;

/**
 * How much smaller each step out is, as a multiple of the step before it.
 *
 * Compounding rather than a fixed subtraction, which is what "decreased
 * sequentially" wants: 100%, 82%, 67%. A fixed step reaches zero, and reaches
 * it sooner the further out you look.
 */
const SCALE = 0.82;

/**
 * How far each step moves sideways, as a fraction of a card's own width.
 *
 * ⚠️ MEASURED, not fixed — `spread()` solves for it so the deck fills the
 * width the block actually has after its padding. A constant looked right at
 * one container width and left a hand's width of empty page either side of it
 * at any other, which is what a fixed fraction of a card can only ever do:
 * the card's width comes from the stage's HEIGHT, so it knows nothing about
 * how wide the widget is.
 *
 * These two are the floor and the ceiling on that.
 *
 * The ceiling is the interesting one. At `0.91` the neighbour's edge exactly
 * meets the front card's, and past that they separate — at which point it is
 * not a stack, it is a row of three sizes. `0.88` keeps a sliver of overlap at
 * every width, which is the thing that reads as depth.
 */
const MIN_STEP = 0.45;
const MAX_STEP = 0.88;

/**
 * The step used before the stage has been measured.
 *
 * ⚠️ PAIRED with the stacked skeleton in `sje-mount.liquid`, which draws its
 * cards at exactly this. That pairing is the whole reason the constant exists.
 *
 * Without it the first paint fell out of `spread()` with a stage width of `0`,
 * which clamps to `MIN_STEP` — so the deck appeared bunched, then sprang
 * outwards the moment the ResizeObserver reported. Starting where the
 * skeleton already is makes the handover invisible, and the settle into the
 * measured width rides the same 320ms transition every other move does, which
 * reads as the deck arriving rather than as a correction.
 *
 * Mid-range on purpose: it is what a widget around 1300px wide asks for, which
 * is a full-width block on an ordinary desktop.
 */
const DEFAULT_STEP = 0.72;

/** How dark a card that is not in front goes. */
const DIM = 0.62;

/** How long a card takes to move when the shopper changes which is in front. */
const GLIDE_MS = 320;
const GLIDE_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/** A shopper who asked not to be moved around should not be. */
const STILL = "(prefers-reduced-motion: reduce)";

/**
 * How much of the deck must be showing before the front card plays. Lower than
 * the carousel's half: the deck is one wide object rather than a row of
 * separable ones, and half of it on screen is plenty to be watching.
 */
const VISIBLE_ENOUGH = 0.35;

/** A 9:16 card, filled. */
const FILL = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
} as const;

/**
 * How far a card `offset` places from the middle sits, as a percentage of its
 * own width.
 *
 * The sum of the steps rather than `offset * STEP`, because each step out is
 * shorter than the last by the same ratio the cards shrink by. Even steps
 * would leave the far cards floating in space; these close up behind the front
 * one the way a real deck does.
 */
function shift(offset: number, step: number): number {
  let total = 0;
  for (let k = 0; k < Math.abs(offset); k += 1) {
    total += step * SCALE ** k;
  }
  return Math.sign(offset) * total * 100;
}

/**
 * The step that makes a deck of `depth` cards either side span `room`.
 *
 * Half the deck, measured from the middle, is every step out plus half of the
 * outermost card:
 *
 *   room = card * step * Σ SCALE^k  +  card * SCALE^depth / 2
 *
 * which rearranges to the line below. Clamped, because a very narrow block
 * would ask for cards on top of each other and a very wide one would pull them
 * apart into a row.
 */
function spread(room: number, card: number, depth: number): number {
  if (depth < 1 || card <= 0) return MAX_STEP;

  let sum = 0;
  for (let k = 0; k < depth; k += 1) sum += SCALE ** k;

  return (room - (card * SCALE ** depth) / 2) / (card * sum);
}

/** Half the deck's width in px, from the middle to the outer card's far edge. */
function halfSpan(step: number, card: number, depth: number): number {
  let total = 0;
  for (let k = 0; k < depth; k += 1) total += step * SCALE ** k;
  return card * total + (card * SCALE ** depth) / 2;
}

/**
 * How many cards either side, and how far apart — the two answers together,
 * because neither is meaningful without the other.
 *
 * ── Why depth is not a constant ──
 *
 * `spread()` alone leaves a gap on a wide block and overflows a narrow one,
 * because it has exactly one lever and that lever has ends. Past `MAX_STEP`
 * the cards separate and it stops being a stack; below `MIN_STEP` they pile up
 * and the deck stops being legible. Clamping either way is what left a hand's
 * width of empty page down both sides of a wide desktop.
 *
 * The second lever is the number of cards. More of them span more width at the
 * same comfortable overlap, which is a better answer than five cards adrift in
 * the middle of a 2000px block — a wide screen showing more of the catalogue
 * is what a wide screen is for.
 *
 * Walks DOWN from the widest deck allowed and takes the first that does not
 * force the cards past `MIN_STEP` into each other. Wide blocks land on a big
 * depth with a comfortable step; narrow ones fall through to a small depth,
 * which is what stops a phone drawing five cards on top of one another.
 */
function deck(room: number, card: number, most: number): { depth: number; step: number } {
  // Not measured yet — the first render, before any observer has reported.
  // These are what the Liquid skeleton draws, so the handover is invisible.
  if (card <= 0 || room <= 0) return { depth: Math.min(DEPTH, most), step: DEFAULT_STEP };

  for (let depth = most; depth >= 1; depth -= 1) {
    const step = spread(room, card, depth);
    if (step >= MIN_STEP) return { depth, step: Math.min(MAX_STEP, step) };
  }

  return { depth: Math.min(1, most), step: MIN_STEP };
}

/**
 * How many cards fit either side WITHOUT any of them appearing twice.
 *
 * `DEPTH` is the most the design wants; this is the most the widget can give.
 * A looping window of `2 * depth + 1` drawn from `count` videos shows the same
 * media at two offsets the moment it is wider than the list — a duplicate
 * `key`, which Preact will not thank anyone for, and a deck with the same
 * thumbnail twice in it, which no shopper would either.
 */
function fittingDepth(count: number): number {
  return Math.max(0, Math.min(MAX_DEPTH, Math.floor((count - 1) / 2)));
}

/**
 * The media at a visual offset from the front card, wrapping at both ends.
 *
 * ⚠️ The whole reason the deck LOOKS the same at every position. Without the
 * wrap the first video has nothing to its left and the last nothing to its
 * right, so the deck arrives lopsided at one end of the widget and lopsided
 * the other way at the far end — which is exactly what a stack should never
 * do, because there is no row for the shopper to see they have reached the end
 * of. It is a deck; a deck has no end.
 *
 * `+ count` before the modulo because `%` in JS keeps the sign of the left
 * operand: `-1 % 5` is `-1`, not `4`.
 */
function wrap(front: number, offset: number, count: number): number {
  return (((front + offset) % count) + count) % count;
}

/**
 * The stage in CSS pixels: its HEIGHT is what every card's width is derived
 * from, and its WIDTH is what the deck has to spread across.
 *
 * ⚠️ Measured on the STAGE, not on a card, and that is the point. A card is
 * scaled by a `transform`, and `getBoundingClientRect` reports the scaled box
 * — so measuring one would hand the badge inside it a width that has already
 * been shrunk, and the transform would then shrink it again. The stage is
 * never transformed, so its height is the honest one, and every card's layout
 * width is the same `height * 9 / 16` whatever scale it is drawn at.
 */
function useStageSize(ref: { current: HTMLElement | null }): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const box = el.getBoundingClientRect();
    setSize({ width: box.width, height: box.height });
    if (typeof ResizeObserver === "undefined") return;

    // `contentRect`, not a fresh measurement: it is the size the observer has
    // already computed, and asking again forces a second layout.
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

interface StackCardProps {
  media: SJEMedia;
  /** Distance from the card in front. `0` is the one being watched. */
  offset: number;
  /** How far one step moves sideways, from `spread()`. */
  step: number;
  /** The deepest offset drawn, which is what the z-index counts down from. */
  depth: number;
  /** The card's layout size in px. Measured on the STAGE, not on a card — see
   *  `useStageSize` for why. */
  cardWidth: number;
  cardHeight: number;
  /** The deck is on screen. */
  inView: boolean;
  /** A full-screen player is up somewhere on the page. See `lib/playback.ts`. */
  frozen: boolean;
  /** No transition — the shopper asked for no movement. */
  still: boolean;
  live: LiveProducts;
  sticker: boolean;
  /** The corner radius in spacing steps, from the block's `card_radius`. */
  radius: number;
  onOpen: () => void;
}

function StackCard({
  media,
  offset,
  step,
  depth,
  cardWidth,
  cardHeight,
  inView,
  frozen,
  still,
  live,
  sticker,
  radius,
  onOpen,
}: StackCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const front = offset === 0;

  // The element is built once the card has been in front, and then stays: a
  // shopper stepping back and forth across a deck should not re-fetch.
  const [seen, setSeen] = useState(front);
  useEffect(() => {
    if (front) setSeen(true);
  }, [front]);

  // Front AND on screen. A deck scrolled past still has a front card, and
  // counting that would give every stacked widget an impression per page view
  // whether it was ever looked at or not.
  useVideoImpression(media.id, front && inView);

  const poster = posterOf(media);
  // Not `media.previewUrl` — that is the ladder's head, the 1080p encode.
  const preview = previewUrlOf(media);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // As a property, not only as the attribute below: some browsers read that
    // attribute at parse time only, and this element is created by script —
    // without this, autoplay is refused as "not muted".
    video.muted = true;

    // ⚠️ ONLY the card in front plays, and that is the layout's whole
    // efficiency story. Five cards are on screen; four of them are partly
    // behind another card, dimmed, and smaller than a thumbnail. Playing them
    // would be four decoders running for something nobody is watching.
    if (front && inView && !frozen) {
      // Rejects when the browser refuses autoplay anyway. A still poster is a
      // fine outcome, so the rejection is deliberately swallowed.
      void video.play().catch(() => {});
      return;
    }

    video.pause();
    // A card the shopper stepped away from starts again when they come back;
    // one merely covered by the player keeps its place.
    if (!front) video.currentTime = 0;
  }, [front, inView, frozen, seen]);

  return (
    <div
      class="sje-stacked__card"
      // A real button: bringing a card forward, or opening the one already
      // there, is the only thing a shopper can do here.
      role="button"
      tabIndex={0}
      aria-label={
        front
          ? media.title
            ? `Play ${media.title}`
            : "Play video"
          : media.title
            ? `Show ${media.title}`
            : "Show this video"
      }
      // Only the front card is in the reading order; the rest are scenery
      // until they are brought forward.
      aria-hidden={front ? undefined : "true"}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // Space scrolls the page otherwise, which is the opposite of opening.
        event.preventDefault();
        onOpen();
      }}
      style={{
        position: "absolute",
        insetInlineStart: "50%",
        top: "50%",
        // Both stated in pixels rather than left to `aspect-ratio`, because
        // the width cap can only be applied to a number.
        width: cardWidth,
        height: cardHeight,
        // Centred first, then stepped out, then scaled. The order matters:
        // scaling last means the step distances are not themselves scaled, so
        // `shift` can describe the deck in one place.
        transform: `translate(-50%, -50%) translateX(${shift(offset, step)}%) scale(${SCALE ** Math.abs(offset)})`,
        // The front card is on top; each step out sits one layer behind.
        zIndex: depth - Math.abs(offset),
        // Dimmed behind, not faded: opacity would let the card behind THAT one
        // show through, and a deck you can see into is not a deck.
        filter: front ? undefined : `brightness(${DIM})`,
        transition: still ? "none" : `transform ${GLIDE_MS}ms ${GLIDE_EASE}, filter ${GLIDE_MS}ms ease`,
        borderRadius: sp(radius),
        overflow: "hidden",
        background: "rgba(0,0,0,0.08)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {poster && <img class="sje-stacked__poster" src={poster} alt={media.title || ""} loading="lazy" style={FILL} />}

      {preview && seen && (
        <video
          class="sje-stacked__video"
          ref={videoRef}
          src={preview}
          poster={poster}
          muted
          loop
          playsInline
          preload="none"
          // The card is decoration around the poster; nothing here is a
          // control, so it stays out of the accessibility tree.
          aria-hidden="true"
          tabIndex={-1}
          style={FILL}
        />
      )}

      {/* The front card only. On a card scaled to 67% the badge would be
          scaled with it, and a price at two thirds of an already small size is
          not a price anyone reads — it is noise over a card whose job right
          now is to suggest there is more to come. */}
      {sticker && front && <Sticker media={media} frameWidth={cardWidth} live={live} />}
    </div>
  );
}

export function Stacked({ widget, settings }: WidgetProps) {
  const media = widgetMedia(widget, settings.shuffle);

  // The badges' products, fetched once for the whole deck — same batch, same
  // cache as the carousel's. See `Carousel`.
  const live = useLiveProducts(
    media.flatMap((item) => {
      const product = stickyProduct(item);
      return product ? [product] : [];
    }),
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const spacing = useTokenPx(stageRef, SPACING_VAR, BASE_SPACING);
  const stage = useStageSize(stageRef);
  const still = useMedia(STILL);

  /** Which card is in front. The whole layout is a function of this. */
  const [active, setActive] = useState(0);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [inView, setInView] = useState(false);

  const playerOpen = openAt !== null && openAt < media.length;

  // This block says a player is open, and separately asks whether one is —
  // its own included. A player opened anywhere on the page stops these
  // previews. See `lib/playback.ts`.
  useHold(playerOpen);
  const frozen = usePlaybackFrozen();

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    return observeInView(el, VISIBLE_ENOUGH, setInView);
  }, []);

  const move = useCallback(
    (direction: 1 | -1) => {
      // Wraps, so the arrows never run out. See `wrap`.
      setActive((current) => wrap(current, direction, Math.max(1, media.length)));
    },
    [media.length],
  );

  if (media.length === 0) return null;

  // A widget re-saved with fewer videos leaves both indexes pointing past the
  // end. Clamping here is cheaper than an effect and correct on the very
  // render that shrinks the list.
  const front = Math.min(active, media.length - 1);
  const open = playerOpen ? openAt : null;

  // The badge is a percentage of the card, and the card's width comes from a
  // 9:16 ratio against the stage's height — so it is only known once laid out.
  // ── The card ──
  //
  // Its HEIGHT is the stage's, which is `CARD_VH`; its width follows at 9:16.
  // The cap is for a screen too narrow to hold that: the card shrinks rather
  // than filling the block edge to edge and leaving its neighbours nowhere to
  // show.
  const cardWidth = Math.min((stage.height * 9) / 16, stage.width * MAX_CARD_FRACTION);
  const cardHeight = (cardWidth * 16) / 9;

  const arrows = settings.arrowPosition;
  const arrowSize = Math.round((spacing * settings.arrowScale) / 100);

  // How much half the deck may occupy. The arrows sit inside the stage when
  // they are at the sides, so the cards stop short of them rather than sliding
  // underneath; below the deck they take no width at all and only the widget's
  // own breathing room is held back.
  const room =
    stage.width / 2 - (arrows === "sides" ? arrowSize + spacing * 3 : spacing * 2);

  // How many cards, and how far apart — answered together, because neither is
  // meaningful without the other. See `deck`.
  const { depth, step } = deck(room, cardWidth, fittingDepth(media.length));

  // Never spent: the deck wraps, so there is always somewhere to go. A widget
  // with one video is the exception, and there both arrows are dead.
  const spent = media.length < 2;

  // Where an arrow's outer edge goes, measured from the middle: past the outer
  // card, then the gap, then the button itself.
  const arrowOffset = halfSpan(step, cardWidth, depth) + spacing + arrowSize;

  return (
    <div class="sje-stacked" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        class="sje-stacked__stage"
        ref={stageRef}
        // Arrow keys move the deck when the shopper is in it. Handled here
        // rather than on each card so it keeps working while the focus is on
        // an arrow button.
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") move(-1);
          else if (event.key === "ArrowRight") move(1);
          else return;
          // Only for the keys actually handled, so a theme's own shortcuts and
          // ordinary page scrolling are left alone.
          event.preventDefault();
        }}
        style={{
          position: "relative",
          // ⚠️ NOT `flex: 1 1 auto`. Every card in here is absolutely
          // positioned, so the stage has no content height to be sized from —
          // inside a container that states no height of its own, `1 1 auto`
          // resolves to zero and the deck vanishes. The card's height is
          // stated here instead. See `CARD_VH`.
          flex: "0 0 auto",
          height: CARD_VH,
          // The cards either side are stepped outwards and would otherwise
          // spill into whatever the theme has beside the widget.
          overflow: "hidden",
        }}
      >
        {/* Driven by the WINDOW, not by the media list.
            Mapping the list and skipping what is out of range cannot wrap: the
            first video would have nothing to its left and the last nothing to
            its right, so the deck arrives lopsided at one end of the widget
            and lopsided the other way at the far end. Walking the offsets and
            asking `wrap` which media belongs at each is what makes the deck
            look the same wherever the shopper is in it.

            It also fixes the mount count: five cards drawn from a widget of
            forty, rather than forty rendered and thirty-five thrown away. */}
        {Array.from({ length: depth * 2 + 1 }, (_, slot) => {
          const offset = slot - depth;
          const index = wrap(front, offset, media.length);
          const item = media[index];

          return (
            <StackCard
              key={item.id}
              media={item}
              offset={offset}
              step={step}
              depth={depth}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              inView={inView}
              frozen={frozen}
              still={still}
              live={live}
              sticker={settings.stickerOnPreview}
              // A percentage of the spacing token, as every size setting here
              // is — `sp()` takes the multiplier, so 100% is one spacing.
              radius={settings.cardRadius / 100}
              // The front card opens; any other comes forward first. A shopper
              // who tapped a half-hidden card at the edge of a deck meant
              // "show me that one", not "play it".
              onOpen={() => (offset === 0 ? setOpenAt(index) : setActive(index))}
            />
          );
        })}

        {/* `sides` — one either side OF THE CARDS, which is what a stack
            wants and what a rail cannot offer. Inside the stage so they are
            centred on the deck rather than on the widget's whole height. */}
        {arrows === "sides" && (
          <>
            <div
              class="sje-stacked__side sje-stacked__side--prev"
              style={{
                position: "absolute",
                // ⚠️ Against the DECK's edge, not the stage's.
                //
                // Pinned to the stage, an arrow on a block wider than the deck
                // sits alone against the far edge with a stretch of empty page
                // between it and the nearest card — the control and the thing
                // it controls, visibly unrelated. Measured off the deck they
                // stay together at every width, and whatever room is left over
                // falls OUTSIDE the pair, where it reads as a centred widget
                // rather than as a gap.
                //
                // `max()` is the floor: on a block narrower than its own deck
                // the arrows would otherwise be pushed off the stage.
                insetInlineStart: `max(${sp(1)}, calc(50% - ${arrowOffset}px))`,
                top: "50%",
                transform: "translateY(-50%)",
                // Over the cards, which reach `depth`.
                zIndex: depth + 1,
              }}
            >
              <Arrow direction="prev" tone="overlay" size={arrowSize} spent={spent} onClick={() => move(-1)} />
            </div>
            <div
              class="sje-stacked__side sje-stacked__side--next"
              style={{
                position: "absolute",
                insetInlineEnd: `max(${sp(1)}, calc(50% - ${arrowOffset}px))`,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: depth + 1,
              }}
            >
              <Arrow direction="next" tone="overlay" size={arrowSize} spent={spent} onClick={() => move(1)} />
            </div>
          </>
        )}
      </div>

      {/* Every other placement is the strip under the deck, shared with the
          carousel. `RailArrows` draws nothing for `sides` or `hidden`. */}
      <RailArrows
        position={arrows}
        // ⚠️ The DECK's arrows, everywhere, not only the ones at the sides.
        //
        // The sides are where it matters: on a phone the deck fills the width,
        // so those two sit on top of the cards, and a `currentColor` outline
        // over a video frame is invisible about half the time. But a merchant
        // who moves them below should not find them changing appearance —
        // one control, one look, wherever this layout puts it.
        //
        // The carousel and the story bar keep `plain`: their arrows sit in a
        // strip below the row, on the theme's own ground, where an outline is
        // the least presumptuous thing to draw.
        tone="overlay"
        scale={settings.arrowScale}
        spacing={spacing}
        atStart={spent}
        atEnd={spent}
        onPrev={() => move(-1)}
        onNext={() => move(1)}
      />

      {open !== null && (
        <Lightbox
          items={media}
          index={open}
          live={live}
          products={settings.playerProducts}
          widgetId={widget.id}
          // ⚠️ `setOpenAt` ONLY — the deck deliberately does not follow.
          //
          // It used to: moving in the player also moved `active`, on the
          // reasoning that closing it should leave the shopper looking at the
          // video they had got to. In practice that is the deck rearranging
          // itself behind a scrim, for a shopper who is watching something
          // else — five cards resizing and sliding every time an arrow is
          // pressed, visible around the edges of the overlay and impossible
          // to attribute to anything they did.
          //
          // The player owns which video is playing. The deck owns which card
          // is in front. They meet when one is opened from the other and not
          // before, so closing the player puts the shopper back exactly where
          // they left the page.
          onIndex={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </div>
  );
}

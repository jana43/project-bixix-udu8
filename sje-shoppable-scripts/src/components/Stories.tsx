// src/components/Stories.tsx
// A row of circles the shopper scrolls through, like a story bar.
//
// The same widget as the carousel, in a different shape. A circle plays its
// preview on loop while it is in the viewport and stops the moment it leaves —
// or stays a still, if the block says so; see `preview_mode`. Tapping one
// opens `Lightbox` either way, which plays the whole video full screen with
// whatever the block's `player_products` says. The row hides its scrollbar and
// scrolls by swipe, drag and wheel — with no arrows, deliberately, which is
// what every story bar the shopper has already met does.
//
// ── What a circle changes ──
//
// Three things, and they are all consequences of the round mask:
//
//   1. The preview is `object-fit: cover` on a SQUARE, not a 9:16 card, so a
//      portrait video shows its middle band. That is what a story bar is.
//   2. The ring is a painted circle with the photo inset by its padding.
//      Drawing it as a `border` on the clipping element would put it inside
//      the circle and eat the photo; drawing it as a `box-shadow` — which the
//      first pass did — cannot carry a gradient.
//   3. There is NO product badge. The carousel draws one on its cards and this
//      deliberately does not: the badge is a rectangle whose default sits at
//      the frame's lower-right, which on a circle is exactly the corner the
//      mask cuts away — so it can only be clipped into a sliver or hung
//      outside the circle, and neither is a story bar. A circle is a
//      thumbnail; the products belong to the video it opens.
//
// Styling is inline for the same reason the Liquid skeletons are: this renders
// inside a merchant's theme, where a class name of ours may collide with
// theirs and their reset may undo ours. Inline wins both.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  CIRCLE_RUNGS,
  posterOf,
  previewUrlOf,
  widgetMedia,
  type SJEMedia,
} from "../lib/sje";
import { observeInView } from "../lib/inView";
import { useHold, usePlaybackFrozen } from "../lib/playback";
import { useLiveProducts } from "../lib/products";
import { stickyProduct } from "../lib/sticker";
import { BASE_STORY_UNIT, fs, sp, STORY_UNIT_VAR, useTokenPx } from "../lib/tokens";
import { Lightbox } from "./Lightbox";
import type { PreviewMode, RingStyle, RowAlignment } from "../lib/settings";
import type { WidgetProps } from "../lib/mount";

/** The space between circles, in standard spacings. */
const GAP_STEPS = 2;

/**
 * How much of a circle must be showing before it counts as watched.
 *
 * Higher than the carousel's half, and deliberately: circles are small and a
 * row holds many more of them, so half a circle peeking in from the edge is a
 * far weaker signal that the shopper is looking at it than half a card is.
 */
const VISIBLE_ENOUGH = 0.7;

/** How many lines of caption before it is cut off. */
const TITLE_LINES = 1;

/**
 * Where a short row sits, as a `justify-content` value.
 *
 * ⚠️ `safe`, and it is load-bearing. `justify-content: center` on a scroll
 * container whose content OVERFLOWS pushes the overflow off BOTH ends, and
 * the start of it becomes unreachable — the row cannot be scrolled back to
 * its first circle. The `safe` keyword says "centre it only while it fits,
 * and fall back to the start when it does not", which is exactly the
 * behaviour wanted and the whole reason a row of circles can be centred at
 * all.
 *
 * A browser too old for `safe` drops the declaration outright and the row
 * falls back to `flex-start`. That is the correct degradation: left-aligned
 * rather than half-unreachable.
 */
const ALIGN: Record<RowAlignment, string> = {
  left: "flex-start",
  center: "safe center",
  right: "safe flex-end",
};

const FILL = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
} as const;

/**
 * The ring, as a paint value for the wrapper's background.
 *
 * `conic-gradient` rather than `linear-gradient`: the thing being painted is
 * an annulus, and a linear ramp across a ring leaves two flat arcs where the
 * gradient has already finished. A conic sweep travels the way the ring does.
 *
 * `none` returns `undefined` rather than `"transparent"`, so the wrapper is
 * left with no background at all and the padding below collapses to nothing —
 * a ring switched off should cost no layout, not draw an invisible one.
 */
function ringPaint(style: RingStyle, from: string, to: string): string | undefined {
  if (style === "none") return undefined;
  if (style === "solid") return from;
  return `conic-gradient(from 135deg, ${from}, ${to}, ${from})`;
}

interface StoryProps {
  media: SJEMedia;
  /** The circle's diameter in px, from the block's `circle_scale`. */
  size: number;
  /** The ring's thickness in px, or `0` when there is no ring. */
  ring: number;
  paint: string | undefined;
  /**
   * Held still while a full-screen player is up ANYWHERE on the page — not
   * only this block's. The circle is still on screen as far as the observer is
   * concerned, so without this every preview on the page would go on looping
   * — and decoding — behind the overlay, in competition with the one video
   * the shopper is actually watching. See `lib/playback.ts`.
   */
  frozen: boolean;
  /** Whether this circle plays its preview clip or stays a still. */
  mode: PreviewMode;
  /** Whether its media waits until the shopper can see it. */
  lazy: boolean;
  /** Whether the circle is captioned with its video's title. */
  title: boolean;
  onOpen: () => void;
}

function Story({ media, size, ring, paint, frozen, mode, lazy, title, onOpen }: StoryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [inView, setInView] = useState(false);
  // Whether the video element may exist yet. Under lazy loading the circle has
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
  // Not `media.previewUrl` — that is the ladder's head, the 1080p encode, and
  // a circle is the smallest thing this widget draws. `CIRCLE_RUNGS` asks for
  // 480p first; see the note there for what that costs and buys.
  const preview = previewUrlOf(media, CIRCLE_RUNGS);

  /**
   * Whether this circle has a clip to play AND is meant to play it.
   *
   * Everything below hangs off this rather than off `preview` alone, so a
   * merchant who chose stills gets no observer, no element, and — the point
   * of the setting — not one byte of video fetched.
   */
  const plays = mode === "video" && Boolean(preview);

  useEffect(() => {
    const el = rootRef.current;
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

    // A circle that is merely covered keeps its place, so closing the player
    // drops the shopper back where they were. Only one that actually left the
    // viewport is rewound.
    if (!inView) video.currentTime = 0;
  }, [inView, seen, frozen]);

  return (
    <div
      ref={rootRef}
      // A real button, not a div with a click handler: this is the one thing
      // a shopper can do here, and it should be reachable by keyboard and
      // announced as an action.
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
        flex: "0 0 auto",
        // The caption sits under the circle and is usually wider than it, so
        // the column is sized by the circle and the text is allowed to be
        // narrower — see the caption's own `width` below.
        width: size,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: sp(0.75),
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* ── The ring, and the photo inside it ──

          A painted circle with the photo inset by its own padding. That is
          all: one background, one padding, and there is no state in which it
          fails to draw.

          ⚠️ It WAS a masked annulus — `radial-gradient` in `mask-image`, so a
          transparent gap could sit between the ring and the photo the way
          Instagram's does. Do not reach for that again without reading this.
          A gap has to be SOME colour, and the only correct one is the page's,
          which a widget dropped into someone else's theme cannot know: a
          white halo round every circle on a dark theme reads as a rendering
          fault. Masking the middle out was the way to make the gap genuinely
          transparent — and it put the entire ring behind a feature with two
          prefixes, three browser eras of `calc()`-in-gradient-stop bugs, and
          a failure mode that hides the element completely rather than
          degrading. A ring nobody can see is worth less than a ring without a
          gap. */}
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "50%",
          // Undefined when the merchant chose no ring, which also collapses
          // the padding below — so the photo fills the whole diameter rather
          // than sitting in a hole the ring left behind.
          background: paint,
          padding: paint ? ring : 0,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            overflow: "hidden",
            background: "rgba(0,0,0,0.08)",
          }}
        >
          {poster && (
            <img
              src={poster}
              alt={media.title || ""}
              loading={lazy ? "lazy" : "eager"}
              style={FILL}
            />
          )}

          {plays && seen && (
            <video
              ref={videoRef}
              src={preview!}
              poster={poster}
              muted
              loop
              playsInline
              // ⚠️ `none` is what makes lazy loading actually lazy: the
              // element existing is not the same as the clip being fetched,
              // and without this a circle scrolled past would download its
              // video whether or not it ever played.
              //
              // `auto` when the merchant has turned lazy loading off — they
              // have asked for the clips to be there before they are needed,
              // and that is the only thing that delivers it. Browsers treat it
              // as a hint and a data-saver setting overrides it, so it is a
              // request rather than a promise.
              preload={lazy ? "none" : "auto"}
              // The circle is decoration around the poster; nothing here is a
              // control, so it stays out of the accessibility tree.
              aria-hidden="true"
              tabIndex={-1}
              style={FILL}
            />
          )}
        </div>
      </div>

      {title && media.title && (
        <div
          style={{
            // Allowed to be a little wider than the circle, because a name
            // cropped to a 72px circle is two syllables. Not much wider: the
            // row's gap is what stops two captions running together.
            width: `calc(100% + ${sp(GAP_STEPS * 0.5)})`,
            fontSize: fs(0.75),
            lineHeight: 1.3,
            // Semi-bold, not bold. At `fs(0.75)` — 10.5px on desktop, 9px on
            // a phone — a 700 weight starts closing its own counters, and it
            // is also a wider face, which costs characters on a label already
            // clamped to one line. 600 is enough to lift the caption off the
            // theme's body copy without asking for attention the circle above
            // it should be getting.
            //
            // Stated rather than inherited: the typeface is the merchant's
            // (see the `font-family: inherit` pass), but a theme's body weight
            // is whatever it happens to be, and this needs to read as a label.
            fontWeight: 600,
            textAlign: "center",
            // One line, then an ellipsis. A story caption is a label, and a
            // label that reflows changes the height of every circle beside it.
            display: "-webkit-box",
            WebkitLineClamp: TITLE_LINES,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {media.title}
        </div>
      )}
    </div>
  );
}

export function Stories({ widget, settings }: WidgetProps) {
  const media = widgetMedia(widget, settings.shuffle);

  // Fetched for the PLAYER, not for the row — the circles carry no badge (see
  // the header). One batch up front so the full-screen badge is drawn from
  // cache the instant a circle is tapped, rather than flashing a skeleton at
  // the one moment the shopper is looking straight at it. Duplicates across
  // videos cost nothing: the cache in `products.ts` is keyed by product id.
  const live = useLiveProducts(
    media.flatMap((item) => {
      const product = stickyProduct(item);
      return product ? [product] : [];
    }),
  );

  const scrollerRef = useRef<HTMLDivElement>(null);

  /**
   * The story unit as a NUMBER, kept current across the breakpoint. The circle
   * and its ring are percentages of it.
   *
   * ⚠️ NOT the spacing token, which every other size here uses. This one steps
   * UP on a phone rather than down — see `STORY_UNIT_VAR`. The gap between
   * circles and the caption below them still come off the standard scale,
   * which is what makes a phone show bigger circles packed a little tighter.
   *
   * Read directly rather than through `useRail`, which the carousel uses:
   * that hook also watches the row's ends so it can dim the arrows, and a
   * story bar has none. Taking it would mean a scroll listener and a
   * ResizeObserver per row, kept alive to answer a question nothing asks.
   */
  const unit = useTokenPx(scrollerRef, STORY_UNIT_VAR, BASE_STORY_UNIT);

  // Which circle is open full screen, or `null` for none. The index, not the
  // media: the player moves between neighbours, and an index is what says
  // where in the row it currently is.
  const [openAt, setOpenAt] = useState<number | null>(null);

  // A widget re-saved with fewer videos while the player is open would leave
  // the index pointing past the end. Treating that as closed is cheaper than
  // an effect, and correct on the very render that shrinks the list.
  const playerOpen = openAt !== null && openAt < media.length;

  // ── The two halves of the page-wide pause ──
  //
  // This block SAYS a player is open, and separately ASKS whether one is —
  // its own included, which is why the two are not the same expression. A
  // player opened from a story bar three sections up must stop these previews
  // too: they are all competing for the same decoders and the same battery as
  // the one video the shopper actually chose. See `lib/playback.ts`.
  useHold(playerOpen);
  const frozen = usePlaybackFrozen();

  if (media.length === 0) return null;

  const open = playerOpen ? openAt : null;

  // Both settings are percentages of the story unit, so the circle and its
  // ring are derived from a scale rather than being absolute px that ignore
  // one — 900% is 72px on desktop and 81px on a phone. The ring comes off the
  // same unit so it stays in proportion instead of thinning as the circle
  // grows.
  const size = Math.round((unit * settings.circleScale) / 100);
  const ring = Math.round((unit * settings.ringScale) / 100);
  const paint = ringPaint(settings.ringStyle, settings.ringFrom, settings.ringTo);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        ref={scrollerRef}
        // The class carries one thing only: the WebKit scrollbar rule, which
        // is a pseudo-element and so cannot be written inline. Everything the
        // layout depends on stays in `style`, where the theme cannot reach it.
        //
        // ⚠️ Hiding a scrollbar hides an affordance, and unlike the carousel
        // there are no arrows here to replace it — CLAUDE.md §2's note about
        // that applies. It is still the right call: a story bar that is too
        // long to fit leaves a circle CUT OFF at the edge, and a half-visible
        // circle is a better "there is more this way" than a scrollbar is.
        // `safe center` above is what guarantees that — a centred row that
        // overflows falls back to the start rather than hiding both ends.
        class="sje-scroller"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: ALIGN[settings.rowAlignment],
          gap: sp(GAP_STEPS),
          overflowX: "auto",
          overflowY: "hidden",
          // Firefox. WebKit's equivalent is in the stylesheet.
          scrollbarWidth: "none",
        }}
      >
        {media.map((item, i) => (
          <Story
            key={item.id}
            media={item}
            size={size}
            ring={paint ? ring : 0}
            paint={paint}
            frozen={frozen}
            mode={settings.previewMode}
            lazy={settings.lazyLoad}
            title={settings.showTitles}
            onOpen={() => setOpenAt(i)}
          />
        ))}
      </div>

      {open !== null && (
        <Lightbox
          items={media}
          index={open}
          live={live}
          products={settings.playerProducts}
          onIndex={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </div>
  );
}

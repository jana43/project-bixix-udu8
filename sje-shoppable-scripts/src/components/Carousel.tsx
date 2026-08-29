// src/components/Carousel.tsx
// A horizontal row of 9:16 cards the shopper scrolls through.
//
// A card plays its preview on loop while it is in the viewport, and stops the
// moment it leaves, with the sticker product's badge over it. Tapping one
// opens `Lightbox`, which plays the whole video full screen.
//
// The row still scrolls by drag, wheel and swipe — only its scrollbar is
// hidden. The arrows underneath are the visible way to move it, and where they
// sit (or whether they appear at all) is the merchant's to set on the block.
//
// Styling is inline for the same reason the Liquid skeletons are: this
// renders inside a merchant's theme, where a class name of ours may collide
// with theirs and their reset may undo ours. Inline wins both.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { widgetMedia, posterOf, previewUrlOf, type SJEMedia } from "../lib/sje";
import { observeInView } from "../lib/inView";
import { useElementWidth } from "../lib/useElementWidth";
import { useLiveProducts, type LiveProducts } from "../lib/products";
import { stickyProduct } from "../lib/sticker";
import { ChevronLeft, ChevronRight } from "../lib/icons";
import { sp, useTokenPx, SPACING_VAR, BASE_SPACING } from "../lib/tokens";
import { Lightbox } from "./Lightbox";
import { Sticker } from "./Sticker";
import type { ArrowPosition } from "../lib/settings";
import type { WidgetProps } from "../lib/mount";

/** Matches the Liquid skeleton, so nothing jumps when this takes over. */
const CARD_HEIGHT = "100%";

/**
 * The space between cards, in standard spacings. The row draws it as a CSS
 * length; `scrollByCard` needs the same distance as a NUMBER to move by
 * exactly one card, and gets it from the live token rather than a second
 * constant that could drift from this one.
 */
const GAP_STEPS = 1.5;

/**
 * How much of a card must be showing before it counts as watched. Half keeps
 * a card that is only peeking in from the edge of a horizontal scroller
 * quiet, which is both what it looks like it should do and cheaper.
 */
const VISIBLE_ENOUGH = 0.5;

/** What each arrow placement means to a flex row. `hidden` draws no row. */
const ARROW_ALIGN: Record<Exclude<ArrowPosition, "hidden">, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

const FILL = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
} as const;

interface CardProps {
  media: SJEMedia;
  /**
   * Held still while the full-screen player is up. The card is still on
   * screen as far as the observer is concerned, so without this every preview
   * in the row would go on looping — and decoding — behind the overlay, in
   * competition with the video the shopper is actually watching.
   */
  frozen: boolean;
  /** Live product data for the badge. See `useLiveProducts`. */
  live: LiveProducts;
  /** Whether this placement draws the badge on its cards at all. */
  sticker: boolean;
  onOpen: () => void;
}

function Card({ media, frozen, live, sticker, onOpen }: CardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // The badge's stored size is a percentage of the frame, and the frame is
  // this card — its width comes from a 9:16 ratio against the row's height, so
  // it is only known once laid out.
  const cardWidth = useElementWidth(cardRef);

  const [inView, setInView] = useState(false);
  // The video element is not rendered until the card has been seen once, so
  // an off-screen card downloads nothing. It then stays mounted, so scrolling
  // back to a card resumes from what is already buffered instead of
  // re-fetching.
  const [seen, setSeen] = useState(false);

  const poster = posterOf(media);
  // Not `media.previewUrl` — that is the ladder's head, which is the 1080p
  // encode. See `previewUrlOf`.
  const preview = previewUrlOf(media);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || !preview) return;

    return observeInView(el, VISIBLE_ENOUGH, (visible) => {
      setInView(visible);
      if (visible) setSeen(true);
    });
  }, [preview]);

  useEffect(() => {
    const video = videoRef.current;
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
    // viewport is rewound, so that coming back to it starts from the top
    // rather than resuming mid-sentence.
    if (!inView) video.currentTime = 0;
  }, [inView, seen, frozen]);

  return (
    <div
      ref={cardRef}
      // A real button, not a div with a click handler: this is the one thing
      // on the card a shopper can do, and it should be reachable by keyboard
      // and announced as an action. The theme's own button styling is undone
      // by the reset in `style` rather than fought with.
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
        height: CARD_HEIGHT,
        aspectRatio: "9 / 16",
        borderRadius: sp(1),
        overflow: "hidden",
        background: "rgba(0,0,0,0.08)",
        position: "relative",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {poster && <img src={poster} alt={media.title || ""} loading="lazy" style={FILL} />}

      {preview && seen && (
        <video
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

      {/* Over both the poster and the preview, on the same setting as full
          playback — the merchant chooses once, for the media, not per view. */}
      {/* The row only. The full-screen player draws its badge regardless —
          see `stickerOnPreview` in `lib/settings.ts` for why the two differ. */}
      {sticker && <Sticker media={media} frameWidth={cardWidth} live={live} />}
    </div>
  );
}

interface ArrowProps {
  direction: "prev" | "next";
  /**
   * Diameter in px, worked out from the block's setting against the live
   * spacing token — so the control shrinks at the breakpoint with everything
   * else. The icon scales with it.
   */
  size: number;
  /** At the end it can move towards, so there is nowhere left to go. */
  spent: boolean;
  onClick: () => void;
}

function Arrow({ direction, size, spent, onClick }: ArrowProps) {
  const isPrev = direction === "prev";

  return (
    <button
      type="button"
      onClick={onClick}
      // Left in the tree rather than removed, so the row does not reflow every
      // time the shopper reaches an end. `disabled` is what takes it out of
      // the tab order and stops it being announced as available.
      disabled={spent}
      aria-label={isPrev ? "Previous videos" : "Next videos"}
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        padding: 0,
        // `currentColor` on a transparent ground, so the arrows read against
        // whatever the theme's background happens to be — this widget has no
        // say in that, and a hardcoded black or white is wrong half the time.
        border: "1px solid currentColor",
        borderRadius: "50%",
        background: "transparent",
        color: "inherit",
        // ⚠️ `inherit`, and it has to be SAID. A `button` does not inherit
        // `font-family` — the UA stylesheet gives every form control a font of its
        // own — so leaving this out is not "inherit the theme's font", it is
        // "render in whatever the browser thinks a button should look like".
        // Deleting the declaration and inheriting are different things here.
        fontFamily: "inherit",
        cursor: spent ? "default" : "pointer",
        opacity: spent ? 0.3 : 1,
        transition: "opacity 150ms ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Half the button, so the glyph keeps its proportions as the merchant
          scales the control. */}
      {isPrev ? <ChevronLeft size={Math.round(size / 2)} /> : <ChevronRight size={Math.round(size / 2)} />}
    </button>
  );
}

export function Carousel({ widget, settings }: WidgetProps) {
  const media = widgetMedia(widget);

  // The badges' products, fetched once for the whole row.
  //
  // Gathered here rather than per card so the requests go out together and the
  // skeletons clear together — a row that filled in one badge at a time would
  // read as broken rather than as loading. `stickyProduct` picks the one
  // product each badge will actually show, so nothing is fetched for a tagged
  // product no badge draws. Duplicates across cards cost nothing: the cache in
  // `products.ts` is keyed by product id.
  const live = useLiveProducts(
    media.flatMap((item) => {
      const product = stickyProduct(item);
      return product ? [product] : [];
    }),
  );

  const scrollerRef = useRef<HTMLDivElement>(null);

  // The spacing token as a number, kept current across the breakpoint. Two
  // things need it that way: the arrows, whose diameter is a percentage of it,
  // and the scroll step below.
  const spacing = useTokenPx(scrollerRef, SPACING_VAR, BASE_SPACING);

  // Which card is open full screen, or `null` for none. The index, not the
  // media: the player moves between neighbours, and an index is what says
  // where in the row it currently is.
  const [openAt, setOpenAt] = useState<number | null>(null);

  // Whether each arrow has anywhere left to go. Kept in state rather than read
  // during render because scroll position is not something a render can see
  // changing.
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const readEnds = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const furthest = el.scrollWidth - el.clientWidth;
    // A pixel of slack: `scrollLeft` is fractional on zoomed and
    // high-density displays, and an exact comparison never quite lands, which
    // would leave an arrow lit at the end of the row with nothing to do.
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= furthest - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    readEnds();
    el.addEventListener("scroll", readEnds, { passive: true });

    // The row's own width decides whether there is anything to scroll at all,
    // and it changes without a scroll ever happening — the viewport resizes,
    // the theme editor re-renders the section around it.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(readEnds);
    observer?.observe(el);

    return () => {
      el.removeEventListener("scroll", readEnds);
      observer?.disconnect();
    };
  }, [readEnds, media.length]);

  const scrollByCard = useCallback((direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;

    // One card and the gap after it. Measured rather than assumed: the card's
    // width comes from a 9:16 ratio against the row's height, so it is only
    // known once laid out. The gap comes from the same token the row is drawn
    // with, so the step stays exact on both sides of the breakpoint. The
    // fallback is for an empty row, which cannot be scrolled anyway.
    const card = el.firstElementChild;
    const step = card
      ? card.getBoundingClientRect().width + spacing * GAP_STEPS
      : el.clientWidth;

    el.scrollBy({
      left: step * direction,
      // A shopper who asked not to be moved around should not be, even when
      // they were the one who pressed the button.
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [spacing]);

  if (media.length === 0) return null;

  // A widget re-saved with fewer videos while the player is open would leave
  // the index pointing past the end. Treating that as closed is cheaper than
  // an effect, and correct on the very render that shrinks the list.
  const open = openAt !== null && openAt < media.length ? openAt : null;

  const arrows = settings.arrowPosition;

  // The setting is a percentage of the standard spacing, so the arrows are one
  // more thing derived from the scale rather than an absolute px that ignores
  // it — 500% is 40px on desktop and 30px on a phone.
  const arrowSize = Math.round((spacing * settings.arrowScale) / 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        ref={scrollerRef}
        // The class carries one thing only: the WebKit scrollbar rule, which
        // is a pseudo-element and so cannot be written inline. Everything the
        // layout depends on stays in `style`, where the theme cannot reach it
        // — if the stylesheet fails to load, the row still works and only the
        // scrollbar comes back.
        class="sje-scroller"
        style={{
          flex: "1 1 auto",
          // A flex item defaults to `min-height: auto` and refuses to shrink
          // below its content, which would push the row past the group's
          // height and hide the arrows under it.
          minHeight: 0,
          display: "flex",
          alignItems: "stretch",
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
            frozen={open !== null}
            live={live}
            sticker={settings.stickerOnPreview}
            onOpen={() => setOpenAt(i)}
          />
        ))}
      </div>

      {arrows !== "hidden" && (
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            justifyContent: ARROW_ALIGN[arrows],
            gap: sp(1),
            paddingBlockStart: sp(1.5),
          }}
        >
          <Arrow
            direction="prev"
            size={arrowSize}
            spent={atStart}
            onClick={() => scrollByCard(-1)}
          />
          <Arrow
            direction="next"
            size={arrowSize}
            spent={atEnd}
            onClick={() => scrollByCard(1)}
          />
        </div>
      )}

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

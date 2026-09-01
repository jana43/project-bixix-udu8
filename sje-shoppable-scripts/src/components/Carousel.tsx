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
import { useEffect, useRef, useState } from "preact/hooks";
import { widgetMedia, posterOf, previewUrlOf, type SJEMedia } from "../lib/sje";
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
  /** The corner radius in spacing steps, from the block's `card_radius`. */
  radius: number;
  onOpen: () => void;
}

function Card({ media, frozen, live, sticker, radius, onOpen }: CardProps) {
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
        borderRadius: sp(radius),
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

export function Carousel({ widget, settings }: WidgetProps) {
  const media = widgetMedia(widget, settings.shuffle);

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

  const rail = useRail(GAP_STEPS, media.length);

  // Which card is open full screen, or `null` for none. The index, not the
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        ref={rail.ref}
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
            frozen={frozen}
            live={live}
            sticker={settings.stickerOnPreview}
            // A percentage of the spacing token, as every size setting here
            // is — `sp()` takes the multiplier, so 100% is one spacing.
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
          onIndex={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </div>
  );
}

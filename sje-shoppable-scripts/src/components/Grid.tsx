// src/components/Grid.tsx
// Every video at once, in rows that wrap.
//
// The same widget as the carousel, in a different shape. A card plays its
// preview on loop while it is in the viewport and stops the moment it leaves —
// or stays a still, if the block says so; see `preview_mode`. Tapping one
// opens `Lightbox` either way, which plays the whole video full screen with
// whatever the block's `player_products` says.
//
// ── What a grid changes ──
//
// Three things, and each of them falls out of the cards being laid out by a
// track rather than by a scrolling row:
//
//   1. There are no ARROWS and no scroller. A grid has nowhere to scroll to:
//      everything the block draws is already on the page, and what is not
//      drawn is behind the Show more button rather than off to one side.
//   2. A card takes its WIDTH from its column and its height from the 9:16
//      ratio — the opposite of the carousel, where the row states a height and
//      the ratio gives the width. That is why nothing here states a height,
//      and why the skeleton can use a bare `aspect-ratio` where the carousel's
//      could not (CLAUDE.md §6).
//   3. The number of columns is the MERCHANT'S, and it is the one thing in
//      this extension that cannot be derived from a token: "four across on a
//      desktop" says nothing about what a phone should do, and no spacing
//      value can be asked. So it arrives as `--sje-across-count`, which
//      `sje-widget.css` switches at the breakpoint — see `TRACKS` below.
//
// A grid also shows far more videos at once than a row does, which is why
// `preview_mode` and `lazy_load` matter more here than anywhere else: twenty
// clips autoplaying is twenty decoders, and a merchant with a long widget
// should be able to say so.
//
// Styling is inline for the same reason the Liquid skeletons are: this renders
// inside a merchant's theme, where a class name of ours may collide with
// theirs and their reset may undo ours. Inline wins both.
import { useEffect, useRef, useState } from "preact/hooks";
import { widgetMedia, posterOf, previewUrlOf, type SJEMedia } from "../lib/sje";
import { observeInView } from "../lib/inView";
import { useElementWidth } from "../lib/useElementWidth";
import { useHold, usePlaybackFrozen } from "../lib/playback";
import { useLiveProducts, type LiveProducts } from "../lib/products";
import { stickyProduct } from "../lib/sticker";
import { fs, sp } from "../lib/tokens";
import { Lightbox } from "./Lightbox";
import { Sticker } from "./Sticker";
import type { PreviewMode } from "../lib/settings";
import type { WidgetProps } from "../lib/mount";

/** The space between cards, in standard spacings. Matches the carousel's row. */
const GAP_STEPS = 1.5;

/**
 * How much of a card must be showing before it counts as watched.
 *
 * Half, as in the carousel — but the axis it matters on is the other one. A
 * grid scrolls VERTICALLY with the page, so this is what keeps the row of
 * cards half-off the bottom of the screen from playing before the shopper has
 * reached it.
 */
const VISIBLE_ENOUGH = 0.5;

/**
 * The grid's columns, as a `grid-template-columns` value.
 *
 * ⚠️ `--sje-across-count` is the third and last thing in this extension that
 * answers the breakpoint with a value of its own rather than by deriving from
 * a token, and it is on that list for a different reason from the other two. A
 * COUNT is not a length: it cannot be a multiple of the spacing token,
 * it cannot step down by 25% with everything else, and there is no arithmetic
 * that turns "four across on a desktop" into "two across on a phone" — that is
 * a judgement, and it is the merchant's. So the block writes both counts onto
 * the wrapper as `--sje-across-desktop` and `--sje-across-mobile`, and
 * `sje-widget.css` picks between them inside the ONE media query the extension
 * has. Nothing here knows what the breakpoint is, which is the rule that
 * matters (CLAUDE.md §3).
 *
 * The fallback is the merchant's desktop count rather than a constant, so a
 * stylesheet that never loads costs the mobile column count and nothing else.
 *
 * Shared with `ProductVideos`, which asks the same question in different words
 * — "cards visible before the row scrolls" rather than "columns". One
 * mechanism, deliberately, so the paragraph above has only one copy.
 *
 * `minmax(0, 1fr)` and not `1fr`: a `1fr` track has an automatic MINIMUM, so a
 * card whose content refuses to shrink — a long product title on a badge —
 * would widen its column and push the last one off the page.
 */
const TRACKS = (desktop: number): string =>
  `repeat(var(--sje-across-count, ${desktop}), minmax(0, 1fr))`;

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
  /** Whether this card plays its preview clip or stays a still. */
  mode: PreviewMode;
  /** Whether its media waits until the shopper can see it. */
  lazy: boolean;
  /** The corner radius in spacing steps, from the block's `card_radius`. */
  radius: number;
  onOpen: () => void;
}

function Card({ media, frozen, live, sticker, mode, lazy, radius, onOpen }: CardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // The badge's stored size is a percentage of the frame, and the frame is
  // this card — its width comes from the grid track, so it is only known once
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

  /**
   * Whether this card has a clip to play AND is meant to play it.
   *
   * Everything below hangs off this rather than off `preview` alone, so a
   * merchant who chose stills gets no observer, no element, and — the point of
   * the setting — not one byte of video fetched. That is worth more in a grid
   * than anywhere else: a row shows three or four clips at a time and a grid
   * can show twenty.
   */
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
        // ⚠️ No height, and no `flex` either. The card fills its column and
        // the ratio gives the height — the reverse of the carousel, where the
        // row states a height and the ratio gives the width. A `height: 100%`
        // copied across from there would resolve against a grid row that is
        // sized by this card, which is circular.
        width: "100%",
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
          // ⚠️ `none` is what makes lazy loading actually lazy: the element
          // existing is not the same as the clip being fetched, and without
          // this a card scrolled past would download its video whether or not
          // it ever played.
          //
          // `auto` when the merchant has turned lazy loading off — they have
          // asked for the clips to be there before they are needed, and that
          // is the only thing that delivers it. Browsers treat it as a hint
          // and a data-saver setting overrides it, so it is a request rather
          // than a promise.
          preload={lazy ? "none" : "auto"}
          // The card is decoration around the poster; nothing here is a
          // control, so it stays out of the accessibility tree.
          aria-hidden="true"
          tabIndex={-1}
          style={FILL}
        />
      )}

      {/* Over both the poster and the preview, on the same setting as full
          playback — the merchant chooses once, for the media, not per view. */}
      {/* This grid only. The full-screen player draws its badge regardless —
          see `stickerOnPreview` in `lib/settings.ts` for why the two differ. */}
      {sticker && <Sticker media={media} frameWidth={cardWidth} live={live} />}
    </div>
  );
}

export function Grid({ widget, settings }: WidgetProps) {
  const media = widgetMedia(widget, settings.shuffle);

  // The badges' products, fetched once for the whole grid.
  //
  // Gathered here rather than per card so the requests go out together and the
  // skeletons clear together — a grid that filled in one badge at a time would
  // read as broken rather than as loading. `stickyProduct` picks the one
  // product each badge will actually show, so nothing is fetched for a tagged
  // product no badge draws. Duplicates across cards cost nothing: the cache in
  // `products.ts` is keyed by product id.
  //
  // ⚠️ Every video's, not only the drawn ones'. What is behind Show more is
  // one tap away, and re-running this on expand would fire a second burst of
  // requests at the moment the shopper is watching the new rows appear.
  const live = useLiveProducts(
    media.flatMap((item) => {
      const product = stickyProduct(item);
      return product ? [product] : [];
    }),
  );

  // Whether the merchant's limit has been lifted. One-way, deliberately: a
  // Show less that collapsed the grid back would move everything under the
  // shopper's cursor, and they can already scroll past what they do not want.
  const [expanded, setExpanded] = useState(false);

  // Which card is open full screen, or `null` for none. The index, not the
  // media: the player moves between neighbours, and an index is what says
  // where in the grid it currently is.
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

  // What is drawn, against everything the widget holds. The player is handed
  // the FULL list either way: a shopper who opens the last visible card and
  // keeps pressing next should reach the rest of the widget, not run out at
  // the fold. That also means the arrows can leave `openAt` past the end of
  // what is drawn, which is harmless — the grid does not follow the player.
  const shown = expanded ? media.length : Math.min(settings.videosShown, media.length);
  const hidden = media.length - shown;

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: TRACKS(settings.columns),
          gap: sp(GAP_STEPS),
        }}
      >
        {media.slice(0, shown).map((item, i) => (
          <Card
            key={item.id}
            media={item}
            frozen={frozen}
            live={live}
            sticker={settings.stickerOnPreview}
            mode={settings.previewMode}
            lazy={settings.lazyLoad}
            // A percentage of the spacing token, as every size setting here
            // is — `sp()` takes the multiplier, so 100% is one spacing.
            radius={settings.cardRadius / 100}
            onOpen={() => setOpenAt(i)}
          />
        ))}
      </div>

      {hidden > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBlockStart: sp(2),
          }}
        >
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              padding: `${sp(1)} ${sp(2.5)}`,
              // `currentColor` on a transparent ground, so the button reads
              // against whatever the theme's background happens to be — this
              // widget has no say in that, and a hardcoded black or white is
              // wrong half the time. Same reasoning as `RailArrows`.
              border: "1px solid currentColor",
              borderRadius: sp(3),
              background: "transparent",
              color: "inherit",
              // ⚠️ `inherit`, and it has to be SAID. A `button` does not
              // inherit `font-family` — the UA stylesheet gives every form
              // control a font of its own — so leaving this out is not
              // "inherit the theme's font", it is "render in whatever the
              // browser thinks a button should look like". Deleting the
              // declaration and inheriting are different things.
              fontFamily: "inherit",
              fontSize: fs(1),
              lineHeight: 1.4,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* The count is the point: "Show more" alone gives the shopper no
                way to tell whether one video is left or thirty. */}
            Show {hidden} more
          </button>
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

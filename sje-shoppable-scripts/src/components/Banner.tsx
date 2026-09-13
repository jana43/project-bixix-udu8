// src/components/Banner.tsx
// One video across the section, with the merchant's own copy over it.
//
// ── What this component is NOT responsible for ──
//
// The heading, the subheading, the paragraph and the button. All four are
// drawn by `SJE_Banner.liquid`, as real markup, and this never sees them.
//
// That is deliberate and it is the most important thing on this page. A
// banner's heading is the loudest text in the section: it belongs in the HTML
// the crawler reads and the page paints, not in a string a lazily-fetched
// script injects a second later. Rendering it here would mean a banner whose
// words are invisible to search, absent from the first paint, and gone
// entirely if the bundle 404s — for no gain at all, since none of the four is
// interactive or derived from anything this component knows.
//
// So the split is: Liquid owns the words, this owns the moving picture behind
// them. The block stacks them; see the wrapper there.
//
// ── What it does own ──
//
// The video, the product badge over it, and the tap that opens the player.
//
//   1. THE FULL VIDEO, not the preview clip. Every other layout loops a
//      three-second `previewSources` clip because it is drawing a thumbnail;
//      a banner is the thing itself, and a hero that loops three seconds reads
//      as broken. `videoUrlOf` is the full-length counterpart of
//      `previewUrlOf` — same shape, different ladder, easy to mix up.
//   2. WHICH video, and whether it stays. See `rotates` below: shuffle off is
//      the merchant's first video, always; shuffle on plays through them.
//   3. The badge, placed on the far side of the copy and sized from the frame
//      the video would occupy rather than from the banner's box. See
//      `badgeSpot` and `badgeFrame` — both exist because a banner is the one
//      layout whose box is not the 9:16 frame the merchant positioned the
//      badge against.
//
// Styling is inline for the same reason the Liquid skeletons are: this renders
// inside a merchant's theme, where a class name of ours may collide with
// theirs and their reset may undo ours. Inline wins both.
import { useEffect, useRef, useState } from "preact/hooks";
import { widgetMedia, posterOf, videoUrlOf } from "../lib/sje";
import { useVideoImpression } from "../lib/analytics";
import { observeInView } from "../lib/inView";
import { useElementSize } from "../lib/useElementSize";
import { useHold, usePlaybackFrozen } from "../lib/playback";
import { useLiveProducts } from "../lib/products";
import { stickyProduct } from "../lib/sticker";
import { Lightbox } from "./Lightbox";
import { Sticker } from "./Sticker";
import type { BannerPosition } from "../lib/settings";
import type { WidgetProps } from "../lib/mount";

/**
 * How much of the banner must be on screen before it plays.
 *
 * Lower than the row layouts' half. A banner is often the tallest thing in the
 * viewport — on a short laptop screen a 60vh banner may never be 50% visible
 * while the shopper reads the copy on it, and a hero that refuses to play
 * because it is too big is the worst possible reading of "in view".
 */
const VISIBLE_ENOUGH = 0.15;

/**
 * Where the badge goes, read off where the COPY is.
 *
 * ⚠️ The media's own `stickerPosition` is deliberately NOT used on a banner,
 * and this is the only place in the extension that overrides it. Two reasons,
 * and both are about the banner being the odd shape out:
 *
 *   • The stored position is a percentage of a 9:16 VIDEO FRAME, measured in
 *     the app's editor. A banner is a wide box with the video cropped to fill
 *     it, so that frame is not on screen any more and 80%/82% of the banner is
 *     somewhere else entirely.
 *   • The editor knew nothing about the heading and button the merchant later
 *     typed into this block. A badge that lands on top of its own call to
 *     action is worse than one an inch from where it was placed.
 *
 * So it goes to the far side of the copy, on both axes. Two small tables
 * rather than one of nine rows: the rule is "the opposite end", and nine hand
 * written pairs would hide that behind numbers somebody would later have to
 * reverse-engineer.
 *
 * The centre columns are not centres. Copy that is horizontally centred can be
 * as wide as its measure allows, so there is no free side — only a free
 * corner; copy that is vertically centred leaves the bottom, which is where a
 * badge belongs anyway.
 */
const BADGE_X: Record<string, number> = { left: 82, center: 86, right: 18 };
const BADGE_Y: Record<string, number> = { top: 82, middle: 76, bottom: 18 };

/** The badge's spot for a copy position, or the default corner if unreadable. */
function badgeSpot(position: BannerPosition): { x: number; y: number } {
  const [vertical, horizontal] = position.split("-");
  return {
    x: BADGE_X[horizontal] ?? BADGE_X.center,
    y: BADGE_Y[vertical] ?? BADGE_Y.middle,
  };
}

/** A 9:16 frame's width, given its height. See `badgeFrame`. */
const FRAME_RATIO = 9 / 16;

const FILL = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
} as const;

export function Banner({ widget, settings }: WidgetProps) {
  const media = widgetMedia(widget, settings.shuffle);

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [inView, setInView] = useState(false);

  // Both numbers, unlike every other layout — see `badgeFrame`.
  const size = useElementSize(rootRef);

  /**
   * Whether the banner plays through the widget or stays on one video.
   *
   * Shuffle OFF is the merchant's arrangement, and the first of it is the
   * video they put first — so the banner shows that one, on every page and
   * every visit, looping. A hero that changed on its own when nobody asked it
   * to would be a slideshow the merchant never opted into.
   *
   * Shuffle ON is the merchant asking for variety, so they get it twice over:
   * `widgetMedia` draws a random order once per page load, and the banner then
   * advances through it as each video ENDS rather than looping one. That is
   * the setting doing what it says on a layout that shows one video at a time.
   *
   * ⚠️ The BLOCK's setting, from the theme customizer — not a field on the
   * widget, which is where it used to live.
   */
  const rotates = settings.shuffle && media.length > 1;

  const [at, setAt] = useState(0);

  // Fetched for the badge AND the player. One batch up front so neither
  // flashes a skeleton at the moment the shopper is looking straight at it,
  // and every video's, not just the current one's — with `rotates` on, the
  // next one is seconds away and re-running this per video would fire a
  // request burst mid-play.
  const live = useLiveProducts(
    media.flatMap((item) => {
      const product = stickyProduct(item);
      return product ? [product] : [];
    }),
  );

  const [openAt, setOpenAt] = useState<number | null>(null);
  const playerOpen = openAt !== null && openAt < media.length;

  // ── The two halves of the page-wide pause ──
  //
  // This block SAYS a player is open, and separately ASKS whether one is —
  // its own included, which is why the two are not the same expression. See
  // `lib/playback.ts`.
  useHold(playerOpen);
  const frozen = usePlaybackFrozen();

  // Modulo rather than a clamp: a widget re-saved with fewer videos while the
  // banner is mid-rotation would otherwise index past the end, and wrapping is
  // what rotation means anyway.
  const index = media.length > 0 ? at % media.length : 0;
  // Read before the effects so they can depend on it without a conditional
  // hook — the `return null` for an empty widget has to come after every hook.
  const chosen = media.length > 0 ? media[index] : undefined;

  const poster = chosen ? posterOf(chosen) : undefined;
  // ⚠️ `videoUrlOf`, not `previewUrlOf`. The whole video, not the clip.
  // `undefined` when the merchant chose a still, or when the media is an
  // image — either way there is no element and nothing is fetched.
  const source =
    chosen && settings.previewMode === "video" ? videoUrlOf(chosen) : undefined;

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !source) return;

    return observeInView(el, VISIBLE_ENOUGH, setInView);
  }, [source]);

  // A banner is one video filling a section, so the block being on screen IS
  // the impression — there are no cards to distinguish. `chosen`, not the
  // widget's first: with shuffle on the banner advances as each video ends, and
  // every one it rotates to has genuinely been shown.
  useVideoImpression(chosen?.id ?? "", inView && chosen !== undefined);

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

    // A banner covered by a player keeps its place, so closing drops the
    // shopper back where they were. Only one scrolled past is rewound.
    if (!inView) video.currentTime = 0;
  }, [inView, frozen, source]);

  if (!chosen) return null;

  const opens = settings.bannerOpensPlayer;

  /**
   * The width the badge's percentages are of.
   *
   * ⚠️ NOT the banner's width, and getting this wrong is spectacular rather
   * than subtle. `stickerSize` is a percentage of the frame — 28 by default —
   * so handing over a 1400px banner draws a 392px badge across a quarter of
   * the hero. What the merchant sized it against was a 9:16 video, so that is
   * what it is measured against here: the width such a video occupies at this
   * banner's height, which under `contain` is also its real width on screen.
   *
   * Capped at the banner's own width for the case where that frame would be
   * wider than the box — a tall, narrow banner on a phone.
   */
  const badgeFrame = Math.min(size.width, Math.round(size.height * FRAME_RATIO));

  return (
    <div class="sje-banner" ref={rootRef} style={{ position: "absolute", inset: 0 }}>
      <div
        class="sje-banner__frame"
        // A button ONLY when it does something. A `role="button"` that opens
        // nothing is a promise to a screen reader that the widget then breaks,
        // and a focus stop the keyboard user gains nothing by landing on.
        role={opens ? "button" : undefined}
        tabIndex={opens ? 0 : undefined}
        aria-label={
          opens ? (chosen.title ? `Play ${chosen.title}` : "Play video") : undefined
        }
        onClick={opens ? () => setOpenAt(index) : undefined}
        onKeyDown={
          opens
            ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                // Space scrolls the page otherwise.
                event.preventDefault();
                setOpenAt(index);
              }
            : undefined
        }
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          // Transparent, not a grey. Under `contain` the bars either side of
          // the video are this, and the block paints the merchant's
          // `banner_background` behind — a widget dropped into someone else's
          // theme cannot guess what colour belongs there.
          background: "transparent",
          cursor: opens ? "pointer" : undefined,
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {/* `alt=""`, deliberately. The banner's meaning is in the heading and
            the button beside it, which are real text in the block's markup —
            describing the decorative video as well would read the section
            twice. The poster follows the same `object-fit` as the video, so
            the first paint is not a different crop from the second. */}
        {poster && (
          <img class="sje-banner__poster" src={poster} alt="" style={{ ...FILL, objectFit: settings.bannerFit }} />
        )}

        {source && (
          <video
            class="sje-banner__video"
            // ⚠️ Keyed by media. Under `rotates` the `src` changes on the same
            // element otherwise, and an element whose `src` is swapped keeps
            // the old frame until it is told to `load()` — a visible stall
            // between videos. A new key is a new element, which starts clean.
            key={chosen.id}
            ref={videoRef}
            src={source}
            poster={poster}
            muted
            // One video, looping, unless the widget is shuffled — then each
            // one ends and hands over to the next. See `rotates`.
            loop={!rotates}
            onEnded={rotates ? () => setAt((n) => n + 1) : undefined}
            playsInline
            // `auto`, unlike the row layouts. There is exactly one clip on
            // screen, it is the largest thing in the section, and a banner
            // that fades in after the copy has settled is the one case where
            // waiting costs more than fetching. The bundle gate still applies:
            // a merchant who turned `lazy_load` on gets nothing at all until
            // the shopper moves.
            preload="auto"
            aria-hidden="true"
            tabIndex={-1}
            style={{ ...FILL, objectFit: settings.bannerFit }}
          />
        )}

        {/* Over the video and under the block's copy layer, which comes after
            this in the document. The badge is `pointer-events: none` — no
            `onOpen` is passed — so the tap that opens the player still works
            through it, exactly as on a carousel card. */}
        {settings.bannerSticker && (
          <Sticker
            media={chosen}
            frameWidth={badgeFrame}
            live={live}
            at={badgeSpot(settings.contentPosition)}
          />
        )}
      </div>

      {playerOpen && openAt !== null && (
        <Lightbox
          items={media}
          index={openAt}
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

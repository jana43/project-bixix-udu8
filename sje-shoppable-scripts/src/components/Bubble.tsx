// src/components/Bubble.tsx
// One video, pinned to a corner of the viewport for the whole page.
//
// The smallest of the layouts and the only one that is not part of the page:
// every other block draws a widget into the flow where the merchant put it,
// and this one floats over whatever the shopper is reading. Tapping it opens
// `Lightbox` on the whole widget, so the bubble is an entry point rather than
// the widget itself.
//
// ── What one bubble changes ──
//
//   1. It shows ONE video and it is always the same one — `media[0]` of the
//      widget's play order. See `chosen` below for what shuffle does to that.
//   2. It renders through `Portal`, into `<body>`. `position: fixed` is only
//      fixed to the VIEWPORT while no ancestor has a `transform`, `filter`,
//      `perspective`, `will-change` or `contain: paint` — any one of those
//      makes that ancestor the containing block instead, and themes put them
//      on section wrappers freely for scroll reveals and hover lifts. A bubble
//      left in the tree would pin itself to whichever section the merchant
//      happened to drop the block into. See `lib/portal.tsx`.
//   3. There is NO product badge, for the same reason the story circle has
//      none: at 96px across, the badge's price and count are unreadable, and
//      the badge's own corner is where the close button has to go. A bubble is
//      a thumbnail; the products belong to the video it opens.
//   4. There is no observer. A fixed element is on screen by definition, so
//      the only thing that stops the clip is a player opening somewhere on the
//      page — `usePlaybackFrozen` — or the shopper closing the bubble.
//
// Styling is inline for the same reason the Liquid skeletons are: this renders
// inside a merchant's theme, where a class name of ours may collide with
// theirs and their reset may undo ours. Inline wins both. The ONE exception is
// `show_on_mobile`, which is a media query and cannot be — see `MOBILE_CLASS`.
import { useEffect, useRef, useState } from "preact/hooks";
import { sje, widgetMedia, posterOf, previewUrlOf, CIRCLE_RUNGS } from "../lib/sje";
import { useHold, usePlaybackFrozen } from "../lib/playback";
import { useLiveProducts } from "../lib/products";
import { stickyProduct } from "../lib/sticker";
import { inDesignMode } from "../lib/shopify";
import { sp } from "../lib/tokens";
import { NBSP, NOT_EMPTY } from "../lib/notEmpty";
import { Play, X } from "../lib/icons";
import { Portal } from "../lib/portal";
import { Lightbox } from "./Lightbox";
import type { BubblePosition, BubbleShape } from "../lib/settings";
import type { WidgetProps } from "../lib/mount";

/**
 * Whether THIS bubble is the one the page draws.
 *
 * ⚠️ The bubble is an app block, so a merchant can add it to more than one
 * section of the same page — a header and a footer, say — and two of them
 * would stack in the same corner, each with its own close button and its own
 * clip decoding. It was an app embed for exactly one release, which cannot be
 * added twice; that was given up because an embed appears on every page of the
 * storefront, and choosing which pages get a bubble matters more.
 *
 * So the guarantee is bought back here: the first to mount claims the page and
 * every other one renders nothing.
 *
 * Claimed during RENDER rather than in an effect, so a second bubble never
 * paints a frame before disappearing. The claim is per component instance
 * (`useRef` decides once) and released on unmount, so the theme editor tearing
 * a section down hands the page back.
 *
 * ⚠️ One known edge, and it is the editor's alone: if the CLAIMING bubble is
 * removed while a second is still mounted, the second does not re-elect itself
 * — its ref was decided when it first rendered. The merchant sees no bubble
 * until the section re-renders, which in the editor it does on the next
 * settings change. Not worth a subscription to fix.
 */
function usePageBubble(): boolean {
  const owned = useRef<boolean | null>(null);

  if (owned.current === null) {
    const state = sje();
    owned.current = state.bubbleClaimed !== true;
    if (owned.current) state.bubbleClaimed = true;
  }

  useEffect(
    () => () => {
      if (owned.current) sje().bubbleClaimed = false;
    },
    [],
  );

  return owned.current;
}

/**
 * The class that lets a merchant hide the bubble on a phone.
 *
 * ⚠️ The one thing in this component that is not inline, and it cannot be:
 * "is this a phone" is the breakpoint, the breakpoint lives in
 * `sje-widget.css` and nowhere else (CLAUDE.md §3), and a `style` attribute
 * cannot carry a media query. `useMedia` is not the answer either — it says so
 * itself, in as many words.
 *
 * A stylesheet that never loads leaves the bubble showing on a phone the
 * merchant hid it from. That is the mildest failure available and the same
 * bargain the `--pad-*` widths already make.
 */
const MOBILE_CLASS = "sje-bubble--desktop-only";

/**
 * Where the bubble sits in the stacking order.
 *
 * Deliberately NOT a maximum. It has to clear a theme's sticky header, which
 * is usually in the tens and occasionally in the hundreds — the `z-index: 5`
 * this layout carried as a skeleton did not. It must NOT clear a cart drawer,
 * a cookie banner or an age gate: those are things a shopper has to act on
 * before they can do anything else, and a video bubble sitting over the accept
 * button is worse than no bubble.
 *
 * The full-screen player is unaffected either way — it is a `dialog` in the
 * browser's top layer, which is above every z-index there is.
 */
const LAYER = 9990;

/**
 * The close button's diameter, in spacing steps.
 *
 * `* 4` and not the `* 2.5` a corner badge wants to be, because of the note in
 * CLAUDE.md §3: the mobile token takes every one of these down by a quarter,
 * and 4 is the smallest multiplier that still clears the 24px pointer-target
 * minimum once it has (32px on desktop, 24px on a phone). A dismiss control
 * that is hard to hit on the device where the bubble is most in the way is the
 * one place not to save a few pixels.
 */
const CLOSE_STEPS = 4;

/**
 * How far the close button hangs outside the bubble's box.
 *
 * ⚠️ NEGATIVE INSIDE the `calc()`, via `sp(-1)`, and not a minus sign written
 * in front of `sp(1)`. `-calc(…)` is not valid CSS — a leading minus is only
 * allowed on a plain number or length — so the browser drops the whole
 * declaration without a word. That is not a slightly-off button: with both
 * insets dropped, the absolutely positioned button falls back to its STATIC
 * position, which is under the bubble and off the bottom of the screen for the
 * two bottom corners. The close button simply was not there.
 *
 * `sp()` interpolates the multiplier straight into the `calc()`, so a negative
 * multiplier is all this needs.
 */
const CLOSE_OVERHANG = sp(-1);

/**
 * Where the bubble is dismissed for, when it is.
 *
 * `sessionStorage`, so it lasts the browse and not the shopper's life. A
 * shopper who has closed it once should not be asked again on the next page;
 * they should be asked again on their next visit, when the merchant may well
 * have put a different video in it.
 *
 * Keyed by widget, so two bubbles on one storefront are dismissed separately.
 */
const dismissKey = (widgetId: string): string => `sje-bubble-dismissed-${widgetId}`;

/**
 * Both halves guarded, and both of them can genuinely throw rather than merely
 * return null: Safari's private mode used to throw on `setItem`, and a browser
 * set to block all site data throws on the `sessionStorage` GETTER itself, so
 * the whole expression sits inside the `try`.
 *
 * A bubble that cannot remember a dismissal is a bubble that comes back on the
 * next page, which is a far better outcome than one that fails to draw.
 */
function wasDismissed(widgetId: string): boolean {
  // Never in the theme editor. A merchant clicking the close button there is
  // looking at the thing they are configuring, not asking never to see it
  // again — and a dismissal remembered in the editor survives every settings
  // change and every re-render, so their bubble would simply never come back.
  if (inDesignMode()) return false;

  try {
    return sessionStorage.getItem(dismissKey(widgetId)) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal(widgetId: string): void {
  if (inDesignMode()) return;

  try {
    sessionStorage.setItem(dismissKey(widgetId), "1");
  } catch {
    // Nothing to do and nothing worth saying: the bubble is already closed for
    // this page, and it coming back on the next one is the documented
    // fallback rather than a failure.
  }
}

/**
 * The two viewport edges a corner is pinned to, as inline `style` keys.
 *
 * Logical properties (`inset-inline-*`), so a right-hand bubble moves to the
 * left on an RTL storefront — which is what "the corner out of the way of the
 * text" means there. The setting is still named for what a merchant sees in
 * the editor's own reading direction.
 */
const CORNERS: Record<BubblePosition, { block: "top" | "bottom"; inline: "start" | "end" }> = {
  "top-left": { block: "top", inline: "start" },
  "top-right": { block: "top", inline: "end" },
  "bottom-left": { block: "bottom", inline: "start" },
  "bottom-right": { block: "bottom", inline: "end" },
};

/**
 * The safe-area edge that matters for a given corner.
 *
 * ⚠️ A bubble in a bottom corner of a phone lands on the home indicator, and
 * one in a top corner lands under the notch, and the merchant's offset knows
 * about neither — so the larger of the two wins. `env()` resolves to `0px` on
 * every device without one, which makes this free everywhere else.
 */
const inset = (offset: string, edge: string): string =>
  `max(${offset}, env(safe-area-inset-${edge}, 0px))`;

const FILL = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
} as const;

interface FloaterProps {
  shape: BubbleShape;
  position: BubblePosition;
  /**
   * The bubble's box, as CSS LENGTHS rather than pixels.
   *
   * Both are `calc()` against the spacing token, so the bubble steps down at
   * the breakpoint with the rest of the widget without this component ever
   * being told what the breakpoint is (CLAUDE.md §3/§4). Nothing here needs
   * the number: the box is drawn, not measured.
   */
  width: string;
  height: string;
  /** The play glyph's size, when there is one. Also a token multiple. */
  glyph: string;
  /** How far from the two pinned edges, as a CSS length. */
  offset: string;
  /** The corner radius in spacing steps, from the block's `card_radius`. */
  radius: number;
  poster: string | undefined;
  /** The clip to loop, or `undefined` when the merchant chose a still. */
  preview: string | undefined;
  frozen: boolean;
  /** Whether the bubble is drawn on a phone. See `MOBILE_CLASS`. */
  onMobile: boolean;
  label: string;
  onOpen: () => void;
  /** `undefined` when the merchant turned the close button off. */
  onDismiss: (() => void) | undefined;
}

function Floater({
  shape,
  position,
  width,
  height,
  glyph,
  offset,
  radius,
  poster,
  preview,
  frozen,
  onMobile,
  label,
  onOpen,
  onDismiss,
}: FloaterProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const corner = CORNERS[position];

  // A circle is its own height; a rectangle is the 9:16 frame every other
  // layout draws, which at bubble scale is roughly twice as tall as it is
  // wide. Both arrive already worked out, and both are stated outright rather
  // than left to `aspect-ratio`, because the close button below is positioned
  // against this box and needs it to be definite.
  const round = shape === "circle";

  useEffect(() => {
    const video = videoRef.current;
    // Null when the merchant chose a still — there is no element to drive.
    if (!video) return;

    // As a property, not only as the `muted` attribute below: some browsers
    // read that attribute at parse time only, and this element is created by
    // script — without this, autoplay is refused as "not muted".
    video.muted = true;

    if (!frozen) {
      // Rejects when the browser refuses autoplay anyway. A still poster is a
      // fine outcome, so the rejection is deliberately swallowed.
      void video.play().catch(() => {});
      return;
    }

    // Held, not rewound. The bubble is on screen the whole time, so a player
    // closing should drop the clip back where the shopper last saw it rather
    // than snapping it to the first frame.
    video.pause();
  }, [frozen, preview]);

  return (
    <div
      // ⚠️ The one class, and it carries one rule: hide on a phone. See
      // `MOBILE_CLASS` for why this cannot be inline like everything else.
      class={onMobile ? undefined : MOBILE_CLASS}
      style={{
        position: "fixed",
        [corner.block]: inset(offset, corner.block),
        [corner.inline === "start" ? "insetInlineStart" : "insetInlineEnd"]: inset(
          offset,
          // `left` and `right` rather than the logical names, because that is
          // what `env()` is defined for — the safe area is a property of the
          // DEVICE, which has no reading direction. Both are offered to the
          // `max()`, so the correct one wins whichever way the page runs.
          corner.inline === "start" ? "left" : "right",
        ),
        zIndex: LAYER,
        width,
        height,
      }}
    >
      <div
        // A real button, not a div with a click handler: this is the one thing
        // a shopper can do here, and it should be reachable by keyboard and
        // announced as an action.
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          // Space scrolls the page otherwise, which is the opposite of opening.
          event.preventDefault();
          onOpen();
        }}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: round ? "50%" : sp(radius),
          overflow: "hidden",
          background: "rgba(0,0,0,0.08)",
          // The bubble sits over the merchant's own content rather than in a
          // row of its own, so it needs an edge of its own to read against —
          // the same problem, and the same answer, as an `overlay` arrow.
          boxShadow: "0 2px 12px rgba(0, 0, 0, 0.28)",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {poster && <img src={poster} alt="" style={FILL} />}

        {preview && (
          <video
            ref={videoRef}
            src={preview}
            poster={poster}
            muted
            loop
            playsInline
            // `auto`, unlike every other layout. The others say `none` because
            // a row can hold twenty clips and most of them will never be
            // watched; there is exactly one here, it is on screen from the
            // moment it exists, and it is the only thing the block draws.
            preload="auto"
            // The bubble is decoration around the poster; nothing here is a
            // control, so it stays out of the accessibility tree.
            aria-hidden="true"
            tabIndex={-1}
            style={FILL}
          />
        )}

        {/* Only when there is no clip playing. A moving picture says "video"
            by itself; a still needs telling. */}
        {!preview && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "#fff",
              // Enough to keep a white glyph legible over a pale poster,
              // without turning the thumbnail grey.
              background: "rgba(0, 0, 0, 0.18)",
              pointerEvents: "none",
            }}
          >
            <Play size={glyph} filled />
          </div>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={(event) => {
            // The bubble underneath is a click target too, and closing must
            // not also open the player on the way out.
            event.stopPropagation();
            onDismiss();
          }}
          aria-label="Close video"
          style={{
            position: "absolute",
            // ⚠️ The corner DIAGONALLY OPPOSITE the one the bubble is pinned
            // to, so the button always hangs towards the middle of the page.
            // Put it at a fixed corner instead and a top-right bubble wears
            // its close button off the top-right of the screen.
            [corner.block === "top" ? "bottom" : "top"]: CLOSE_OVERHANG,
            [corner.inline === "start" ? "insetInlineEnd" : "insetInlineStart"]:
              CLOSE_OVERHANG,
            display: "grid",
            placeItems: "center",
            width: sp(CLOSE_STEPS),
            height: sp(CLOSE_STEPS),
            padding: 0,
            border: "none",
            borderRadius: "50%",
            // Its own dark disc with a light glyph, not `currentColor`. This
            // sits half on the video and half on the merchant's page, and
            // `currentColor` there resolves to the THEME's text colour, which
            // has no relationship to either. Same reasoning as `ArrowTone`.
            background: "rgba(0, 0, 0, 0.62)",
            color: "#fff",
            boxShadow: "0 1px 4px rgba(0, 0, 0, 0.3)",
            // ⚠️ `inherit`, and it has to be SAID. A `button` does not inherit
            // `font-family` — the UA stylesheet gives every form control a
            // font of its own — so leaving this out is not "inherit the
            // theme's font", it is "render in whatever the browser thinks a
            // button should look like".
            fontFamily: "inherit",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <X size={sp(CLOSE_STEPS / 2)} />
        </button>
      )}
    </div>
  );
}

export function Bubble({ widget, settings }: WidgetProps) {
  const media = widgetMedia(widget, settings.shuffle);

  // Before anything else, but after nothing that could return early: a hook
  // cannot be conditional, and this one has to run on every bubble on the page
  // for the claim to mean anything.
  const owned = usePageBubble();

  // Fetched for the PLAYER, not for the bubble — the bubble carries no badge
  // (see the header). One batch up front so the full-screen badge is drawn
  // from cache the instant it is tapped, rather than flashing a skeleton at
  // the one moment the shopper is looking straight at it.
  const live = useLiveProducts(
    media.flatMap((item) => {
      const product = stickyProduct(item);
      return product ? [product] : [];
    }),
  );

  // Read once, synchronously, rather than in an effect: a bubble that appears
  // and then vanishes a frame later is worse than one that never appeared.
  const [dismissed, setDismissed] = useState(() => wasDismissed(widget.id));

  // Which video is open full screen, or `null` for none. An index, because the
  // player moves between neighbours — the bubble shows one video but opens the
  // whole widget.
  const [openAt, setOpenAt] = useState<number | null>(null);

  // A widget re-saved with fewer videos while the player is open would leave
  // the index pointing past the end. Treating that as closed is cheaper than
  // an effect, and correct on the very render that shrinks the list.
  const playerOpen = openAt !== null && openAt < media.length;

  // ── The two halves of the page-wide pause ──
  //
  // This block SAYS a player is open, and separately ASKS whether one is —
  // its own included, which is why the two are not the same expression. A
  // player opened from a carousel three sections down must stop this clip too:
  // they are all competing for the same decoders and the same battery as the
  // one video the shopper actually chose. See `lib/playback.ts`.
  useHold(playerOpen);
  const frozen = usePlaybackFrozen();

  // A second bubble on the same page draws nothing at all — not even the
  // portal, which would otherwise leave an empty host div in the body.
  if (media.length === 0 || !owned) return null;

  const open = playerOpen ? openAt : null;

  /**
   * The one video the bubble shows.
   *
   * ⚠️ `widgetMedia` has already answered the only question here, from the
   * BLOCK's `shuffle` setting — the theme customizer's, not a field on the
   * widget, which is where it used to live. With shuffle
   * OFF it hands back the merchant's stored arrangement untouched, so `[0]` is
   * the first video of the widget and stays the first video on every page of
   * the storefront and every visit — which is what a merchant who arranged
   * their widget by hand expects the bubble to show. With shuffle ON it is a
   * random one, drawn once per page load and memoised, so the bubble does not
   * change video under the shopper as the component re-renders.
   *
   * There is deliberately no cycling. A bubble that changed its clip every few
   * seconds would be an advertisement rather than a way in, and the shopper
   * reaches the rest of the widget by tapping it.
   */
  const chosen = media[0];

  const poster = posterOf(chosen);
  // `CIRCLE_RUNGS` — 480p first. A bubble is the same size as a story circle
  // and smaller than any card, so the smaller rung is the right trade for the
  // same reasons; see the note beside it in `sje.ts`.
  //
  // `undefined` when the merchant chose a still, which is what stops the
  // element being created and any video being fetched at all.
  const preview =
    settings.previewMode === "video" ? previewUrlOf(chosen, CIRCLE_RUNGS) : undefined;

  /** The merchant's width, in spacing steps — 1200 means twelve. */
  const steps = settings.bubbleScale / 100;

  return (
    // ⚠️ Rendered into `<body>`, not here. A `position: fixed` bubble left in
    // the block's own tree is fixed to the nearest ancestor with a
    // `transform`, `filter` or `contain` rather than to the viewport, and
    // themes put those on section wrappers freely. See `lib/portal.tsx`.
    <Portal>
      {!dismissed && (
        <Floater
          shape={settings.bubbleShape}
          position={settings.bubblePosition}
          // Every one of these is a hundredth of the spacing token, as every
          // size setting here is — 1200 is twelve spacings, so 96px on desktop
          // and 72px on a phone — and every one stays a CSS `calc()` rather
          // than being resolved to a number, so the bubble steps down at the
          // breakpoint on its own.
          width={sp(steps)}
          height={settings.bubbleShape === "circle" ? sp(steps) : sp((steps * 16) / 9)}
          glyph={sp(steps / 3)}
          offset={sp(settings.bubbleOffset / 100)}
          radius={settings.cardRadius / 100}
          poster={poster}
          preview={preview}
          frozen={frozen}
          onMobile={settings.showOnMobile}
          label={chosen.title ? `Play ${chosen.title}` : "Play video"}
          onOpen={() => setOpenAt(0)}
          onDismiss={
            settings.bubbleDismissible
              ? () => {
                  setDismissed(true);
                  rememberDismissal(widget.id);
                }
              : undefined
          }
        />
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

      {/* ⚠️ Load-bearing, and easy to mistake for a stray character. Themes
          commonly ship `div:empty { display: none }`, and with the bubble
          dismissed and no player open the portal's host div holds nothing at
          all. See `lib/notEmpty.ts` — this is the third time that rule has
          cost this extension a bug. */}
      <span style={NOT_EMPTY} aria-hidden="true">
        {NBSP}
      </span>
    </Portal>
  );
}

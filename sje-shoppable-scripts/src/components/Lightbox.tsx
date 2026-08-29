// src/components/Lightbox.tsx
// The full-screen player a card opens into.
//
// This plays the whole video, not the preview: a card loops `previewUrl`, the
// three-second clip the app generates, and opening one here switches to
// `media.url` — the file the merchant actually uploaded.
//
// The shape is the reels viewer everyone already knows: the video on a dimmed
// page, tap to pause, a hairline of progress along the bottom, the neighbours
// an arrow away. It renders through `Portal`, so it is out of the card's
// `overflow:hidden` and out of the theme's stacking contexts before any of
// these styles are asked to do anything.
//
// Inline styles for the same reason as the rest of the widget: this is a
// stranger inside a merchant's theme, and a class name of ours may collide
// with theirs.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { posterOf, type SJEMedia } from "../lib/sje";
import { Portal } from "../lib/portal";
import { useElementWidth } from "../lib/useElementWidth";
import { ChevronLeft, ChevronRight, ChevronUp, Play, Volume2, VolumeX, X } from "../lib/icons";
import { BASE_SPACING, fs, sp, SPACING_VAR, useTokenPx } from "../lib/tokens";
import { Sticker } from "./Sticker";
import { ProductRail } from "./ProductRail";
import { ProductSheet, type SheetState } from "./ProductSheet";
import type { LiveProducts } from "../lib/products";
import type { PlayerProducts } from "../lib/settings";

/**
 * The fallback, and only the fallback.
 *
 * `2147483647` is the largest value a 32-bit z-index holds, and it is still
 * not enough: a theme's sticky header that also writes a huge number and sits
 * later in the document wins the tie, which is exactly what it was seen doing
 * — nav crisp and white while the rest of the page dimmed behind the scrim.
 * There is no number that reliably wins an argument someone else can also
 * join.
 *
 * So the overlay does not argue. It is a `<dialog>` opened with `showModal()`,
 * which promotes it to the browser's TOP LAYER: painted above the whole
 * document, z-index and stacking contexts included, with the viewport as its
 * containing block. Nothing in the page can rank above it, because the top
 * layer is not part of the page's stacking order at all.
 *
 * This constant is what holds the overlay up on a browser too old for
 * `showModal` — where the `<dialog>` is an ordinary block and the old rules,
 * with their old caveats, apply again.
 */
const TOP_LAYER = 2147483647;

/** Enough of a dim that the page reads as "behind", without being pitch black. */
const SCRIM = "rgba(0,0,0,0.92)";

/**
 * The breathing room around the stage, as a CSS length off the spacing token.
 *
 * This overlay renders into `<body>` (see `lib/portal.tsx`), outside the
 * widget wrapper entirely — which is exactly why the tokens are declared on
 * `:root` in `sje-widget.css` and not on `.sje-widget`. Nothing here would
 * inherit them otherwise.
 */
const GUTTER = sp(2);

/** Twice the gutter, for the stage's `100vw` sum. */
const GUTTER_X2 = sp(4);

/** Half a control, for the `marginTop` that centres one on an edge. */
const CONTROL_STEPS = 5;

/**
 * How far a finger must travel before it is a swipe and not a shaky tap, in
 * spacing steps — `* 6`, so 48px on desktop and 36px on a phone.
 *
 * Below this the gesture is left alone and the tap-to-pause it almost
 * certainly was goes through.
 */
const SWIPE_STEPS = 6;

/**
 * How far a finger must move before the frame starts following it — `* 1`, so
 * 8px on desktop and 6px on a phone.
 *
 * Small, because this is only the question "is this a drag or a tap". The
 * bigger question — "is this drag enough to change the video" — is settled on
 * release by `commits()`.
 */
const GRAB_STEPS = 1;

/**
 * How far the frame must be dragged to commit, as a fraction of the stage.
 *
 * A fraction and not a token: this is the shopper saying "far enough that I
 * clearly mean it", and how far that is depends on how tall the frame is, not
 * on the type scale. `SWIPE_STEPS` is the floor under it for a very short
 * stage.
 */
const COMMIT_FRACTION = 0.18;

/**
 * A flick, in px per ms.
 *
 * Distance alone is not enough to feel right. A quick 40px flick is
 * unmistakably "next" and would sit under any sensible distance threshold,
 * and waiting for the shopper to drag a fifth of the screen every time is
 * exactly what makes a homemade carousel feel homemade.
 */
const FLICK_SPEED = 0.5;

/**
 * How long the frame takes to settle after release, in ms.
 *
 * Unlike the sheet's and the toast's, this duration is NOT paired with the
 * stylesheet — the transition is inline, because it is a transition and not a
 * keyframe, so this constant is the only place it is written. The easing is
 * decelerating: fast off the release, slowing into place.
 */
const GLIDE_MS = 260;
const GLIDE_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/** Resistance at the two ends of the reel, where there is nothing to drag to. */
const RUBBER = 3;

/** A settle in flight: where the track is going, and what it means. */
interface Glide {
  /** The track's target offset in px. */
  to: number;
  /**
   * What happens on arrival. `-1` and `1` move the reel, `0` is a snap back,
   * and `"close"` dismisses the player — the shopper has swiped past the last
   * video, and past the last video there is nothing to go to but out.
   */
  step: -1 | 0 | 1 | "close";
}

/**
 * How long the swipe hint stays up, in ms.
 *
 * ⚠️ Paired with the `.sje-hint` animation in `sje-widget.css`, which fades it
 * in and back out across exactly this span. The JS timer is what unmounts it
 * at the end. Same arrangement as the product sheet's toast.
 */
const HINT_MS = 2000;

/**
 * How long a video must be stalled before the spinner appears, in ms.
 *
 * ⚠️ Not zero, and the delay is the whole design. `waiting` fires for every
 * momentary hiccup — a keyframe arriving late, a buffer dipping for two
 * frames — many times a minute on an ordinary connection, and a spinner
 * wired straight to it strobes over video that is playing perfectly well.
 * A quarter of a second is longer than any hiccup a shopper would have
 * noticed and shorter than one they would call a freeze.
 */
const SPINNER_DELAY_MS = 250;

/**
 * Whether the shopper has swiped yet, for the life of the page.
 *
 * Module scope on purpose. The hint answers one question — "is there anything
 * past this video?" — and a shopper who has swiped has answered it themselves.
 * Showing it again on the next video would be the player explaining a control
 * they are already using, which is the point at which a hint becomes noise.
 */
let swipedBefore = false;

interface NeighbourProps {
  media: SJEMedia;
  /** `-1` for the frame above, `1` for the frame below. */
  slot: -1 | 1;
  frameWidth: number;
  live: LiveProducts;
  products: PlayerProducts;
}

/**
 * The video before or after this one, as it appears mid-swipe.
 *
 * ── A poster, not a video ──
 *
 * What the shopper sees of a neighbour during a 260ms slide is one still
 * frame. `<video>` gives them that at the cost of a second decoder, a second
 * network stream and a second element to keep paused — on a phone, on a
 * gesture that may be a snap-back. The poster is the same picture.
 *
 * There is no pop when it commits, either: the real `<video>` carries the SAME
 * poster and shows it until it can play, so the still simply becomes the still
 * of a video that then starts.
 *
 * ── What rides along, and what does not ──
 *
 * The badge does, because it is free: `live` already holds every tagged
 * product on the widget, fetched in one batch for the row behind, so drawing
 * the neighbour's badge costs no request. The free-scroll RAIL does not — it
 * fetches every product of its own media, and pulling two neighbours' worth on
 * every drag would be a burst of requests for a video the shopper may not
 * even arrive at.
 */
function Neighbour({ media, slot, frameWidth, live, products }: NeighbourProps) {
  const poster = posterOf(media);

  return (
    <div
      // Stacked exactly one stage away, so the track's own offset is the only
      // thing that decides what is on screen.
      style={{
        position: "absolute",
        inset: 0,
        transform: `translateY(${slot * 100}%)`,
        background: "#000",
      }}
      // It is scenery for the length of a gesture. A screen reader announcing
      // the next video's title while the shopper is still on this one would be
      // reading out the future.
      aria-hidden="true"
    >
      {poster && (
        <img
          src={poster}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      )}

      {products === "sticker" && (
        <Sticker media={media} frameWidth={frameWidth} live={live} />
      )}

      {media.title && products !== "free-scroll" && (
        <div
          style={{
            position: "absolute",
            insetInline: 0,
            bottom: 0,
            padding: `${sp(6)} ${sp(2)} ${sp(2)}`,
            background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)",
            fontSize: fs(1),
            fontWeight: 600,
          }}
        >
          {media.title}
        </div>
      )}
    </div>
  );
}

/**
 * A media query, as a boolean that keeps itself current.
 *
 * ⚠️ Never `(max-width: 749px)`. The breakpoint lives in `sje-widget.css` and
 * nowhere else, and `useTokenPx` is how this side asks about it — CLAUDE.md
 * §3. This hook is for the questions a token cannot answer.
 *
 * Read synchronously on the first render rather than in an effect, because the
 * swipe hint has to decide whether to appear before anything is painted.
 */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== "function") return;

    const list = matchMedia(query);
    const read = () => setMatches(list.matches);
    read();

    // Safari did not have `addEventListener` on a MediaQueryList until 14.
    if (list.addEventListener) {
      list.addEventListener("change", read);
      return () => list.removeEventListener("change", read);
    }

    list.addListener(read);
    return () => list.removeListener(read);
  }, [query]);

  return matches;
}

/**
 * Whether this is a touch device — NOT whether the viewport is narrow.
 *
 * `(pointer: coarse)` and not the spacing token, deliberately. The two
 * questions are different: the breakpoint asks how much ROOM there is, and
 * this asks what the shopper is pointing WITH. A desktop browser dragged
 * narrow is below the breakpoint and still has a mouse, and taking its only
 * on-screen way between videos away would leave nothing but the arrow keys.
 */
const COARSE = "(pointer: coarse)";

/**
 * The frame following a finger is DIRECT MANIPULATION, not decoration, and it
 * is left alone here — a drag that does not track the thumb is broken, not
 * calm. What this switches off is the part the shopper did not ask for: the
 * settle after release, which becomes an instant cut.
 */
const STILL = "(prefers-reduced-motion: reduce)";

// Five standard spacings: 40px on desktop, 30px on a phone. Still past the
// 24px minimum a pointer target has to clear, but it is the tightest thing on
// the scale — if the mobile spacing token is ever taken below 6px, raise this
// multiplier rather than letting the tap target follow it down.
const BUTTON = {
  display: "grid",
  placeItems: "center",
  width: sp(CONTROL_STEPS),
  height: sp(CONTROL_STEPS),
  padding: 0,
  border: "none",
  borderRadius: "50%",
  background: "rgba(0,0,0,0.45)",
  color: "#fff",
  cursor: "pointer",
  // ⚠️ `inherit`, and it has to be SAID. A `button` does not inherit
  // `font-family` — the UA stylesheet gives every form control a font of its
  // own — so leaving this out is not "inherit the theme's font", it is
  // "render in whatever the browser thinks a button should look like".
  // Deleting the declaration and inheriting are different things here.
  fontFamily: "inherit",
  // Themes like a global `button { transition: … }`; this keeps ours still.
  transition: "none",
  WebkitTapHighlightColor: "transparent",
} as const;

interface LightboxProps {
  /** Everything the carousel holds, so the viewer can move between them. */
  items: SJEMedia[];
  /** Which one is open. */
  index: number;
  /**
   * Passed down from the carousel rather than fetched again: the same batch
   * already ran for the row behind, so the badge here is drawn from cache with
   * no second request and no flash of skeleton.
   */
  live: LiveProducts;
  /** How this placement shows the video's products. See `PlayerProducts`. */
  products: PlayerProducts;
  onIndex: (next: number) => void;
  onClose: () => void;
}

export function Lightbox({ items, index, live, products, onIndex, onClose }: LightboxProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * The stage, measured — the badge's stored size is a percentage of the frame
   * and has to become pixels somewhere.
   *
   * The stage is the 9:16 box, not the video's own letterboxed rectangle
   * inside it. That matches the app's editor, whose preview is a 9:16 box too,
   * so a badge lands where the merchant placed it. A video that is not 9:16
   * is the exception, and there the badge follows the box.
   */
  const stageRef = useRef<HTMLDivElement>(null);
  const stageWidth = useElementWidth(stageRef);

  /**
   * Opens the dialog the instant Preact hands the element over.
   *
   * A ref callback rather than an effect, because the element is built by the
   * portal's root and this component's effects belong to the carousel's — and
   * `showModal()` throws on an element not yet in the document. The callback
   * fires during the portal root's own commit, by which point the node is
   * attached, so the question never arises.
   */
  const attachDialog = useCallback((el: HTMLDialogElement | null) => {
    // Guarded for browsers without the dialog API, where the element is an
    // ordinary block and the inline `position:fixed` / `z-index` carry it.
    if (!el || typeof el.showModal !== "function" || el.open) return;
    el.showModal();
  }, []);

  /**
   * The product sheet, or `null` for closed.
   *
   * Owned here rather than by either of the two things that open it, because
   * the sticker and the rail open the SAME sheet in different states — see
   * `SheetState` — and because closing it has to be reachable from the
   * dialog's own Escape handling below.
   */
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const sheetOpen = sheet !== null;

  const coarse = useMedia(COARSE);
  const still = useMedia(STILL);

  /**
   * The vertical distance a swipe has to cover, in real pixels.
   *
   * Read off the live token rather than written as a number, so it steps down
   * at the breakpoint with everything else — a 48px throw on a phone is a
   * bigger fraction of the screen than it is on a desktop.
   */
  const spacing = useTokenPx(stageRef, SPACING_VAR, BASE_SPACING);
  const swipeMin = spacing * SWIPE_STEPS;

  /** How far a finger moves before the frame starts following it. */
  const grabMin = spacing * GRAB_STEPS;

  /** Zero settles instantly, which is what reduced motion is asking for. */
  const glideMs = still ? 0 : GLIDE_MS;

  /** Where the finger went down, when, and what it turned into. */
  const from = useRef<{ x: number; y: number; at: number } | null>(null);
  const dragging = useRef(false);
  const swiped = useRef(false);

  /** The track's live offset while a finger is on it. */
  const [drag, setDrag] = useState(0);
  /** The settle after release, or `null` when nothing is in flight. */
  const [glide, setGlide] = useState<Glide | null>(null);

  // Anything on screen other than one still frame — which is when the
  // neighbours have to exist, and the only time this pays for them.
  const moving = drag !== 0 || glide !== null;

  /** Swiped past the last video, and on its way out. */
  const leaving = glide?.step === "close";

  const [hint, setHint] = useState(false);

  const [paused, setPaused] = useState(false);
  // Opened by a tap, so sound is allowed to start on. `play()` is still the
  // authority — the effect below falls back to muted if the browser disagrees.
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);

  /**
   * The raw signal — the element says it has run out of data — and the
   * delayed, visible one. Kept apart so `SPINNER_DELAY_MS` has somewhere to
   * live: the first flips the instant the video stalls, the second only if it
   * is still stalled a moment later.
   */
  const [stalled, setStalled] = useState(false);
  const [spinner, setSpinner] = useState(false);

  useEffect(() => {
    if (!stalled) {
      setSpinner(false);
      return;
    }

    const timer = setTimeout(() => setSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [stalled]);

  const media = items[index];
  const poster = posterOf(media);
  // `url` is the upload itself. The fallback is for a media saved before the
  // app recorded one: the preview on loop beats a black rectangle.
  const source = media.kind === "video" ? media.url || media.previewUrl : undefined;

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  const goPrev = useCallback(() => {
    if (hasPrev) onIndex(index - 1);
  }, [hasPrev, index, onIndex]);

  const goNext = useCallback(() => {
    if (hasNext) onIndex(index + 1);
  }, [hasNext, index, onIndex]);

  // Shown once per opening of the player, and only where it is true: a touch
  // device, with somewhere to swipe to, for a shopper who has not swiped yet.
  //
  // Mount only. `items.length` rather than `hasNext`, so moving to the last
  // video does not re-run this and put the hint back up mid-session.
  useEffect(() => {
    if (!coarse || items.length < 2 || swipedBefore) return;

    setHint(true);
    const timer = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The page must not scroll under the overlay. The previous value is put back
  // rather than cleared, so a theme that sets its own `overflow` on <body> —
  // an open drawer menu, say — is left as it was found.
  useEffect(() => {
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  // Arrows only. Escape belongs to the dialog, which raises `cancel` for it —
  // see `onCancel` below.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // While the sheet is up it is what the shopper is looking at, and the
      // arrows would move the player out from under it. Escape closes the
      // sheet first — see `onCancel`.
      if (sheetOpen) return;

      if (event.key === "ArrowLeft") goPrev();
      else if (event.key === "ArrowRight") goNext();
      else return;
      // Only for the keys actually handled, so a theme's own shortcuts are
      // left alone.
      event.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, sheetOpen]);

  // A new item starts from the top, playing, at zero progress. `muted` is
  // deliberately left alone: a shopper who silenced one video meant it for the
  // session, not for that one clip.
  useEffect(() => {
    setPaused(false);
    setProgress(0);
    // The outgoing video's buffering is not the incoming one's. Without this,
    // moving off a stalled video carries its spinner onto the next.
    setStalled(false);
    // The sheet belongs to the video it was opened from. Carrying it across
    // would leave the previous video's products over the next one's frame.
    setSheet(null);
  }, [index]);

  /**
   * Put the element in the state the buttons say it is in.
   *
   * Called from an effect AND from the element's own `loadedmetadata`, on
   * purpose. The video lives in the portal's root, not this one, so the order
   * the two roots run their effects in is the only thing that would otherwise
   * decide whether `videoRef` is filled by the time the effect fires — and a
   * player that opens silent and still, once, on some browsers, is exactly the
   * kind of bug that never reproduces. Whichever call arrives second is a
   * no-op, so there is no cost to both.
   */
  const applyPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = muted;

    if (paused) {
      video.pause();
      return;
    }

    void video.play().catch(() => {
      // Refused — all but always because it would have made noise. Muting and
      // trying once more turns a dead player into a silent one, and the button
      // then reads "unmute", which is a tap the browser will honour.
      video.muted = true;
      setMuted(true);
      void video.play().catch(() => setPaused(true));
    });
  }, [paused, muted]);

  useEffect(applyPlayback, [index, applyPlayback]);

  /** The stage's height in px, read when a gesture needs it. */
  const stageHeight = () => stageRef.current?.clientHeight ?? 0;

  const onTouchStart = (event: TouchEvent) => {
    // Two fingers is a pinch, and none of this applies to it. Neither does a
    // touch that arrives mid-settle — the frame is already going somewhere.
    if (event.touches.length !== 1 || glide) {
      from.current = null;
      return;
    }

    const touch = event.touches[0];
    from.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    dragging.current = false;
    swiped.current = false;
  };

  const onTouchMove = (event: TouchEvent) => {
    const start = from.current;
    const touch = event.touches[0];
    // While the sheet is up it owns the shopper's gestures, and moving the
    // player out from under it is the last thing a drag there should do.
    if (!start || !touch || sheetOpen) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // Not ours until it is clearly vertical AND has travelled far enough to be
    // a drag. The second test is what keeps a scroll of the free-scroll
    // product rail from dragging the frame with it.
    if (!dragging.current) {
      if (Math.abs(dy) < grabMin || Math.abs(dy) <= Math.abs(dx)) return;
      dragging.current = true;
      // The stage toggles play/pause on click, and a touch that moved still
      // raises one. This is what stops a drag also pausing the video.
      swiped.current = true;
    }

    // ⚠️ Only the TOP end resists. Past the FIRST video there is genuinely
    // nowhere to go, so the frame gives a little and springs back, the way
    // every native list does it.
    //
    // Past the LAST video there is somewhere to go — out — so that end drags
    // freely. Rubber-banding it would make the exit feel like a wall the
    // shopper had to push through, which is the opposite of what it is.
    const nowhere = dy > 0 && !hasPrev;
    setDrag(nowhere ? dy / RUBBER : dy);
  };

  const onTouchEnd = (event: TouchEvent) => {
    const start = from.current;
    from.current = null;

    const touch = event.changedTouches[0];
    if (!start || !touch || !dragging.current || sheetOpen) {
      // A drag that began and was then disqualified still has to be put back.
      if (drag !== 0) setGlide({ to: 0, step: 0 });
      dragging.current = false;
      return;
    }

    dragging.current = false;

    const dy = touch.clientY - start.y;
    const height = stageHeight();

    // Far enough, OR fast enough. Distance alone makes a quick flick feel
    // ignored; speed alone makes a careful drag feel like it needs a run-up.
    const elapsed = Math.max(1, Date.now() - start.at);
    const far = Math.abs(dy) >= Math.max(swipeMin, height * COMMIT_FRACTION);
    const fast = Math.abs(dy) / elapsed >= FLICK_SPEED && Math.abs(dy) >= grabMin;

    // Finger up means the next video, as it does in every reels player there
    // is. The frame follows the thumb, and then keeps going the same way.
    const wants: -1 | 0 | 1 = !(far || fast) ? 0 : dy < 0 ? 1 : -1;

    const step: Glide["step"] =
      // Up, with nothing above: the reel is over, and the player goes with
      // it. Carrying on in the direction they were already going is a
      // gentler end than a bounce that says "no" and leaves them to find the
      // close button.
      wants === 1 && !hasNext
        ? "close"
        : // Down, with nothing below: a real dead end, so it springs back.
          wants === -1 && !hasPrev
          ? 0
          : wants;

    if (step !== 0) {
      // They have found it. It never needs explaining again.
      swipedBefore = true;
      setHint(false);
    }

    setGlide({
      to: step === 0 ? 0 : step === "close" ? -height : -step * height,
      step,
    });
  };

  /**
   * Land the settle: swap the index and put the track back to zero.
   *
   * A timer rather than `transitionend`, because a transition that changes
   * nothing — a release at exactly the offset it is gliding to — never fires
   * one, and a player stuck mid-swipe is a worse failure than a frame of
   * imprecision. `GLIDE_MS` is the same number the inline transition uses, so
   * there is one source for it and nothing to keep in step.
   *
   * Both updates happen in one pass, so the frame that was the neighbour
   * becomes the current one at offset zero in a single paint — with
   * `transition: none` applied in the same style change, which is what stops
   * the browser animating the jump back.
   */
  useEffect(() => {
    if (!glide) return;

    const timer = setTimeout(() => {
      // Nothing after this: closing unmounts the whole component, and the two
      // resets below would be writing state into something already gone.
      if (glide.step === "close") {
        onClose();
        return;
      }

      if (glide.step !== 0) onIndex(index + glide.step);
      setGlide(null);
      setDrag(0);
    }, glideMs);

    return () => clearTimeout(timer);
  }, [glide, glideMs, index, onIndex, onClose]);

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const { currentTime, duration } = video;
    // A stream still working out how long it is reports `NaN` or `Infinity`.
    if (!duration || !isFinite(duration)) return;
    setProgress(Math.min(1, Math.max(0, currentTime / duration)));
  };

  return (
    <Portal>
      <dialog
        ref={attachDialog}
        aria-label={media.title || "Video"}
        // Escape, raised by the dialog itself. Prevented so the browser does
        // not also close it behind our back — the carousel owns whether this
        // component exists, and it unmounting is what removes it.
        onCancel={(event) => {
          event.preventDefault();
          // One layer at a time, innermost first — the same thing every other
          // stacked overlay on the web does with Escape. Closing the player
          // out from under an open sheet would take two things away for one
          // keypress.
          if (sheetOpen) setSheet(null);
          else onClose();
        }}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: TOP_LAYER,
          background: SCRIM,
          // The frame slides up and off; without this the shopper would be
          // left looking at an empty black rectangle for the length of that,
          // and the player would then vanish in one cut. Fading the whole
          // overlay on the same clock makes the two read as one dismissal —
          // the video leaves and takes the player with it.
          opacity: leaving ? 0 : 1,
          transition: `opacity ${glideMs}ms ease`,
          // Undoing the UA stylesheet, which gives a dialog a border, padding,
          // a white background and centring margins, caps it at
          // `max-width/max-height: calc(100% - 6px - 2em)`, and — the one that
          // matters most — sizes it `width: fit-content; height: fit-content`.
          //
          // That last pair BEATS `inset: 0`. A fixed element only stretches to
          // its insets while its size is `auto`, and `fit-content` is not
          // `auto`, so the box shrink-wrapped the video instead of filling the
          // screen: an overlay the shape of the clip, with the theme still lit
          // beside it. The explicit `100%`s are what put that right. Both
          // percentages resolve against the viewport, which is the containing
          // block for a fixed element and for a top-layer dialog alike.
          border: "none",
          margin: 0,
          width: "100%",
          height: "100%",
          maxWidth: "none",
          maxHeight: "none",
          // `display` also overrides `dialog:not([open]) { display: none }`,
          // which is what keeps the fallback path visible on a browser that
          // never ran `showModal()` and so never set the `open` attribute.
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: GUTTER,
          boxSizing: "border-box",
          // The theme's typeface, not ours. This renders into `<body>` (see
          // `lib/portal.tsx`), so it inherits whatever the theme set there,
          // which is the point: a player inside a merchant's storefront should
          // look like it belongs to that storefront.
          //
          // Written out rather than as the `font` shorthand, which cannot take
          // a `calc()` size without the slash before `line-height` turning
          // ambiguous.
          fontFamily: "inherit",
          fontSize: fs(1),
          lineHeight: 1.4,
          color: "#fff",
          // Stops a swipe that runs out of overlay from scrolling the page
          // behind it, on the browsers that chain scrolls by default.
          overscrollBehavior: "contain",
        }}
      >
        {/* The stage. Clicks stop here, so only the scrim closes.
            The height is the smaller of the room available and the height a
            9:16 frame may be before it is wider than the room available —
            portrait on a phone, letterboxed on a desktop, with no reliance on
            how a browser clamps `aspect-ratio` against `max-width`. */}
        <div
          ref={stageRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          onClick={(event) => {
            event.stopPropagation();

            // The click that follows a swipe is not a tap. Cleared here rather
            // than in `onTouchEnd`, because this is the event it exists to
            // suppress and there is exactly one of it.
            if (swiped.current) {
              swiped.current = false;
              return;
            }

            setPaused((was) => !was);
          }}
          style={{
            position: "relative",
            height: `min(100%, calc((100vw - ${GUTTER_X2}) * 16 / 9))`,
            aspectRatio: "9 / 16",
            maxWidth: "100%",
            borderRadius: sp(1.5),
            overflow: "hidden",
            background: "#000",
            cursor: "pointer",
          }}
        >
          {/* ── The reel ──

              One track carrying the video and the two stills either side of
              it, offset by the finger. Everything that belongs to THIS media
              rides with it; the player's own chrome — the progress hairline,
              the close and mute buttons, the sheet — sits on the stage and
              stays put, which is the division every reels player makes.

              The neighbours exist only while something is moving. Two more
              frames rendered permanently would mean two more `video` elements
              on every open, for a swipe that may never come. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `translateY(${glide ? glide.to : drag}px)`,
              // ⚠️ `none` while a finger is down. A transition on a value
              // being set from `touchmove` fights the finger: every frame the
              // browser starts a new 260ms animation towards a target that
              // has already moved, and the frame trails the thumb like it is
              // stuck in treacle.
              transition: glide ? `transform ${glideMs}ms ${GLIDE_EASE}` : "none",
              // Only while it is actually moving. A permanent `will-change`
              // keeps a compositor layer alive for a video that is going
              // nowhere, which on a phone is memory that could have been the
              // decoder's.
              willChange: moving ? "transform" : undefined,
            }}
          >
            {moving && hasPrev && (
              <Neighbour
                media={items[index - 1]}
                slot={-1}
                frameWidth={stageWidth}
                live={live}
                products={products}
              />
            )}

            <div style={{ position: "absolute", inset: 0 }}>
          {source ? (
            <video
              // Keyed by media: moving to the next item must build a new
              // element rather than re-point this one, which would otherwise
              // carry the outgoing video's buffered time and readyState in.
              key={media.id}
              ref={videoRef}
              src={source}
              poster={poster}
              autoPlay
              playsInline
              loop
              preload="auto"
              onLoadedMetadata={applyPlayback}
              onTimeUpdate={onTimeUpdate}
              // `waiting` is the exact event for this and the only one worth
              // trusting: "playback has stopped because of a temporary lack of
              // data". `stalled` is the tempting alternative and it is wrong —
              // it means the browser is not RECEIVING data, which it fires
              // happily while playing from a buffer that is minutes deep.
              onWaiting={() => setStalled(true)}
              onPlaying={() => setStalled(false)}
              // The recovery event for a video that filled its buffer without
              // resuming — one paused mid-stall, which raises no `playing`.
              onCanPlay={() => setStalled(false)}
              // A source that has failed is not coming back, and a spinner
              // that turns forever is a worse answer than a still poster.
              onError={() => setStalled(false)}
              // The browser's own controls are the wrong furniture here, and on
              // iOS they carry a fullscreen button that leaves the overlay.
              controls={false}
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />
          ) : (
            poster && (
              <img
                src={poster}
                alt={media.title || ""}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              />
            )
          )}

          {/* `sticker` — the same badge the card draws, in the spot the
              merchant placed it. Before the paused badge and the title in the
              tree, so both draw over it. */}
          {products === "sticker" && (
            <Sticker
              media={media}
              frameWidth={stageWidth}
              live={live}
              onOpen={() => {
                // The badge names one product and its "+N" hints at the rest,
                // so it opens the rest — UNLESS there is no rest, in which
                // case a list of one is a screen the shopper has to tap
                // through to reach the only thing on it. Straight to the
                // product then, with no Back arrow, because there is nothing
                // behind it.
                const tagged = media.products ?? [];
                setSheet(
                  tagged.length === 1
                    ? { productId: tagged[0].id, stacked: false }
                    : { productId: null, stacked: true },
                );
              }}
            />
          )}

          {/* Centred rather than tucked along the bottom, and that is not a
              style choice: the bottom of the stage is where the title scrim
              and the free-scroll product rail live, and their heights are not
              things this can know. The middle is clear in every mode, and the
              hint is gone in two seconds either way. */}
          {hint && (
            <div
              class="sje-hint"
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                // It explains the gesture; it must never be in the way of it.
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: sp(0.5),
                  padding: `${sp(1.5)} ${sp(2)}`,
                  borderRadius: sp(2),
                  background: "rgba(0,0,0,0.55)",
                  fontSize: fs(0.85),
                  fontWeight: 600,
                }}
              >
                {/* The arrow is the message; the words are the caption. The
                    loop is on the arrow alone so the text does not judder. */}
                <div class="sje-hint__arrow">
                  <ChevronUp size={sp(3)} />
                </div>
                Swipe up for next
              </div>
            </div>
          )}

          {/* ⚠️ `!paused` is not belt and braces. A shopper who taps pause
              mid-stall would otherwise get a spinner AND a play badge stacked
              on the same spot, each contradicting the other about why nothing
              is moving. Paused is the shopper's doing and takes precedence:
              it is an answer, and the spinner is only ever a question. */}
          {source && spinner && !paused && (
            <div
              // Announced, because a shopper who cannot see the screen has no
              // other way to tell a slow video from a broken one.
              role="status"
              aria-label="Loading video"
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                // The stage is the play/pause control and this sits over the
                // middle of it. It must never eat that tap.
                pointerEvents: "none",
              }}
            >
              <div
                // The class carries the rotation. A `style` attribute cannot
                // hold a keyframe, which is the only reason this widget ever
                // uses one.
                class="sje-spinner"
                style={{
                  width: sp(4),
                  height: sp(4),
                  // One lit quarter on a dim ring — the ring is what makes the
                  // lit part legible as a circuit rather than a stray mark,
                  // and both are white because this only ever sits on video.
                  border: `${sp(0.25)} solid rgba(255,255,255,0.25)`,
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {/* Paused badge — a hint, not a control. The stage is the control. */}
          {source && paused && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                pointerEvents: "none",
              }}
            >
              {/* `paddingLeft` nudges the glyph right by a hair: a triangle's
                  optical centre sits left of its bounding box, so one centred
                  by geometry looks off-centre to the eye. */}
              <div
                style={{
                  ...BUTTON,
                  width: sp(8),
                  height: sp(8),
                  paddingLeft: sp(0.5),
                  background: "rgba(0,0,0,0.55)",
                }}
              >
                <Play size={sp(3.5)} filled />
              </div>
            </div>
          )}

          {media.title && products !== "free-scroll" && (
            <div
              style={{
                position: "absolute",
                insetInline: 0,
                bottom: 0,
                // Bottom-up scrim, so the title survives a bright frame.
                padding: `${sp(6)} ${sp(2)} ${sp(2)}`,
                background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)",
                fontSize: fs(1),
                fontWeight: 600,
                pointerEvents: "none",
              }}
            >
              {media.title}
            </div>
          )}

            </div>

            {moving && hasNext && (
              <Neighbour
                media={items[index + 1]}
                slot={1}
                frameWidth={stageWidth}
                live={live}
                products={products}
              />
            )}
          </div>

          {/* `free-scroll` — every tagged product, in a row of its own. After
              the title so it draws over that scrim, before the progress so the
              hairline still tops everything.

              It does NOT ride the track: it is a scroller of its own, and a
              horizontal scroller inside a vertically dragging box is a
              gesture argument nobody wins. It fades instead, so it is not
              still advertising the outgoing video's products over the
              incoming one's frame. */}
          {products === "free-scroll" && (
            <div
              style={{
                opacity: moving ? 0 : 1,
                transition: `opacity ${glideMs}ms ease`,
              }}
            >
              {/* The rail IS the list, so a tap on a card has nothing to list
                  and goes straight to the product — `stacked: false`, no
                  Back. */}
              <ProductRail
                media={media}
                onOpen={(productId) => setSheet({ productId, stacked: false })}
              />
            </div>
          )}

          {/* Progress. After the title in the tree, so it is drawn over it. */}
          {source && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                insetInline: 0,
                bottom: 0,
                height: sp(0.375),
                background: "rgba(255,255,255,0.25)",
                pointerEvents: "none",
              }}
            >
              <div style={{ width: `${progress * 100}%`, height: "100%", background: "#fff" }} />
            </div>
          )}

          {/* Last in the stage, so it draws over the rail, the title and the
              progress hairline alike. It renders nothing at all until it is
              opened, and keeps itself mounted for the length of its exit —
              see `ProductSheet`. */}
          <ProductSheet
            media={media}
            state={sheet}
            onSelect={(productId) => setSheet({ productId, stacked: true })}
            onBack={() => setSheet({ productId: null, stacked: true })}
            onClose={() => setSheet(null)}
          />
        </div>

        {/* The controls sit on the scrim, outside the stage, so a tap on one is
            never also a tap on the video. */}
        <div
          onClick={(event) => event.stopPropagation()}
          style={{ position: "absolute", top: GUTTER, right: GUTTER, display: "flex", gap: sp(1) }}
        >
          {source && (
            <button
              type="button"
              onClick={() => setMuted((was) => !was)}
              aria-label={muted ? "Unmute" : "Mute"}
              style={BUTTON}
            >
              {muted ? <VolumeX /> : <Volume2 />}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" style={BUTTON}>
            <X />
          </button>
        </div>

        {/* ⚠️ Not on a touch device. They are a mouse affordance — a 40px
            target either side of a portrait frame, sitting on the video —
            and on a phone the swipe replaces them entirely. The keyboard
            arrows are unaffected and still work everywhere. */}
        {hasPrev && !coarse && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              goPrev();
            }}
            aria-label="Previous video"
            style={{ ...BUTTON, position: "absolute", left: GUTTER, top: "50%", marginTop: sp(CONTROL_STEPS / -2) }}
          >
            <ChevronLeft />
          </button>
        )}

        {hasNext && !coarse && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              goNext();
            }}
            aria-label="Next video"
            style={{ ...BUTTON, position: "absolute", right: GUTTER, top: "50%", marginTop: sp(CONTROL_STEPS / -2) }}
          >
            <ChevronRight />
          </button>
        )}
      </dialog>
    </Portal>
  );
}

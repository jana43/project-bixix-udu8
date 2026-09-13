// src/components/RailArrows.tsx
// The two arrows under a scrolling row, and the strip they sit in.
//
// The row still scrolls by drag, wheel and swipe — only its scrollbar is
// hidden. These are the visible way to move it, and where they sit (or whether
// they appear at all) is the merchant's to set on the block.
//
// Shared by the carousel and the story bar. Both rows answer the same two
// settings, `arrow_position` and `arrow_scale`, and a merchant who has learnt
// one should not find the other behaving differently.
import { ChevronLeft, ChevronRight } from "../lib/icons";
import { sp } from "../lib/tokens";
import type { ArrowPosition } from "../lib/settings";

/** What each placement means to a flex row. `hidden` draws no strip at all. */
const ALIGN: Record<"left" | "center" | "right", string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

/**
 * How an arrow is drawn against what is behind it.
 *
 * `plain` is a `currentColor` outline on nothing — right for a control sitting
 * on the theme's own background, where the widget has no idea what colour that
 * is and a hardcoded black or white would be wrong half the time.
 *
 * `overlay` is for an arrow that sits ON the content. `currentColor` fails
 * there completely: it resolves to the THEME's text colour, which has no
 * relationship to the video underneath, so a dark outline vanishes against a
 * dark frame and a light one against a light frame. A pale surface with its
 * own dark glyph is the only version that works over an image nobody can
 * predict.
 */
export type ArrowTone = "plain" | "overlay";

/** A pale disc that reads on any frame, without shouting over it. */
const OVERLAY = {
  background: "rgba(255, 255, 255, 0.88)",
  border: "1px solid rgba(0, 0, 0, 0.08)",
  boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)",
  // ⚠️ Stated, not inherited. The glyph is `currentColor`, so leaving this
  // alone would draw a light icon on a light disc on any dark theme.
  color: "#111",
} as const;

interface RailArrowsProps {
  position: ArrowPosition;
  /** How the arrows are drawn. See `ArrowTone`. Defaults to `plain`. */
  tone?: ArrowTone;
  /**
   * The block's `arrow_scale`, as a percentage of the standard spacing — 500
   * means five spacings, so 40px on desktop and 30px on a phone.
   */
  scale: number;
  /** The live spacing token in px, from `useRail`. */
  spacing: number;
  atStart: boolean;
  atEnd: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function RailArrows({
  position,
  tone = "plain",
  scale,
  spacing,
  atStart,
  atEnd,
  onPrev,
  onNext,
}: RailArrowsProps) {
  // ⚠️ `sides` draws nothing HERE. It means "one arrow either side of the
  // cards", which is not a strip under a row at all — it is two absolutely
  // positioned buttons over the layout, and only a layout that knows where its
  // cards are can place them. `Stacked` does that with `Arrow` directly. A rail
  // offered `sides` by a hand-edited attribute gets no arrows rather than
  // something misplaced.
  if (position === "hidden" || position === "sides") return null;

  // The setting is a percentage of the standard spacing, so the arrows are one
  // more thing derived from the scale rather than an absolute px that ignores
  // it — 500% is 40px on desktop and 30px on a phone.
  const size = Math.round((spacing * scale) / 100);

  return (
    <div
      class="sje-arrows"
      style={{
        flex: "0 0 auto",
        display: "flex",
        justifyContent: ALIGN[position],
        gap: sp(1),
        paddingBlockStart: sp(1.5),
      }}
    >
      <Arrow direction="prev" tone={tone} size={size} spent={atStart} onClick={onPrev} />
      <Arrow direction="next" tone={tone} size={size} spent={atEnd} onClick={onNext} />
    </div>
  );
}

interface ArrowProps {
  direction: "prev" | "next";
  /** How it is drawn against what is behind it. Defaults to `plain`. */
  tone?: ArrowTone;
  /** Diameter in px. The icon scales with it. */
  size: number;
  /** At the end it can move towards, so there is nowhere left to go. */
  spent: boolean;
  onClick: () => void;
}

export function Arrow({ direction, tone = "plain", size, spent, onClick }: ArrowProps) {
  const isPrev = direction === "prev";

  return (
    <button
      type="button"
      onClick={onClick}
      // Left in the tree rather than removed, so the row does not reflow every
      // time the shopper reaches an end. `disabled` is what takes it out of
      // the tab order and stops it being announced as available.
      class={`sje-arrow sje-arrow--${direction}`}
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
        // `overlay` replaces all three, for an arrow drawn over the content
        // rather than beside it. See `ArrowTone`.
        border: "1px solid currentColor",
        borderRadius: "50%",
        background: "transparent",
        color: "inherit",
        ...(tone === "overlay" ? OVERLAY : null),
        // ⚠️ `inherit`, and it has to be SAID. A `button` does not inherit
        // `font-family` — the UA stylesheet gives every form control a font of
        // its own — so leaving this out is not "inherit the theme's font", it
        // is "render in whatever the browser thinks a button should look
        // like". Deleting the declaration and inheriting are different things.
        fontFamily: "inherit",
        cursor: spent ? "default" : "pointer",
        opacity: spent ? 0.3 : 1,
        transition: "opacity 150ms ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Half the button, so the glyph keeps its proportions as the merchant
          scales the control. */}
      {isPrev ? (
        <ChevronLeft size={Math.round(size / 2)} />
      ) : (
        <ChevronRight size={Math.round(size / 2)} />
      )}
    </button>
  );
}

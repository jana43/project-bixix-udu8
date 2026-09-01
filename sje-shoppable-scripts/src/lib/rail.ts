// src/lib/rail.ts
// The horizontal scroller both the carousel and the story bar are built on.
//
// Extracted when the story bar arrived, because a story bar is a carousel with
// a different shape of item: the same row, the same hidden scrollbar, the same
// arrows underneath, the same "is there anything left that way" question. The
// only thing that differed was what sits in it, and copying a hundred lines of
// scroll bookkeeping to change the border-radius of the children is how two
// layouts start behaving differently for no reason anyone can name.
//
// What is NOT here: the arrows themselves (`components/RailArrows.tsx`), and
// anything that knows what an item looks like. This module knows there is a
// row, that it scrolls, and how wide one step is.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { BASE_SPACING, SPACING_VAR, useTokenPx } from "./tokens";

export interface Rail {
  /** Goes on the scrolling element. */
  ref: { current: HTMLDivElement | null };
  /**
   * The standard spacing in px, kept current across the breakpoint.
   *
   * Handed back because callers need it as a NUMBER, not a length: the arrows'
   * diameter is a percentage of it, and so is the story circle's.
   */
  spacing: number;
  /** Nothing further that way — the matching arrow has nothing to do. */
  atStart: boolean;
  atEnd: boolean;
  /** Move the row by exactly one item and the gap after it. */
  scrollByItem: (direction: 1 | -1) => void;
}

/**
 * A scrolling row that knows where its ends are.
 *
 * `gapSteps` is the gap between items in standard spacings — the same number
 * the row is drawn with, so the scroll step stays exact on both sides of the
 * breakpoint rather than being a second constant that can drift.
 *
 * `count` is how many items are in the row. It is not used for anything except
 * re-measuring: a widget re-saved with more or fewer videos changes whether
 * there is anything to scroll, without a scroll ever happening.
 */
export function useRail(gapSteps: number, count: number): Rail {
  const ref = useRef<HTMLDivElement>(null);
  const spacing = useTokenPx(ref, SPACING_VAR, BASE_SPACING);

  // Kept in state rather than read during render, because scroll position is
  // not something a render can see changing.
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const readEnds = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const furthest = el.scrollWidth - el.clientWidth;
    // A pixel of slack: `scrollLeft` is fractional on zoomed and high-density
    // displays, and an exact comparison never quite lands — which would leave
    // an arrow lit at the end of the row with nothing to do.
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= furthest - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
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
  }, [readEnds, count]);

  const scrollByItem = useCallback(
    (direction: 1 | -1) => {
      const el = ref.current;
      if (!el) return;

      // One item and the gap after it. MEASURED rather than assumed: a
      // carousel card's width comes from a 9:16 ratio against the row's
      // height and a story circle's from a merchant setting, so neither is
      // known until it is laid out. The fallback is for an empty row, which
      // cannot be scrolled anyway.
      const item = el.firstElementChild;
      const step = item
        ? item.getBoundingClientRect().width + spacing * gapSteps
        : el.clientWidth;

      el.scrollBy({
        left: step * direction,
        // A shopper who asked not to be moved around should not be, even when
        // they were the one who pressed the button.
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    },
    [spacing, gapSteps],
  );

  return { ref, spacing, atStart, atEnd, scrollByItem };
}

// src/lib/useElementWidth.ts
// An element's width in CSS pixels, kept current as it changes.
//
// The sticker badge needs this. Its width is stored as a PERCENTAGE of the
// frame, but everything inside it — the corner radius, the price's font size,
// the price band's padding — is a proportion of that width, and a font size
// cannot be a percentage of the box it sits in. So the percentage is turned
// into pixels once, here, and the badge is drawn from the number.
//
// The admin measures for the same reason and reached it the harder way: an
// earlier version of its badge sized everything in container-query units and
// rendered as an empty circle or a sliver. See `StickerBadge.tsx` there.
//
// `0` until the first measurement, which callers should read as "not yet" and
// draw nothing — a badge briefly sized from a width of zero is a visible pop.
import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";

export function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // A first read before observing, so a box that never resizes again still
    // gets its one measurement.
    setWidth(el.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // `contentRect`, not a fresh `getBoundingClientRect()`: it is the size
        // the observer already measured, so reading it cannot itself force
        // another layout inside a callback layout just triggered.
        setWidth(entry.contentRect.width);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

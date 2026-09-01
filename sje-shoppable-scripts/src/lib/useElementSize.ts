// src/lib/useElementSize.ts
// An element's width AND height in CSS pixels, kept current as they change.
//
// ⚠️ Deliberately separate from `useElementWidth` rather than replacing it.
// One caller needs both numbers — `Banner`, which sizes the product badge from
// the frame a 9:16 video WOULD occupy at the banner's height, because the
// badge's stored size is a percentage of a video frame and a banner's box is
// nothing like one. Every other caller needs the width alone, and folding them
// together would make four working layouts re-render on a height change they
// have no use for.
//
// The two values are held as separate states so a resize that changes only one
// of them costs one render, not two.
//
// `0` until the first measurement, which callers should read as "not yet" and
// draw nothing — a badge briefly sized from zero is a visible pop.
import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";

export interface ElementSize {
  width: number;
  height: number;
}

export function useElementSize(ref: RefObject<HTMLElement>): ElementSize {
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // A first read before observing, so a box that never resizes again still
    // gets its one measurement.
    const box = el.getBoundingClientRect();
    setWidth(box.width);
    setHeight(box.height);

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // `contentRect`, not a fresh `getBoundingClientRect()`: it is the size
        // the observer already measured, so reading it cannot itself force
        // another layout inside a callback layout just triggered.
        setWidth(entry.contentRect.width);
        setHeight(entry.contentRect.height);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return { width, height };
}

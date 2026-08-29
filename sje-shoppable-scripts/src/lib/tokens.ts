// src/lib/tokens.ts
// The two standard tokens, as the components see them.
//
// Every font size and every piece of spacing in this extension is a multiple
// of one of these — in `sje-widget.css`, in the Liquid `style` attributes, and
// here. This module is the JS half of that contract, and the ONLY place the
// token names and their base values are written down on this side.
//
// ── Why inline styles still use `var()` ──
//
// `Carousel`, `Stories` and `Lightbox` style themselves inline on purpose: a
// class name of ours can collide with the merchant's theme and their reset can
// undo ours, and an inline declaration wins both. Reaching for a custom
// property does not give any of that back. The declaration is still inline and
// still beats the theme; only the VALUE arrives from the sheet, and the
// fallback below covers a sheet that never loads. What it buys is that the
// components step down at 749px along with the Liquid chrome around them,
// which is not something inline numbers can ever do.
//
// ⚠️ The fallback is not optional. `sje-widget.css` has failed to load on the
// storefront before (see the note in `snippets/sje-widget.liquid`), and an
// undefined custom property makes the whole `calc()` invalid — the declaration
// is dropped, not defaulted. With the fallback, a missing sheet costs only the
// mobile step-down.

import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";

/** The token names, exactly as `sje-widget.css` declares them on `:root`. */
export const FONT_SIZE_VAR = "--sje-standard-font-size";
export const SPACING_VAR = "--sje-standard-spacing";

/**
 * The desktop values, mirroring the `:root` block in `sje-widget.css`.
 *
 * These are the `var()` fallbacks, so they are what the extension renders at
 * when the stylesheet does not load. Keep them in step with the CSS.
 */
export const BASE_FONT_SIZE = 14;
export const BASE_SPACING = 8;

/** A CSS length derived from the standard font size. `fs(1)` is one step. */
export const fs = (multiplier = 1): string =>
  `calc(var(${FONT_SIZE_VAR}, ${BASE_FONT_SIZE}px) * ${multiplier})`;

/** A CSS length derived from the standard spacing. `sp(1.5)` is one and a half. */
export const sp = (multiplier = 1): string =>
  `calc(var(${SPACING_VAR}, ${BASE_SPACING}px) * ${multiplier})`;

/**
 * A token's resolved value in CSS pixels, for the few places a NUMBER is
 * needed rather than a length — an arrow's diameter, a scroll step.
 *
 * Read off `el` rather than `document.documentElement` so a widget that ever
 * overrides a token on its own wrapper is honoured. Falls back on every way
 * this can come back empty: no element, no `getComputedStyle` (a server render
 * or a very old browser), or a property that resolves to nothing because the
 * sheet is missing.
 */
export function tokenPx(el: Element | null, name: string, fallback: number): number {
  if (!el || typeof getComputedStyle !== "function") return fallback;

  const raw = getComputedStyle(el).getPropertyValue(name);
  const value = parseFloat(raw);
  return isFinite(value) && value > 0 ? value : fallback;
}

/** The standard spacing in px, times `multiplier`. */
export const spacingPx = (el: Element | null, multiplier = 1): number =>
  tokenPx(el, SPACING_VAR, BASE_SPACING) * multiplier;

/**
 * A token's resolved value in px, kept current as the viewport changes.
 *
 * `resize` is the signal because the only thing that moves these values is the
 * media query in `sje-widget.css` crossing 749px, and that is exactly when a
 * resize fires (an orientation change fires one too). The breakpoint itself
 * stays in the stylesheet where it belongs — nothing here knows the number.
 */
export function useTokenPx(
  ref: RefObject<Element | null>,
  name: string,
  fallback: number,
): number {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    const read = () => setValue(tokenPx(ref.current, name, fallback));

    // The first read has to wait for layout: on the very first render the ref
    // is still empty, and an effect runs once the node is attached.
    read();

    window.addEventListener("resize", read, { passive: true });
    return () => window.removeEventListener("resize", read);
  }, [ref, name, fallback]);

  return value;
}

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
// storefront before — twice: `asset_url`, which resolves against the THEME's
// assets rather than the app's, and then the schema's `stylesheet` key — and an
// undefined custom property makes the whole `calc()` invalid — the declaration
// is dropped, not defaulted. With the fallback, a missing sheet costs only the
// mobile step-down.

import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";

/** The token names, exactly as `sje-widget.css` declares them on `:root`. */
export const FONT_SIZE_VAR = "--sje-standard-font-size";
export const SPACING_VAR = "--sje-standard-spacing";

/**
 * The story circle's own unit — the documented exception to "two tokens".
 *
 * ⚠️ It steps UP at the breakpoint, not down: 8px to 9px. The story circle is
 * the one thing in this extension that must get BIGGER on a phone, because it
 * is content rather than chrome and is already the smallest thing drawn. The
 * long version is beside its declaration in `sje-widget.css`.
 *
 * There is no `su()` helper to match `sp()` and `fs()`, deliberately. Only two
 * measurements read this — the circle and its ring — and both need a NUMBER
 * rather than a CSS length, because they are percentages of it computed in JS
 * from a merchant setting.
 */
export const STORY_UNIT_VAR = "--sje-story-unit";

/**
 * The product badge's own type, which also steps UP at the breakpoint — 14px
 * to 16px, and 600 to 700.
 *
 * Same reasoning as `STORY_UNIT_VAR`: a price on a badge is content, not
 * chrome, and it is the smallest text this extension draws. At the standard
 * scale a phone took it to about 5px. The weight goes up because the badge
 * sits on moving video, where a 600 face at 7px loses its edges to the
 * compression.
 *
 * ⚠️ The badge's SIZE is not here and must not come here. That is
 * `sticker.size`, a percentage of the video frame set per-video in the app,
 * and it has to stay exactly what the merchant placed in the position editor.
 * Only the type inside the badge answers the breakpoint.
 */
export const STICKER_FONT_VAR = "--sje-sticker-font-size";
export const STICKER_WEIGHT_VAR = "--sje-sticker-font-weight";


/**
 * The desktop values, mirroring the `:root` block in `sje-widget.css`.
 *
 * These are the `var()` fallbacks, so they are what the extension renders at
 * when the stylesheet does not load. Keep them in step with the CSS.
 */
export const BASE_FONT_SIZE = 14;
export const BASE_SPACING = 8;
/** The desktop value of `STORY_UNIT_VAR`. Keep in step with `sje-widget.css`. */
export const BASE_STORY_UNIT = 8;
/** The desktop values of the two sticker tokens. Same pairing. */
export const BASE_STICKER_FONT = 14;
export const BASE_STICKER_WEIGHT = 600;

/** A CSS length derived from the standard font size. `fs(1)` is one step. */
export const fs = (multiplier = 1): string =>
  `calc(var(${FONT_SIZE_VAR}, ${BASE_FONT_SIZE}px) * ${multiplier})`;

/** A CSS length derived from the standard spacing. `sp(1.5)` is one and a half. */
export const sp = (multiplier = 1): string =>
  `calc(var(${SPACING_VAR}, ${BASE_SPACING}px) * ${multiplier})`;

/**
 * A CSS length derived from the BADGE's font token — `fs()`'s counterpart for
 * the one piece of type that gets bigger on a phone rather than smaller.
 */
export const bfs = (multiplier = 1): string =>
  `calc(var(${STICKER_FONT_VAR}, ${BASE_STICKER_FONT}px) * ${multiplier})`;

/** The badge's label weight. A `var()`, because it steps up at the breakpoint. */
export const BADGE_WEIGHT = `var(${STICKER_WEIGHT_VAR}, ${BASE_STICKER_WEIGHT})`;


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
  // ⚠️ Seeded from `documentElement`, NOT from `fallback`.
  //
  // The ref is empty on the very first render, so this used to start at the
  // desktop base and correct itself one effect later. Every consumer that only
  // wants a length rode that out as a frame of slightly-wrong padding — but a
  // consumer that turns the number into a DECISION does not: `Lightbox` asks
  // whether this is a phone, and a first render that says "no" flashes the
  // arrows on a phone and, because the swipe hint is a mount-only effect,
  // stops the hint appearing at all.
  //
  // These tokens are declared on `:root`, so `documentElement` carries the
  // same value the ref's element would inherit — and it exists before any of
  // this renders. `tokenPx` already returns the fallback for a null element or
  // a browser without `getComputedStyle`.
  const [value, setValue] = useState(() =>
    tokenPx(typeof document === "undefined" ? null : document.documentElement, name, fallback),
  );

  useEffect(() => {
    const read = () => setValue(tokenPx(ref.current, name, fallback));

    // Re-read against the real node now it is attached, in case anything
    // between it and `:root` overrides the token.
    read();

    window.addEventListener("resize", read, { passive: true });
    return () => window.removeEventListener("resize", read);
  }, [ref, name, fallback]);

  return value;
}

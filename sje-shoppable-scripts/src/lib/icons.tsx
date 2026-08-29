// src/lib/icons.tsx
// The handful of Lucide icons the widget draws, inlined.
//
// The admin panel gets these from `lucide-react`. This bundle does not take
// the equivalent dependency: a theme asset is fetched on a shopper's phone, is
// built per entry with everything inlined (see `build.mjs`), and six glyphs of
// path data is a smaller thing to ship than an icon runtime. The paths below
// are Lucide's own, unmodified, at its 24×24 grid.
//
// Names match `lucide-react` / `lucide-preact` exactly — `X`, `Play`,
// `Volume2`, `VolumeX`, `ChevronLeft`, `ChevronRight`, `ChevronUp`,
// `ShoppingBag`, `Check`
// — so if this ever does take the dependency, every call site here is already
// correct and only the import line changes.
//
// Attributes are written dash-cased (`stroke-width`, not `strokeWidth`).
// Preact passes unknown props to `setAttribute` as given, and `stroke-width`
// is the name SVG actually answers to.
import type { ComponentChildren } from "preact";
import { sp } from "./tokens";

export interface IconProps {
  /**
   * Both width and height — Lucide icons are square. Either a number of CSS
   * pixels, or any CSS length, which is how a glyph derived from the standard
   * spacing token (`sp(2.5)`) gets here.
   */
  size?: number | string;
}

/** Lucide's shared frame. Every icon is this `svg` with different children. */
function Icon({
  size = sp(2.5),
  fill = "none",
  children,
}: IconProps & { fill?: string; children: ComponentChildren }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      // Sized through CSS rather than the `width`/`height` ATTRIBUTES, which
      // is what lets a `calc()` through: SVG2 maps those attributes onto the
      // CSS properties, but browsers are uneven about accepting a `calc()` in
      // the attribute position. The `viewBox` does the scaling either way.
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      // Every icon here sits inside a button that carries its own
      // `aria-label`, so the glyph itself is decoration.
      aria-hidden="true"
      style={{ display: "block", width: size, height: size }}
    >
      {children}
    </svg>
  );
}

export function X({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

/**
 * `filled` is not a Lucide prop — Lucide draws an outline, and the paused
 * badge wants the solid triangle a play button has always been. It maps onto
 * the `fill` the real component would forward to its `svg` anyway.
 */
export function Play({ size, filled }: IconProps & { filled?: boolean }) {
  return (
    <Icon size={size} fill={filled ? "currentColor" : "none"}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </Icon>
  );
}

export function Volume2({ size }: IconProps) {
  return (
    <Icon size={size}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </Icon>
  );
}

export function VolumeX({ size }: IconProps) {
  return (
    <Icon size={size}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" x2="16" y1="9" y2="15" />
      <line x1="16" x2="22" y1="9" y2="15" />
    </Icon>
  );
}

export function ChevronLeft({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m15 18-6-6 6-6" />
    </Icon>
  );
}

export function ChevronRight({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

export function ShoppingBag({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </Icon>
  );
}

export function Check({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

export function ChevronUp({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m18 15-6-6-6 6" />
    </Icon>
  );
}

// src/lib/sticker.ts
// Which product is pinned to a media, and where its badge sits.
//
// ── Why every one of these fields can be missing ──
//
// The app writes a widget with `JSON.stringify`, which DROPS keys whose value
// is `undefined` — and in the admin's `parseAppMedia` all four sticker fields
// are `undefined` until a merchant explicitly sets them. So a media whose
// sticker was never dragged, sized or tilted arrives here with no
// `stickerPosition`, no `stickerSize` and no `stickerRotation` at all, and one
// where no product was pinned arrives with no `stickyProductId`.
//
// That is not damage, and it is not "no sticker". It means "never chose", and
// the answer to never having chosen is the default — the same default the
// merchant was shown in the app's position editor while they were deciding.
// A renderer that read absent as broken would hide a badge on every media the
// merchant was happy with as-is.
//
// The numbers below are copied from the admin's `lib/shoppable_videos/
// stickerOverlay.ts`. They are duplicated rather than shared because the two
// codebases do not build together — if they change there, change them here.
//
// ⚠️ "sticky" vs "sticker": the merchant sees "sticker product", the stored
// field says `stickyProductId`. The storage name is deliberately not renamed —
// it is a key inside every media already written to a metafield. Same thing.
import { BASE_SPACING } from "./tokens";
import type { SJEMedia, SJEProduct } from "./sje";

/**
 * The badge's anchor, as percentages of the frame — bottom-right, inset.
 *
 * ⚠️ These are the badge's CENTRE, not its corner, so they are nowhere near
 * 100. The tilt below matters here too: a rotated box needs `w*cos + h*sin` of
 * room across and `w*sin + h*cos` down, and half of each has to fit between
 * the anchor and the edge.
 *
 * ⚠️ THE ANCHOR AND THE ROTATION MOVE TOGETHER. They were 75/80 at a 30 degree
 * tilt; dropping to 7 shrank the rotated box from 42% of the frame's width to
 * 32%, which at the old anchor would have left the badge sitting 8.8% off the
 * right edge instead of 3.3% — drifting out of the corner it is meant to be
 * in, without either number looking wrong on its own. Change one, redo the sum
 * for the other.
 *
 * Measured against the tightest case (a small carousel card on a phone, where
 * the price strip is proportionally largest) these leave 3.8% clear on the
 * right and 6.4% at the bottom. Do not raise either without redoing that sum:
 * the frame clips, and a badge with its corner cut off looks like a bug rather
 * than a placement.
 *
 * The bottom margin is the larger of the two on purpose. In the full-screen
 * player the video's title sits along the bottom on its own scrim, and it is
 * drawn AFTER the badge — so a badge pushed lower does not overlap the title,
 * it goes under it.
 */
export const DEFAULT_STICKER_POSITION = { x: 80, y: 82 };

/**
 * The badge's width, as a PERCENTAGE of the video's own width — 28, meaning
 * 28%, which is three and a half steps on the standard scale.
 *
 * It went 24 -> 32 -> 28. The first move was a fix: a price is up to nine
 * characters — "$2,629.00" — and at 24% of a carousel card there was no room
 * for it at any legible size, so the card clipped its own price. The second
 * was taste, once the labels had come down far enough to make it safe.
 *
 * The whole badge scales with this now, labels included — see
 * `LABEL_REFERENCE_SIZE`. That is what makes it a taste knob rather than a
 * legibility one.
 *
 * ⚠️ `BASE_SPACING` is a number of PIXELS and this is a percentage. The two
 * are multiplied here only because the scale's three-and-a-half step and the
 * percentage wanted happen to be the same number, 28, and writing it this way
 * keeps the value legible as "three and a half steps" the way the rest of the
 * extension reads. It is NOT a length: never turn this into `sp(3.5)`. The
 * badge stays frame-relative, which is what keeps it matching the app's
 * position editor.
 *
 * The coupling is real, though — move `BASE_SPACING` off 8 and this silently
 * becomes a different percentage. If that ever happens, pin this to a literal.
 *
 * ⚠️ Must equal `DEFAULT_STICKER_SIZE` in the admin's `stickerOverlay.ts`. It
 * is what a media whose sticker was never sized draws at, in BOTH the app's
 * position editor and here — and the editor is the merchant's only preview of
 * this, so a badge that is one size there and another here makes the preview a
 * lie. Change the two together or not at all.
 */
export const DEFAULT_STICKER_SIZE = BASE_SPACING * 3.5;

/**
 * The size the label sizes are stated AT — the denominator of `scale`.
 *
 * ⚠️ Deliberately NOT `DEFAULT_STICKER_SIZE`, though it was until the default
 * came down, and the split is the point. `scale` used to be
 * `size / DEFAULT_STICKER_SIZE`, which made the default a denominator as well
 * as a default: lowering it would have left a badge at the new default with
 * `scale = 1` and therefore the SAME text on a smaller card — the labels would
 * not have followed the card down — while every media with an explicitly
 * stored size would have silently grown its text, because its number had not
 * changed but what it was divided by had.
 *
 * Against a fixed reference, the default is free to move: a badge at 28 gets
 * `scale = 0.875` and text 12.5% smaller, in proportion, and a merchant who
 * chose 32 keeps exactly the rendering they chose. Move THIS number only to
 * restyle every badge on every storefront at once.
 */
export const LABEL_REFERENCE_SIZE = BASE_SPACING * 4;
const MIN_STICKER_SIZE = 12;
const MAX_STICKER_SIZE = 40;

/**
 * Degrees, clockwise — a tilt, not a free spin.
 *
 * Enough to read as something stuck ONTO the video rather than composited into
 * it, and not so much that it reads as the point. The badge carries a price
 * the shopper has to actually read, and text on a noticeable slant is text
 * they read more slowly.
 *
 * ⚠️ Paired with `DEFAULT_STICKER_POSITION` — see the note there. A rotation
 * change resizes the badge's bounding box, which moves how close its anchor
 * can sit to the corner.
 */
export const DEFAULT_STICKER_ROTATION = 7;
const MIN_STICKER_ROTATION = -30;
const MAX_STICKER_ROTATION = 30;

/** Everything the badge needs, with every "never chose" already resolved. */
export interface ResolvedSticker {
  product: SJEProduct;
  /**
   * How many OTHER products are tagged on this media — what the badge's "+N"
   * chip counts. `0` draws no chip.
   *
   * The badge shows one product, the pinned one; a video can carry a whole
   * outfit. This is the rest of it, and it is the difference between a badge
   * that looks like the video's only product and one that says there is more
   * to see.
   */
  others: number;
  /** Percentages of the frame. The badge is centred on this point. */
  x: number;
  y: number;
  /** Percentage of the frame's width. */
  size: number;
  /** Degrees clockwise. */
  rotation: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * A stored number, or the default when it was never set.
 *
 * Clamped as well as defaulted: these arrive from a metafield, and the app's
 * sliders are not the only thing that can have written one.
 */
function number(value: unknown, fallback: number, low: number, high: number): number {
  return typeof value === "number" && isFinite(value)
    ? clamp(value, low, high)
    : fallback;
}

/**
 * The product pinned to this media: the merchant's explicit choice, and
 * failing that the first tagged product.
 *
 * A `stickyProductId` naming a product that has since been UNTAGGED is treated
 * as no choice at all rather than as a missing product — untagging is the
 * merchant saying they no longer want it there, so the fallback applies again.
 *
 * Mirrors `stickyProduct()` in the admin, so the badge the storefront draws is
 * the one the app's editor previewed.
 */
export function stickyProduct(media: SJEMedia): SJEProduct | null {
  const products = media.products ?? [];

  const chosen = media.stickyProductId
    ? products.find((product) => product.id === media.stickyProductId)
    : undefined;

  return chosen ?? products[0] ?? null;
}

/**
 * The badge to draw over `media`, or `null` for no badge at all.
 *
 * Only two things say "no badge": the merchant switching it off, and there
 * being no product to show. Everything else has a default.
 *
 * `showSticker` follows the admin's `parseAppMedia`, where an absent value
 * reads as ON — so a media saved before the flag existed keeps showing what
 * the app shows for it. (The comment on `AppMedia.showSticker` in the admin
 * says the opposite, that unset means hidden; the code there is what actually
 * runs, and matching the code is what keeps the two views the same.)
 */
export function stickerOf(media: SJEMedia): ResolvedSticker | null {
  if (media.showSticker === false) return null;

  const product = stickyProduct(media);
  if (!product) return null;

  const position = media.stickerPosition;

  return {
    product,
    // Everything tagged, less the one on the badge. `stickyProduct` always
    // returns a member of the list, so this can never be off by one.
    others: Math.max(0, (media.products?.length ?? 0) - 1),
    // Positions are clamped to the frame rather than the sliders' range: the
    // editor lets a badge sit anywhere, edges included.
    x: number(position?.x, DEFAULT_STICKER_POSITION.x, 0, 100),
    y: number(position?.y, DEFAULT_STICKER_POSITION.y, 0, 100),
    size: number(media.stickerSize, DEFAULT_STICKER_SIZE, MIN_STICKER_SIZE, MAX_STICKER_SIZE),
    rotation: number(
      media.stickerRotation,
      DEFAULT_STICKER_ROTATION,
      MIN_STICKER_ROTATION,
      MAX_STICKER_ROTATION,
    ),
  };
}

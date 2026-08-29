// src/lib/settings.ts
// The block's own theme-editor settings, as the components see them.
//
// These are NOT the widget. A widget is the merchant's content, saved in the
// app and shared by every block that shows it; these are one block's
// appearance, saved in the theme and belonging to that one placement. Two
// carousels of the same widget can have arrows in different places, which is
// why they arrive per mount point rather than on `window.SJE`.
//
// `sje-mount` writes `block.settings` onto the mount point as JSON. Keys are
// therefore the snake_case ids from the `{% schema %}`, and everything here is
// optional-by-attitude for the same reason as `sje.ts`: a block saved before a
// setting existed simply has no key for it, and a merchant who never opened
// the block has no saved settings at all.

/** Where the scroll arrows sit under a carousel, or `hidden` for no arrows. */
export type ArrowPosition = "hidden" | "left" | "center" | "right";

/**
 * How the full-screen player presents the video's products.
 *
 * - `sticker`     the same badge the preview card draws, pinned to the frame
 *                 where the merchant placed it.
 * - `free-scroll` a rail of every tagged product, scrolled independently of
 *                 the video. NOT BUILT YET — see `Lightbox`.
 * - `hidden`      nothing; just the video.
 *
 * Separate from `stickerOnPreview` because the two views are not the same
 * problem. A card is one of a dozen in a scrolling row and a badge on each can
 * read as clutter; the player is one video the shopper chose, where there is
 * room to show the whole outfit.
 */
export type PlayerProducts = "sticker" | "free-scroll" | "hidden";

export interface SJESettings {
  arrowPosition: ArrowPosition;
  /**
   * The arrow button's diameter as a PERCENTAGE of the standard spacing token
   * — 500 means five spacings, which is 40px on desktop and 30px on a phone.
   *
   * A percentage rather than a diameter in px so the control scales with the
   * rest of the widget at the breakpoint, instead of staying stubbornly the
   * same size while everything around it tightens. `Carousel` turns it into
   * pixels against the live token; see `lib/tokens.ts`.
   */
  arrowScale: number;
  /**
   * Whether the sticker product's badge shows on the PREVIEW videos — the
   * short autoplay clips on the cards in the row.
   *
   * The full-screen player has its own control, `playerProducts`, because it
   * has more than two answers there.
   *
   * Per PLACEMENT, not per media — `AppMedia.showSticker` in the app is the
   * merchant saying "this video has no badge at all", and it still wins. This
   * one is a merchant saying "not in THIS carousel".
   */
  stickerOnPreview: boolean;
  /** How the full-screen player shows the video's products. */
  playerProducts: PlayerProducts;
}

const ARROW_POSITIONS: readonly string[] = ["hidden", "left", "center", "right"];
const PLAYER_PRODUCTS: readonly string[] = ["sticker", "free-scroll", "hidden"];

/** Matches the `{% schema %}` defaults, for a block that has never been saved. */
export const DEFAULT_SETTINGS: SJESettings = {
  arrowPosition: "center",
  arrowScale: 500,
  stickerOnPreview: true,
  playerProducts: "sticker",
};

/**
 * The range the size setting is clamped to, as a percentage of the spacing
 * token — 200% to 1000%, so 16px to 80px at the desktop base.
 *
 * The schema states the same numbers, so the editor cannot send anything
 * outside them — but the value also arrives through a `data-` attribute anyone
 * can edit, and a negative or absurd diameter should not be able to break the
 * row's layout.
 */
const MIN_ARROW_SCALE = 200;
const MAX_ARROW_SCALE = 1000;

/** The mount point's attribute, in `dataset` spelling. */
const ATTRIBUTE = "sjeSettings";

function asArrowPosition(value: unknown): ArrowPosition {
  return typeof value === "string" && ARROW_POSITIONS.includes(value)
    ? (value as ArrowPosition)
    : DEFAULT_SETTINGS.arrowPosition;
}

/**
 * A checkbox setting, defaulting to ON.
 *
 * Only an explicit `false` turns it off — the same rule `parseWidget` uses for
 * `enabled` in the app. A block saved before this setting existed has no key
 * for it at all, and a badge that was showing should not vanish because the
 * app learned a new option.
 */
function asFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  // Liquid writes a real boolean, but a hand-edited attribute could say
  // "false" as a string, which is truthy and would read as ON.
  if (value === "false") return false;
  if (value === "true") return true;
  return fallback;
}

function asPlayerProducts(value: unknown): PlayerProducts {
  return typeof value === "string" && PLAYER_PRODUCTS.includes(value)
    ? (value as PlayerProducts)
    : DEFAULT_SETTINGS.playerProducts;
}

function asArrowScale(value: unknown): number {
  // Liquid writes a range setting as a number, but a hand-edited attribute
  // could be anything, so it is coerced rather than trusted.
  const scale = typeof value === "number" ? value : Number(value);
  if (!isFinite(scale)) return DEFAULT_SETTINGS.arrowScale;
  return Math.round(Math.min(MAX_ARROW_SCALE, Math.max(MIN_ARROW_SCALE, scale)));
}

/**
 * Read one mount point's settings, falling back to the defaults for anything
 * missing or malformed.
 *
 * Never throws: a block whose settings failed to serialise should cost the
 * merchant their arrow placement, not the whole widget.
 */
export function readSettings(node: HTMLElement): SJESettings {
  const raw = node.dataset[ATTRIBUTE];
  if (!raw) return DEFAULT_SETTINGS;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.warn("[SJE] could not read block settings — using defaults");
    return DEFAULT_SETTINGS;
  }

  return {
    arrowPosition: asArrowPosition(parsed.arrow_position),
    arrowScale: asArrowScale(parsed.arrow_scale),
    stickerOnPreview: asFlag(parsed.sticker_on_preview, DEFAULT_SETTINGS.stickerOnPreview),
    playerProducts: asPlayerProducts(parsed.player_products),
  };
}

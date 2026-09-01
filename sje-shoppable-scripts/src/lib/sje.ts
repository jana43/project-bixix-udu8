// src/lib/sje.ts
// The bridge between Liquid and the components.
//
// The blocks put everything a component needs on `window.SJE` before any of
// this loads: the widget itself, and every media it plays. That is why a
// component never fetches — the data is already inlined in the page by the
// time the script is asked for.
//
// Shapes mirror what `saveWidgets.ts` / `saveAppMedia.ts` write into the
// app-installation metafields, read back through `app.metafields` in Liquid.
// Every field is optional-by-attitude: a widget saved by an older version of
// the app may be missing anything, so components must not assume.

import { shuffleOrder } from "./shuffleOrder";
import type { Money } from "./money";

export interface SJEProduct {
  id: string;
  title: string;
  handle: string;
  imageUrl?: string;
  price?: Money;
  /**
   * What the product used to cost, when it is on sale.
   *
   * LIVE ONLY. The app's stored copy of a tagged product has no such field —
   * a sale that started after the merchant tagged the product would not be in
   * it anyway, and a struck-through price that is out of date is worse than
   * none. `lib/products.ts` sets this from `/products/{handle}.js`, and only
   * when the store says it is genuinely higher than the current price.
   */
  compareAtPrice?: Money;
  /**
   * Every variant the shopper can buy, in the storefront's own order.
   *
   * LIVE ONLY, like `compareAtPrice`, and for a stronger reason than staleness
   * — the app's stored copy has never held variants at all. The product sheet
   * cannot offer an add-to-cart button without one of these: `/cart/add.js`
   * takes a VARIANT id, and a product id means nothing to it.
   *
   * Absent means "not asked yet, or the request failed". EMPTY means the store
   * answered and there is genuinely nothing to sell.
   */
  variants?: SJEVariant[];
  /** LIVE ONLY. Whether any variant at all is in stock. */
  available?: boolean;
  /**
   * Every photo on the product, in the storefront's own order.
   *
   * LIVE ONLY. The app's stored copy keeps ONE image — enough for a badge and
   * a list row, which is all it was ever asked for. `imageUrl` stays the
   * single-image fallback for a sheet opened before this lands.
   */
  images?: string[];
  /**
   * The product description as PLAIN TEXT, paragraphs and bullets preserved
   * as line breaks.
   *
   * LIVE ONLY, and already stripped: `/products/{handle}.js` returns HTML the
   * merchant typed, and `lib/products.ts` runs it through `DOMParser` at the
   * boundary so nothing downstream ever handles markup. See `plainText` there
   * for why that is not simply a `dangerouslySetInnerHTML`.
   */
  description?: string;
}

/**
 * One buyable variant, as `/products/{handle}.js` reports it.
 *
 * `title` is the option values already joined — "Small / Red" — which is why
 * the sheet offers variants as a flat list of chips rather than one control
 * per option. It is `"Default Title"` on a product with no options, and the
 * sheet knows to draw no picker at all in that case.
 */
export interface SJEVariant {
  /** The NUMERIC storefront variant id. What `/cart/add.js` wants. */
  id: number;
  title: string;
  available: boolean;
  price?: Money;
  compareAtPrice?: Money;
  /** This variant's own photo, when it has one. */
  imageUrl?: string;
}

/**
 * One transcode of a video. Shopify makes a 480p, a 720p and a 1080p mp4 of
 * every upload, and the app stores all of them so the storefront can pick by
 * the size it is actually drawing into rather than always taking the largest.
 */
export interface SJEVideoRendition {
  url: string;
  format?: string;
  width?: number;
  height?: number;
}

export interface SJEMedia {
  id: string;
  fileGid: string;
  kind: "video" | "image";
  title: string;
  url: string;
  /** Largest first; `url` is its head. Absent on media saved before the ladder. */
  sources?: SJEVideoRendition[];
  thumbnailUrl?: string;
  durationSeconds?: number;
  previewStartSeconds?: number;
  previewFileGid?: string;
  previewUrl?: string;
  /** The clip's own ladder — `sources`, for `previewUrl`. */
  previewSources?: SJEVideoRendition[];
  stickyProductId?: string;
  products?: SJEProduct[];
  stickerPosition?: { x: number; y: number };
  stickerSize?: number;
  stickerRotation?: number;
  showSticker?: boolean;
  addedAt?: string;
}

/**
 * A widget and everything it needs to draw itself. Nothing here is a
 * reference to look up somewhere else — that is the whole point of the copy
 * the app stores on the widget.
 */
export interface SJEWidget {
  id: string;
  name: string;
  layout: string;
  enabled: boolean;
  /**
   * Every media this widget plays, IN PLAY ORDER — the order the merchant
   * arranged in the app.
   *
   * There is no companion `mediaIds`: this array is the order, and a second
   * list of ids beside it would be one more thing that can disagree with it.
   * An id whose media has gone simply has no entry.
   */
  media: SJEMedia[];
  /**
   * ⚠️ There is no `shuffle` here any more. It was a property of the WIDGET,
   * saved in the app; it is now a property of the BLOCK, set in the theme
   * customizer — `SJESettings.shuffle`. The metafield of a widget saved before
   * the move still carries the old field; nothing reads it, and `sje-mount`
   * no longer copies it onto the page.
   *
   * The move follows the split this whole file is built on: a widget is the
   * merchant's CONTENT and every block showing it shows the same thing, while
   * how it is presented belongs to the placement. Two carousels of one widget
   * can now differ in this as they already could in everything else.
   */
  updatedAt?: string;
  version?: number;
}

/** How a given layout's script is doing. Set by the Liquid loader. */
export type SJEScriptStatus = "idle" | "loading" | "loaded" | "error";

export interface SJEGlobal {
  /** Every widget on the page, by id. Each carries its own medias. */
  widgets: Record<string, SJEWidget>;
  /** Keyed by layout — `carousel`, `story-bar`, … — so one layout's script
   *  loading never makes another think it has already run. */
  scripts: Record<string, SJEScriptStatus>;
  booted?: boolean;
  load?: (layout: string) => void;
  /**
   * Whether any block on the page has a full-screen player open.
   *
   * Lives HERE, on the one object every bundle shares, and not in a module of
   * its own — each layout is built as a separate flat file with its own scope,
   * so a module variable would be one copy per layout and a story bar's player
   * would not reach a carousel's previews. See `lib/playback.ts`.
   *
   * Absent until the first player opens; `playback.ts` creates it.
   */
  playback?: import("./playback").PlaybackState;
  /**
   * Whether a floating bubble has already claimed this page.
   *
   * The bubble is an app BLOCK, so nothing stops a merchant adding it twice —
   * to a header and a footer, say — and two of them would stack in the same
   * corner, each with its own close button. It was briefly an app embed, which
   * cannot be added twice at all; that was given up because an embed appears
   * on EVERY page, and choosing pages matters more than the guarantee. This
   * flag buys the guarantee back: the first bubble to mount draws, the rest
   * draw nothing.
   *
   * Here rather than in a module variable for the same reason as `playback`:
   * bundles are built separately and a module variable is one copy each. This
   * one is only ever touched by `sje-bubble.js`, but the rule is worth keeping
   * uniform.
   */
  bubbleClaimed?: boolean;
}

declare global {
  interface Window {
    SJE?: SJEGlobal;
  }
}

/**
 * The global, created if a block has not already. A component can be loaded
 * in isolation (a stray script tag, a dev page), so this never assumes the
 * Liquid ran first.
 */
export function sje(): SJEGlobal {
  const existing = window.SJE;
  if (existing) {
    existing.widgets ??= {};
    existing.scripts ??= {};
    return existing;
  }

  const created: SJEGlobal = { widgets: {}, scripts: {} };
  window.SJE = created;
  return created;
}

/** A widget by id, or `null` when the page never registered it. */
export function widget(id: string): SJEWidget | null {
  return sje().widgets[id] ?? null;
}

/**
 * The media a widget plays, in the order it plays them.
 *
 * That is `media` as stored — the order the merchant arranged in the app —
 * unless `shuffle` is on, which OVERRIDES it with a random order drawn once
 * for this page load. Shuffle wins: the arrangement is still there and still
 * returns the moment shuffle is switched off, but while it is on nothing else
 * decides the order.
 *
 * ⚠️ `shuffle` is the BLOCK's, passed in, not the widget's. It used to be a
 * field on the widget and moved to the theme customizer; a caller that forgets
 * to pass it gets the merchant's arrangement, which is the safe way to be
 * wrong. See the note where the field used to be.
 *
 * The non-shuffled case hands back the stored array itself rather than a copy,
 * so a component calling this every render compares equal every render.
 *
 * The random order is memoised per WIDGET, not per block — so two shuffled
 * blocks of the same widget on one page agree with each other, which reads as
 * one decision rather than two rolls of the dice.
 */
export function widgetMedia(w: SJEWidget, shuffle = false): SJEMedia[] {
  const media = w.media ?? [];
  if (!shuffle || media.length < 2) return media;

  const byId = new Map(media.map((m) => [m.id, m]));
  return shuffleOrder(
    w.id,
    media.map((m) => m.id),
  ).flatMap((id) => {
    const m = byId.get(id);
    return m ? [m] : [];
  });
}

/**
 * The rungs a CARD takes, in order of preference.
 *
 * 720 first, then 480. A card is a 9:16 tile a few hundred pixels wide at
 * most — 1080p is more picture than it can draw, and the whole point of the
 * preview clip is that it costs a shopper as little as possible to autoplay
 * one on every card in a row. 720p is the rung that still looks right on a
 * high-density phone; 480p is the one worth having when 720 is missing.
 */
export const CARD_RUNGS = [720, 480];

/**
 * The rungs a STORY CIRCLE takes. 480 first, and 720 only if there is no 480.
 *
 * A circle is a fraction of a card: 72px across by default, and 160px at the
 * largest setting the schema allows. A portrait 480p encode is about 264px
 * wide, so even the biggest circle on a 2x screen is asking for 320 device
 * pixels of a 264-wide source — a touch soft at that one extreme, and
 * comfortably native everywhere else. Against that: a story bar shows far
 * more thumbnails at once than a carousel does, and every one of them is a
 * decoder and a stream. The smaller rung is the right trade here in a way it
 * would not be on a card.
 *
 * ⚠️ Both ladders are matched on HEIGHT, which is the rung label in BOTH
 * orientations: a portrait 1080p is 596x1080 and a landscape one is 1920x1080.
 * Matching the larger dimension would read a landscape 1080p as "1920", and
 * the smaller would read the portrait one as "596".
 */
export const CIRCLE_RUNGS = [480, 720];

/**
 * The rungs a BANNER takes: the largest first.
 *
 * The opposite end of the ladder from `CIRCLE_RUNGS`, and for the opposite
 * reason. A banner is the widest thing this extension draws — a full-bleed
 * section, often the first thing on the page — and it plays the WHOLE video
 * rather than a three-second clip, so it is the one place where the largest
 * encode is the right default and a soft one is immediately obvious.
 */
export const BANNER_RUNGS = [1080, 720];

/**
 * The FULL video, at the largest rung asked for that the media actually has.
 *
 * ⚠️ `sources`, not `previewSources` — the whole video, not the short clip
 * every other layout loops. `previewUrlOf` below is the one for thumbnails,
 * and the two are easy to mix up: they have the same shape and differ only in
 * which ladder they read.
 *
 * `undefined` for a media that is an IMAGE. `url` on one of those is the
 * picture, not a video, and handing it to a `video` element gets a broken
 * element rather than a still — the caller already has `posterOf` for that.
 */
export function videoUrlOf(
  media: SJEMedia,
  rungs: readonly number[] = BANNER_RUNGS,
): string | undefined {
  if (media.kind !== "video") return undefined;

  const ladder = media.sources ?? [];

  for (const rung of rungs) {
    const match = ladder.find((source) => source.height === rung && source.url);
    if (match) return match.url;
  }

  // The ladder's head is the largest, so a media that only ever got one
  // encode still plays. `url` is the last resort, for anything saved before
  // the ladder existed.
  return ladder[0]?.url || media.url;
}

/**
 * The clip a thumbnail autoplays, at the smallest rung it asked for that the
 * media actually has.
 *
 * Falls through `rungs` and then, if the video has none of them, takes the
 * ladder's head — which is the largest, so a media that only ever got a 1080p
 * encode still plays. `previewUrl` is the last resort: it is what a media
 * saved before the ladder existed has, and it is always the ladder's head
 * anyway on one that has both.
 */
export function previewUrlOf(
  media: SJEMedia,
  rungs: readonly number[] = CARD_RUNGS,
): string | undefined {
  const ladder = media.previewSources ?? [];

  for (const rung of rungs) {
    const match = ladder.find((source) => source.height === rung && source.url);
    if (match) return match.url;
  }

  return ladder[0]?.url || media.previewUrl;
}

/**
 * The trailing numeric part of a Shopify id.
 *
 * ⚠️ The two sides of a product comparison are written differently and
 * always have been. The app stores a tagged product's id as the picker gave
 * it — `gid://shopify/Product/123` — while Liquid's `product.id` on a product
 * page is the bare `123`. Comparing them as strings is always false, silently,
 * and the symptom is a product row that finds nothing tagged with the product
 * it is standing on.
 *
 * Everything after the last slash, so a bare id passes through untouched.
 */
export function numericId(id: string): string {
  const cut = id.lastIndexOf("/");
  return cut === -1 ? id : id.slice(cut + 1);
}

/** Whether `media` is tagged with the product `productId` refers to. */
export function taggedWith(media: SJEMedia, productId: string): boolean {
  const wanted = numericId(productId);
  return (media.products ?? []).some((product) => numericId(product.id) === wanted);
}

/** The poster to show before anything plays. */
export function posterOf(media: SJEMedia): string | undefined {
  return media.thumbnailUrl || (media.kind === "image" ? media.url : undefined);
}

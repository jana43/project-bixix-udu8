// src/lib/shopify.ts
// The three things the storefront tells us about itself.
//
// `window.Shopify` is set by the platform on every storefront page, and by
// nothing at all on the Vite dev page — so every read here is guarded and
// every one has an answer for "not on a storefront".
//
// This exists because three separate modules were reaching for the same
// globals: `products.ts` for the Ajax URL and the presentment currency,
// `ProductRail` for a product link, and `cart.ts` for both. A fourth copy of
// `window.Shopify?.routes?.root || "/"` is a fourth place to forget the
// fallback.

declare global {
  interface Window {
    /** Set by Shopify on every storefront page. Absent on the Vite dev page. */
    Shopify?: {
      /** `{ root: "/" }`, or `"/en-gb/"` on a localised or market-scoped store. */
      routes?: { root?: string };
      currency?: { active?: string };
      /**
       * `true` inside the theme editor's preview, absent everywhere else.
       *
       * The Liquid half of this is `request.design_mode`, which the blocks
       * already use to decide whether to explain themselves to a merchant. This
       * is the same question asked from a script, and Shopify sets it on every
       * editor preview.
       */
      designMode?: boolean;
    };
  }
}

/**
 * The prefix every storefront URL has to carry.
 *
 * ⚠️ Never hardcode `"/"`. `Shopify.routes.root` holds the locale or market
 * prefix — `/en-gb/`, `/fr/` — and a request built without it 404s on every
 * localised storefront, which is exactly the kind of bug that never shows up
 * on the shop it was developed against.
 *
 * Always ends in a slash, so callers concatenate directly.
 */
export function storeRoot(): string {
  return window.Shopify?.routes?.root || "/";
}

/** A product's page. `handle` is the slug the storefront routes on. */
export function productUrl(handle: string): string {
  return `${storeRoot()}products/${encodeURIComponent(handle)}`;
}

/**
 * The currency the shopper is actually being charged in.
 *
 * `Shopify.currency.active` over anything stored, because the two can
 * disagree: the app's copy of a product was written in the shop's own
 * currency, and a shopper browsing a market in another one is quoted — and
 * charged — in theirs. Ajax prices are already converted, so pairing one with
 * a stored code would print the right number under the wrong symbol.
 */
export function activeCurrency(fallback?: string): string | undefined {
  return window.Shopify?.currency?.active || fallback;
}

/**
 * Whether this is the theme editor's preview rather than a real storefront.
 *
 * For anything a SHOPPER dismisses. A merchant clicking a close button in the
 * editor is looking at the thing they are configuring, not asking never to see
 * it again — and a dismissal remembered there outlives every settings change
 * and every re-render, so the bubble they were working on simply never comes
 * back and the block reads as broken. See `Bubble`.
 *
 * ⚠️ Not a substitute for `request.design_mode` in Liquid. That decides what
 * is RENDERED, and has to, because a script has not loaded at that point.
 */
export function inDesignMode(): boolean {
  return window.Shopify?.designMode === true;
}

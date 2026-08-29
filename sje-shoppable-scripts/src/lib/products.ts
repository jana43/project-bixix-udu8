// src/lib/products.ts
// Live product data for the sticker badges.
//
// The widget's metafield carries a COPY of each tagged product — title, image,
// price — captured when the merchant tagged it. That copy is what made the
// badge drawable with no request at all, and it is also a snapshot: a product
// repriced, restocked or re-photographed since is still showing yesterday's
// number. A price is the one thing on a storefront that must not be stale.
//
// So the badge asks the store. The stored copy stays as the fallback for a
// request that fails, and as the source of the `handle` the request needs.
//
// ── Why `/products/{handle}.js` ──
//
// It is the theme Ajax API: same origin, no token, no app proxy, and it is
// already how every theme fetches a product client-side. The Storefront
// GraphQL API would be the richer answer and cannot be used here — it needs a
// public access token, and a theme app extension has nowhere to keep one that
// is not simply readable in the page source.
//
// Prices come back as INTEGER CENTS in the buyer's active presentment
// currency, which is why the divide below and why the currency is read off
// `Shopify.currency` rather than trusted from the stored copy.
import { useEffect, useState } from "preact/hooks";
import { activeCurrency, storeRoot } from "./shopify";
import type { Money } from "./money";
import type { SJEProduct, SJEVariant } from "./sje";

/** The fields this reads off the Ajax API's response. It returns far more. */
interface AjaxProduct {
  title?: string;
  /** Integer cents, active presentment currency. */
  price?: number;
  /**
   * The was-price, in cents, or `null` when the product is not on sale.
   * `compare_at_price` is the selected variant's; `compare_at_price_min` is
   * the lowest across variants and is the fallback for a product whose first
   * variant happens not to be discounted.
   */
  compare_at_price?: number | null;
  compare_at_price_min?: number | null;
  featured_image?: string | null;
  /** Every photo, protocol-relative, in the storefront's order. */
  images?: string[];
  /** HTML, as the merchant typed it. Never rendered as markup — see `plainText`. */
  description?: string;
  available?: boolean;
  variants?: AjaxVariant[];
}

/** One entry of `variants`. Again, a fraction of what comes back. */
interface AjaxVariant {
  /** Numeric, and what `/cart/add.js` takes. */
  id?: number;
  /** The option values joined — "Small / Red", or "Default Title". */
  title?: string;
  available?: boolean;
  price?: number;
  compare_at_price?: number | null;
  /** An object here, unlike the product's, which is a bare string. */
  featured_image?: { src?: string | null } | null;
}

/**
 * Every product ever asked for, by product id — the hash map that makes this
 * one request per product rather than one per badge.
 *
 * ⚠️ It holds the PROMISE, not the product, and that is the whole point. A
 * carousel of twelve videos tagging the same product mounts twelve badges in
 * the same tick, before any response has landed. A map of resolved values
 * would still be empty at that moment and would fire twelve requests; a map of
 * promises hands the other eleven the first one's.
 *
 * Module scope, not component state, so it also survives the Lightbox opening
 * over a carousel that has already fetched — the full-screen badge is drawn
 * from cache, with no second request and no flash of skeleton.
 *
 * A failed request caches `null` and is not retried for the life of the page.
 * That is deliberate: the badge has the stored copy to fall back on, and a
 * product that 404s once will 404 every time it is scrolled past.
 */
const CACHE = new Map<string, Promise<SJEProduct | null>>();

/** `//cdn.shopify.com/…` is what the Ajax API returns. `src` wants a scheme. */
function absolute(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith("//") ? `https:${url}` : url;
}

/** The first of `values` that is a usable number. */
function firstNumber(...values: (number | null | undefined)[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && isFinite(value)) return value;
  }
  return undefined;
}

/** The stored copy with whatever the store just said layered over it. */
function merged(stored: SJEProduct, data: AjaxProduct): SJEProduct {
  const image = absolute(data.featured_image ?? data.images?.[0]);
  const currencyCode = activeCurrency(stored.price?.currencyCode);
  const hasPrice = typeof data.price === "number" && isFinite(data.price);

  // The was-price, but only when it really is one. A `compare_at_price` equal
  // to or below `price` is what Shopify returns for a product that is NOT on
  // sale, and striking through a number the shopper is being charged anyway is
  // worse than showing nothing.
  const wasCents = firstNumber(data.compare_at_price, data.compare_at_price_min);
  const onSale = hasPrice && wasCents !== undefined && wasCents > data.price!;

  return {
    ...stored,
    title: data.title || stored.title,
    imageUrl: image ?? stored.imageUrl,
    // Both halves or neither: an amount without a currency cannot be
    // formatted, so in that case the stored pair is left alone.
    price:
      hasPrice && currencyCode
        ? { amount: (data.price! / 100).toFixed(2), currencyCode }
        : stored.price,
    compareAtPrice:
      onSale && currencyCode
        ? { amount: (wasCents! / 100).toFixed(2), currencyCode }
        : undefined,
    available: data.available,
    // Absolutised the same way as `imageUrl`, and dropped where a URL is
    // missing rather than left as a hole in the gallery.
    images: (data.images ?? []).flatMap((url) => {
      const absolute_ = absolute(url);
      return absolute_ ? [absolute_] : [];
    }),
    description: plainText(data.description),
    // An EMPTY array when the store answered and had nothing to sell, which
    // is a different thing from `undefined` — see `SJEProduct.variants`. The
    // sheet tells the two apart to decide between "sold out" and "still
    // loading".
    variants: (data.variants ?? []).flatMap((variant) =>
      variantOf(variant, currencyCode),
    ),
  };
}

/**
 * The blocks whose ends should read as a line break once the markup is gone.
 *
 * `br` is in here for the obvious reason; the rest are because a description
 * is very often a stack of paragraphs or a bullet list, and running all of it
 * together into one block of prose loses the shape the merchant wrote.
 */
const BLOCKS = "br, p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote";

/**
 * A product description as text, from the HTML the store returns.
 *
 * ── Why not just render the HTML ──
 *
 * `dangerouslySetInnerHTML` is the obvious answer and it is the wrong one
 * here, for two separate reasons.
 *
 * The layout one is the reliable one: a description is whatever the merchant
 * pasted into the admin, which in practice means tables, full-width images,
 * inline `style` attributes, iframes and the occasional entire landing page.
 * Any of those dropped into a 78%-height sheet on a phone breaks it, and none
 * of them is something this widget can style around.
 *
 * The safety one is narrower but real: a description CAN carry a script tag,
 * and while the theme's own product page renders it raw, that is a page the
 * merchant is looking at, not an overlay this widget injects into every page
 * of the store.
 *
 * `DOMParser` answers both. The document it builds has no browsing context,
 * so nothing in it runs and nothing in it loads — it is inert markup being
 * read for its text, not a fragment being mounted.
 */
function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  // A very old browser, or a non-DOM environment such as the unit tests.
  if (typeof DOMParser !== "function") return undefined;

  const doc = new DOMParser().parseFromString(html, "text/html");

  doc.body.querySelectorAll(BLOCKS).forEach((element) => {
    // `after`, not `textContent +=`: this puts the break OUTSIDE the element,
    // so a nested block does not have its parent's newline land in the middle
    // of its own text.
    element.after(doc.createTextNode("\n"));
    // A bullet list that loses its bullets reads as run-on prose.
    if (element.tagName === "LI") element.prepend(doc.createTextNode("\u2022 "));
  });

  const text = (doc.body.textContent ?? "")
    // Every run of horizontal whitespace to one space — HTML source is full
    // of indentation, and none of it is the merchant's formatting. The
    // negated class is what keeps this from eating the newlines just added.
    .replace(/[^\S\n]+/g, " ")
    // Trim each line, now that its indentation has become a leading space.
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    // Nested blocks each contribute a newline, so a `div > p` yields two and
    // a deeply wrapped list yields a gap the size of a paragraph.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text || undefined;
}

/**
 * One Ajax variant, in the shape the sheet draws — or nothing at all.
 *
 * A variant with no numeric id is dropped rather than kept: the only thing the
 * sheet does with a variant is add it to the cart, and one that cannot be
 * added is a chip that fails when tapped.
 */
function variantOf(data: AjaxVariant, currencyCode?: string): SJEVariant[] {
  if (typeof data.id !== "number") return [];

  const cents = (value: number | null | undefined): Money | undefined =>
    typeof value === "number" && isFinite(value) && currencyCode
      ? { amount: (value / 100).toFixed(2), currencyCode }
      : undefined;

  const price = cents(data.price);
  const was = cents(data.compare_at_price);

  return [
    {
      id: data.id,
      title: data.title || "",
      // Absent reads as buyable: a variant the store did not describe should
      // not be hidden behind a "Sold out" the store never said.
      available: data.available !== false,
      price,
      // Only when it really is a was-price. Shopify returns a `compare_at`
      // equal to or below the price for a variant that is NOT on sale, and
      // striking through a number the shopper is being charged anyway is
      // worse than showing nothing.
      compareAtPrice:
        was && price && Number(was.amount) > Number(price.amount) ? was : undefined,
      imageUrl: absolute(data.featured_image?.src),
    },
  ];
}

async function load(product: SJEProduct): Promise<SJEProduct | null> {
  // The handle is the URL. A product tagged before handles were stored has no
  // way to be looked up, and falls back to its copy.
  if (!product.handle) return null;

  const response = await fetch(
    `${storeRoot()}products/${encodeURIComponent(product.handle)}.js`,
    { headers: { Accept: "application/json" } },
  );

  if (!response.ok) return null;
  return merged(product, (await response.json()) as AjaxProduct);
}

/** One product, from the cache or from the store. Never rejects. */
export function fetchProduct(product: SJEProduct): Promise<SJEProduct | null> {
  const cached = CACHE.get(product.id);
  if (cached) return cached;

  // `catch` before the map is written, so what is cached is a promise that
  // always resolves. A rejected one left in there would be re-thrown at every
  // later caller, and would trip an unhandled-rejection warning besides.
  const pending = load(product).catch(() => null);
  CACHE.set(product.id, pending);
  return pending;
}

export interface LiveProducts {
  /** Freshly fetched products, by product id. Missing means "not (yet) known". */
  byId: Map<string, SJEProduct>;
  /**
   * Whether every request in this batch has finished, successfully or not.
   *
   * The badge needs both this and `byId` to tell its two "no entry" cases
   * apart: still in flight, which draws a skeleton, versus finished and
   * failed, which falls back to the stored copy.
   */
  settled: boolean;
}

const NOTHING: LiveProducts = { byId: new Map(), settled: true };

/**
 * Fetch every product in one batch, and report when they are all in.
 *
 * `Promise.all` rather than one request per badge: the whole set is known up
 * front, so they go out together and the skeletons clear together instead of
 * the row popping one badge at a time.
 *
 * It cannot reject — `fetchProduct` swallows failures into `null` — so there
 * is no rejection path here. A `Promise.allSettled` would only wrap results
 * that are already never thrown.
 */
export function useLiveProducts(products: SJEProduct[]): LiveProducts {
  // The identity of the array changes on every render; the identity of the
  // SET it describes is what the effect actually depends on.
  const key = products.map((product) => product.id).join("|");

  // Lazily initialised to "not settled" when there is anything to fetch, so
  // the FIRST paint is already the skeleton. Starting from `NOTHING`
  // (`settled: true`) meant one render of the badge drawn from the stored
  // copy before the effect below could say otherwise — the stale price
  // flashing up for a frame, which is the exact thing the skeleton exists to
  // prevent.
  const [live, setLive] = useState<LiveProducts>(() =>
    products.length === 0 ? NOTHING : { byId: new Map(), settled: false },
  );

  useEffect(() => {
    if (products.length === 0) {
      setLive(NOTHING);
      return;
    }

    let current = true;
    // Anything already cached resolves in a microtask, so a re-render over the
    // same products shows its skeleton for one frame at most.
    setLive({ byId: new Map(), settled: false });

    void Promise.all(products.map(fetchProduct)).then((results) => {
      // The widget may have been torn down, or asked for a different set,
      // while these were in the air.
      if (!current) return;

      const byId = new Map<string, SJEProduct>();
      results.forEach((result, index) => {
        if (result) byId.set(products[index].id, result);
      });

      setLive({ byId, settled: true });
    });

    return () => {
      current = false;
    };
    // `products` is deliberately not a dependency — `key` is its stable
    // stand-in, and listing the array would re-run this on every render.
  }, [key]);

  return live;
}

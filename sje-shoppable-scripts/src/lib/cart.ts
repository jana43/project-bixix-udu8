// src/lib/cart.ts
// Adding a variant to the shopper's cart, from inside the player.
//
// ── Why the Ajax cart API ──
//
// `POST /cart/add.js` is same-origin, needs no token and no app proxy, and is
// the same endpoint every theme's own quick-add button uses. The alternative,
// a Storefront API cart, would need a public access token that a theme app
// extension has nowhere to keep out of the page source — and would build a
// SECOND cart beside the theme's, so the shopper's items would be split
// between two carts that never meet.
//
// ⚠️ Prices and ids here are the storefront's own: `id` is the numeric VARIANT
// id, not the product id, and not a GID. A product id sent to this endpoint is
// simply "not found".
import { numericProductId, trackAddToCart } from "./analytics";
import { storeRoot } from "./shopify";

/** What happened, in a shape the button can render without a try/catch. */
export type AddResult = { ok: true } | { ok: false; message: string };

/** Which video produced this add, and what it was worth. */
export interface AddSource {
  mediaId: string;
  /** The app's stored id — `gid://shopify/Product/123`. Normalised downstream. */
  productId: string;
  /** The variant's price, for the value this added to the cart. */
  value: number;
  /** Which placement it was played in, when the caller knows. */
  widgetId?: string;
}

/**
 * The cart attribute that credits a later checkout to a video.
 *
 * ⚠️ The leading underscore is load-bearing. Shopify treats an attribute whose
 * name begins with `_` as private: it travels through checkout and onto the
 * order, but is not printed on the order confirmation or shown as a
 * customer-entered note. Without it every merchant would see
 * `sje_source: 9f1c…` on their orders and reasonably ask what it was.
 */
const ATTRIBUTION_ATTRIBUTE = "_sje_source";

/**
 * Prefix for the per-product attribution attributes.
 *
 * One attribute per attributed product — `_sje_p7291…` — rather than one packed
 * blob under a single key. Three reasons, and the first is the one that decides
 * it:
 *
 *  - No value grows without bound. A shopper who adds eleven things writes
 *    eleven short values instead of one long one, and nothing has to guess where
 *    a platform limit on attribute length sits.
 *  - Re-adding the same product overwrites its own key. A packed list would have
 *    to be read, parsed, deduplicated and rewritten on every add, against a cart
 *    that another tab may have changed in the meantime.
 *  - The webhook reads it by name. Given an order line's product id it knows the
 *    exact key to look for, with no parsing at all.
 */
const PRODUCT_ATTRIBUTE_PREFIX = "_sje_p";

/**
 * How many products the cart will carry attribution for.
 *
 * A ceiling rather than a target: the attributes ride through checkout and onto
 * the order, and a cart with a hundred of them is a payload nobody benefits
 * from. Past this the earliest attributions are simply not written — the add
 * itself is unaffected, and the order still carries the order-level credit.
 */
const MAX_ATTRIBUTED_PRODUCTS = 20;

/**
 * The video and widget an attribution names, as one value.
 *
 * A dot rather than JSON: both halves are hex ids that cannot contain one, the
 * value stays short enough to read at a glance in the Shopify admin, and the
 * webhook's parse is a single `split`.
 */
function credit(mediaId: string, widgetId?: string): string {
  return widgetId ? `${mediaId}.${widgetId}` : mediaId;
}

/**
 * The last-resort message.
 *
 * The endpoint's own `description` is preferred wherever there is one — it is
 * localised to the storefront and says the useful thing ("All 3 Small are in
 * your cart", "Sold out"). This is for a network that never answered.
 */
const GENERIC_FAILURE = "Could not add to cart. Please try again.";

/**
 * Tell the theme its cart changed.
 *
 * ⚠️ Best-effort, and deliberately so. There is no standard event for this:
 * Dawn and its descendants use an internal pub/sub that is not reachable from
 * another script, other themes listen for `cart:refresh`, others poll, others
 * do nothing at all. So this fires the two most widely-listened-for events and
 * does not depend on either being heard.
 *
 * What the shopper actually gets told is OUR confirmation, in the sheet — see
 * `Toast` in `ProductSheet`. That works on every theme, which is exactly why
 * the feedback lives there rather than in the theme's drawer.
 */
function announce(): void {
  for (const name of ["cart:refresh", "sje:cart:added"]) {
    document.dispatchEvent(new CustomEvent(name, { bubbles: true }));
  }
}

/**
 * Stamp the cart with the video the shopper bought from.
 *
 * ── Why the cart and not the app's own record ──
 *
 * Attributing revenue means knowing which video a CHECKOUT came from, and
 * nothing on the storefront sees a checkout complete. The cart is the only thing
 * that survives the journey from the player to the thank-you page, so the credit
 * rides along on it.
 *
 * Cart attributes become the order's `note_attributes`, which is where the app's
 * `orders/create` webhook handler reads them back — see
 * `lib/shoppable_videos/parseOrderAttribution.ts` in the admin panel. Nothing is
 * stored in between: the cart carries the whole of it.
 *
 * ── Two attributions, answering two different questions ──
 *
 * `_sje_source` is the ORDER-level credit and is last-touch: a shopper who adds
 * from two videos overwrites the first with the second, and the whole order's
 * revenue lands on that one video and widget. That is what answers "which
 * placement is earning".
 *
 * `_sje_p<productId>` is the LINE-level credit, one per attributed product, and
 * it is not last-touch — each product remembers the video it was added from. It
 * is what answers "how much did this product sell through video", which the
 * order-level credit cannot: an order containing three products from three
 * videos has one source and three lines.
 *
 * ⚠️ Cart ATTRIBUTES, not line-item properties. A line property would show up
 * in the cart drawer of a great many themes, next to the product name, where a
 * shopper would read it as something they had chosen. Attributes are invisible
 * and — with the leading underscore — private.
 */
async function attribute(source: AddSource): Promise<void> {
  const value = credit(source.mediaId, source.widgetId);
  const attributes: Record<string, string> = { [ATTRIBUTION_ATTRIBUTE]: value };

  const productId = numericProductId(source.productId);
  if (attributed.has(productId) || attributed.size < MAX_ATTRIBUTED_PRODUCTS) {
    attributed.add(productId);
    attributes[`${PRODUCT_ATTRIBUTE_PREFIX}${productId}`] = value;
  }

  try {
    await fetch(`${storeRoot()}cart/update.js`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // ⚠️ `cart/update.js` MERGES the attributes it is given rather than
      // replacing the set, so sending one product's key leaves every previously
      // written key alone. Sending the full map instead would mean reading the
      // cart back first, and racing any other tab that added something since.
      body: JSON.stringify({ attributes }),
    });
  } catch {
    // The add already succeeded. Losing the attribute costs a revenue credit
    // and nothing the shopper can see, so it is never surfaced.
  }
}

/**
 * Products this tab has already written an attribution attribute for.
 *
 * Only there to bound `MAX_ATTRIBUTED_PRODUCTS` without reading the cart back on
 * every add. It is per-page and deliberately approximate: a shopper returning in
 * a new tab starts a fresh count, and the worst that costs is a few more
 * attributes on a cart that was already large.
 */
const attributed = new Set<string>();

/**
 * Add one variant to the cart. Never throws — every failure comes back as
 * `{ ok: false }` with something worth showing the shopper.
 */
export async function addToCart(
  variantId: number,
  quantity = 1,
  source?: AddSource,
): Promise<AddResult> {
  try {
    const response = await fetch(`${storeRoot()}cart/add.js`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: [{ id: variantId, quantity }] }),
    });

    if (response.ok) {
      if (source) {
        trackAddToCart(
          source.mediaId,
          source.productId,
          source.value * quantity,
          source.widgetId,
        );
        // Fire and forget: the shopper's confirmation must not wait on an
        // attribution write, and a cart that ends up without the attribute
        // costs a revenue credit, not a sale.
        void attribute(source);
      }
      announce();
      return { ok: true };
    }

    // A refusal — sold out, or more than the inventory allows — comes back as
    // 422 with a message written for the shopper. `description` is the long
    // form; `message` is the short one ("Cart Error").
    const body = (await response.json().catch(() => null)) as
      | { description?: string; message?: string }
      | null;

    return { ok: false, message: body?.description || body?.message || GENERIC_FAILURE };
  } catch {
    // Offline, or the request was blocked.
    return { ok: false, message: GENERIC_FAILURE };
  }
}

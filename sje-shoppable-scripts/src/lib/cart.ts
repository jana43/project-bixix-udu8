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
import { storeRoot } from "./shopify";

/** What happened, in a shape the button can render without a try/catch. */
export type AddResult = { ok: true } | { ok: false; message: string };

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
 * Add one variant to the cart. Never throws — every failure comes back as
 * `{ ok: false }` with something worth showing the shopper.
 */
export async function addToCart(variantId: number, quantity = 1): Promise<AddResult> {
  try {
    const response = await fetch(`${storeRoot()}cart/add.js`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: [{ id: variantId, quantity }] }),
    });

    if (response.ok) {
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

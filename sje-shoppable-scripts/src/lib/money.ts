// src/lib/money.ts
// Prices, as a shopper reads them.
//
// One copy, because there are now four places that print one — the sticker
// badge, the free-scroll card, the product sheet's list and its detail — and
// four copies of a currency formatter is four chances for the same product to
// be quoted two different ways on the same screen.
//
// ⚠️ Still paired by hand with `formatStickerPrice` in the ADMIN's
// `StickerBadge.tsx`. The two codebases do not build together; the app's
// position editor is the merchant's only preview of the storefront badge, so
// the two formatters have to agree. Change them together.

export interface Money {
  amount: string;
  currencyCode: string;
}

/**
 * The exact number the storefront charges, cents included — a badge rounding
 * $25.99 to $26 is quoting a price the shopper will not be asked for.
 *
 * ── Why `currencyDisplay` is stated ──
 *
 * The default is `"symbol"`, and "symbol" does not mean what it sounds like:
 * for a currency the locale considers ambiguous it yields the DISAMBIGUATED
 * form, which is often the three-letter code — "INR 1,234.00", "USD 25.99".
 * That is right in a table of many currencies and wrong on a badge over a
 * video, where there is room for a glyph and no room for anything else.
 * `"narrowSymbol"` asks for the shortest form there is.
 *
 * Tried in order because `narrowSymbol` is ES2020 and older engines throw
 * `RangeError` on the option rather than ignoring it — so a browser that does
 * not know it falls back to the old behaviour instead of showing no price at
 * all.
 */
export function formatPrice(price: Money): string {
  const amount = Number(price.amount);
  if (!isFinite(amount)) return price.amount;

  for (const currencyDisplay of ["narrowSymbol", "symbol"] as const) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: price.currencyCode,
        currencyDisplay,
      }).format(amount);
    } catch {
      // Either the option or the currency code was refused. The next pass
      // narrows the ask; the return below is for when nothing is accepted.
    }
  }

  // An unknown currency code, or a browser without `Intl`.
  return `${price.currencyCode} ${amount.toFixed(2)}`;
}

/**
 * How much off, as a whole percent, or `null` when there is no saving to
 * state.
 *
 * Rounded, not floored: a 14.6% saving reads as 15% everywhere else a shopper
 * sees one. `0` comes back as `null` rather than "-0%" — a compare-at that
 * rounds to nothing is a rounding artefact, not an offer.
 */
export function percentOff(priced: {
  price?: Money;
  compareAtPrice?: Money;
}): number | null {
  const now = Number(priced.price?.amount);
  const was = Number(priced.compareAtPrice?.amount);
  if (!isFinite(now) || !isFinite(was) || was <= now || was <= 0) return null;

  const off = Math.round(((was - now) / was) * 100);
  return off > 0 ? off : null;
}

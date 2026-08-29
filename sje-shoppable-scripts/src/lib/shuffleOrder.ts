// src/lib/shuffleOrder.ts
// A widget's random play order, decided once per page load.
//
// ── Why it is memoised ──
//
// Components call `widgetMedia()` in their render body, and a component
// re-renders whenever anything about it changes — a card entering the
// viewport, a lightbox opening. A fresh shuffle on every one of those would
// reorder the row under the shopper mid-scroll and remount every card. So the
// order is drawn ONCE per widget and kept for as long as the page lives.
//
// Per page load, not per save: the alternative is baking a random order into
// the metafield, which would give every shopper the same "random" order until
// the merchant next saved the widget. That is not shuffling, it is reordering.

interface Memo {
  /** The ids that produced `order`, to notice when the widget's medias change. */
  key: string;
  order: string[];
}

const MEMO = new Map<string, Memo>();

/**
 * `ids` in a random order, stable for this widget for the life of the page.
 *
 * Re-draws when the widget's medias themselves change — which happens in the
 * theme editor, where a settings change re-renders the block with new data
 * into the same page.
 */
export function shuffleOrder(widgetId: string, ids: string[]): string[] {
  const key = ids.join(",");
  const memo = MEMO.get(widgetId);
  if (memo && memo.key === key) return memo.order;

  // Fisher–Yates: every permutation equally likely. The naive
  // `sort(() => Math.random() - 0.5)` is not — it leans heavily towards the
  // original order, which on a five-media widget is very visible.
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  MEMO.set(widgetId, { key, order });
  return order;
}

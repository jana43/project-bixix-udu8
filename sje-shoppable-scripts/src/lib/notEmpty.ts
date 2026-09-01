// src/lib/notEmpty.ts
// One non-breaking space, and the styling that makes it cost nothing.
//
// ⚠️ LOAD-BEARING, and the single most repeated bug in this extension. Themes
// very commonly ship `div:empty { display: none }`, and an element that draws
// itself entirely with CSS — a skeleton, a spinner, a progress fill, a scrim —
// has no children by definition. The theme hides it, and it renders as
// nothing at all while every style on it is perfectly correct, which is the
// worst kind of bug to look at: the element is in the DOM, its computed styles
// are what you wrote, and it is not on the screen.
//
// It has now cost this codebase four separate rounds of debugging — the
// sticker badge's image skeleton, the Liquid card skeletons, the buffering
// spinner and the product sheet's scrim. Hence one module, one explanation,
// and one thing to spread.
//
// `font-size: 0` and `line-height: 0` are what keep the character from adding
// a line box to an element whose height is already stated. The character only
// has to EXIST; it must never be seen or measured.
//
// ⚠️ Use it on any element with no children of its own. If you are about to
// write `<div style={...} />`, it needs this.
//
// Same rule, and the same fix, as the `&nbsp;` in the Liquid skeletons — see
// CLAUDE.md §6.

/** Written as an escape, not typed literally: a raw U+00A0 is invisible in a
 *  diff and does not survive every tool that touches a file. */
export const NBSP = " ";

/** Spread onto the element that holds it. */
export const NOT_EMPTY = { fontSize: 0, lineHeight: 0 } as const;

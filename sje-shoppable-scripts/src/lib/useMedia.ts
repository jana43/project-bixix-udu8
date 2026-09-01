// src/lib/useMedia.ts
// A media query as a boolean, for the two questions a token cannot answer.
//
// Extracted from `Lightbox` when the stacked layout needed the same thing:
// the player asks about pointer type and reduced motion, and any layout with
// an animated transition asks about the second.
import { useEffect, useState } from "preact/hooks";

/**
 * A media query, as a boolean that keeps itself current.
 *
 * ⚠️ Never `(max-width: 749px)`. The breakpoint lives in `sje-widget.css` and
 * nowhere else, and `useTokenPx` is how this side asks about it — CLAUDE.md
 * §3. This hook is for the questions a token cannot answer.
 *
 * Read synchronously on the first render rather than in an effect, because the
 * swipe hint has to decide whether to appear before anything is painted.
 */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== "function") return;

    const list = matchMedia(query);
    const read = () => setMatches(list.matches);
    read();

    // Safari did not have `addEventListener` on a MediaQueryList until 14.
    if (list.addEventListener) {
      list.addEventListener("change", read);
      return () => list.removeEventListener("change", read);
    }

    list.addListener(read);
    return () => list.removeListener(read);
  }, [query]);

  return matches;
}

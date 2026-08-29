// src/lib/portal.tsx
// Render children into a node at the end of <body> instead of where they sit
// in the tree.
//
// ── Why a widget needs this at all ──
//
// A full-screen overlay rendered where its trigger lives is at the mercy of
// every ancestor between it and the page:
//
//   • The card it opens from is `overflow:hidden` — it would be clipped to a
//     9:16 tile before it ever got the chance to be full screen.
//   • `position:fixed` is only fixed to the viewport while no ancestor has a
//     `transform`, `filter`, `perspective`, `backdrop-filter`, `will-change`
//     or `contain:paint`. Any one of those makes the ancestor the containing
//     block instead, and themes put them on section wrappers freely — scroll
//     reveals, parallax, hover lifts.
//   • `z-index` only ranks an element among its siblings inside the nearest
//     stacking context. A section with `z-index:1` caps everything inside it
//     at 1, however large a number we write.
//
// Moving the overlay to <body> removes all three at once. That, not the
// z-index, is what actually puts it above the theme.
//
// ── Why not `createPortal` ──
//
// Preact 10 keeps `createPortal` in `preact/compat`, and pulling compat in
// would ride along with every entry bundle for one function. `render()` into
// a second root does the same job: Preact supports as many roots as you like,
// and reconciles each on its own.
import { render, type ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

export function Portal({ children }: { children: ComponentChildren }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Made during render rather than in the effect, so the effect below always
  // has a node to append. `useRef` holds it for the life of the component.
  if (hostRef.current === null && typeof document !== "undefined") {
    const host = document.createElement("div");
    // Not styled, only labelled: the host is a plain wrapper, and giving it
    // dimensions would make it a hit target of its own over the page.
    host.setAttribute("data-sje-portal", "");
    hostRef.current = host;
  }

  // Attach once, detach on unmount. Rendering `null` before removing the node
  // is what runs the children's own cleanup — dropping the host on the floor
  // would leave their effects (a key listener, a scroll lock) running.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    document.body.appendChild(host);
    return () => {
      render(null, host);
      host.remove();
    };
  }, []);

  // No dependency array: the children are new objects on every parent render,
  // and this second root has to be told about each one.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !host.isConnected) return;
    render(<>{children}</>, host);
  });

  return null;
}

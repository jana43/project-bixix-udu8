// src/lib/inView.ts
// Tell an element when it enters or leaves the viewport.
//
// One IntersectionObserver is shared by every element watching at the same
// threshold, rather than one per card: a page can hold several widgets of
// several dozen cards each, and observers are not free.
//
// The viewport — `root: null` — is the right root even though the cards live
// in a horizontally scrolling box. Intersection accounts for clipping by any
// scrolling ancestor, so a card scrolled off the side of its own carousel
// reports as out of view without the carousel having to be the root. Removing
// the element from the document reports the same way, which is what makes a
// torn-down card stop on its own.

type Listener = (inView: boolean) => void;

/**
 * Which listener belongs to which element. Weak so a card that is dropped
 * from the DOM without unobserving is still collectable.
 */
const LISTENERS = new WeakMap<Element, Listener>();

/** One observer per threshold, made on first use. */
const OBSERVERS = new Map<number, IntersectionObserver>();

function observerFor(threshold: number): IntersectionObserver {
  const existing = OBSERVERS.get(threshold);
  if (existing) return existing;

  const created = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        LISTENERS.get(entry.target)?.(entry.isIntersecting);
      }
    },
    { threshold },
  );

  OBSERVERS.set(threshold, created);
  return created;
}

/**
 * Call `listener` whenever `el` crosses `threshold` of its own area being
 * visible. Returns the function that stops watching — call it on unmount.
 *
 * On a browser without IntersectionObserver the element is reported as in
 * view once and never again: playing everything is a better failure than
 * playing nothing.
 */
export function observeInView(
  el: Element,
  threshold: number,
  listener: Listener,
): () => void {
  if (typeof IntersectionObserver === "undefined") {
    // Deferred, not called straight away: a real observer never reports
    // during the call that registered it, and a caller written against that
    // (a hook setting state, say) would be surprised by one that did.
    const timer = setTimeout(() => listener(true));
    return () => clearTimeout(timer);
  }

  const observer = observerFor(threshold);
  LISTENERS.set(el, listener);
  observer.observe(el);

  return () => {
    observer.unobserve(el);
    LISTENERS.delete(el);
  };
}

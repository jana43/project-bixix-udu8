// src/lib/playback.ts
// One page-wide answer to "is a full-screen player open right now".
//
// ── Why this cannot be a module variable ──
//
// Every layout is built as its OWN flat bundle — see `build.mjs`, and the
// reason there: each asset is fetched by a hardcoded Liquid URL, so a shared
// chunk would 404. That means `sje-carousel.js` and `sje-stories.js` have
// separate module scopes AND separate copies of Preact. A `let open = false`
// in this file is two variables that never meet, and a story bar opening a
// player would leave a carousel three sections down looping happily behind
// the overlay — which is exactly the bug this exists to fix.
//
// `window.SJE` is the one thing both bundles genuinely share. It is already
// where the widgets and the per-layout script statuses live, so this goes
// there too rather than inventing a second global.
//
// ── Why a count and not a flag ──
//
// A page can hold several widgets, a merchant can put a carousel above a story
// bar, and the theme editor can mount and unmount either while a player is up.
// A boolean written by two owners is a boolean one of them clears too early: a
// count only reaches zero when the last player has genuinely gone.
import { useEffect, useState } from "preact/hooks";
import { sje } from "./sje";

export interface PlaybackState {
  /** How many full-screen players are open, across every block on the page. */
  count: number;
  /** Everything that wants telling when that number changes. */
  listeners: Set<() => void>;
}

function state(): PlaybackState {
  const global = sje();
  return (global.playback ??= { count: 0, listeners: new Set() });
}

function notify(current: PlaybackState): void {
  // A copy, because a listener may unsubscribe as it runs — a widget unmounted
  // by the theme editor mid-notification would otherwise mutate the set being
  // iterated.
  Array.from(current.listeners).forEach((listener) => listener());
}

/**
 * Say that a player is open, and get back the way to say it is not.
 *
 * The returned function is idempotent: calling it twice must not take the
 * count below what the other holders are owed, and an effect cleanup that runs
 * twice — which a re-render under a changing dependency can cause — is not
 * worth a page of previews that never restart.
 */
export function acquireHold(): () => void {
  const current = state();
  current.count += 1;
  notify(current);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    current.count = Math.max(0, current.count - 1);
    notify(current);
  };
}

/** Hold the page's previews still for as long as `active` is true. */
export function useHold(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return acquireHold();
  }, [active]);
}

/**
 * Whether ANY block on the page has a player open — the signal a thumbnail
 * uses to decide whether to keep playing.
 *
 * A widget freezing for another widget's player is the point, not a side
 * effect. Every preview on the page is competing for the same decoders and
 * the same battery as the one video the shopper actually chose to watch, and
 * none of them is the thing being looked at.
 */
export function usePlaybackFrozen(): boolean {
  // Read during the first render, not in the effect: a widget that mounts
  // while a player is already open — lazy-loaded as the shopper scrolls to it
  // — must not autoplay for a frame first.
  const [frozen, setFrozen] = useState(() => state().count > 0);

  useEffect(() => {
    const current = state();
    const read = () => setFrozen(current.count > 0);

    current.listeners.add(read);
    // The count can have changed between the render above and this effect.
    read();

    return () => {
      current.listeners.delete(read);
    };
  }, []);

  return frozen;
}

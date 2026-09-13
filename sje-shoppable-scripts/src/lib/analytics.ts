// src/lib/analytics.ts
// What the shopper did, accumulated on the page and sent in one request.
//
// ── Why this cannot be module state ──
//
// Every layout is built as its OWN flat bundle — see `build.mjs`, and the
// reason there. `sje-carousel.js` and `sje-stories.js` have separate module
// scopes, so a `let buffer = {}` in this file is SEVEN buffers, seven 20-second
// timers and seven `visibilitychange` listeners. A page with a story bar above
// a carousel would fire two beacons carrying half the session each, and the
// widget impressions would be counted once per bundle that happened to load.
//
// `window.SJE` is the one thing every bundle genuinely shares. `playback.ts`
// solved exactly this problem the same way; this follows it.
//
// ── Why counters and not events ──
//
// A shopper does five to twenty things per session. Sending each one is five to
// twenty requests, every one of which is a connection the phone has to open on
// a page that is trying to be fast. Accumulating and sending once collapses that
// to one, and the server never wanted the individual events anyway — it stores
// counters.
//
// ── Why deltas ──
//
// The buffer is RESET after every send, so what goes out is always "what
// happened since last time". That is what makes a retried or out-of-order
// beacon merge correctly on the server: adding is commutative, assigning is
// not. Never change this to send running totals.
//
// ── Where it goes, and why that changed ──
//
// Straight to the analytics service's own domain, read from `SJE.ingest` — the
// host is a deployment constant the Liquid puts on the page.
//
// It used to go to a RELATIVE `/apps/sv/beacon`, which Shopify's App Proxy
// forwarded on, signing the request so the `shop` it carried was proven rather
// than claimed. The service moved to its own domain and the proxy went with it.
// Two things follow, and neither is recoverable from inside this file:
//
//  - The `shop` is now CLAIMED. It rides in the payload because nothing else
//    can tell the service who these counters are for.
//  - The request is cross-origin, which is why `post()` is fussy about the
//    content type. Read the warning there before touching it — the failure mode
//    is every beacon disappearing with nothing logged anywhere.
import { useEffect, useRef } from "preact/hooks";
import { inDesignMode } from "./shopify";
import { sje } from "./sje";

/** Where the buffer is mirrored, so a page navigation does not lose it. */
const STORAGE_KEY = "sje_analytics_buf";

/** The session id, kept for the life of the tab. */
const SESSION_KEY = "sje_analytics_sid";

/**
 * Whether this browser has been here before — `localStorage`, not `session`.
 *
 * ⚠️ Deliberately NOT an identifier. What is written is the date of the first
 * visit, which is low entropy and shared by everyone who arrived the same day;
 * it answers "has this browser been here before" and nothing else. A random id
 * would answer the same question and also make the visitor followable across
 * sessions, which is a different thing to store and a different thing to have
 * to justify.
 */
const VISITOR_KEY = "sje_visitor_since";

/**
 * This tab's answer, so every beacon in a session agrees.
 *
 * ⚠️ The reason this exists is the second page view. `VISITOR_KEY` is written on
 * the FIRST beacon of a first visit, so by the time the shopper clicks through
 * to a product page the key is there — and a fresh classification on that page
 * would report the same visit as "returning". Deciding once per tab and keeping
 * the answer here is what stops a single new visit being counted as one new and
 * three returning.
 */
const VISITOR_KIND_KEY = "sje_visitor_kind";

/** How often an incremental beacon goes out during a session. */
const SEND_INTERVAL_MS = 20_000;

/** How often the buffer is mirrored to `sessionStorage`. */
const PERSIST_INTERVAL_MS = 2_000;

/**
 * `sendBeacon` caps its payload at roughly 64KB and returns `false` when the
 * body is over it or the queue is full. Well before that, a body this size
 * means something is wrong.
 */
const MAX_BODY_BYTES = 60_000;

/** Seconds of a video that count as a view. */
const VIEW_THRESHOLD_SECONDS = 3;

/**
 * The largest `currentTime` jump that counts as watching.
 *
 * `timeupdate` fires about four times a second, so a real step is ~250ms. A
 * bigger one is a seek, a tab that was backgrounded, or a stall recovering —
 * none of which is time the shopper spent watching. Counting them is how
 * watchtime quietly becomes wall-clock time.
 */
const MAX_TICK_SECONDS = 2;

interface ProductBuffer {
  /** Add-to-cart clicks. */
  a: number;
  /** Money those clicks added to the cart. */
  s: number;
  /**
   * Taps that opened THIS product.
   *
   * The video's own `c` counts taps across all of its products; this says which
   * one was tapped. The id has always been in hand at the call site — it was
   * simply not being counted, so a video with four tagged products reported six
   * taps and no way to tell which product earned them.
   */
  t: number;
}

interface VideoBuffer {
  /** Impressions — scrolled into view. */
  i: number;
  /** Views — played past the threshold. */
  v: number;
  /** Product taps. */
  c: number;
  /** Watchtime, milliseconds. */
  w: number;
  /** Viewing sessions contributing to `w`. Its denominator — never an average. */
  vc: number;
  p: Record<string, ProductBuffer>;
}

interface Buffer {
  /** Widget mounts, by widget id. */
  w: Record<string, number>;
  /** Per-video counters, by media id. The authoritative cut. */
  m: Record<string, VideoBuffer>;
  /**
   * The same counters again, cut by the widget they happened inside.
   *
   * ⚠️ Additive, never a replacement for `m`. A video can be played with no
   * widget in scope, so this may total LESS than `m` does, and the server folds
   * the two separately for exactly that reason — nothing derives a headline
   * from it.
   *
   * It carries `p` as well, and that is the point of it. The same media sits in
   * several widgets, and a product tapped inside the home carousel is not the
   * same event as the same product tapped inside the collection story bar.
   * Splitting the video's global product totals across its widgets by ratio
   * would be an estimate; this is the measurement.
   */
  wm: Record<string, Record<string, VideoBuffer>>;
}

/** `n` first time this browser has been here, `r` not. */
export type VisitorKind = "n" | "r";

export interface AnalyticsState {
  buffer: Buffer;
  sid: string;
  /**
   * New or returning, decided once for the tab.
   *
   * `undefined` where the browser refuses persistent storage — a private
   * window, or a shopper who blocks it. That is reported as unknown rather
   * than guessed: calling every private window a NEW visitor would inflate the
   * new-visitor count by however many people browse that way, and the number
   * would look like growth.
   */
  visitor?: VisitorKind;
  seq: number;
  /** Set by `track`, cleared by `persist`. Keeps `timeupdate` off storage. */
  dirty: boolean;
  /** Whether the timers and listeners have been installed by some bundle. */
  installed: boolean;
}

function emptyBuffer(): Buffer {
  return { w: {}, m: {}, wm: {} };
}

function emptyVideo(): VideoBuffer {
  return { i: 0, v: 0, c: 0, w: 0, vc: 0, p: {} };
}

/** Session storage, or `null` where it throws — a private window, or blocked. */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStoredBuffer(): Buffer {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return emptyBuffer();

  try {
    const parsed = JSON.parse(raw) as Partial<Buffer>;
    // `wm` is defaulted rather than required: a shopper mid-session when this
    // bundle was deployed has a stored buffer written by the previous one, and
    // the counters it holds are still worth sending.
    return { w: parsed.w ?? {}, m: parsed.m ?? {}, wm: parsed.wm ?? {} };
  } catch {
    // A half-written value from a tab that died mid-save. Losing it is the
    // right call — the alternative is throwing on every later track.
    return emptyBuffer();
  }
}

function newSessionId(): string {
  const existing = storage()?.getItem(SESSION_KEY);
  if (existing) return existing;

  const created =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  storage()?.setItem(SESSION_KEY, created);
  return created;
}

/**
 * The page-wide state, created by whichever bundle asks first.
 *
 * The buffer is restored from `sessionStorage` here rather than started empty:
 * a shopper who watched a video and then clicked through to a product page
 * would otherwise lose everything the previous page had not yet sent.
 */
/** Persistent storage, or `null` where it throws — a private window, or blocked. */
function persistent(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether this browser has been here before, decided once per tab.
 *
 * ⚠️ READ BEFORE WRITE, and the order is the whole thing. Writing the key on
 * page load and then reading it would make every visitor returning, including
 * the one arriving for the first time — an analytics screen where nobody is
 * ever new, which reads as working right up until somebody launches a campaign
 * and sees no new visitors from it.
 */
function visitorKind(): VisitorKind | undefined {
  const session = storage();
  const seen = session?.getItem(VISITOR_KIND_KEY);
  if (seen === "n" || seen === "r") return seen;

  const store = persistent();
  // No persistent storage means the question cannot be answered at all. Not
  // "new" — see `AnalyticsState.visitor`.
  if (!store) return undefined;

  let kind: VisitorKind;
  try {
    kind = store.getItem(VISITOR_KEY) ? "r" : "n";
    // Only ever written once. Rewriting it on every visit would keep moving the
    // first-seen date forward and turn it into a last-seen one.
    if (kind === "n") store.setItem(VISITOR_KEY, new Date().toISOString().slice(0, 10));
  } catch {
    // Quota, or a browser that allows reads and refuses writes. The read
    // succeeded or it did not; either way this visit cannot be classified
    // consistently, so it is left unknown.
    return undefined;
  }

  session?.setItem(VISITOR_KIND_KEY, kind);
  return kind;
}

function state(): AnalyticsState {
  const global = sje();
  return (global.analytics ??= {
    buffer: readStoredBuffer(),
    sid: newSessionId(),
    visitor: visitorKind(),
    seq: 0,
    dirty: false,
    installed: false,
  });
}

function videoOf(current: AnalyticsState, mediaId: string): VideoBuffer {
  return (current.buffer.m[mediaId] ??= emptyVideo());
}

/** One video's counters within one widget. */
function widgetVideoOf(
  current: AnalyticsState,
  widgetId: string,
  mediaId: string,
): VideoBuffer {
  const widget = (current.buffer.wm[widgetId] ??= {});
  return (widget[mediaId] ??= emptyVideo());
}

/**
 * Every buffer one interaction should be counted into.
 *
 * The video's own always; the widget's copy only when the caller knew which
 * widget it was playing in. A layout always does — `mount` hands it
 * `WidgetProps.widget` — but the id is threaded as an optional argument so that
 * a call site which somehow has not got one still records the video, rather
 * than recording nothing.
 */
function targets(
  current: AnalyticsState,
  mediaId: string,
  widgetId?: string,
): VideoBuffer[] {
  const video = videoOf(current, mediaId);
  return widgetId ? [video, widgetVideoOf(current, widgetId, mediaId)] : [video];
}

/** One product's counters inside a video buffer, created on first touch. */
function productOf(video: VideoBuffer, productId: string): ProductBuffer {
  return (video.p[productId] ??= { a: 0, s: 0, t: 0 });
}

/**
 * Mirror the buffer to `sessionStorage`.
 *
 * On a timer rather than on every `track`, because `timeupdate` fires four
 * times a second and `sessionStorage` writes are synchronous and hit disk.
 * Called directly before a send and on the way out, so the throttle never costs
 * more than a couple of seconds of counters.
 */
function persist(): void {
  const current = state();
  if (!current.dirty) return;

  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(current.buffer));
    current.dirty = false;
  } catch {
    // Quota, or a browser refusing storage. The in-memory buffer is still
    // authoritative for this page and the next send still carries it.
  }
}

/** True when there is nothing worth sending. */
function isEmpty(buffer: Buffer): boolean {
  return (
    Object.keys(buffer.w).length === 0 &&
    Object.keys(buffer.m).length === 0 &&
    Object.keys(buffer.wm).length === 0
  );
}

/**
 * Send everything buffered, and reset.
 *
 * ⚠️ The buffer is cleared BEFORE the request, not after. `sendBeacon` gives no
 * completion signal, so there is no "after" to clear in — and clearing late
 * would double-count every counter on the next send. The trade is that a beacon
 * the browser drops takes its deltas with it, which is the loss the 20-second
 * incremental send exists to bound.
 */
export function send(final = false): void {
  const current = state();
  persist();

  if (isEmpty(current.buffer)) return;

  // ⚠️ Before the reset, not after. A page whose Liquid never set `SJE.ingest`
  // has nowhere to send to, and clearing the buffer anyway would throw away
  // counters that a later page — one that DOES carry the snippet — could still
  // have sent, since the buffer is restored from `sessionStorage` across
  // navigations.
  const destination = beaconUrl();
  if (!destination) return;

  const payload = JSON.stringify({
    kind: "widget",
    // Which shop these counters belong to. Under the App Proxy this was proven
    // by Shopify's signature over the query string and never had to be sent;
    // posting straight to the analytics domain, the page has to say.
    shop: destination.shop,
    sid: current.sid,
    seq: current.seq,
    final,
    w: current.buffer.w,
    m: current.buffer.m,
    wm: current.buffer.wm,
    // New or returning. Omitted where the browser refuses persistent storage,
    // which the server files as unknown rather than guessing at.
    ...(current.visitor ? { vr: current.visitor } : {}),
    // Where the shopper is browsing, as Liquid's `localization.country.iso_code`
    // reported it. Omitted rather than guessed when the page did not say: the
    // server files an absent country under `ZZ`, and an unknown country is a
    // far better answer than a wrong one.
    ...(destination.country ? { cc: destination.country } : {}),
  });

  current.seq += 1;
  current.buffer = emptyBuffer();
  current.dirty = true;
  persist();

  post(destination.url, payload);
}

/** Where a beacon goes, and the shop it speaks for. */
interface Destination {
  url: string;
  shop: string;
  /** ISO 3166-1 alpha-2, when the page carried one. */
  country?: string;
}

/**
 * The analytics service's own endpoint. `null` when the page never configured
 * one, which is the signal to buffer and send nothing.
 *
 * ⚠️ ABSOLUTE, and deliberately not built from `storeRoot()`.
 *
 * This used to be `${storeRoot()}apps/sv/beacon` — a relative path that
 * Shopify's App Proxy forwarded to the analytics service, where the leading
 * locale or market segment (`/en-gb/`, `/fr/`) was load-bearing and omitting it
 * 404d on every localised storefront. That proxy is gone: the service runs on
 * its own domain and is posted to directly, so the store's own path prefix has
 * nothing to do with this URL any more.
 *
 * `storeRoot()` is still right for anything that talks to the STOREFRONT —
 * `cart.ts` and `products.ts` both depend on it. Only the beacon left.
 */
function beaconUrl(): Destination | null {
  const config = sje().ingest;
  if (!config?.host || !config.cell || !config.shop) return null;

  return {
    url: `${config.host}/ingest/${encodeURIComponent(config.cell)}/beacon`,
    shop: config.shop,
    country: config.country,
  };
}

function post(url: string, payload: string): void {
  // `sendBeacon` is the only transport the browser promises to finish after the
  // page is gone. It refuses a body over its cap or a full queue, and says so.
  //
  // ⚠️ The payload goes in as a STRING, not a `Blob`. A string body is sent as
  // `text/plain;charset=UTF-8`, which is one of the three CORS-safelisted
  // content types — so this stays a "simple request" and the browser sends it
  // straight out. A `Blob` of type `application/json`, which this used to be,
  // is NOT safelisted: cross-origin it triggers a preflight, and `sendBeacon`
  // has no way to survive one. It drops the beacon and reports nothing.
  //
  // Same-origin through the App Proxy that never mattered. Posting to the
  // analytics domain it is the difference between working and losing every
  // single beacon, silently.
  if (typeof navigator.sendBeacon === "function") {
    if (payload.length <= MAX_BODY_BYTES) {
      if (navigator.sendBeacon(url, payload)) return;
    }
  }

  // `keepalive` is the fallback with the same "outlives the page" property.
  // Same content type, for the same reason.
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Analytics must never surface as an error on the storefront.
    });
  } catch {
    // Offline, or blocked. Nothing to do and nothing worth saying.
  }
}

/**
 * Start the timer and the listeners, once for the whole page.
 *
 * ⚠️ `visibilitychange` → `hidden`, never `unload` or `beforeunload`. Those do
 * not fire on iOS Safari at all, and mobile Chrome kills a backgrounded tab
 * without them — which is precisely the case that loses a whole session.
 *
 * `hidden` also fires on an ordinary tab switch, so this sends more often than
 * "on close". That is harmless: the buffer resets after each send, so the
 * deltas are never counted twice.
 */
function install(): void {
  const current = state();
  if (current.installed) return;
  current.installed = true;

  window.setInterval(persist, PERSIST_INTERVAL_MS);
  window.setInterval(() => send(false), SEND_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") send(true);
  });

  // Belt and braces for a desktop browser that never hides the tab before it
  // navigates. `pagehide` fires in the bfcache case too, where `unload` does not.
  window.addEventListener("pagehide", () => send(true));
}

/**
 * Whether to record anything at all.
 *
 * Two reasons not to:
 *
 *  * The theme editor. A merchant arranging a widget replays it dozens of
 *    times, and every one of those would land in their own analytics as shopper
 *    activity. `inDesignMode()` is how the rest of this codebase asks that.
 *  * The shop's plan does not include analytics. `sje-mount.liquid` writes
 *    `SJE.plan` from the `shoppable_videos_plan` metafield before any bundle
 *    runs.
 *
 * ⚠️ THIS is the plan switch, not the absence of `SJE.ingest`. Omitting the
 * ingest config makes `beaconUrl()` return null and `send()` bail — but
 * `track()` would carry on buffering counters and mirroring them to
 * `sessionStorage` on every page of every session. The buffer would grow
 * unbounded on a Free shop and then flush months of accumulated activity the
 * moment they upgraded. Gating here stops the counters being written at all,
 * and stops `install()` ever registering its timers and listeners.
 *
 * `!== false`, not `=== true`: a storefront running a theme published before
 * this snippet existed has no `SJE.plan` at all, and the right behaviour there
 * is the old one — keep recording — rather than silently going dark on every
 * install that has not re-published its theme.
 */
function enabled(): boolean {
  return !inDesignMode() && sje().plan?.analytics !== false;
}

function track(mutate: (current: AnalyticsState) => void): void {
  if (!enabled()) return;

  const current = state();
  install();
  mutate(current);
  current.dirty = true;
}

/** A widget drew itself. Counted per mount, not per video. */
export function trackWidgetImpression(widgetId: string): void {
  track((current) => {
    current.buffer.w[widgetId] = (current.buffer.w[widgetId] ?? 0) + 1;
  });
}

/** A video scrolled into view, played or not. */
export function trackVideoImpression(mediaId: string): void {
  track((current) => {
    videoOf(current, mediaId).i += 1;
  });
}

/**
 * Count an impression the first time a card is actually seen.
 *
 * Every layout already watches its cards with `observeInView` and already keeps
 * the "has been visible at least once" flag that gates rendering the video
 * element. This turns that existing signal into an impression rather than
 * adding a second observer per card.
 *
 * Once per card per mount, not once per crossing: a shopper scrolling a
 * carousel back and forth has seen the card once, and counting every pass would
 * make impressions a measure of how fidgety they were.
 */
export function useVideoImpression(mediaId: string, seen: boolean): void {
  // The media this hook has already counted, so a card reused for a different
  // media — which shuffle and the theme editor both cause — counts again.
  const countedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!seen || countedFor.current === mediaId) return;
    countedFor.current = mediaId;
    trackVideoImpression(mediaId);
  }, [mediaId, seen]);
}

/** A shopper opened a tagged product from inside a video. */
export function trackProductTap(
  mediaId: string,
  productId: string,
  widgetId?: string,
): void {
  const key = numericProductId(productId);

  track((current) => {
    // Counted into the video's own buffer AND the widget's copy of it, so the
    // drill-down can report what this product did INSIDE this placement rather
    // than a share of what it did everywhere.
    for (const video of targets(current, mediaId, widgetId)) {
      video.c += 1;
      productOf(video, key).t += 1;
    }
  });
}

/** A shopper added a tagged product to the cart from inside a video. */
export function trackAddToCart(
  mediaId: string,
  productId: string,
  value: number,
  widgetId?: string,
): void {
  const key = numericProductId(productId);
  const amount = Number.isFinite(value) && value > 0 ? value : 0;

  track((current) => {
    for (const video of targets(current, mediaId, widgetId)) {
      const product = productOf(video, key);
      product.a += 1;
      product.s += amount;
    }
  });
}

/**
 * The trailing numeric part of a Shopify id.
 *
 * ⚠️ The app stores a tagged product as `gid://shopify/Product/123` while the
 * storefront uses the bare `123`. Both reach this module — the sheet has the
 * stored copy, the cart has the live one — and keying the buffer on whichever
 * happened to arrive would split one product's counters across two keys.
 * `sje.ts` documents the same trap for product comparison.
 */
export function numericProductId(id: string): string {
  const cut = id.lastIndexOf("/");
  return cut === -1 ? id : id.slice(cut + 1);
}

/**
 * Follows one video's playback and turns it into a view and watchtime.
 *
 * Created per playback rather than per media: a shopper who watches the same
 * video twice has watched it twice, and the second play is a second view.
 */
export class WatchSession {
  private lastTime = 0;
  private watchedSeconds = 0;
  private counted = false;
  private started = false;

  // Declared and assigned rather than a constructor parameter property:
  // `erasableSyntaxOnly` is on, and that shorthand emits code rather than
  // erasing to nothing.
  private readonly mediaId: string;
  private readonly widgetId: string | undefined;

  constructor(mediaId: string, widgetId?: string) {
    this.mediaId = mediaId;
    this.widgetId = widgetId;
  }

  /**
   * Call from the video's `timeupdate`.
   *
   * Watchtime is the sum of forward steps in `currentTime`, not elapsed wall
   * time: a paused video, a backgrounded tab and a stalled stream all keep
   * ticking on the clock and none of them is watching. Steps larger than
   * `MAX_TICK_SECONDS` are seeks and are skipped rather than counted.
   */
  tick(currentTime: number): void {
    if (!Number.isFinite(currentTime)) return;

    const delta = currentTime - this.lastTime;
    this.lastTime = currentTime;

    if (delta <= 0 || delta > MAX_TICK_SECONDS) return;

    if (!this.started) {
      this.started = true;
      track((current) => {
        for (const video of targets(current, this.mediaId, this.widgetId)) video.vc += 1;
      });
    }

    this.watchedSeconds += delta;

    track((current) => {
      const reached = !this.counted && this.watchedSeconds >= VIEW_THRESHOLD_SECONDS;
      const watched = Math.round(delta * 1000);

      for (const video of targets(current, this.mediaId, this.widgetId)) {
        video.w += watched;
        if (reached) video.v += 1;
      }

      // Flipped once, outside the loop. Both buffers are counting the SAME
      // view, so setting it inside would credit only whichever came first.
      if (reached) this.counted = true;
    });
  }

  /** Call when the shopper seeks, so the jump is not read as watching. */
  seeked(currentTime: number): void {
    if (Number.isFinite(currentTime)) this.lastTime = currentTime;
  }
}

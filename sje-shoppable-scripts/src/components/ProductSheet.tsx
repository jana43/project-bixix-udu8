// src/components/ProductSheet.tsx
// The bottom sheet the player's products open into.
//
// ── Two ways in, one sheet ──
//
//   sticker      tap the badge  ->  the LIST of everything tagged
//                tap a row      ->  that product's DETAIL, Back to the list
//
//   free-scroll  tap a card     ->  that product's DETAIL, no list behind it
//
// The difference is only where the shopper entered. A sticker names one
// product and hints at the rest with its "+N", so it opens the rest; a rail is
// already the list, so a tap on one of its cards has nothing to list and goes
// straight to the product. Which of the two is behind the current view is the
// `stacked` flag on `SheetState`, and it is the only thing that decides
// whether a Back arrow is drawn.
//
// ── Why a sheet rather than a link ──
//
// A tap that leaves for the product page ends the video. The whole point of a
// shoppable video is that the shopper can buy without giving up their place in
// it, so the sheet covers the bottom of the frame, the video keeps playing
// above it, and `/cart/add.js` puts the item in the THEME's own cart — see
// `lib/cart.ts` for why it must be that cart and not a second one. The full
// product page is still one tap away for anyone who wants it.
//
// ── Where it renders ──
//
// Inside the Lightbox's STAGE, not the dialog. The stage is the 9:16 frame —
// the whole screen on a phone, a portrait rectangle on a desktop — and a sheet
// pinned to the bottom of the viewport on a desktop would slide up out of the
// dark, unattached to the video it belongs to. It also inherits the stage's
// `overflow: hidden`, so its top corners are clipped to the frame's radius for
// free.
//
// Every size is a multiple of a standard token, read through `sp()` / `fs()`,
// so the sheet steps down at the breakpoint with the rest of the widget —
// CLAUDE.md §3 and §4. The four animations are the exception and live in
// `sje-widget.css`, for the one reason a class is ever used here: a `style`
// attribute cannot carry a keyframe.
import { useEffect, useRef, useState } from "preact/hooks";
import { addToCart } from "../lib/cart";
import { formatPrice, percentOff } from "../lib/money";
import { useLiveProducts } from "../lib/products";
import { productUrl } from "../lib/shopify";
import { fs, sp } from "../lib/tokens";
import { Check, ChevronLeft, ChevronRight, ShoppingBag, X } from "../lib/icons";
import type { SJEMedia, SJEProduct, SJEVariant } from "../lib/sje";

/** Which view the sheet is showing, and what is behind it. */
export interface SheetState {
  /** The product shown in detail, or `null` for the list of all of them. */
  productId: string | null;
  /**
   * Whether a list sits behind this detail — i.e. whether Back goes anywhere.
   *
   * True when the sticker opened the sheet, false when a rail card did. Not
   * derived from `productId`, because "detail with a list behind it" and
   * "detail on its own" look identical from the state alone.
   */
  stacked: boolean;
}

/**
 * How long the sheet takes to slide back down, in ms.
 *
 * ⚠️ Paired with `.sje-sheet--out` in `sje-widget.css`. The animation is CSS,
 * the unmount is JS, and this number is what keeps the second from happening
 * before the first has finished. Change them together — too short and the
 * sheet vanishes mid-slide; too long and it sits invisible, blocking nothing
 * but still mounted.
 */
const EXIT_MS = 220;

/**
 * How long the "Added to cart" toast lives, in ms.
 *
 * ⚠️ Paired with the `.sje-toast` animation in `sje-widget.css`, which runs
 * the whole life of it — in, hold, out — in one keyframe set. This number is
 * what unmounts the element at the end of that, and the button's confirmation
 * settles back on the same timer, so the two never disagree about whether the
 * add is still news.
 */
const TOAST_MS = 2600;

/** The sheet's ground, and the ink on it. Not the theme's — see the header. */
const PAPER = "#fff";
const INK = "#111";
const MUTED = "#6b6b6b";

/** The hairline between the header and what it heads. */
const RULE = "1px solid rgba(0,0,0,0.1)";

/** The was-price and the saving, matching `ProductRail`. */
const WAS_COLOUR = "#6b6b6b";
const SALE_COLOUR = "#b3261e";

/** The grey a skeleton pulses. Opaque, as everywhere else in the widget. */
const SKELETON_FILL = "#e6e6e6";

/**
 * ⚠️ LOAD-BEARING. Themes commonly hide empty elements
 * (`div:empty { display: none }`), and every skeleton box is empty by
 * definition. `font-size: 0` keeps the character from taking up space.
 * CLAUDE.md §6.
 */
const NBSP = " ";
const NOT_EMPTY = { fontSize: 0, lineHeight: 0 } as const;

/** A tap target, and the tightest thing on the scale. See CLAUDE.md §3. */
const CONTROL_STEPS = 4;

/**
 * The one scrolling box in a view.
 *
 * ⚠️ Each VIEW owns one of these, not the sheet — which is what lets the
 * detail keep its Add to cart button outside the scroll. `min-height: 0` is
 * required: a flex item defaults to `min-height: auto` and refuses to shrink
 * below its content, so without it the sheet grows past its own max-height
 * instead of the box scrolling.
 */
const SCROLLER = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  // Stops a swipe that runs out of content from scrolling the page behind the
  // dialog, and from being read as a swipe on the video.
  overscrollBehavior: "contain",
  WebkitOverflowScrolling: "touch",
} as const;

/**
 * The sheet's typography, spread onto every control in this file.
 *
 * The TYPEFACE is the merchant's. A sheet that slides up inside someone's
 * storefront should look like it belongs to that storefront, and a system font
 * beside a theme's own is the tell that it does not.
 *
 * `text-transform` and `letter-spacing` are NOT inherited, on purpose. Themes
 * very commonly ship a global `button { text-transform: uppercase }`, and a
 * variant chip reading "SMALL / RED" or a toggle reading "SHOW MORE" is the
 * theme shouting at content that is not a call to action.
 */
const TYPE = {
  // ⚠️ `inherit`, and it has to be SAID. A `button` does not inherit
  // `font-family` — the UA stylesheet gives every form control a font of its
  // own — so leaving this out is not "inherit the theme's font", it is
  // "render in whatever the browser thinks a button should look like".
  // Deleting the declaration and inheriting are different things here.
  fontFamily: "inherit",
  textTransform: "none",
  letterSpacing: "normal",
} as const;

const ICON_BUTTON = {
  ...TYPE,
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
  width: sp(CONTROL_STEPS),
  height: sp(CONTROL_STEPS),
  padding: 0,
  border: "none",
  borderRadius: "50%",
  background: "transparent",
  color: INK,
  cursor: "pointer",
  // Themes like a global `button { transition: … }`; this keeps ours still.
  transition: "none",
  WebkitTapHighlightColor: "transparent",
} as const;

interface ProductSheetProps {
  media: SJEMedia;
  /** The view to show, or `null` to close — which plays the exit first. */
  state: SheetState | null;
  /** A product was chosen from the list. */
  onSelect: (productId: string) => void;
  /** Back to the list. Only ever called while `stacked`. */
  onBack: () => void;
  onClose: () => void;
}

/**
 * The sheet, with its entrance and its exit.
 *
 * This half exists only to keep the sheet mounted while it slides back down.
 * `state` going `null` is the parent saying "closed", and a component that
 * unmounted on that would jump off the screen instead of leaving it — so the
 * last state is HELD for exactly as long as the exit animation runs, and the
 * body below is unmounted only at the end of it.
 *
 * That the body is a separate component is load-bearing too, and not tidiness:
 * it is what keeps `useLiveProducts` from running until the sheet is actually
 * opened. In sticker mode the Lightbox has fetched one product — the one on
 * the badge — and the sheet needs all of them; fetching the rest on the
 * chance that a shopper might tap would put a request per tagged product on
 * every video opened.
 */
export function ProductSheet({ media, state, onSelect, onBack, onClose }: ProductSheetProps) {
  const [held, setHeld] = useState<SheetState | null>(state);

  useEffect(() => {
    if (state) {
      setHeld(state);
      return;
    }

    // Already gone — nothing to play out.
    if (!held) return;

    const timer = setTimeout(() => setHeld(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [state, held]);

  // The live state where there is one, and the held one only on the way out.
  // Reading `held` alone would cost a frame at both ends: one showing nothing
  // on the way in, because `held` is not set until the effect above has run,
  // and one showing the PREVIOUS view on every navigation.
  const shown = state ?? held;
  if (!shown) return null;

  // Closing, but still on screen. Both layers wear their `--out` modifier for
  // this stretch, which is what runs them back off.
  const leaving = state === null;

  return (
    <>
      {/* Dims the video the sheet is covering part of, and closes on a tap
          the way the Lightbox's own scrim does. `aria-hidden` because the
          close button below is the accessible way out. */}
      <div
        aria-hidden="true"
        class={leaving ? "sje-sheet__scrim sje-sheet__scrim--out" : "sje-sheet__scrim"}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
        }}
      />

      <div
        role="dialog"
        aria-label="Products in this video"
        class={leaving ? "sje-sheet sje-sheet--out" : "sje-sheet"}
        // The stage toggles play/pause on click. Everything in here is a
        // control of its own, and none of it should also pause the video.
        onClick={(event) => event.stopPropagation()}
        style={{
          ...TYPE,
          position: "absolute",
          insetInline: 0,
          bottom: 0,
          // A proportion of the frame, not a token multiple: the sheet should
          // leave a usable amount of VIDEO visible above it, and how much
          // video there is is not a thing the type scale knows about.
          maxHeight: "78%",
          display: "flex",
          flexDirection: "column",
          borderStartStartRadius: sp(2),
          borderStartEndRadius: sp(2),
          background: PAPER,
          color: INK,
          fontSize: fs(1),
          lineHeight: 1.4,
          // The video's own corners are square where the sheet meets them.
          overflow: "hidden",
        }}
      >
        <SheetBody
          media={media}
          state={shown}
          onSelect={onSelect}
          onBack={onBack}
          onClose={onClose}
        />
      </div>
    </>
  );
}

function SheetBody({
  media,
  state,
  onSelect,
  onBack,
  onClose,
}: ProductSheetProps & { state: SheetState }) {
  const tagged = media.products ?? [];

  // Every tagged product, not just the sticker's one. Deduplicated against the
  // module cache in `lib/products.ts`, so anything already fetched for a badge
  // or a rail card resolves in a microtask and never shows a skeleton here.
  const live = useLiveProducts(tagged);

  const chosen = state.productId
    ? tagged.find((product) => product.id === state.productId)
    : undefined;

  const fresh = chosen ? live.byId.get(chosen.id) : undefined;
  // Three states, as everywhere else the store is asked: no answer and still
  // running means waiting, no answer once settled means the request failed and
  // the stored copy is better than nothing, an answer is an answer.
  const waiting = !fresh && !live.settled;

  const view = chosen ? chosen.id : "list";

  return (
    <>
      {/* The grab handle. Purely a signal that this is a sheet — the drag it
          suggests is not implemented, and a tap anywhere off the sheet does
          the same job. */}
      <div
        aria-hidden="true"
        style={{
          flex: "0 0 auto",
          width: sp(4.5),
          height: sp(0.5),
          margin: `${sp(1)} auto 0`,
          borderRadius: sp(0.25),
          background: "rgba(0,0,0,0.18)",
          ...NOT_EMPTY,
        }}
      >
        {NBSP}
      </div>

      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: sp(0.5),
          padding: `${sp(1)} ${sp(1.5)}`,
          borderBlockEnd: RULE,
        }}
      >
        {/* Only when there is a list to go back TO. A rail card opened the
            detail directly, and a Back arrow there would point at nothing. */}
        {chosen && state.stacked && (
          <button type="button" onClick={onBack} aria-label="Back to products" style={ICON_BUTTON}>
            <ChevronLeft size={sp(2.25)} />
          </button>
        )}

        <div
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            fontSize: fs(0.95),
            fontWeight: 700,
            // A long product name is a header, not a paragraph.
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            // Centred over the list, where there is no back arrow to balance
            // against; left-aligned in the detail, where there is.
            textAlign: chosen && state.stacked ? "start" : "center",
            // Keeps the centred title from sitting off to one side, since the
            // close button takes room on the right and nothing takes room on
            // the left.
            paddingInlineStart: chosen && state.stacked ? 0 : sp(CONTROL_STEPS),
          }}
        >
          {chosen ? chosen.title : `${tagged.length} product${tagged.length === 1 ? "" : "s"}`}
        </div>

        <button type="button" onClick={onClose} aria-label="Close" style={ICON_BUTTON}>
          <X size={sp(2.25)} />
        </button>
      </div>

      {/* ⚠️ The `key` is doing three jobs and all of them are load-bearing.
          It rebuilds the subtree on a navigation, which resets `Detail`'s
          chosen variant and its "Added" confirmation instead of carrying one
          product's state onto the next; it restarts the slide, which a class
          change alone would not do reliably, since an ordinary re-render (the
          prices landing) must NOT restart it; and — since each view now
          builds its own scroller — it hands the new view a box already at
          `scrollTop: 0`, so opening a product from halfway down a long list
          no longer lands mid-page. That last one used to be an effect. */}
      <div
        key={view}
        // Forward off the list, backward on the way home. See the
        // `sje-sheet__view` rules in `sje-widget.css`.
        class={chosen ? "sje-sheet__view" : "sje-sheet__view sje-sheet__view--back"}
        // Fills what the header leaves, and is a column so the view inside
        // can put a scroller above a footer that does not scroll.
        style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        {chosen ? (
          <Detail product={fresh ?? chosen} waiting={waiting} />
        ) : (
          <div style={SCROLLER}>
            {tagged.map((product) => (
              <ListRow
                key={product.id}
                product={live.byId.get(product.id) ?? product}
                waiting={!live.byId.has(product.id) && !live.settled}
                onOpen={() => onSelect(product.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface ListRowProps {
  product: SJEProduct;
  /** Its price is still being fetched; show the shape, not a stale number. */
  waiting: boolean;
  onOpen: () => void;
}

/** One product in the list — a full-width row, not a card. */
function ListRow({ product, waiting, onOpen }: ListRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        ...TYPE,
        display: "flex",
        alignItems: "center",
        gap: sp(1.5),
        width: "100%",
        padding: `${sp(1.25)} ${sp(1.5)}`,
        border: "none",
        borderBlockEnd: RULE,
        background: "transparent",
        color: INK,
        textAlign: "start",
        cursor: "pointer",
        transition: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <Thumb url={product.imageUrl} waiting={waiting} steps={7} />

      {/* `min-width: 0` is what lets the ellipsis engage: without it a flex
          item refuses to shrink below its text's natural width. */}
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div
          style={{
            fontSize: fs(0.95),
            lineHeight: 1.3,
            fontWeight: 600,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {product.title}
        </div>

        {waiting ? (
          <Bar steps={0.95} width={sp(9)} />
        ) : (
          <PriceRow priced={product} steps={0.95} />
        )}
      </div>

      <ChevronRight size={sp(2.25)} />
    </button>
  );
}

interface DetailProps {
  product: SJEProduct;
  /** The store has not answered yet — there are no variants to offer. */
  waiting: boolean;
}

/**
 * One product, with the button that buys it.
 *
 * The variant picker is a flat row of chips titled the way the storefront
 * titles them — "Small / Red" — rather than one control per option. That is a
 * deliberate simplification: `variant.title` is the option values already
 * joined, so a single list handles a product with three options as well as one
 * with none, and there is no option matrix to keep in sync with what is
 * actually in stock. A product with one variant gets no picker at all.
 */
function Detail({ product, waiting }: DetailProps) {
  const variants = product.variants ?? [];

  const [chosenId, setChosenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * How many times this product has been added, or `0` for "not just now".
   *
   * A COUNTER rather than a flag, and the difference is a real one. Adding a
   * second time inside the toast's window would set a `true` that was already
   * `true` — no state change, so no effect re-run, so the timer would not
   * restart and the toast would expire on the FIRST add's schedule, seconds
   * after the second tap. It is also the `key` on the toast, which is what
   * restarts its animation rather than leaving it mid-fade.
   */
  const [confirmed, setConfirmed] = useState(0);
  const added = confirmed > 0;

  // The shopper's pick, or the first thing that can actually be bought. A
  // product whose first variant is sold out should not open on a dead button.
  const variant =
    variants.find((candidate) => candidate.id === chosenId) ??
    variants.find((candidate) => candidate.available) ??
    variants[0];

  // The variant's own pair, or the product's, but never one of each: a chosen
  // variant's price beside a compare-at from a DIFFERENT variant would invent
  // a discount nobody is offering.
  const priced = variant && variant.price ? variant : product;

  // Every photo the store returned. The stored copy keeps only one, which is
  // what a sheet opened before the request lands has to work from — a gallery
  // of one is still a gallery, and it does not jump when the rest arrive.
  const gallery = product.images?.length
    ? product.images
    : product.imageUrl
      ? [product.imageUrl]
      : [];

  // Three different nothings, and the button must not conflate them: still
  // asking, asked and got no answer, asked and there is nothing to sell.
  // `variants` is `undefined` only in the middle case — see `SJEProduct`.
  const known = product.variants !== undefined;
  const inStock = !waiting && variants.length > 0 && variant?.available === true;

  // The confirmation says its piece and goes. The toast carries it, the button
  // carries it alongside, and both settle back so a second add is one tap away
  // rather than something the shopper has to reset by changing variant.
  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(() => setConfirmed(0), TOAST_MS);
    return () => clearTimeout(timer);
  }, [confirmed]);

  const add = async () => {
    if (!variant || adding) return;

    setAdding(true);
    setError(null);

    const result = await addToCart(variant.id);

    setAdding(false);
    if (result.ok) setConfirmed((count) => count + 1);
    else setError(result.message);
  };

  return (
    // A column, not a block: the scroller takes what is left and the footer
    // below it stays put.
    <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={SCROLLER}>
        {/* Edge to edge — which is why the padding below is on an inner box
            and not on this one. A gallery inset from the sheet's sides reads
            as a picture OF a product; one that runs to the edges reads as the
            product itself, which is the whole job of the top of a sheet. */}
        <Gallery images={gallery} waiting={waiting} activeUrl={variant?.imageUrl} />

        <div style={{ padding: sp(1.5) }}>
        <div style={{ fontSize: fs(1), lineHeight: 1.3, fontWeight: 700 }}>
          {product.title}
        </div>

        {waiting ? (
          <Bar steps={1.15} width={sp(11)} />
        ) : (
          <PriceRow priced={priced} steps={1.15} />
        )}

      {product.description && <Description text={product.description} />}

      {product.handle && (
        <a
          href={productUrl(product.handle)}
          // A real link, so it is middle-clickable and openable in a new tab.
          // Following it leaves the video, which is the shopper's choice to
          // make and the reason it is a quiet one down here rather than the
          // loudest thing on the sheet.
          style={{
            display: "block",
            marginBlockStart: sp(2),
            fontSize: fs(0.8),
            textAlign: "center",
            color: MUTED,
            textDecoration: "underline",
          }}
        >
          View full details
        </a>
      )}

      {/* Nothing to choose between on a product with a single variant, and a
          picker with one chip in it is a control that does nothing. */}
      {variants.length > 1 && (
        <div style={{ marginBlockStart: sp(2) }}>
          <div style={{ fontSize: fs(0.8), fontWeight: 600, color: MUTED }}>Options</div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: sp(0.75),
              marginBlockStart: sp(0.75),
            }}
          >
            {variants.map((candidate) => (
              <VariantChip
                key={candidate.id}
                variant={candidate}
                selected={candidate.id === variant?.id}
                onPick={() => {
                  setChosenId(candidate.id);
                  // A confirmation belongs to the variant it was for.
                  setConfirmed(0);
                  setError(null);
                }}
              />
            ))}
          </div>
        </div>
      )}

        </div>
      </div>

      {/* ⚠️ OUTSIDE the scroller. A bottom sheet is short — 78% of a frame,
          less on a phone in landscape — and a product with a gallery, a
          picker and a description is taller than that every time. With the
          button in the flow, buying meant scrolling to the bottom first, and
          the one thing the shopper opened this to do was the one thing they
          could not see. It is a footer of the sheet now, always on screen.

          The error and the cart link come with it: a message about the button
          belongs beside the button, not wherever the scroll happens to be. */}
      <div
        style={{
          // The toast hangs off the top of this, so it has to be the
          // positioned ancestor.
          position: "relative",
          flex: "0 0 auto",
          padding: sp(1.5),
          borderBlockStart: RULE,
          background: PAPER,
        }}
      >
        {added && <Toast key={confirmed} />}
      <button
        type="button"
        onClick={add}
        disabled={!inStock || adding}
        style={{
          ...TYPE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: sp(1),
          width: "100%",
          padding: `${sp(1.5)} ${sp(2)}`,
          border: "none",
          borderRadius: sp(1),
          background: inStock ? INK : "rgba(0,0,0,0.12)",
          color: inStock ? PAPER : MUTED,
          fontSize: fs(0.95),
          fontWeight: 700,
          lineHeight: 1.2,
          cursor: inStock && !adding ? "pointer" : "default",
          transition: "none",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {added ? <Check size={sp(2.25)} /> : <ShoppingBag size={sp(2.25)} />}
        {buttonLabel({ waiting, known, inStock, adding, added })}
      </button>

      {error && (
        // `role="alert"` so a screen reader is told without having to be
        // looking at the button.
        <div
          role="alert"
          style={{
            marginBlockStart: sp(1),
            fontSize: fs(0.8),
            lineHeight: 1.3,
            textAlign: "center",
            color: SALE_COLOUR,
          }}
        >
          {error}
        </div>
      )}

      </div>
    </div>
  );
}

/** How many lines of description show before "Show more". */
const DESCRIPTION_LINES = 4;

/**
 * Long enough to be worth collapsing, in characters.
 *
 * A heuristic, and deliberately one: knowing whether text ACTUALLY overflows
 * four lines means measuring it after layout, which is a `ResizeObserver` and
 * a re-render for a control that only decides whether one word is on screen.
 * Erring high — a description just over the line gets a "Show more" that
 * reveals a line and a half — is a smaller cost than the measurement.
 */
const DESCRIPTION_CLAMP_OVER = 180;

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const clampable = text.length > DESCRIPTION_CLAMP_OVER;

  return (
    <div style={{ marginBlockStart: sp(2) }}>
      <div style={{ fontSize: fs(0.8), fontWeight: 600, color: MUTED }}>Description</div>

      <div
        style={{
          marginBlockStart: sp(0.5),
          fontSize: fs(0.85),
          lineHeight: 1.5,
          // The text arrives with real newlines where the merchant's markup
          // had paragraphs and bullets — see `plainText` in `lib/products.ts`.
          // `pre-line` is what keeps them and still wraps everything else.
          whiteSpace: "pre-line",
          ...(clampable && !open
            ? {
                display: "-webkit-box",
                WebkitLineClamp: DESCRIPTION_LINES,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
            : {}),
        }}
      >
        {text}
      </div>

      {clampable && (
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          style={{
            ...TYPE,
            marginBlockStart: sp(0.5),
            padding: 0,
            border: "none",
            background: "transparent",
            color: INK,
            fontSize: fs(0.8),
            fontWeight: 600,
            textDecoration: "underline",
            cursor: "pointer",
            transition: "none",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/**
 * The confirmation, floating just above the Add to cart button.
 *
 * ── Why here and not the top of the sheet ──
 *
 * Feedback belongs where the tap was. A toast at the top of the frame is a
 * notification about something that happened elsewhere; one sitting on the
 * button the shopper just pressed is that button answering. It also cannot be
 * scrolled away from, because the footer it hangs off does not scroll.
 *
 * ── Why it replaced a "View cart" link ──
 *
 * The link was there because no cart event reaches every theme — see
 * `announce()` in `lib/cart.ts` — so the shopper could not be relied on to see
 * a cart count update. That is still true, and this is still the answer to it:
 * the confirmation is ours and appears on every theme. What it no longer does
 * is invite the shopper OUT of the video to check, which is the one thing a
 * shoppable video exists to avoid.
 *
 * `pointer-events: none` so it can never intercept a tap meant for the button
 * a few pixels below it — a toast that eats the second add is worse than no
 * toast at all.
 */
function Toast() {
  return (
    <div
      // Announced without stealing focus, which a shopper mid-swipe would feel
      // as the sheet grabbing at them.
      role="status"
      aria-live="polite"
      // The class carries the animation. A `style` attribute cannot hold a
      // keyframe, which is the only reason any of this widget uses a class.
      class="sje-toast"
      style={{
        position: "absolute",
        // Directly above the footer, overlaying the foot of the scroll.
        insetBlockEnd: "100%",
        insetInline: 0,
        display: "flex",
        justifyContent: "center",
        padding: `0 ${sp(1.5)} ${sp(1)}`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          ...TYPE,
          display: "flex",
          alignItems: "center",
          gap: sp(0.75),
          padding: `${sp(0.75)} ${sp(1.5)}`,
          borderRadius: sp(2.5),
          // Dark on the sheet's white, which is the one combination that reads
          // as "a layer above" without needing a border or a shadow to say so.
          background: INK,
          color: PAPER,
          fontSize: fs(0.85),
          fontWeight: 600,
          lineHeight: 1.2,
        }}
      >
        <Check size={sp(2)} />
        Added to cart
      </div>
    </div>
  );
}

/** What the add button says, in the order the states actually happen. */
function buttonLabel(state: {
  waiting: boolean;
  known: boolean;
  inStock: boolean;
  adding: boolean;
  added: boolean;
}): string {
  if (state.waiting) return "Loading…";
  // The request finished and brought back nothing — the store was unreachable,
  // or the product has gone. NOT "Sold out": that is a claim about stock, and
  // there is no stock information here to make it from. The "View full
  // details" link above is the way through in this state.
  if (!state.known) return "Unavailable";
  // Settled, and every variant the store listed is gone.
  if (!state.inStock) return "Sold out";
  if (state.adding) return "Adding…";
  if (state.added) return "Added to cart";
  return "Add to cart";
}

interface VariantChipProps {
  variant: SJEVariant;
  selected: boolean;
  onPick: () => void;
}

function VariantChip({ variant, selected, onPick }: VariantChipProps) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!variant.available}
      // `aria-pressed` rather than a radio group: these are toggles in a row,
      // and a screen reader should hear which one is on.
      aria-pressed={selected}
      style={{
        ...TYPE,
        padding: `${sp(0.75)} ${sp(1.25)}`,
        border: `1px solid ${selected ? INK : "rgba(0,0,0,0.2)"}`,
        borderRadius: sp(2.5),
        background: selected ? INK : PAPER,
        color: selected ? PAPER : variant.available ? INK : MUTED,
        fontSize: fs(0.8),
        lineHeight: 1.2,
        fontWeight: 600,
        // A sold-out option is struck through rather than hidden: a shopper
        // looking for their size should be told it is gone, not left to
        // wonder whether it ever existed.
        textDecoration: variant.available ? "none" : "line-through",
        cursor: variant.available ? "pointer" : "default",
        whiteSpace: "nowrap",
        transition: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {variant.title}
    </button>
  );
}

/**
 * The gallery's height, in spacing steps — `* 20`, so 160px on desktop and
 * 120px on a phone.
 *
 * A stated HEIGHT rather than `aspect-ratio`, and for once not because of the
 * empty-box hazard: the sheet is at most 78% of the frame, and below the
 * gallery sit a title, a price, a picker, a description and — outside the
 * scroll entirely — the Add to cart button. A gallery sized from its own
 * width would be the only thing on screen on a phone.
 */
const GALLERY_STEPS = 20;

/**
 * How many photos are in view at once.
 *
 * One and a half, deliberately: a half-slide of the NEXT photo hanging off
 * the right edge is what tells a shopper there is a right edge to swipe past.
 * A gallery showing exactly one image looks like a product that HAS one
 * image, and the arrows would then be the only clue otherwise.
 */
const SLIDES_IN_VIEW = 1.5;

/** Between slides — and subtracted from the slide width, so the sum is exact. */
const SLIDE_GAP = sp(1);

/** How many dots before they stop being readable and become a counter. */
const MAX_DOTS = 8;

interface GalleryProps {
  images: string[];
  /** No photos yet — draw the box, greyed, so nothing moves when they land. */
  waiting: boolean;
  /**
   * The chosen variant's own photo, if it has one. Selecting a variant scrolls
   * the gallery to its picture, which is the thing that makes a colour swatch
   * feel like it did something.
   */
  activeUrl?: string;
}

/**
 * Every photo on the product, as one swipeable strip.
 *
 * Scroll snapping rather than a JS carousel: the browser already knows how to
 * fling, rubber-band, honour a trackpad and respect reduced motion, and every
 * line of that reimplemented in a theme asset is a line shipped to a phone.
 * The JS here only reads which slide the browser settled on, and writes a
 * scroll position when an arrow, a dot or a variant asks for one.
 */
function Gallery({ images, waiting, activeUrl }: GalleryProps) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const many = images.length > 1;

  /**
   * Scroll so slide `next` sits at the leading edge.
   *
   * Measured off the live boxes rather than computed from a slide width,
   * because that width is a `calc()` of a percentage and a token — the browser
   * knows what it came out as, and this code would only be guessing. It is
   * also why nothing here has to know which way the store reads.
   */
  const show = (next: number) => {
    const element = track.current;
    const slide = element?.children[next] as HTMLElement | undefined;
    if (!element || !slide) return;

    const delta = slide.getBoundingClientRect().left - element.getBoundingClientRect().left;
    element.scrollTo({ left: element.scrollLeft + delta, behavior: "smooth" });
  };

  // A variant with its own photo moves the gallery to it. No-ops when the
  // variant's image is not one of the product's — which does happen, since the
  // two come back as separate fields of the same response.
  useEffect(() => {
    if (!activeUrl) return;
    const target = images.indexOf(activeUrl);
    if (target >= 0) show(target);
    // `images` is deliberately absent: it is stable for the life of a detail
    // view, and listing it would re-run this on every parent render.
  }, [activeUrl]);

  if (images.length === 0 && !waiting) return null;

  const slideWidth = `calc((100% - ${SLIDE_GAP}) / ${SLIDES_IN_VIEW})`;

  return (
    <>
    {/* The arrows are positioned against this, and it is exactly the height of
        the track — the dots below are OUTSIDE it, so an arrow centred here is
        centred on the photos rather than on the photos plus the dots. */}
    <div style={{ position: "relative", height: sp(GALLERY_STEPS) }}>
      <div
        ref={track}
        // The class carries the WebKit scrollbar rule, which is a
        // pseudo-element and so cannot be written inline.
        class="sje-scroller"
        onScroll={(event) => {
          const element = event.currentTarget;
          const base = element.getBoundingClientRect().left;

          // Whichever slide's leading edge is nearest the track's. Cheaper
          // ways exist — `scrollLeft / slideWidth` — and every one of them has
          // to know a width this deliberately does not compute.
          let nearest = 0;
          let best = Infinity;
          for (let position = 0; position < element.children.length; position += 1) {
            const distance = Math.abs(
              element.children[position].getBoundingClientRect().left - base,
            );
            if (distance < best) {
              best = distance;
              nearest = position;
            }
          }
          setIndex(nearest);
        }}
        style={{
          display: "flex",
          gap: SLIDE_GAP,
          height: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x mandatory",
          // ⚠️ THE X AXIS ONLY, and this is the bug that made the sheet feel
          // stuck. `overscroll-behavior: contain` is a SHORTHAND: it sets the
          // y axis too, and an element with `overflow-y: hidden` is still a
          // scroll container on that axis — one with nothing to scroll. So a
          // vertical drag that began on a photo was contained to a box that
          // could not move, rather than chaining to the sheet's scroller, and
          // the sheet refused to move under the shopper's thumb.
          overscrollBehaviorX: "contain",
          overscrollBehaviorY: "auto",
          // The same fix from the other end, and the one that lands before a
          // single scroll event is dispatched: this box handles horizontal
          // pans, so the browser gives anything vertical straight to the
          // ancestor. `pinch-zoom` is kept — a shopper looking closely at a
          // product photo is exactly who needs it.
          touchAction: "pan-x pinch-zoom",
          // Firefox. WebKit's half is the `.sje-scroller` rule in the sheet.
          scrollbarWidth: "none",
          background: "rgba(0,0,0,0.04)",
          // One photo has nothing to scroll past, so it is centred rather than
          // parked against the leading edge with a gap where its neighbour
          // would have been. Safe only because a single slide cannot overflow
          // — `justify-content` on a scroller that DOES overflow makes the far
          // end unreachable.
          justifyContent: many ? "flex-start" : "center",
        }}
      >
        {waiting && images.length === 0 ? (
          <div
            class="sje-skeleton"
            style={{
              flex: "0 0 auto",
              width: slideWidth,
              height: "100%",
              background: SKELETON_FILL,
              ...NOT_EMPTY,
            }}
          >
            {NBSP}
          </div>
        ) : (
          images.map((url, position) => (
            <div
              key={url}
              style={{
                flex: "0 0 auto",
                // Exactly one and a half in view, gap included: a slide plus a
                // gap plus half a slide is the track, so a slide is
                // `(track - gap) / 1.5`.
                width: slideWidth,
                height: "100%",
                scrollSnapAlign: "start",
                // Nothing may squeeze a slide narrower than that: a flex
                // item's `min-width` defaults to `auto`, which is its content
                // — and an image's content is its natural size.
                minWidth: 0,
              }}
            >
              <img
                src={url}
                alt=""
                // The first is what the shopper is looking at the moment the
                // sheet opens; the rest are a swipe away.
                loading={position === 0 ? "eager" : "lazy"}
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  // `contain`, not `cover`. A gallery is for seeing the whole
                  // product — a cropped hero is the badge's job, and cropping
                  // a flat-lay or a size chart is how a shopper misses the
                  // thing they opened it to look at.
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>
          ))
        )}
      </div>

      {/* One photo needs no way to reach a second one. */}
      {many && (
        <>
          <GalleryArrow side="start" disabled={index === 0} onClick={() => show(index - 1)} />
          <GalleryArrow
            side="end"
            disabled={index >= images.length - 1}
            onClick={() => show(index + 1)}
          />
        </>
      )}
    </div>

    <GalleryDots images={images} index={index} onPick={show} />
    </>
  );
}

/**
 * The arrows over the photos.
 *
 * `* 4` — 32px on desktop, 24px on a phone, which is exactly the minimum a
 * pointer target may be. If the mobile spacing token is ever taken below 6px,
 * raise this rather than letting the target follow it down. CLAUDE.md §3.
 */
const GALLERY_ARROW = {
  ...TYPE,
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  display: "grid",
  placeItems: "center",
  width: sp(4),
  height: sp(4),
  padding: 0,
  border: "none",
  borderRadius: "50%",
  background: "rgba(255,255,255,0.92)",
  boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
  color: INK,
  transition: "none",
  WebkitTapHighlightColor: "transparent",
} as const;

interface GalleryArrowProps {
  /** Which edge it hangs off — logical, so it follows a right-to-left store. */
  side: "start" | "end";
  disabled: boolean;
  onClick: () => void;
}

function GalleryArrow({ side, disabled, onClick }: GalleryArrowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "start" ? "Previous photo" : "Next photo"}
      style={{
        ...GALLERY_ARROW,
        insetInlineStart: side === "start" ? sp(1) : undefined,
        insetInlineEnd: side === "end" ? sp(1) : undefined,
        // Faded rather than removed at the ends: a control that vanishes is a
        // control the shopper has to rediscover.
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {side === "start" ? <ChevronLeft size={sp(2)} /> : <ChevronRight size={sp(2)} />}
    </button>
  );
}

/**
 * The dots, or the counter once there are too many to count.
 *
 * Outside the track's wrapper so the arrows can centre on the photos alone.
 */
function GalleryDots({
  images,
  index,
  onPick,
}: {
  images: string[];
  index: number;
  onPick: (position: number) => void;
}) {
  if (images.length < 2) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(0.5),
        padding: `${sp(1)} ${sp(1.5)} 0`,
      }}
    >
      {images.length <= MAX_DOTS ? (
        images.map((url, position) => (
          <button
            key={url}
            type="button"
            onClick={() => onPick(position)}
            aria-label={`Photo ${position + 1} of ${images.length}`}
            aria-current={position === index}
            style={{
              ...TYPE,
              width: sp(0.75),
              height: sp(0.75),
              padding: 0,
              border: "none",
              borderRadius: "50%",
              background: position === index ? INK : "rgba(0,0,0,0.2)",
              cursor: "pointer",
              transition: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          />
        ))
      ) : (
        // Past a handful, dots stop being countable and start being a grey
        // smear. A number says the same thing and keeps saying it.
        <div style={{ fontSize: fs(0.75), color: MUTED }}>
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  );
}

/**
 * A square product photo, or the grey square standing in for one.
 *
 * ⚠️ The box states a real WIDTH and HEIGHT, never `aspect-ratio` alone: a
 * product with no photo leaves it empty, and an empty flex item sized only by
 * a ratio resolves to zero. Same rule as the Liquid skeletons — CLAUDE.md §6.
 */
function Thumb({ url, waiting, steps }: { url?: string; waiting: boolean; steps: number }) {
  return (
    <div
      class={waiting ? "sje-skeleton" : undefined}
      style={{
        flex: "0 0 auto",
        width: sp(steps),
        height: sp(steps),
        borderRadius: sp(0.75),
        overflow: "hidden",
        // White under the photo, grey only while there is no photo. A product
        // shot is very often cut out on white, and grey behind one of those
        // reads as a dirty edge rather than as loading.
        background: waiting ? SKELETON_FILL : "rgba(0,0,0,0.04)",
        ...NOT_EMPTY,
      }}
    >
      {NBSP}
      {url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
    </div>
  );
}

/**
 * A grey bar exactly as tall as the price line it stands in for, so nothing
 * moves when the number lands.
 *
 * The height is stated rather than left to the text, because `NOT_EMPTY`
 * zeroes the placeholder character — which also zeroes the line box it would
 * otherwise have given the box.
 */
function Bar({ steps, width }: { steps: number; width: string }) {
  return (
    <div
      class="sje-skeleton"
      style={{
        marginBlockStart: sp(0.5),
        width,
        height: `calc(${fs(steps)} * 1.2)`,
        borderRadius: sp(0.25),
        background: SKELETON_FILL,
        ...NOT_EMPTY,
      }}
    >
      {NBSP}
    </div>
  );
}

/**
 * Price, was-price and the saving — the same three pieces, in the same order,
 * as the free-scroll card's.
 *
 * Wraps, because three of them do not always fit: a saving pushed onto its own
 * line still reads correctly, while one clipped mid-number does not.
 */
function PriceRow({
  priced,
  steps,
}: {
  priced: { price?: SJEProduct["price"]; compareAtPrice?: SJEProduct["compareAtPrice"] };
  steps: number;
}) {
  const off = percentOff(priced);

  return (
    <div
      style={{
        marginBlockStart: sp(0.5),
        display: "flex",
        alignItems: "baseline",
        flexWrap: "wrap",
        gap: sp(0.5),
      }}
    >
      <span
        style={{
          fontSize: fs(steps),
          lineHeight: 1.2,
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        {priced.price ? formatPrice(priced.price) : NBSP}
      </span>

      {priced.compareAtPrice && (
        <span
          style={{
            fontSize: fs(steps * 0.8),
            lineHeight: 1.2,
            color: WAS_COLOUR,
            textDecoration: "line-through",
            whiteSpace: "nowrap",
          }}
        >
          {formatPrice(priced.compareAtPrice)}
        </span>
      )}

      {off !== null && (
        <span
          style={{
            fontSize: fs(steps * 0.72),
            lineHeight: 1.2,
            fontWeight: 700,
            color: PAPER,
            background: SALE_COLOUR,
            padding: `${sp(0.25)} ${sp(0.5)}`,
            borderRadius: sp(0.375),
            whiteSpace: "nowrap",
          }}
        >
          {`-${off}%`}
        </span>
      )}
    </div>
  );
}

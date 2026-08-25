// src/lib/sje.ts
// The bridge between Liquid and the components.
//
// The blocks put everything a component needs on `window.SJE` before any of
// this loads: the widget itself, and every media it plays. That is why a
// component never fetches — the data is already inlined in the page by the
// time the script is asked for.
//
// Shapes mirror what `saveWidgets.ts` / `saveAppMedia.ts` write into the
// app-installation metafields, read back through `app.metafields` in Liquid.
// Every field is optional-by-attitude: a widget saved by an older version of
// the app may be missing anything, so components must not assume.

export interface SJEProduct {
  id: string;
  title: string;
  handle: string;
  imageUrl?: string;
  price?: { amount: string; currencyCode: string };
}

export interface SJEMedia {
  id: string;
  fileGid: string;
  kind: "video" | "image";
  title: string;
  url: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  previewStartSeconds?: number;
  previewFileGid?: string;
  previewUrl?: string;
  stickyProductId?: string;
  products?: SJEProduct[];
  stickerPosition?: { x: number; y: number };
  stickerSize?: number;
  stickerRotation?: number;
  showSticker?: boolean;
  addedAt?: string;
}

export interface SJEWidget {
  id: string;
  name: string;
  layout: string;
  enabled: boolean;
  mediaIds: string[];
  updatedAt?: string;
  version?: number;
}

/** How a given layout's script is doing. Set by the Liquid loader. */
export type SJEScriptStatus = "idle" | "loading" | "loaded" | "error";

export interface SJEGlobal {
  widgets: Record<string, SJEWidget>;
  media: Record<string, SJEMedia>;
  /** Keyed by layout — `carousel`, `story-bar`, … — so one layout's script
   *  loading never makes another think it has already run. */
  scripts: Record<string, SJEScriptStatus>;
  booted?: boolean;
  load?: (layout: string) => void;
}

declare global {
  interface Window {
    SJE?: SJEGlobal;
  }
}

/**
 * The global, created if a block has not already. A component can be loaded
 * in isolation (a stray script tag, a dev page), so this never assumes the
 * Liquid ran first.
 */
export function sje(): SJEGlobal {
  const existing = window.SJE;
  if (existing) {
    existing.widgets ??= {};
    existing.media ??= {};
    existing.scripts ??= {};
    return existing;
  }

  const created: SJEGlobal = { widgets: {}, media: {}, scripts: {} };
  window.SJE = created;
  return created;
}

/** A widget by id, or `null` when the page never registered it. */
export function widget(id: string): SJEWidget | null {
  return sje().widgets[id] ?? null;
}

/**
 * The media a widget plays, IN ORDER, skipping any the page did not register
 * — a media deleted from the library after the widget was saved leaves its id
 * behind, and a hole is better than a broken tile.
 */
export function widgetMedia(w: SJEWidget): SJEMedia[] {
  const all = sje().media;
  const out: SJEMedia[] = [];
  for (const id of w.mediaIds ?? []) {
    const m = all[id];
    if (m) out.push(m);
  }
  return out;
}

/** The poster to show before anything plays. */
export function posterOf(media: SJEMedia): string | undefined {
  return media.thumbnailUrl || (media.kind === "image" ? media.url : undefined);
}

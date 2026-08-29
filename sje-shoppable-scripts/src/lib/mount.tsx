// src/lib/mount.ts
// Find a layout's mount points and render into them.
//
// Every entry does the same three things — find the divs, look the widget up,
// render — so it lives here once and each entry is a single call.
//
// Mount points are `<div id="sje-{layout}-{widgetId}" data-sje-widget-id>`,
// written by the block. The id carries the widget, so a page can hold several
// widgets of the same layout and each renders its own.
//
// ── Why it re-scans ──
//
// A script is fetched once per page, but mount points can appear afterwards:
// the theme editor re-renders a section on every settings change, and some
// themes load sections on demand. So after the first pass this keeps watching
// and renders anything new. Already-rendered nodes are marked so a re-scan
// never mounts twice over the top of itself.
import { render, type ComponentType } from "preact";
import { widget, type SJEWidget } from "./sje";
import { readSettings, type SJESettings } from "./settings";

export interface WidgetProps {
  /** The merchant's content, shared by every block showing this widget. */
  widget: SJEWidget;
  /** This one placement's appearance, from the block's theme-editor settings. */
  settings: SJESettings;
}

/** Marks a node as rendered, so a re-scan skips it. */
const MOUNTED = "sjeMounted";

function mountInto(node: HTMLElement, Component: ComponentType<WidgetProps>): void {
  if (node.dataset[MOUNTED] === "1") return;

  const id = node.dataset.sjeWidgetId;
  if (!id) return;

  const found = widget(id);
  // The block only writes a mount point for a widget it resolved, so a miss
  // here means the data script did not run — worth saying out loud rather
  // than leaving an empty div and no explanation.
  if (!found) {
    console.warn(`[SJE] no widget data for "${id}" — was the block's data script blocked?`);
    return;
  }

  node.dataset[MOUNTED] = "1";
  // Read per mount point, not once per script: two blocks can show the same
  // widget with different settings, and each owns its own.
  render(<Component widget={found} settings={readSettings(node)} />, node);
}

/**
 * Render `Component` into every mount point for `layout`, now and whenever
 * another appears.
 */
export function mountAll(layout: string, Component: ComponentType<WidgetProps>): void {
  const selector = `[data-sje-widget-id][id^="sje-${layout}-"]`;

  const scan = () => {
    document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      mountInto(node, Component);
    });
  };

  // The script is loaded on interaction, so the document is long since
  // parsed — but guard anyway for the case where it is loaded eagerly.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  } else {
    scan();
  }

  if (window.MutationObserver) {
    new MutationObserver(scan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
}

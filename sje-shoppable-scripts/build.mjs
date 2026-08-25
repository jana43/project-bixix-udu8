// build.mjs
// Build one self-contained script per widget layout, straight into the theme
// app extension's assets.
//
// ── Why a script instead of plain `vite build` ──
//
// Vite's multi-entry build shares code between entries as separate chunks.
// That is right for an app, and wrong here: each file is fetched on its own by
// a Liquid block through a hardcoded URL, so a chunk it depends on would 404.
// Building each entry ALONE, in library mode, guarantees one flat file with
// everything inlined.
//
// The cost is Preact being duplicated across layouts (~4KB each). A page
// normally shows one layout, and the block only fetches the script for the
// layout it renders, so in practice nothing is downloaded twice.
import { build } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Where the extension serves its assets from. */
const OUT_DIR = resolve(here, "../extensions/shoppable-videos/assets");

/** entry file → asset filename the Liquid loader asks for. */
const ENTRIES = [
  { entry: "src/entries/carousel.tsx", file: "sje-carousel.js" },
  { entry: "src/entries/stories.tsx", file: "sje-stories.js" },
];

for (const { entry, file } of ENTRIES) {
  await build({
    root: here,
    configFile: false,
    plugins: [preact()],
    logLevel: "info",
    build: {
      outDir: OUT_DIR,
      // Each entry is written on its own pass, so the directory must survive
      // the other passes — and it holds hand-written assets (the CSS) that
      // are not ours to delete.
      emptyOutDir: false,
      // `public/` belongs to the Vite dev page, not to the extension. Without
      // this its contents are copied into the theme's assets on every build.
      copyPublicDir: false,
      target: "es2020",
      // `true`, not `"esbuild"` — Vite 8 minifies with Oxc, and asking for
      // esbuild by name requires installing it as a separate package.
      minify: true,
      cssCodeSplit: false,
      lib: {
        entry: resolve(here, entry),
        // IIFE: no imports, no exports, runs on load. A theme asset is a
        // plain script tag, not a module graph.
        formats: ["iife"],
        name: "SJEBundle",
        fileName: () => file,
      },
      rollupOptions: {
        output: {
          // Any CSS a component imports rides along under a predictable name
          // rather than a hashed one the block could not reference.
          assetFileNames: file.replace(/\.js$/, "[extname]"),
        },
      },
    },
  });
}

console.log(`\n✓ ${ENTRIES.length} bundles written to ${OUT_DIR}`);

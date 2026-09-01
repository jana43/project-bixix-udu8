// src/entries/productVideos.tsx
// Build entry for the product-videos block. Becomes
// `assets/sje-product-videos.js`.
//
// One entry per layout, each self-contained: a page only ever downloads the
// script for the layouts it actually shows — and this one is only ever on a
// product page, because its block is restricted to product templates.
import { mountAll } from "../lib/mount";
import { sje } from "../lib/sje";
import { ProductVideos } from "../components/ProductVideos";

sje().scripts["product-videos"] = "loaded";
mountAll("product-videos", ProductVideos);

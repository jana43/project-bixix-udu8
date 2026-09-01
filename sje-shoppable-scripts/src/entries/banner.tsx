// src/entries/banner.tsx
// Build entry for the banner block. Becomes `assets/sje-banner.js`.
//
// One entry per layout, each self-contained: a page only ever downloads the
// script for the layouts it actually shows.
import { mountAll } from "../lib/mount";
import { sje } from "../lib/sje";
import { Banner } from "../components/Banner";

sje().scripts["banner"] = "loaded";
mountAll("banner", Banner);

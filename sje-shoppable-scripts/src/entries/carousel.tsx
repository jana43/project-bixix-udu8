// src/entries/carousel.tsx
// Build entry for the carousel block. Becomes `assets/sje-carousel.js`.
//
// One entry per layout, each self-contained: a page only ever downloads the
// script for the layouts it actually shows.
import { mountAll } from "../lib/mount";
import { sje } from "../lib/sje";
import { Carousel } from "../components/Carousel";

sje().scripts["carousel"] = "loaded";
mountAll("carousel", Carousel);

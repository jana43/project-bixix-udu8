// src/entries/grid.tsx
// Build entry for the grid block. Becomes `assets/sje-grid.js`.
//
// One entry per layout, each self-contained: a page only ever downloads the
// script for the layouts it actually shows.
import { mountAll } from "../lib/mount";
import { sje } from "../lib/sje";
import { Grid } from "../components/Grid";

sje().scripts["grid"] = "loaded";
mountAll("grid", Grid);

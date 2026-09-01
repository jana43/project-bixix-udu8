// src/entries/bubble.tsx
// Build entry for the floating-bubble block. Becomes `assets/sje-bubble.js`.
//
// One entry per layout, each self-contained: a page only ever downloads the
// script for the layouts it actually shows.
//
// The layout is called `floating-bubble` in the app and in the mount point id,
// so that — not "bubble" — is what `mountAll` matches on. The script FILE is
// `sje-bubble.js`, the same deliberate difference the story bar has.
import { mountAll } from "../lib/mount";
import { sje } from "../lib/sje";
import { Bubble } from "../components/Bubble";

sje().scripts["floating-bubble"] = "loaded";
mountAll("floating-bubble", Bubble);

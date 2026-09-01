// src/entries/stacked.tsx
// Build entry for the stacked block. Becomes `assets/sje-stacked.js`.
//
// The layout name matches everywhere here — the block's class, the mount
// point's id, `mountAll` and the key in `window.SJE.scripts` are all
// `stacked`, and so is the asset. The story bar is the one layout where the
// script file and the layout name differ; see CLAUDE.md §2.
import { mountAll } from "../lib/mount";
import { sje } from "../lib/sje";
import { Stacked } from "../components/Stacked";

sje().scripts["stacked"] = "loaded";
mountAll("stacked", Stacked);

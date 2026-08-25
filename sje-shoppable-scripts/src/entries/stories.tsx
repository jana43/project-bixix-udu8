// src/entries/stories.tsx
// Build entry for the story-bar block. Becomes `assets/sje-stories.js`.
//
// The layout is called `story-bar` in the app and in the mount point id, so
// that — not "stories" — is what `mountAll` matches on.
import { mountAll } from "../lib/mount";
import { sje } from "../lib/sje";
import { Stories } from "../components/Stories";

sje().scripts["story-bar"] = "loaded";
mountAll("story-bar", Stories);

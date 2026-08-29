// src/components/Stories.tsx
// A row of circular thumbnails, like a story bar.
//
// First pass: posters only. Tapping one should open the full-screen player,
// which comes later.
//
// Inline styles for the same reason as `Carousel` — this renders inside a
// merchant's theme and must not depend on our class names surviving theirs.
import { widgetMedia, posterOf, type SJEMedia } from "../lib/sje";
import { sp } from "../lib/tokens";
import type { WidgetProps } from "../lib/mount";

/** The circle's diameter: nine standard spacings, so 72px on desktop. */
const SIZE = sp(9);
/** The ring, drawn as a shadow so it costs no layout. */
const RING = "0 0 0 2px #fff, 0 0 0 4px #c9922f";

function Story({ media }: { media: SJEMedia }) {
  const poster = posterOf(media);

  return (
    <div
      style={{
        flex: `0 0 ${SIZE}`,
        height: SIZE,
        borderRadius: "50%",
        overflow: "hidden",
        background: "rgba(0,0,0,0.08)",
        boxShadow: RING,
        cursor: "pointer",
      }}
      title={media.title || undefined}
    >
      {poster && (
        <img
          src={poster}
          alt={media.title || ""}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
    </div>
  );
}

export function Stories({ widget }: WidgetProps) {
  const media = widgetMedia(widget);
  if (media.length === 0) return null;

  return (
    // `padding-block` leaves room for the ring, which would otherwise be
    // clipped by the scroll container.
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: sp(2),
        overflowX: "auto",
        paddingBlock: sp(0.5),
      }}
    >
      {media.map((item) => (
        <Story key={item.id} media={item} />
      ))}
    </div>
  );
}

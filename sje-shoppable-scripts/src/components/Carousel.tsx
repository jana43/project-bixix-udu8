// src/components/Carousel.tsx
// A horizontal row of 9:16 cards the shopper scrolls through.
//
// First pass: posters only. Playback, the product sticker and the full-screen
// player come later — this is the shape, wired to real data.
//
// Styling is inline for the same reason the Liquid skeletons are: this
// renders inside a merchant's theme, where a class name of ours may collide
// with theirs and their reset may undo ours. Inline wins both.
import { widgetMedia, posterOf, type SJEMedia } from "../lib/sje";
import type { WidgetProps } from "../lib/mount";

/** Matches the Liquid skeleton, so nothing jumps when this takes over. */
const CARD_HEIGHT = "100%";

function Card({ media }: { media: SJEMedia }) {
  const poster = posterOf(media);

  return (
    <div
      style={{
        flex: "0 0 auto",
        height: CARD_HEIGHT,
        aspectRatio: "9 / 16",
        borderRadius: 8,
        overflow: "hidden",
        background: "rgba(0,0,0,0.08)",
        position: "relative",
        cursor: "pointer",
      }}
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

export function Carousel({ widget }: WidgetProps) {
  const media = widgetMedia(widget);
  if (media.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 12,
        overflowX: "auto",
        height: "100%",
      }}
    >
      {media.map((item) => (
        <Card key={item.id} media={item} />
      ))}
    </div>
  );
}

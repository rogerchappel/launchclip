// Reflow: the make-room layout primitive (ART_DIRECTION 4d.2). A stacked
// scene's children share one layout that re-solves as items enter: each item
// occupies a slot that grows with its entrance spring ("presence"), so every
// element already on screen glides to its new position instead of jumping
// when the flexbox re-centers. Framework-free and deterministic, like
// schema.js — components feed it spring values and apply the offsets.

// sizes[i]: the item's full extent along the stack axis (px).
// presences[i]: 0..1 entrance progress (a spring; may overshoot slightly).
// gap: spacing between adjacent items, which also grows with the entering
// item's presence so space opens exactly as the newcomer needs it.
// Returns center offsets relative to the stack's own center, so a stack
// anchored mid-frame stays balanced while it grows.
export function stackLayout({ sizes, presences, gap = 0 }) {
  const slotCenters = [];
  let cursor = 0;
  sizes.forEach((size, index) => {
    const presence = Math.max(0, presences[index] ?? 0);
    if (index > 0) cursor += gap * presence;
    slotCenters.push(cursor + (size * presence) / 2);
    cursor += size * presence;
  });
  const total = cursor;
  return { centers: slotCenters.map((center) => center - total / 2), total };
}

// Focal micro-motion (ART_DIRECTION 4d.3): focal cards are never statically
// framed. A slow push-in plus a right-to-left pan across the scene — eased so
// it is imperceptible as movement but felt as life. Returns scale and a pan
// as a fraction of frame width (positive = right), starting right of center
// and drifting left.
export function focalDrift({ frame, fps, seconds, zoom = 0.05, pan = 0.012 }) {
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, seconds * fps)));
  const eased = progress * progress * (3 - 2 * progress);
  return {
    scale: 1 + zoom * eased,
    panX: (0.5 - eased) * 2 * pan
  };
}

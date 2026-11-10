// Tooling fits captions around cards: a storyboard that fails because a card
// sits in the caption band while captions are visible ("layout: caption-band
// @0.3s [cover-callouts, captions] ... while captions are visible
// (0.3s–1.4s)") gets the captions hidden for that window instead of a failed
// plan. A caption position the module layout does not plan for (captions in
// the middle of the frame, where every card sits) otherwise fails every
// attempt. The card carries the line's words while it is up, and the captions
// come back when it goes. The layout check stays strict; this only adds
// [start, end] ranges to the captions overlay's `hide`.

const BAND_ERROR = /^layout: caption-band @[\d.]+s \[([^,\]]+), ([^\]]+)\][^]*?while captions are visible \(([\d.]+)s–([\d.]+)s\)/;

/** The caption-band clashes in a list of check errors: [{scene, captions, start, end}]. */
export function captionBandErrors(errors) {
  const out = [];
  for (const error of errors ?? []) {
    const match = BAND_ERROR.exec(String(error));
    if (!match) continue;
    const [, scene, captions, start, end] = match;
    if (!(Number(end) > Number(start))) continue;
    out.push({ scene: scene.trim(), captions: captions.trim(), start: Number(start), end: Number(end) });
  }
  return out;
}

/**
 * A copy of the storyboard with the captions hidden over each clash, and
 * what changed: {storyboard, hidden: ["captions 0.3–1.4 s under cover-callouts"]}.
 * Only overlays already in the storyboard change.
 */
export function fitCaptionBand(storyboard, errors) {
  const found = captionBandErrors(errors);
  // No overlays at all: the captions are the style pack's (applyStyle adds
  // the overlay when the story declares none), so the story gets a captions
  // overlay of its own to carry the ranges; the pack still fills the rest.
  const styled = storyboard && typeof storyboard === "object" && storyboard.overlays === undefined;
  if (!found.length || !(styled || Array.isArray(storyboard?.overlays))) return { storyboard, hidden: [] };
  const copy = structuredClone(storyboard);
  if (styled) copy.overlays = [{ type: "captions" }];
  const hidden = [];
  for (const clash of found) {
    const overlay = copy.overlays.find((item) => item?.type === "captions" && item.id === clash.captions)
      ?? copy.overlays.find((item) => item?.type === "captions");
    if (!overlay) continue;
    const ranges = Array.isArray(overlay.hide) ? overlay.hide : [];
    // A hair wider than the clash, so rounding never leaves a frame of overlap.
    const range = [round(Math.max(0, clash.start - 0.02)), round(clash.end + 0.02)];
    if (ranges.some((entry) => Array.isArray(entry) && Number(entry[0]) <= range[0] && Number(entry[1]) >= range[1])) continue;
    overlay.hide = [...ranges, range];
    hidden.push(`captions ${range[0]}–${range[1]} s under ${clash.scene}`);
  }
  return { storyboard: hidden.length ? copy : storyboard, hidden };
}

/**
 * The caption band, settled: while the checks report a card in the band, the
 * captions are hidden under it and the storyboard is checked again (one
 * round can expose the next clash). check(storyboard) → {ok, errors}, the
 * caller's own check. → {storyboard, checked (the last check), hidden};
 * nothing changes when no clash is reported or none can be fitted.
 */
export function settleCaptionBand(storyboard, checked, check, { passes = 4 } = {}) {
  const hidden = [];
  for (let pass = 0; pass < passes && !checked.ok; pass += 1) {
    const fitted = fitCaptionBand(storyboard, checked.errors);
    if (!fitted.hidden.length) break;
    storyboard = fitted.storyboard;
    hidden.push(...fitted.hidden);
    checked = check(storyboard);
  }
  return { storyboard, checked, hidden };
}

/** The warning a stage records for the ranges settleCaptionBand hid. */
export function captionBandWarning(hidden) {
  return `layout: tooling hid ${hidden.join("; ")}`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

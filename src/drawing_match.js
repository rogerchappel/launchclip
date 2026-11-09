// From measured drawing traits (src/drawing_traits.js) to what LaunchClip can
// draw: the nearest drawing style of the characters kit, the backdrop, the
// illustration treatment and the panel corners. Whatever has no dial is
// listed as unmatched with the reason, never guessed.
//
//   matchDrawingStyle(traits)   → {name, distance, runner_up, ranked, unprofiled} | null
//   mapDrawingTraits(block)     → {apply, matched, unmatched}
//
// Drawing styles are matched on what a frame shows of the figures whatever
// the backdrop is: how many boundaries are inked, how much of the picture is
// line, cel shading, and shading inside the figure. Each style's own numbers
// are measured the same way (src/drawing_style_profiles.js, written by
// scripts/measure-drawing-styles.mjs). Only measured traits are matched: a
// style is how a figure is rendered, never whose character it is.
import { DRAWING_STYLES } from "@launchclip/core/characters/styles.mjs";
import { PANEL_RADIUS } from "@launchclip/core/panels.mjs";
import { DRAWING_STYLE_PROFILES } from "./drawing_style_profiles.js";

// A reference further than this from every drawing style is not matched to one.
export const DRAWING_STYLE_MATCH = 0.3;
// A trait under this confidence is reported, not applied.
export const DRAWING_APPLY_CONFIDENCE = 0.5;

const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const unit = (value) => Math.max(0, Math.min(1, value));

/** The distance between a reference's figure traits and a drawing style's profile (0–1). */
export function drawingStyleDistance(traits, profile) {
  if (!traits?.outline || !traits?.fill || !profile?.outline || !profile?.fill) return null;
  const o = traits.outline, f = traits.fill, po = profile.outline, pf = profile.fill;
  return round(0.35 * Math.abs(o.presence - po.presence) + 0.2 * Math.abs(o.line_share - po.line_share) + 0.25 * unit(Math.abs(f.cel - pf.cel) / 0.3) + 0.2 * unit(Math.abs((f.shaded ?? f.gradient) - (pf.shaded ?? pf.gradient)) / 0.5));
}

/**
 * The drawing styles nearest a reference's traits. → {name, distance,
 * runner_up, ranked: [{name, distance}], unprofiled: [style]} or null when the
 * outline or the fill could not be measured. `unprofiled` lists styles of the
 * kit that have no measured profile yet and so were not considered.
 */
export function matchDrawingStyle(traits, { profiles = DRAWING_STYLE_PROFILES, styles = DRAWING_STYLES } = {}) {
  const ranked = [], unprofiled = [];
  for (const name of styles) {
    const distance = drawingStyleDistance(traits, profiles[name]);
    if (distance === null) { if (!profiles[name]?.outline || !profiles[name]?.fill) unprofiled.push(name); continue; }
    ranked.push({ name, distance });
  }
  if (!ranked.length) return null;
  ranked.sort((a, b) => a.distance - b.distance);
  return { name: ranked[0].name, distance: ranked[0].distance, runner_up: ranked[1] ?? null, ranked, unprofiled };
}

/**
 * Map a drawing-traits block to pack fields. → {apply: {cast?,
 * background?, vocabulary?, panel_radius?}, matched: [{trait, field, value,
 * confidence, why}], unmatched: [{trait, measured, reason}]}
 */
export function mapDrawingTraits(block, { profiles, styles } = {}) {
  const traits = block?.traits ?? {};
  const apply = {}, matched = [], unmatched = [];
  const { outline, fill, grain, shape, stepping } = traits;
  const weak = (trait) => trait.confidence < DRAWING_APPLY_CONFIDENCE;
  for (const entry of block?.unmeasured ?? []) unmatched.push({ trait: entry.trait, measured: null, reason: `not measured: ${entry.reason}` });
  // Frames that are mostly footage or dense detail are not a drawing to match.
  const drawn = fill && fill.even_area >= 0.3 && fill.type !== "textured";

  // Drawing style.
  const match = outline && fill ? matchDrawingStyle(traits, { profiles, styles }) : null;
  if (!match) unmatched.push({ trait: "drawing style", measured: null, reason: "the outline or the fill could not be measured, so no drawing style is compared" });
  else if (!drawn) unmatched.push({ trait: "drawing style", measured: `nearest ${match.name} (distance ${match.distance})`, reason: "the frames are mostly footage or texture, not drawn shapes: no drawing style is set" });
  else if (weak(outline) || weak(fill)) unmatched.push({ trait: "drawing style", measured: `nearest ${match.name} (distance ${match.distance})`, reason: `the outline (confidence ${outline.confidence}) or the fill (${fill.confidence}) is too uncertain to choose a style from` });
  else if (match.distance > DRAWING_STYLE_MATCH) unmatched.push({ trait: "drawing style", measured: `nearest ${match.name} (distance ${match.distance})`, reason: `no drawing style comes within ${DRAWING_STYLE_MATCH} of the reference: it is drawn in a way the kit does not have` });
  else {
    // A style barely nearer than the next is a coin toss: its confidence falls with the margin.
    const margin = match.runner_up ? match.runner_up.distance - match.distance : 0.3;
    const confidence = round(Math.min(outline.confidence, fill.confidence) * unit(0.5 + (margin / 0.1) * 0.5), 2);
    const why = `nearest of ${match.ranked.length} drawing styles at distance ${match.distance}${match.runner_up ? ` (then ${match.runner_up.name} at ${match.runner_up.distance})` : ""}`;
    if (confidence < DRAWING_APPLY_CONFIDENCE) unmatched.push({ trait: "drawing style", measured: `nearest ${match.name} (distance ${match.distance})`, reason: `${match.runner_up.name} is as near (${match.runner_up.distance}): the measurements do not tell them apart, so none is set (confidence ${confidence})` });
    else { apply.cast = { drawing_style: match.name }; matched.push({ trait: "drawing style", field: "cast.drawing_style", value: match.name, confidence, why }); }
  }
  if (match?.unprofiled.length) unmatched.push({ trait: "drawing style", measured: null, reason: `not compared with ${match.unprofiled.join(", ")}: no measured profile yet (run node scripts/measure-drawing-styles.mjs)` });

  if (outline) {
    if (outline.color) unmatched.push({ trait: "outline colour", measured: `${outline.color} (${outline.tone} lines)`, reason: "each drawing style inks in its own line colour; brand.colors.ink is the colour of text on the primary colour, not the pen, so it is left alone" });
    if (outline.weight) unmatched.push({ trait: "line weight", measured: `${outline.weight} px at 1080 (spread ×${outline.weight_spread})`, reason: "each drawing style draws its own line weights; there is no line-weight dial" });
  }

  if (fill && drawn && !weak(fill)) {
    const lined = outline && !weak(outline) && outline.label === "line-art";
    const illustration = lined ? "line" : fill.type === "cel-shaded" ? "flat-shadow" : fill.type === "flat" ? "flat" : null;
    if (illustration) { apply.vocabulary = { illustration, ...(lined ? { icon_style: "outline" } : {}) }; matched.push({ trait: "fill", field: "vocabulary.illustration", value: illustration, confidence: fill.confidence, why: lined ? "line art: illustrations and icons drawn in line" : `${fill.type} fills` }); }
    else unmatched.push({ trait: "fill", measured: fill.type, reason: "illustrations draw flat, flat-shadow or line; there is no gradient treatment for them (the soft-shade, lifelike and avatar drawing styles shade characters)" });
    // Backdrop: what the even areas of the whole frame do.
    const textured = grain && grain.label !== "none" && !weak(grain);
    const kind = fill.gradient >= 0.3 ? (textured ? "grain-gradient" : "gradient") : textured ? "paper" : fill.gradient < 0.1 ? "flat" : null;
    if (kind) { apply.background = { kind }; matched.push({ trait: textured ? "fill and grain" : "fill", field: "background.kind", value: kind, confidence: round(Math.min(fill.confidence, textured ? grain.confidence : 1), 2), why: `${fill.gradient >= 0.3 ? "graded" : "even"} areas${textured ? " under a texture" : ""} across the frame` }); }
  } else if (fill) unmatched.push({ trait: "fill", measured: fill.type, reason: drawn ? `too uncertain to set (confidence ${fill.confidence})` : "the frames are mostly footage or texture: no illustration treatment or backdrop is set" });

  if (grain && grain.label !== "none") unmatched.push({ trait: "grain", measured: `${grain.label}, ${grain.amount} luma levels over ${Math.round(grain.coverage * 100)}% of the even areas`, reason: "a paper or grain backdrop textures the background only; nothing lays grain over the drawings except a medium (oil, watercolour, pastel, ink, gouache), which repaints the whole picture, so none is set" });

  if (shape) {
    if (weak(shape)) unmatched.push({ trait: "shape", measured: `${shape.label} (roundness ${shape.roundness})`, reason: `too uncertain to set panel corners from (confidence ${shape.confidence})` });
    else {
      const radius = shape.label === "angular" ? 4 : shape.label === "rounded" ? Math.min(PANEL_RADIUS.max, 32) : 16;
      apply.panel_radius = radius;
      matched.push({ trait: "shape", field: "layouts.panel.radius", value: radius, confidence: shape.confidence, why: `${shape.label} shapes (roundness ${shape.roundness})` });
      unmatched.push({ trait: "shape", measured: `${shape.label} (roundness ${shape.roundness})`, reason: "only panel corners follow it; the shapes of characters, icons and charts are fixed by their modules" });
    }
  }

  if (stepping) {
    if (stepping.label === "ones") matched.push({ trait: "stepping", field: "(none needed)", value: "ones", confidence: stepping.confidence, why: "LaunchClip animates a new drawing every frame" });
    else unmatched.push({ trait: "stepping", measured: `${stepping.label}, ${stepping.drawings_per_second} drawings a second`, reason: "LaunchClip animates a new drawing every frame; no dial holds drawings for two or three frames (a medium's boil redraws only its texture on threes)" });
  }
  return { apply, matched, unmatched };
}

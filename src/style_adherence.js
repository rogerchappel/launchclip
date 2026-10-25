// Style adherence (docs/VIDEO_QUALITY_RFC.md §9.5): does a render follow the
// style its story names? `launchclip style check` reports it, and `finish`
// runs it as the `style` gate whenever the story names a style.
//
// Checks, each an error (fails the gate) or a warning (heuristic; reported):
// - palette: the render's colour clusters against the style's (reference
//   palette, else brand colours), measured both ways. The colours are the
//   styled story's: a storyboard `brand` override wins over the pack, and
//   then the override's colours replace the pack's reference palette. Footage-led renders are mostly footage, so
//   there it only asks that the brand primary shows up somewhere (warning):
//   the storyboard says where it is drawn (captions, brand frame, graphic
//   scenes); the share of pixels in the primary's hue only backs that up.
// - captions: the story's captions use the style's preset for its lane
//   (error); their resolved case matches the style's (warning). Without a
//   storyboard the case is read from the render's caption band, a heuristic
//   that is only a note when its confidence is low.
// - layout mix: the render's footage layouts against the reference mix
//   (warning; only when the style was drafted from references).
// - cadence: the render's shot length and visual and layout changes per
//   minute sit inside the style's profile band (kit/core/profiles.mjs
//   compareMeasures: each measure's own band, max or min rule) (error).
//   For our own renders these come from the resolved storyboard (scene starts
//   and ends, camera moves, layout changes), exactly as the coverage gate
//   counts them; a cut detector on the pixels misses graphics that change
//   over a held shot. Pixel pacing is used only without a storyboard.
//   Without a measured profile, the reference pacing stands in (error), else
//   the motion grammar's shot range (warning) (compareToStyle).
// - brand frame: when the style has one, the story draws it (error), unless
//   the story turns it off with "frame": false (warning).
import { brandFramePlan, storyFrame } from "../kit/core/brand-frame.mjs";
import { CAPTION_PRESETS, captionOptions, captionPresetName, captionsOverlayOf } from "../kit/core/captions.mjs";
import { colorDistance, hexToHsl, packCaptionsFor } from "../kit/core/style.mjs";
import { compareMeasures } from "../kit/core/profiles.mjs";
import { isGraphicScene, storyboardMeasures } from "../kit/core/cadence.mjs";
import { directionMeasures } from "../kit/core/direction.mjs";
import { storySections } from "../kit/core/story.mjs";
import { resolveProfile } from "./profile_store.js";
import { compareToStyle, paletteDistance } from "./style_reference.js";

export const ADHERENCE = Object.freeze({ palette: 0.12, presence: 0.15, primaryShare: 0.002, layoutMix: 0.35 });

const round = (value, places = 3) => (Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null);

/**
 * story: the resolved, style-merged story; pack: the v3 style; measured:
 * analyzeReference() of the render; profile: the style's cadence profile
 * object (pack.profile when inline, or a shipped profile the caller looked
 * up by id; null to skip the band check); cadence: the storyboard's
 * measures (storyCadence), else they are computed from `story` when it is
 * resolved, else the render's pixel pacing stands in.
 * → {status: "passed" | "failed", checks: [{check, severity, ok, expected, measured, detail}]}
 */
export function styleAdherence({ story, pack, measured, profile = typeof pack?.profile === "object" ? pack.profile : null, cadence = storyCadence(story) }) {
  const checks = [];
  const add = (check, severity, ok, expected, value, detail) => checks.push({ check, severity, ok, expected, measured: value, detail });
  const lane = story?.lane;

  // Palette: the styled story's colours (its own brand overrides, the pack's
  // for the rest). When the story overrides a pack colour, the pack's
  // reference palette no longer describes the render, so its colours stand in.
  const colors = { ...(pack?.brand?.colors ?? {}), ...(story?.brand?.colors ?? {}) };
  const overrides = brandOverrides(story, pack);
  const reference = overrides.length ? null : pack?.reference_stats?.palette ?? null;
  const expected = reference ?? Object.values(colors).map((hex) => ({ hex, weight: 1 }));
  if (measured?.palette?.length && expected.length) {
    if (lane === "footage-led") {
      const primary = colors.primary;
      if (primary) {
        // What the storyboard draws in the primary is exact; the pixels only support it.
        const drawn = primaryUses(story, primary);
        const share = primaryShare(measured, primary);
        const nearest = Math.min(...measured.palette.map((entry) => colorDistance(entry.hex, primary)));
        const seen = share !== null ? share >= ADHERENCE.primaryShare : nearest <= ADHERENCE.presence;
        const pixels = share !== null ? `${round(share * 100, 2)}% of sampled pixels are near it` : `nearest render colour ${round(nearest, 4)} away`;
        if (drawn.length) add("palette", "warning", true, `brand primary ${primary} drawn`, drawn, `the storyboard draws the brand primary in ${drawn.join(", ")} (${pixels})`);
        else if (story && Array.isArray(story.scenes)) add("palette", "warning", seen, `brand primary ${primary} drawn`, share ?? round(nearest, 4), seen ? `the brand primary shows in the render (${pixels})` : `nothing in the storyboard draws the brand primary ${primary} and ${pixels}; give the captions, frame or panels a brand colour`);
        else add("palette", seen ? "warning" : "note", seen, `brand primary ${primary} within ${ADHERENCE.presence}`, share ?? round(nearest, 4), seen ? `the brand primary shows in the render (${pixels})` : `little of the brand primary ${primary} shows in sampled frames (${pixels}); footage dominates, so check captions, frame and panels by eye (a heuristic)`);
      }
    } else {
      // Both ways: every render colour near a style colour, and the style's main colours present in the render.
      // With brand colours only, the reverse asks for the background, text and primary (an accent may rightly be rare).
      const main = reference ?? [["bg", 0.6], ["paper", 0.2], ["primary", 0.2]].filter(([role]) => colors[role]).map(([role, weight]) => ({ hex: colors[role], weight }));
      const distance = Math.max(paletteDistance(measured.palette, expected), paletteDistance(main, measured.palette) ?? 0);
      add("palette", "error", distance <= ADHERENCE.palette, `≤ ${ADHERENCE.palette}`, distance, distance <= ADHERENCE.palette ? `the render's colours match the ${overrides.length ? `story's brand colours (it overrides ${overrides.join(", ")})` : "style"}` : `the render's colours are ${distance} from the ${overrides.length ? `story's brand colours (it overrides ${overrides.join(", ")})` : "style's palette"} (limit ${ADHERENCE.palette}); check full-bleed media and colours set outside brand.colors`);
    }
  }

  // Captions.
  const wanted = packCaptionsFor(pack, lane)?.preset ?? null;
  const overlay = captionsOverlayOf(story);
  if (wanted && wanted !== "none") {
    if (!overlay) add("captions", "warning", false, wanted, null, "the story has no captions; the style expects them");
    else {
      const used = captionPresetName(overlay, story);
      add("captions", "error", used === wanted, wanted, used, used === wanted ? `captions use the style's ${wanted} preset` : `captions use ${used}, but the style's ${lane ?? "default"} preset is ${wanted}; remove the overlay's style/preset so the style fills it`);
    }
  }
  // Caption case: our own captions' resolved case is exact; the measured case is a heuristic for renders without a storyboard.
  const styleCase = caseOf(pack?.reference_stats?.captions?.case ?? (wanted && wanted !== "none" ? CAPTION_PRESETS[wanted]?.case : null));
  if (styleCase && overlay) {
    const drawn = caseOf(captionOptions(overlay, { brand: story?.brand, format: story?.format, story }).case);
    add("caption case", "warning", drawn === styleCase, styleCase, drawn, drawn === styleCase ? "the storyboard's captions draw the style's case" : `the storyboard's captions draw ${drawn === "upper" ? "capitals" : "sentence case"}, but the style uses ${styleCase === "upper" ? "capitals" : "sentence case"}; remove the overlay's case so the style fills it`);
  } else if (styleCase && !story && measured?.captions?.case) {
    const seenCase = measured.captions.case;
    const confident = Number(measured.captions.confidence) >= 0.5;
    add("caption case", confident ? "warning" : "note", seenCase === styleCase, styleCase, seenCase, seenCase === styleCase ? "the measured caption case matches the style" : `the render's caption text looks ${seenCase === "upper" ? "upper-case" : "sentence case"}, but the style uses ${styleCase === "upper" ? "capitals" : "sentence case"} (a heuristic, confidence ${measured.captions.confidence ?? "?"}; check by eye)`);
  }

  // Layout mix.
  const referenceMix = pack?.reference_stats?.layout_mix;
  const mix = measured?.layouts?.mix;
  if (referenceMix && mix) {
    const keys = new Set([...Object.keys(referenceMix), ...Object.keys(mix)]);
    const distance = round([...keys].reduce((sum, key) => sum + Math.abs((referenceMix[key] ?? 0) - (mix[key] ?? 0)), 0) / 2, 4);
    add("layout mix", "warning", distance <= ADHERENCE.layoutMix, referenceMix, mix, distance <= ADHERENCE.layoutMix ? "the layout mix is close to the references'" : `the layout mix is ${distance} from the references' (limit ${ADHERENCE.layoutMix})`);
  }

  // Cadence: the storyboard's exact numbers for our own renders, the pixels otherwise.
  const duration = Number(measured?.pacing?.duration_seconds ?? measured?.duration_seconds);
  const values = cadence
    ? { shot_seconds: cadence.shot_seconds?.p50, visual_changes_per_min: cadence.visual_changes_per_min, layout_changes_per_min: cadence.layout_changes_per_min }
    : {
      shot_seconds: measured?.pacing?.shot_seconds?.median,
      visual_changes_per_min: measured?.pacing?.cut_rate_per_minute,
      layout_changes_per_min: measured?.layouts?.frames?.length && duration > 0 ? (measured.layouts.changes / duration) * 60 : undefined
    };
  const source = cadence ? "from the storyboard" : "measured from the render";
  // The profile's own band rules (kit/core/profiles.mjs compareMeasures:
  // "band", "max" or "min" per measure), as the profile gates use them.
  const banded = profile?.measures ? compareMeasures({ ...values, shot_seconds: Number.isFinite(values.shot_seconds) ? { p50: values.shot_seconds } : undefined }, profile, { only: Object.keys(values) }) : [];
  for (const entry of banded) add(`cadence: ${entry.measure}`, "error", entry.status === "inside", entry.band.map((value) => value ?? "—").join("–"), entry.value, `${entry.detail} (${profile.id ?? "style profile"}; ${source})`);
  if (!banded.length) {
    // Reference pacing is measured, so it gates; a grammar's shot range is a rule of thumb, so it warns.
    const pacing = cadence ? { ...measured, pacing: { ...measured?.pacing, shot_seconds: { median: values.shot_seconds }, cut_rate_per_minute: values.visual_changes_per_min } } : measured;
    for (const metric of compareToStyle(pacing ?? {}, pack ?? {}).metrics.filter((entry) => /shot|cut rate/.test(entry.metric))) {
      add(`cadence: ${metric.metric}`, /grammar/.test(metric.metric) ? "warning" : "error", metric.ok, metric.expected, metric.measured, metric.ok ? "the pacing matches the style" : `the pacing drifts from the style (drift ${metric.drift})`);
    }
  }

  // Brand frame.
  const frameWanted = pack?.brand_frame && pack.brand_frame !== false && pack.brand_frame.enabled !== false;
  if (frameWanted) {
    if (story?.frame === false) add("brand frame", "warning", false, "drawn", "off", "the story turns the style's brand frame off (\"frame\": false)");
    else {
      const frame = storyFrame(story);
      const plan = frame ? brandFramePlan(story) : null;
      const draws = Boolean(plan && (frame.kicker || plan.layout.labels.length || frame.progress));
      add("brand frame", "error", draws, "drawn", draws ? "drawn" : "missing", draws ? `the brand frame is drawn (${[frame.kicker ? "kicker" : null, plan.layout.labels.length ? `${plan.layout.labels.length} section label(s)` : null, frame.progress ? "progress line" : null].filter(Boolean).join(", ")})` : "the style has a brand frame but the story draws nothing in it: set frame.kicker.label (or frame.logo) or section labels");
    }
  }

  const failed = checks.some((entry) => entry.severity === "error" && !entry.ok);
  return { status: failed ? "failed" : "passed", checks };
}

/** The brand colour roles a story sets to something other than the pack's. */
export function brandOverrides(story, pack) {
  const own = story?.brand?.colors ?? {}, packed = pack?.brand?.colors ?? {};
  return Object.keys(own).filter((role) => packed[role] && typeof own[role] === "string" && colorDistance(own[role], packed[role]) > 0.02);
}

// "upper" stays upper; sentence and title case both read as not capitals.
const caseOf = (value) => (value ? (value === "upper" ? "upper" : "as-is") : null);

const roleHex = (value, colors, fallback) => {
  const name = value ?? fallback;
  return typeof name === "string" && name.startsWith("#") ? name.toLowerCase() : colors?.[name]?.toLowerCase?.() ?? null;
};

/**
 * Where a resolved story draws a colour near `primary`: the captions' accent
 * or spoken word, the brand frame's kicker underline and progress line, and
 * its graphic scenes (catalogue modules draw their accents in the primary).
 * → ["captions accent word", "kicker underline", …]
 */
export function primaryUses(story, primary) {
  if (!story || !primary) return [];
  const colors = story.brand?.colors ?? {};
  const near = (hex) => Boolean(hex) && colorDistance(hex, primary) <= ADHERENCE.presence;
  const uses = [];
  const overlay = captionsOverlayOf(story);
  if (overlay) {
    const options = captionOptions(overlay, { brand: story.brand, format: story.format, story });
    if (options.emphasis && near(options.colors.accent)) uses.push("captions accent word");
    else if (options.word !== "none" && near(options.colors.active)) uses.push("captions spoken word");
  }
  const frame = story.frame === false ? null : storyFrame(story);
  if (frame?.kicker && frame.kicker.underline !== false && near(roleHex(frame.kicker.color, colors, "primary"))) uses.push("kicker underline");
  if (frame?.progress && near(roleHex(frame.progress.color, colors, "primary"))) uses.push("progress line");
  const graphic = (Array.isArray(story.scenes) ? story.scenes : []).filter(isGraphicScene).length;
  if (graphic && near(colors.primary)) uses.push(`${graphic} graphic scene${graphic === 1 ? "" : "s"}`);
  return uses;
}

/**
 * The share of sampled pixels in the primary's hue (its 15° bin and the two
 * beside it), from analyzeReference's vivid-hue histogram; null when the
 * render has none or the primary is not a saturated colour.
 */
export function primaryShare(measured, primary) {
  const hues = measured?.vivid?.hues;
  if (!Array.isArray(hues) || !hues.length) return null;
  const { h, s, l } = hexToHsl(primary);
  if (s < 0.4 || l < 0.2 || l > 0.85) return null;
  const bin = Math.floor((((h % 360) + 360) % 360) / (360 / hues.length));
  return [-1, 0, 1].reduce((sum, offset) => sum + (Number(hues[(bin + offset + hues.length) % hues.length]) || 0), 0);
}

/**
 * Cadence measures of one of our renders from its resolved storyboard: the
 * direction map's (kit/core/direction.mjs directionMeasures, with its section
 * layouts) when there is a map and narration, else the storyboard's own
 * (kit/core/cadence.mjs storyboardMeasures, with the story's footage
 * sections). Null when the story is not resolved (no duration).
 */
export function storyCadence(story, { map = null, words = null } = {}) {
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  if (!(duration > 0) || !Array.isArray(story?.scenes)) return null;
  try {
    if (map && words?.length) return directionMeasures(map, story, { words });
    // Story sections leave gaps where the frame is full; fill them so leaving a split counts as a change.
    const sections = [];
    let clock = 0;
    for (const section of storySections(story).sort((a, b) => a.start - b.start)) {
      if (section.start > clock + 1e-6) sections.push({ start: clock, end: section.start, layout: "full" });
      sections.push(section);
      clock = Math.max(clock, section.end);
    }
    if (sections.length && clock < duration - 1e-6) sections.push({ start: clock, end: duration, layout: "full" });
    return storyboardMeasures(story, { sections });
  } catch { return null; }
}

/**
 * The cadence profile a style points at: an inline measured profile, or a
 * shipped profile by id (src/profile_store.js resolveProfile); null when the
 * style names none or the id is unknown.
 */
export async function styleProfile(pack, { projectDir } = {}) {
  if (pack?.profile && typeof pack.profile === "object") return pack.profile;
  if (typeof pack?.profile !== "string") return null;
  try { return resolveProfile(pack.profile, { projectDir }).profile; }
  catch { return null; }
}

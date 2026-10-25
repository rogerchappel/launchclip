// Style adherence (docs/VIDEO_QUALITY_RFC.md §9.5): does a render follow the
// style its story names? `launchclip style check` reports it, and `finish`
// runs it as the `style` gate whenever the story names a style.
//
// Checks, each an error (fails the gate) or a warning (heuristic; reported):
// - palette: the render's colour clusters against the style's (reference
//   palette, else brand colours), measured both ways. Footage-led renders are mostly footage, so
//   there it only asks that the brand primary shows up somewhere (warning).
// - captions: the story's captions use the style's preset for its lane
//   (error); the case measured from the render's text band matches the
//   preset's (warning).
// - layout mix: the render's footage layouts against the reference mix
//   (warning; only when the style was drafted from references).
// - cadence: the render's shot length and visual and layout changes per
//   minute sit inside the style's profile band (kit/core/profiles.mjs
//   compareMeasures: each measure's own band, max or min rule) (error).
//   Without a measured profile, the reference pacing stands in (error), else
//   the motion grammar's shot range (warning) (compareToStyle).
// - brand frame: when the style has one, the story draws it (error), unless
//   the story turns it off with "frame": false (warning).
import { brandFramePlan, storyFrame } from "../kit/core/brand-frame.mjs";
import { CAPTION_PRESETS, captionPresetName, captionsOverlayOf } from "../kit/core/captions.mjs";
import { colorDistance, packCaptionsFor } from "../kit/core/style.mjs";
import { compareMeasures } from "../kit/core/profiles.mjs";
import { resolveProfile } from "./profile_store.js";
import { compareToStyle, paletteDistance } from "./style_reference.js";

export const ADHERENCE = Object.freeze({ palette: 0.12, presence: 0.15, layoutMix: 0.35 });

const round = (value, places = 3) => (Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null);

/**
 * story: the resolved, style-merged story; pack: the v3 style; measured:
 * analyzeReference() of the render; profile: the style's cadence profile
 * object (pack.profile when inline, or a shipped profile the caller looked
 * up by id; null to skip the band check).
 * → {status: "passed" | "failed", checks: [{check, severity, ok, expected, measured, detail}]}
 */
export function styleAdherence({ story, pack, measured, profile = typeof pack?.profile === "object" ? pack.profile : null }) {
  const checks = [];
  const add = (check, severity, ok, expected, value, detail) => checks.push({ check, severity, ok, expected, measured: value, detail });
  const lane = story?.lane;

  // Palette.
  const expected = pack?.reference_stats?.palette ?? Object.values(pack?.brand?.colors ?? {}).map((hex) => ({ hex, weight: 1 }));
  if (measured?.palette?.length && expected.length) {
    if (lane === "footage-led") {
      const primary = pack?.brand?.colors?.primary;
      if (primary) {
        const nearest = Math.min(...measured.palette.map((entry) => colorDistance(entry.hex, primary)));
        add("palette", "warning", nearest <= ADHERENCE.presence, `brand primary ${primary} within ${ADHERENCE.presence}`, round(nearest, 4), nearest <= ADHERENCE.presence ? "the brand primary shows in the render" : `no colour in the render is near the brand primary ${primary}; footage dominates, so check captions, frame and panels use the brand colours`);
      }
    } else {
      // Both ways: every render colour near a style colour, and the style's main colours present in the render.
      // With brand colours only, the reverse asks for the background, text and primary (an accent may rightly be rare).
      const colors = pack?.brand?.colors ?? {};
      const main = pack?.reference_stats?.palette ?? [["bg", 0.6], ["paper", 0.2], ["primary", 0.2]].filter(([role]) => colors[role]).map(([role, weight]) => ({ hex: colors[role], weight }));
      const distance = Math.max(paletteDistance(measured.palette, expected), paletteDistance(main, measured.palette) ?? 0);
      add("palette", "error", distance <= ADHERENCE.palette, `≤ ${ADHERENCE.palette}`, distance, distance <= ADHERENCE.palette ? "the render's colours match the style" : `the render's colours are ${distance} from the style's palette (limit ${ADHERENCE.palette}); check brand.colors overrides and full-bleed media`);
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
  const presetCase = overlay ? CAPTION_PRESETS[captionPresetName(overlay, story)]?.case : null;
  const seenCase = measured?.captions?.case ?? null;
  if (presetCase && seenCase) {
    const want = presetCase === "upper" ? "upper" : "as-is";
    add("caption case", "warning", seenCase === want, want, seenCase, seenCase === want ? "the measured caption case matches the preset" : `the render's caption text looks ${seenCase === "upper" ? "upper-case" : "sentence case"}, but the preset draws ${want === "upper" ? "capitals" : "sentence case"} (a heuristic; check by eye)`);
  }

  // Layout mix.
  const referenceMix = pack?.reference_stats?.layout_mix;
  const mix = measured?.layouts?.mix;
  if (referenceMix && mix) {
    const keys = new Set([...Object.keys(referenceMix), ...Object.keys(mix)]);
    const distance = round([...keys].reduce((sum, key) => sum + Math.abs((referenceMix[key] ?? 0) - (mix[key] ?? 0)), 0) / 2, 4);
    add("layout mix", "warning", distance <= ADHERENCE.layoutMix, referenceMix, mix, distance <= ADHERENCE.layoutMix ? "the layout mix is close to the references'" : `the layout mix is ${distance} from the references' (limit ${ADHERENCE.layoutMix})`);
  }

  // Cadence.
  const duration = Number(measured?.pacing?.duration_seconds ?? measured?.duration_seconds);
  const values = {
    shot_seconds: measured?.pacing?.shot_seconds?.median,
    visual_changes_per_min: measured?.pacing?.cut_rate_per_minute,
    layout_changes_per_min: measured?.layouts?.frames?.length && duration > 0 ? (measured.layouts.changes / duration) * 60 : undefined
  };
  // The profile's own band rules (kit/core/profiles.mjs compareMeasures:
  // "band", "max" or "min" per measure), as the profile gates use them.
  const banded = profile?.measures ? compareMeasures({ ...values, shot_seconds: Number.isFinite(values.shot_seconds) ? { p50: values.shot_seconds } : undefined }, profile, { only: Object.keys(values) }) : [];
  for (const entry of banded) add(`cadence: ${entry.measure}`, "error", entry.status === "inside", entry.band.map((value) => value ?? "—").join("–"), entry.value, `${entry.detail} (${profile.id ?? "style profile"})`);
  if (!banded.length) {
    // Reference pacing is measured, so it gates; a grammar's shot range is a rule of thumb, so it warns.
    for (const metric of compareToStyle(measured ?? {}, pack ?? {}).metrics.filter((entry) => /shot|cut rate/.test(entry.metric))) {
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

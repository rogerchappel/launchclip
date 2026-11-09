// launchclip style compare <name>: how far a style drafted from a reference
// draws from that reference. Renders a short sample in the style (or takes a
// render or images), measures it the way the reference was measured
// (src/drawing_traits.js) and reports the distance per drawing trait
// (kit/core/style-distance.mjs drawingDistanceReport) against the traits the
// pack keeps at reference_stats.drawing, so an agent can change the pack and
// compare again.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { drawingDistanceReport } from "@launchclip/core/style-distance.mjs";
import { stylePreviewStory } from "@launchclip/core/style-preview.mjs";
import { combineDrawingNumbers, drawingTraits, measureDrawing } from "./drawing_traits.js";
import { matchDrawingStyle } from "./drawing_match.js";
import { paletteClusters, paletteDistance, pixelsFromFrames, sampleFrames } from "./style_reference.js";
import { resolveStyleV2 } from "./style_store.js";

// A trait further than this from the reference is reported as apart.
export const COMPARE_APART = 0.25;
const list = (value) => (value === undefined || value === true ? [] : Array.isArray(value) ? value : [value]).map(String);

/**
 * The sample story for a style: its preview reel (title, chart, card, call to
 * action), with a character cameo in place of the card when the pack names a
 * drawing style, so the sample shows figures drawn that way.
 */
export function drawingSampleStory(pack, options = {}) {
  const story = stylePreviewStory(pack, { duration: 8, ...options });
  if (!pack.cast?.drawing_style) return story;
  const scenes = story.scenes.map((scene) => (scene.id !== "card" ? scene : {
    // A cameo stands the figure on the style's own backdrop; a cast scene's room would bring its own wall colour.
    id: "cast", module: "character-cameo", start: scene.start, end: scene.end, energy: scene.energy,
    params: { character: "maya", pose: "wave", expression: "happy", panel: false }
  }));
  // The pack's cast gives the drawing style (kit/core/style.mjs applyStyle); the people are the kit's starters.
  return { ...story, cast: { characters: [{ id: "maya" }] }, scenes };
}

const HINTS = {
  outline: (ref, got, pack) => {
    const nearest = matchDrawingStyle({ outline: ref.outline, fill: ref.fill ?? got.fill })?.ranked.slice(0, 3).map((entry) => entry.name) ?? [];
    return `the reference inks ${Math.round(ref.outline.presence * 100)}% of its boundaries, the sample ${Math.round(got.outline.presence * 100)}%. cast.drawing_style is ${pack.cast?.drawing_style ?? "not set"}${nearest.length ? `; the styles nearest the reference are ${nearest.join(", ")}` : ""}. Text and charts in the sample count as lines too.`;
  },
  line_weight: (ref, got) => `the reference's lines are ${ref.outline.weight ?? "absent"} px at 1080, the sample's ${got.outline.weight ?? "absent"}. No dial sets line weight: each drawing style draws its own.`,
  fill: (ref, got) => `the reference's fills are ${ref.fill.type}, the sample's ${got.fill.type}. vocabulary.illustration (flat, flat-shadow, line), background.kind (flat, gradient, grain-gradient, paper) and cast.drawing_style change it.`,
  saturation: (ref, got) => `the reference's chroma is ${ref.palette.saturation}, the sample's ${got.palette.saturation}: make brand.colors ${got.palette.saturation > ref.palette.saturation ? "less" : "more"} saturated, or give the more saturated colours less area (bg and paper cover most of a frame).`,
  contrast: (ref, got) => `the reference's lightness is ${ref.palette.lightness} over a range of ${ref.palette.contrast}, the sample's ${got.palette.lightness} over ${got.palette.contrast}: move brand.colors.bg and brand.colors.paper ${got.palette.contrast > ref.palette.contrast ? "closer together" : "further apart"}.`,
  shape: (ref, got) => `the reference is ${ref.shape.label} (roundness ${ref.shape.roundness}), the sample ${got.shape.label} (${got.shape.roundness}): layouts.panel.radius is the only dial; text in the sample reads as corners.`,
  grain: (ref, got) => `the reference's grain is ${ref.grain.label}, the sample's ${got.grain.label}: background.kind paper or grain-gradient textures the backdrop; a medium textures the whole picture and repaints it.`,
  stepping: (ref, got) => `the reference shows ${ref.stepping.drawings_per_second} drawings a second, the sample ${got.stepping.drawings_per_second}. No dial holds drawings.`
};

/**
 * Compare a sample's drawing traits with a pack's reference traits.
 * → {distance, traits: [{trait, distance, apart, reference, sample, hint?}], unmeasured}
 */
export function compareDrawing(pack, sample) {
  const reference = pack.reference_stats?.drawing;
  if (!reference?.traits) throw new Error(`style ${pack.name} keeps no drawing traits (reference_stats.drawing); draft it with launchclip style create ${pack.name} --from-reference <video ...>`);
  const report = drawingDistanceReport(reference, sample);
  const source = { outline: "outline", line_weight: "outline", fill: "fill", saturation: "palette", contrast: "palette", shape: "shape", grain: "grain", stepping: "stepping" };
  const traits = Object.entries(report.parts).filter(([, distance]) => distance !== null).map(([trait, distance]) => {
    const apart = distance > COMPARE_APART;
    return { trait, distance, apart, reference: reference.traits[source[trait]], sample: sample.traits[source[trait]], ...(apart ? { hint: HINTS[trait](reference.traits, sample.traits, pack) } : {}) };
  });
  const why = (trait) => [reference, sample].map((block, i) => (block.traits[source[trait]] ? null : `${i ? "the sample" : "the reference"} did not measure it`)).filter(Boolean).join("; ") || "one side has no value for it";
  return { distance: report.distance, traits, unmeasured: report.unmeasured.map((trait) => ({ trait, reason: why(trait) })) };
}

/**
 * launchclip style compare <name|path> [--video sample.mp4 | --images a.png ...]
 * adapters: {render (renderStylePreview), measure (measureDrawing), palette}.
 */
export async function compareStyleCommand(name, flags = {}, { root, cwd = process.cwd() } = {}, adapters = {}) {
  const style = await resolveStyleV2(String(name), { projectDir: cwd, root });
  const pack = style.pack;
  if (!pack.reference_stats?.drawing?.traits) throw new Error(`style ${pack.name} keeps no drawing traits (reference_stats.drawing); draft it with launchclip style create ${pack.name} --from-reference <video ...>`);
  const images = list(flags.images).map((file) => path.resolve(cwd, file));
  let video = flags.video && flags.video !== true ? path.resolve(cwd, String(flags.video)) : null;
  let rendered = null;
  if (!video && !images.length) {
    const { renderStylePreview } = await import("./style_preview.js");
    const work = flags.work && flags.work !== true ? path.resolve(cwd, String(flags.work)) : path.join(path.dirname(style.file), ".compare");
    video = path.join(work, "sample.mp4");
    rendered = await (adapters.render ?? renderStylePreview)(pack, { out: video, work: path.join(work, "project"), renderer: flags.renderer ?? "hyperframes", quality: flags.quality ?? "draft", story: drawingSampleStory(pack) });
  }
  for (const file of [video, ...images].filter(Boolean)) if (!existsSync(file)) throw new Error(`Sample not found: ${file}`);
  const measure = adapters.measure ?? measureDrawing;
  const numbers = [];
  if (video) numbers.push(await measure(video, { image: false }));
  for (const file of images) numbers.push(await measure(file, { image: true }));
  const sample = drawingTraits(combineDrawingNumbers(numbers));
  // A rendered sample shows figures only in its cameo: the outline and the fill are read there.
  const cast = rendered?.story?.scenes?.find((scene) => scene.module === "character-cameo");
  const figure = cast ? [cast.start + 0.6, cast.end - 0.2] : null;
  if (figure) {
    const figures = drawingTraits(await measure(video, { image: false, window: figure, count: 4 })).traits;
    for (const trait of ["outline", "fill"]) if (figures[trait]) sample.traits[trait] = figures[trait];
  }
  const compared = compareDrawing(pack, sample);
  // The colours themselves, as style check compares them.
  let palette = null;
  if (pack.reference_stats.palette?.length) {
    const frames = [];
    const read = adapters.palette ?? (async (file, image) => (await sampleFrames(file, { count: 12, image })).frames);
    if (video) frames.push(...await read(video, false));
    for (const file of images) frames.push(...await read(file, true));
    const distance = paletteDistance(paletteClusters(pixelsFromFrames(frames)), pack.reference_stats.palette);
    if (distance !== null) palette = { distance, apart: distance > 0.12, ...(distance > 0.12 ? { hint: "the sample's colours sit away from the reference's clusters (reference_stats.palette): check brand.colors against them." } : {}) };
  }
  const apart = compared.traits.filter((entry) => entry.apart).map((entry) => entry.trait);
  const result = {
    stage: "style",
    action: "compare",
    status: apart.length || palette?.apart ? "apart" : "close",
    style: pack.name,
    sample: { ...(video ? { video } : {}), ...(images.length ? { images } : {}), rendered: Boolean(rendered), frames: sample.frames, ...(figure ? { figure_seconds: figure } : {}) },
    distance: compared.distance,
    apart,
    traits: compared.traits,
    ...(palette ? { palette } : {}),
    unmeasured: compared.unmeasured,
    note: rendered ? "The sample is the style's preview reel (a title, a chart, a call to action) with a character cameo when the style names a drawing style. The outline and the fill are read from the cameo when there is one; the rest from the whole reel, whose text and chart read as corners and whose card sits on a wash (a graded fill when there is no cameo), so shape and fill sit a little off even for a good match. Compare runs against each other." : "Text in a sample reads as lines and corners."
  };
  if (flags.out && flags.out !== true) {
    const out = path.resolve(cwd, String(flags.out));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
    result.out = out;
  }
  return result;
}

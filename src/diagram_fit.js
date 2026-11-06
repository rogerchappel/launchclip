// Tooling fits line-drawing scenes, so a plan never ships a diagram that
// looks unfinished or flashes its labels:
//
// 1. A feynman-diagram scene that is not about particle physics (a deck
//    squared with string lines, a beam on a post, a planned roof) becomes a
//    line-diagram: the same points and lines on a drafting plate that fills
//    the frame, in the brand colours, with backed labels placed clear of the
//    strokes. Scalar (dashed) lines stay dashed; the caption becomes the
//    note, shown with the drawing.
// 2. A label the scene has no time to hold for a read (1 s plus 0.3 s a word
//    before the exit, after the draw compresses) is dropped from the plan,
//    with a warning, so the storyboard says what the video shows. The module
//    decides (kit/core/diagram-layout.mjs scheduleDraw); this reads its model.
//
// fitDiagrams(storyboard, {words, beats}) → {storyboard, changed: [string]}.

import { resolveStory } from "@launchclip/core/story.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";

// Wavy and curly lines only mean something in particle physics.
const PHYSICS_TYPES = new Set(["photon", "gluon", "graviton"]);
const PHYSICS_WORDS = /\b(photons?|gluons?|gravitons?|bosons?|fermions?|quarks?|electrons?|positrons?|muons?|neutrinos?|higgs|one[- ]loop|two[- ]loop|loops?|vertex|vertices|propagators?|scalar field|self[- ]?(energy|mass)|feynman|particles?|annihilat\w*|scatter\w*|qed|qcd|quantum)\b/i;
// Particle symbols: Greek letters, super- and subscript signs (e⁻, γ, φ, μ⁺).
const PHYSICS_SYMBOLS = /[Ͱ-Ͽ⁰-₟]/;

/** Is this feynman-diagram scene really a line sketch of something else? */
export function isSketchFeynman(scene) {
  if (scene?.module !== "feynman-diagram") return false;
  const params = scene.params ?? {};
  if (params.preset !== undefined || !params.points || !Array.isArray(params.lines)) return false;
  if (params.lines.some((line) => PHYSICS_TYPES.has(line?.type))) return false;
  const texts = [params.title, params.caption, ...params.lines.map((line) => line?.label)].filter((value) => typeof value === "string");
  if (texts.some((value) => PHYSICS_WORDS.test(value) || PHYSICS_SYMBOLS.test(value))) return false;
  // Plain-word labels ("string lines", "footing") say it is a sketch.
  return texts.some((value) => /[a-z]{3,}/i.test(value));
}

/** line-diagram params for a sketch planned as a feynman-diagram. */
export function sketchParams(params) {
  const out = {
    points: structuredClone(params.points),
    lines: params.lines.map((line) => {
      const next = { from: line.from, to: line.to };
      if (line.type === "scalar") next.style = "dashed";
      if (line.bend !== undefined) next.bend = line.bend;
      if (line.label !== undefined) next.label = line.label;
      if (line.at !== undefined) next.at = line.at;
      return next;
    })
  };
  if (params.title !== undefined) out.title = params.title;
  if (params.caption !== undefined) out.note = params.caption;
  if (params.at !== undefined) out.at = params.at;
  if (params.rect !== undefined) out.rect = structuredClone(params.rect);
  return out;
}

export function fitDiagrams(storyboard, { words = [], beats = null } = {}) {
  if (!Array.isArray(storyboard?.scenes)) return { storyboard, changed: [] };
  const changed = [];
  let copy = null;
  const own = () => (copy ??= structuredClone(storyboard));
  storyboard.scenes.forEach((scene, index) => {
    if (!isSketchFeynman(scene)) return;
    const target = own().scenes[index];
    target.module = "line-diagram";
    target.params = sketchParams(scene.params);
    changed.push(`${scene.id ?? `scenes[${index}]`} feynman-diagram → line-diagram: a line sketch, not a particle diagram, drawn on a plate that fills the frame`);
  });

  // Labels the scene cannot hold for a read.
  const current = copy ?? storyboard;
  if (current.scenes.some((scene) => scene?.module === "line-diagram" || scene?.module === "feynman-diagram")) {
    let resolved = null;
    try { resolved = resolveStory(structuredClone(current), { words, beats }); } catch { resolved = null; }
    for (const scene of resolved?.scenes ?? []) {
      if (scene.module !== "line-diagram" && scene.module !== "feynman-diagram") continue;
      let model;
      try { model = resolveModule(scene, resolved); } catch { continue; }
      const dropped = model?.content?.dropped ?? [];
      if (!dropped.length) continue;
      const index = current.scenes.findIndex((entry) => entry?.id === scene.id);
      if (index < 0) continue;
      const params = own().scenes[index].params;
      for (const text of dropped) {
        const line = (params.lines ?? []).find((entry) => entry?.label === text);
        if (line) delete line.label;
        else if (Array.isArray(params.marks)) {
          const at = params.marks.findIndex((entry) => entry?.label === text);
          if (at >= 0) params.marks.splice(at, 1);
          if (!params.marks.length) delete params.marks;
        }
      }
      changed.push(`${scene.id} ${scene.module}: dropped label${dropped.length === 1 ? "" : "s"} ${dropped.map((text) => `"${text}"`).join(", ")}: the scene is too short to read ${dropped.length === 1 ? "it" : "them"} (lengthen it or use fewer labels)`);
    }
  }
  return { storyboard: copy ?? storyboard, changed };
}

// A character-led explainer a model could return for the sourdough brief
// (test/fixtures/make-sourdough): the direction map with its cast, and the
// storyboard planned against it. Times are seconds on the saved narration.
export const SOURDOUGH_CAST = Object.freeze({
  characters: [
    { id: "starter", kind: "cup", plays: "the sourdough starter in its jar", name: "Starter", size: "large", colors: { body: "#f3e3c0", detail: "#c9482f" } },
    { id: "yeast", kind: "blob", plays: "the wild yeast", colors: { body: "#f6b73c" } },
    { id: "bacteria", kind: "monster", plays: "the bacteria", size: "small", colors: { body: "#58b368" } }
  ]
});

/** The saved direction map's sections with the cast added and each line's scenes renamed to the character storyboard's. */
export function explainerDirection(saved) {
  const scenes = ["hook", "belief", "inside", "inside", "gas", "rise", "tang", "both", "save"];
  let index = 0;
  return {
    schema: saved.schema,
    profile: saved.profile,
    cast: JSON.parse(JSON.stringify(SOURDOUGH_CAST)),
    sections: saved.sections.map((section) => ({ ...section, lines: section.lines.map((line) => ({ ...line, scenes: [scenes[index++]], why: "a character acts the line" })) }))
  };
}

/** The storyboard: characters in seven of nine scenes, one diagram and the end card as support. */
export function explainerStoryboard({ format, brand }) {
  const cameo = (id, start, end, character, pose, expression, card, cue) => ({ id, module: "character-cameo", start, end, energy: 2, params: { character, pose, expression, card, ...(cue ? { cues: [cue] } : {}) } });
  return {
    schema: "launchclip.story.v1",
    lane: "motion",
    format,
    brand,
    scenes: [
      cameo("hook", 0, 2.72, "starter", "shrug", "confused", { title: "Why does bread need this jar?" }, { at: 1.4, pose: "think", expression: "thinking" }),
      cameo("belief", 2.72, 5.95, "starter", "point-self", "smirk", { kicker: "The guess", title: "Just for the sour taste?" }, { at: 1.6, pose: "shrug", expression: "side-eye" }),
      { id: "inside", module: "cast-scene", start: 5.95, end: 11.64, energy: 2, params: { set: "standing", shot: "medium", cast: [{ id: "yeast", pose: "wave", expression: "happy", cues: [{ at: 2.6, pose: "cheer", expression: "excited" }] }, { id: "bacteria", pose: "arms-crossed", expression: "smirk", cues: [{ at: 1.6, pose: "wave", expression: "happy" }, { at: 4.2, pose: "point-self", expression: "delighted" }] }] } },
      cameo("gas", 11.64, 14.15, "yeast", "cheer", "delighted", { kicker: "Job one", title: "Yeast makes gas" }),
      { id: "rise", module: "process-steps", start: 14.15, end: 17.1, energy: 2, params: { title: "How the loaf rises", steps: ["Gas", "Bubbles", "Rise"] } },
      cameo("tang", 17.1, 19.97, "bacteria", "point-self", "smirk", { kicker: "Job two", title: "Bacteria make the tang" }, { at: 1.5, pose: "cheer", expression: "laughing" }),
      { id: "both", module: "cast-scene", start: 19.97, end: 23.23, energy: 3, params: { set: "standing", shot: "medium", cast: [{ id: "starter", pose: "cheer", expression: "delighted", cues: [{ at: 1.6, pose: "point-self", expression: "happy" }] }, { id: "yeast", pose: "wave", expression: "happy" }, { id: "bacteria", pose: "cheer", expression: "laughing" }] } },
      { id: "save", module: "cta", start: 23.23, end: format.duration, energy: 1, params: { action: "Save this", detail: "Before your next bake", icon: "none" } }
    ],
    overlays: [{ type: "captions" }],
    ending: { loop: false }
  };
}

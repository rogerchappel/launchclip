// Structural comps for `launchclip make --comps` (docs/VIDEO_TELLS_RFC.md §3).
//
// Before the full render, three stills of the hook scene that differ in what
// leads, the topology and the density (never in palette or type: the
// direction fixes those). Comp 1 is the planner's hook; comps 2 and 3 are
// designed by the opening designer (src/make/candidates.js designOpening),
// each told the shape to take and the comps already made. Each comp is a
// plan-only storyboard and one still, in comps/<id>/. The person picks one
// (--comp N); a headless run lets the vision judge pick and records the pick
// as delegated. The pick lands in MAKE.json under comps.picked.
//
// The pure parts live here; the stage is stageComps in src/make/index.js.

export const COMPS_DIR = "comps";
export const COMP_COUNT = 3;

// The two designed comps: each leads with something else, laid out and filled differently.
export const COMP_SHAPES = Object.freeze([
  Object.freeze({ id: "comp-2", label: "a sparse comp: one element leads, alone", note: "Density: sparse. One element carries the frame on its own: the single number, object or product view the line is about, with nothing beside it." }),
  Object.freeze({ id: "comp-3", label: "a dense comp: several elements in a layout", note: "Density: dense. Several elements in one layout (a comparison, a list, the product with its proof beside it), arranged so one still leads." })
]);

/** Whether the run makes comps: --comps, or a pick (--comp N) of comps already made. */
export function compsWanted(options = {}) {
  return Boolean(options.comps) || (options.comp != null && options.comp !== false && options.comp !== "");
}

/** --comp (1 to COMP_COUNT, or nothing) → the comp id, or null; throws on anything else. */
export function compChoice(value) {
  if (value === undefined || value === null || value === false || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > COMP_COUNT) throw new Error(`--comp must be a whole number from 1 to ${COMP_COUNT} (the comp to keep); got ${value}`);
  return `comp-${n}`;
}

/** The note a designed comp gets: its shape, and how it must differ from the comps made so far ([{id, module, why}]). */
export function compNote(shape, made) {
  return [
    `## Structural comp ${shape.id.slice(5)} of ${COMP_COUNT}`,
    "",
    "This is one of three structural comps of the hook. The art direction (palette, type, world) is fixed: differ in structure only.",
    shape.note,
    "The comps already made, which this one must not repeat (use another module, lead with another element, lay it out another way):",
    ...made.map((comp) => `- ${comp.id}: ${comp.module}${comp.why ? ` (${comp.why})` : ""}`)
  ].join("\n");
}

/** Whether a design is a comp already made: the same module with the same params. */
export function sameComp(design, made) {
  return made.some((comp) => comp.module === design.module && JSON.stringify(comp.params) === JSON.stringify(design.params));
}

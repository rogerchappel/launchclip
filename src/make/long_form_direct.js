// The long-form direct pass (docs/MAKE_SKILL_PARITY.md, phase 1): the model
// directs the visuals, as the agent does in the create-video skill. The beat
// director (kit/core/beat-director.mjs) still owns the clock: clauses, shots,
// plates, camera and the cadence gate. One model call per chunk (≤ 180 s)
// picks, for every clause, either a new card (any catalogue module and its
// params) or a hold on the card before. A choice the module rejects, or that
// names a file the video does not have, keeps the director's rule-made card,
// so a bad answer never fails the video.
import { DEFAULT_BRAND, moduleCatalogue } from "@launchclip/core/planning-prompt.mjs";
import { knownModules, resolveModule } from "@launchclip/core/modules.mjs";
import { resolveStory } from "../story.js";
import { estimateModelUsageCost } from "../cost_tracker.js";

// State kinds tooling writes (stings, calls to action): never directed.
const FIXED_KINDS = new Set(["sting", "cta"]);
// Rule-made changes that carry the card before on.
const CARRIED = new Set(["hold", "focus", "guide"]);
// Cards that are words on a backdrop: a parity video keeps them to at most 3 in 10.
export const TYPOGRAPHY_MODULES = Object.freeze(new Set(["motion-title", "kinetic-words", "concept-card", "glass-word", "icon-row", "object-card", "emphasis-caption"]));
const MEDIA_FILE = /\.(png|jpe?g|webp|gif|svg|mp4|mov|webm|m4v)$/i;
const CONCURRENCY = 3;

const SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["states"],
  properties: {
    states: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "action", "module", "params_json"],
        properties: {
          id: { type: "string" },
          action: { type: "string", enum: ["new", "hold"], description: "new: a new card for this clause; hold: the card before stays on screen." },
          module: { type: "string", description: "The catalogue module for a new card (empty for hold)." },
          params_json: { type: "string", description: "The new card's params as a JSON object (empty for hold)." }
        }
      }
    }
  }
});

const ROLE = `You are the visual director of a long explainer video narrated over motion graphics. The narration is split into clauses, each with its own seconds on screen. For every clause, choose what the viewer sees: a new card (one module from the catalogue below and its params), or "hold" to keep the card before on screen while the narration finishes its point.

Direct it the way a good explainer channel would:
- Show, don't caption. A number becomes a chart, a gauge, a counter or a comparison; a date becomes a calendar, a countdown or a timeline; companies and products become logos, lockups or object cards; places become a map; a sequence becomes steps; a choice becomes a comparison; a source becomes an excerpt or a quote card.
- Words-on-a-backdrop cards (motion-title, kinetic-words, concept-card, glass-word, icon-row, object-card, emphasis-caption) are at most 3 in every 10 new cards, and never two in a row. Use them for a chapter title or a single line worth reading.
- Vary the modules: never the same module three new cards in a row.
- Hold when a clause continues the same point and the card already shows it; never hold one card for more than about 10 seconds.
- Never invent a figure, a quote, a date or a name: every value on a card comes from the clause, the chapter's narration or the notes. With no figure to show, choose a visual that needs none.
- Only use files listed under "Files the video can show"; never make up a path.
- Respect every param's limits (lengths, item counts). A card has a few seconds: short labels, few items.
- Each clause's "Rule pick" is a fallback a rule-based director made. Keep it only when it is genuinely the best card.
Return every clause in order, with params as a JSON string, and nothing else.

# Module catalogue
`;

/** The catalogue as prompt text: every motion-lane module with its structured-tier params. */
export function catalogueText(modules = moduleCatalogue()) {
  return modules
    .filter((module) => !module.needs?.includes("subject"))
    .map((module) => [`## ${module.id}`, module.describe, ...module.params.filter((param) => !param.tuning).map((param) => `- ${param.name}: ${param.text}`)].join("\n"))
    .join("\n\n");
}

/**
 * Direct every chunk not already directed. options: {client, model, provider,
 * map (the beat map: changed in place), notes, assets: [{src, line}], format,
 * brand, done (chunk keys already directed), say}.
 * → {chunks: [{id, key, reused, directed, kept, held, failed?, cost_usd, usage, model}],
 *    ruled: the rule-made card of every clause the model changed, by state id}
 * A chunk whose call fails keeps every rule-made card and reports failed.
 */
export async function directLongFormVisuals(options = {}) {
  const { map, done = new Set() } = options;
  const modules = moduleCatalogue().filter((module) => !module.needs?.includes("subject"));
  const known = new Set(modules.map((module) => module.id));
  const instructions = `${ROLE}${catalogueText(modules)}\n`;
  const statesOf = directableStates(map);
  const answers = new Map();
  const jobs = map.chunks.map((chunk) => async () => {
    const states = statesOf.get(chunk.id) ?? [];
    if (done.has(chunk.key) || !states.length) { chunk.directed = true; return { id: chunk.id, key: chunk.key, reused: done.has(chunk.key), directed: 0, kept: 0, held: 0 }; }
    try {
      const result = await askChunk({ ...options, instructions, chunk, states });
      answers.set(chunk.id, result.answers);
      return { id: chunk.id, key: chunk.key, reused: false, ...result.cost };
    } catch (error) {
      options.say?.(`direct: chunk ${chunk.id} keeps the rule-made cards (${error.message})`);
      return { id: chunk.id, key: chunk.key, reused: false, failed: error.message, directed: 0, kept: states.length, held: 0 };
    }
  });
  const results = await limited(jobs, CONCURRENCY);
  // Applied in story order, so a hold carries whatever card the clause before ends up with.
  const allowed = new Set((options.assets ?? []).map((asset) => asset.src));
  const ruled = new Map();
  let last = null;
  for (const chunk of map.chunks) {
    const summary = results.find((entry) => entry.id === chunk.id);
    const chosen = answers.get(chunk.id);
    for (const state of statesOf.get(chunk.id) ?? []) {
      if (chosen) {
        const before = ruleCard(state);
        const outcome = applyChoice(state, chosen.get(state.id), last, { known, allowed, format: options.format, brand: options.brand });
        summary[outcome] += 1;
        if (outcome !== "kept") ruled.set(state.id, before);
      }
      last = state;
    }
    if (chosen) chunk.directed = true;
  }
  return { chunks: results, ruled };
}

const CARD_KEYS = ["module", "params", "capability", "change", "why", "fallback", "focus", "guide", "zooms"];

function ruleCard(state) {
  return Object.fromEntries(CARD_KEYS.filter((key) => key in state).map((key) => [key, structuredClone(state[key])]));
}

/**
 * The ids of a finished storyboard's scenes whose module does not resolve.
 * The direct pass checks each card against the plain brand; the finished
 * storyboard carries the style's fonts and panels, so a card that fitted
 * there can still overflow here.
 */
export function unresolvedScenes(story, words = []) {
  const resolved = resolveStory(story, { words });
  const known = new Set(knownModules());
  return (resolved.scenes ?? []).filter((scene) => {
    if (!known.has(scene.module)) return false;
    try { resolveModule(scene, resolved); return false; } catch { return true; }
  }).map((scene) => scene.id);
}

/** Put back the rule-made card of every listed clause the model changed, in place. → the ids put back. */
export function revertCards(map, ruled, ids) {
  const back = [];
  for (const chapter of map.chapters ?? []) for (const shot of chapter.shots ?? []) for (const state of shot.states ?? []) {
    if (!ids.includes(state.id) || !ruled.has(state.id)) continue;
    for (const key of CARD_KEYS) delete state[key];
    Object.assign(state, structuredClone(ruled.get(state.id)));
    ruled.delete(state.id);
    back.push(state.id);
  }
  return back;
}

/** The states each chunk owns that the model may direct, by chunk id. */
export function directableStates(map) {
  const byShot = new Map();
  for (const chapter of map.chapters ?? []) for (const shot of chapter.shots ?? []) byShot.set(shot.id, shot);
  return new Map((map.chunks ?? []).map((chunk) => [chunk.id, chunk.shots
    .flatMap((id) => byShot.get(id)?.states ?? [])
    .filter((state) => state.params && !FIXED_KINDS.has(state.kind))]));
}

async function askChunk({ client, model = null, provider = null, instructions, chunk, states, map, notes = [], assets = [], say }) {
  if (!client) throw new Error("the direct pass needs a model client");
  say?.(`model: PAID call to ${provider ?? client.provider} ${model} (visual direction, chunk ${chunk.id}, ${states.length} clauses)`);
  const chapter = (map.chapters ?? []).find((entry) => entry.shots?.some((shot) => chunk.shots.includes(shot.id)));
  const lines = [
    `Video: ${map.title ?? "untitled"}. Chapter: ${chapter?.title ?? "untitled"}.`,
    `Chunk ${chunk.id}: ${states.length} clauses.`,
    "",
    "## Clauses",
    "",
    ...states.flatMap((state) => [
      `### ${state.id} (${round(state.end - state.start)} s)`,
      `Narration: ${state.text}`,
      `Rule pick: ${CARRIED.has(state.change) ? `hold (${state.module})` : `${state.module} ${JSON.stringify(state.params)}`}`,
      ""
    ]),
    "## Files the video can show",
    "",
    ...(assets.length ? assets.map((asset) => `- ${asset.line}`) : ["None: use no media files."])
  ];
  if (notes.length) lines.push("", "## Notes", "", ...notes.map((text) => String(text).trim().slice(0, 6000)));
  const result = await client.runStructured({ instructions, input: `${lines.join("\n")}\n`, schema: SCHEMA, schemaName: "launchclip_long_form_direct", model: undefined, maxOutputTokens: 16000 });
  const usage = result?.usage ?? {};
  const cost = estimateModelUsageCost(provider ?? client.provider ?? "openai", result?.model ?? model, usage).estimated_usd;
  const answers = new Map((Array.isArray(result?.value?.states) ? result.value.states : []).map((entry) => [String(entry?.id ?? ""), entry]));
  if (!answers.size) throw new Error("the model returned no clauses");
  return { answers, cost: { directed: 0, kept: 0, held: 0, cost_usd: cost, usage, model: result?.model ?? model } };
}

/**
 * Apply one clause's choice to its state, in place. → "directed" (a new card),
 * "held" (the card before carries on) or "kept" (the rule-made card stays).
 */
export function applyChoice(state, answer, last, { known, allowed = new Set(), format, brand } = {}) {
  if (!answer) return "kept";
  if (answer.action === "hold") {
    if (!last?.module || !last.params) return "kept";
    Object.assign(state, { module: last.module, params: last.params, capability: last.capability ?? last.module, change: "hold", why: "model: holds the card before" });
    delete state.focus; delete state.guide; delete state.zooms;
    return "held";
  }
  const module = String(answer.module ?? "").trim();
  const params = parseParams(answer.params_json);
  if (!known?.has(module) || !params || !filesAllowed(params, allowed) || !fits(module, params, state.end - state.start, format, brand)) return "kept";
  const sameCard = module === state.module;
  Object.assign(state, { module, params, capability: module, fallback: false, change: CARRIED.has(state.change) ? "swap" : state.change, why: `model: ${module}` });
  delete state.focus; delete state.guide;
  // The rule-made zooms frame the rule-made card.
  if (!sameCard) delete state.zooms;
  return "directed";
}

/** Whether every media path in params is one the video has. */
export function filesAllowed(params, allowed) {
  const paths = [];
  const visit = (value) => {
    if (typeof value === "string") { if (value.startsWith("assets/") || MEDIA_FILE.test(value)) paths.push(value); return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(params);
  return paths.every((file) => allowed.has(file));
}

/** The share of typography cards among a map's new cards (holds and fixed kinds left out). */
export function typographyShare(map) {
  const cards = [];
  for (const chapter of map.chapters ?? []) for (const shot of chapter.shots ?? []) for (const state of shot.states ?? []) {
    if (FIXED_KINDS.has(state.kind) || CARRIED.has(state.change)) continue;
    cards.push(state.module);
  }
  return cards.length ? round(cards.filter((module) => TYPOGRAPHY_MODULES.has(module)).length / cards.length) : 0;
}

function parseParams(text) {
  if (typeof text !== "string") return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function fits(module, params, seconds, format, brand) {
  const duration = Math.max(1, round(seconds));
  const scene = { id: "direct-check", module, start: 0, end: duration, params };
  const story = { schema: "launchclip.story.v1", lane: "motion", format: { width: format.width, height: format.height, fps: 30, duration }, brand: brand ?? DEFAULT_BRAND, scenes: [scene], resolved: { duration, fps: 30 } };
  try { resolveModule(scene, story); return true; } catch { return false; }
}

async function limited(jobs, size) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

function round(value) { return Math.round(value * 100) / 100; }

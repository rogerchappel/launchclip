// Frozen answers for make's concept and story stage (src/make/concept_story.js):
// five concepts, a judgment, a story and its edit, each valid for the brief the
// request carries, so the stage runs in tests with no model.
import { CINEMATIC_CONCEPT_JUDGMENT_VERSION, CINEMATIC_CONCEPT_SET_VERSION, CINEMATIC_STORY_EDIT_VERSION, CINEMATIC_STORY_VERSION } from "../../src/cinematic_contracts.js";

export const CONCEPT_SCHEMAS = Object.freeze(["launchclip_cinematic_concept_set", "launchclip_cinematic_concept_judgment", "launchclip_cinematic_story", "launchclip_cinematic_story_edit"]);
const ENGINES = ["reveal", "transformation", "investigation", "contrarian-proof", "cause-and-effect"];
const STORY_ROLES = ["hook", "promise", "mechanism", "proof", "rehook", "escalation", "payoff", "closing_reframe"];

export function fakeConcepts() {
  return {
    schema_version: CINEMATIC_CONCEPT_SET_VERSION,
    candidates: ENGINES.map((engine, index) => ({
      id: `concept-${index + 1}`,
      title: `The ledger that closes itself ${index + 1}`,
      hook: { spoken_line: `Payouts hide mismatch number ${index + 1}.`, open_loop: "Where does the money go?", proof_tease: "Watch one payout find its invoice.", promised_payoff: "Books that close themselves." },
      audience_tension: "Month end is a hunt for missing money.",
      thesis: "Every payout has one invoice, and the product finds it.",
      narrative_engine: engine,
      causal_beats: ["hook", "mechanism", "proof", "payoff"].map((role, beat) => ({ id: `c${index + 1}-b${beat + 1}`, role, turn: `${role} turn`, evidence_ids: role === "proof" ? ["brief"] : [], resource_ids: [], visual_opportunity: `${role} object change`, sound_opportunity: `${role} accent` })),
      art_direction_seed: { visual_metaphor: `A ledger that folds shut ${index + 1}`, spatial_world: `One long desk ${index + 1}`, motion_language: "Weighted paper", transition_logic: "Each sheet becomes the next", sound_world: "Paper and a soft click" },
      differentiators: [`Hook ${index + 1}`, `World ${index + 1}`],
      risks: []
    }))
  };
}

export function fakeJudgment() {
  return {
    schema_version: CINEMATIC_CONCEPT_JUDGMENT_VERSION,
    evaluations: [6, 9, 7, 5, 4].map((value, index) => ({
      candidate_id: `concept-${index + 1}`,
      scores: { scroll_stop: value, promise_clarity: value, audience_fit: value, causality: value, proof: value, visual_originality: value, motion: value, sound: value, feasibility: value },
      penalties: { genericism: 0, slideshow_risk: 0, clickbait_or_unsupported: 0 },
      rationale: `Concept ${index + 1} rationale.`,
      required_improvements: ["Show the proof sooner."]
    })),
    recommended_id: "concept-2",
    selection_rationale: "The clearest promise and the strongest world."
  };
}

/** A story valid for the request's format, duration and pace band: eight beats that cover the duration. */
export function fakeStory(input) {
  const { duration_seconds: duration, aspect, width, height, language } = input.format;
  const words = Math.max(STORY_ROLES.length * 2, Math.round((input.pacing.target_word_minimum + input.pacing.target_word_maximum) / 2));
  const per = Math.floor(words / STORY_ROLES.length);
  const beats = STORY_ROLES.map((role, index) => {
    const count = index === STORY_ROLES.length - 1 ? words - per * (STORY_ROLES.length - 1) : per;
    const text = [`Beat${index + 1}`, ...Array.from({ length: count - 1 }, (_, word) => `word${word + 1}`)].join(" ");
    return { id: `story-${index + 1}`, role, target_start_seconds: round(duration * index / STORY_ROLES.length), target_end_seconds: index === STORY_ROLES.length - 1 ? duration : round(duration * (index + 1) / STORY_ROLES.length), spoken_text: `${text}.`, narrative_turn: `${role} turn`, viewer_question: `What follows ${role}?`, visual_noun: `sheet ${index + 1}`, desired_emotion: "curiosity", evidence_ids: role === "proof" ? ["brief"] : [], resource_ids: [] };
  });
  const fullText = beats.map((beat) => beat.spoken_text).join(" ");
  return {
    schema_version: CINEMATIC_STORY_VERSION,
    concept_id: input.selected_concept.id,
    project: { title: input.selected_concept.title, thesis: "Every payout has one invoice.", audience_promise: "Close the books without the hunt." },
    format: { aspect, width, height, duration_seconds: duration, language },
    narration: { source: "generated", full_text: fullText, target_wpm: round(fullText.split(/\s+/).length * 60 / duration), delivery: "Plain and quick.", beats },
    open_loop: { question: "Where does the money go?", resolved_by_beat_id: "story-7", midpoint_rehook_beat_id: "story-5" },
    claims: []
  };
}

export function fakeStoryEdit(story) {
  return { schema_version: CINEMATIC_STORY_EDIT_VERSION, verdict: "ready", scores: { hook: 9, compression: 8, curiosity: 9, clarity: 9, proof: 8, payoff: 9, speakability: 8, visuality: 9 }, findings: [], story };
}

/** The answer to a concept-stage request, or null for any other schema. */
export function conceptAnswer(request) {
  const input = CONCEPT_SCHEMAS.includes(request.schemaName) ? JSON.parse(request.input) : null;
  if (request.schemaName === "launchclip_cinematic_concept_set") return fakeConcepts();
  if (request.schemaName === "launchclip_cinematic_concept_judgment") return fakeJudgment();
  if (request.schemaName === "launchclip_cinematic_story") return fakeStory(input);
  if (request.schemaName === "launchclip_cinematic_story_edit") return fakeStoryEdit(input.draft_story);
  return null;
}

/** Wrap a make client so the concept stage is answered here; every request is recorded in `seen`. */
export function withConcepts(model, seen = []) {
  const inner = model.client.runStructured.bind(model.client);
  const usage = { input_tokens: 2000, output_tokens: 1500, total_tokens: 3500 };
  const client = { ...model.client, async runStructured(request) {
    seen.push(request);
    const value = conceptAnswer(request);
    return value ? { model: model.model, usage, value } : inner(request);
  } };
  return { ...model, client };
}

function round(value) { return Math.round(value * 100) / 100; }

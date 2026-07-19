import assert from "node:assert/strict";
import test from "node:test";
import {
  CINEMATIC_CONCEPT_JUDGMENT_VERSION,
  CINEMATIC_CONCEPT_SET_VERSION,
  CINEMATIC_STORY_EDIT_VERSION,
  CINEMATIC_STORY_VERSION,
  createCinematicTournament,
  scoreConceptEvaluation,
  validateCinematicStory,
  validateCinematicStoryEdit,
  validateConceptJudgment,
  validateConceptSet
} from "../src/cinematic_contracts.js";

test("validates five distinct concepts and rejects a slideshow-shaped tournament", () => {
  const concepts = sampleConceptSet();
  assert.deepEqual(validateConceptSet(concepts, conceptContext()), { ok: true, errors: [] });

  concepts.candidates[1].narrative_engine = concepts.candidates[0].narrative_engine;
  concepts.candidates[2].narrative_engine = concepts.candidates[0].narrative_engine;
  concepts.candidates[3].narrative_engine = concepts.candidates[0].narrative_engine;
  concepts.candidates[4].narrative_engine = concepts.candidates[0].narrative_engine;
  concepts.candidates[1].art_direction_seed.visual_metaphor = concepts.candidates[0].art_direction_seed.visual_metaphor;
  concepts.candidates[2].art_direction_seed.visual_metaphor = concepts.candidates[0].art_direction_seed.visual_metaphor;
  concepts.candidates[3].art_direction_seed.visual_metaphor = concepts.candidates[0].art_direction_seed.visual_metaphor;
  concepts.candidates[4].art_direction_seed.visual_metaphor = concepts.candidates[0].art_direction_seed.visual_metaphor;
  const validation = validateConceptSet(concepts, conceptContext());
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /three distinct narrative engines/);
  assert.match(validation.errors.join(" "), /three distinct visual metaphors/);
});

test("selects the weighted top concept and applies explicit quality penalties", () => {
  const concepts = sampleConceptSet();
  const judgment = sampleJudgment();
  const evaluation = judgment.evaluations[0];
  assert.equal(scoreConceptEvaluation(evaluation), 85.2);
  assert.deepEqual(validateConceptJudgment(judgment, concepts), { ok: true, errors: [] });
  const tournament = createCinematicTournament(concepts, judgment);
  assert.equal(tournament.selected_id, "concept-1");
  assert.equal(tournament.evaluations[0].total_score, 85.2);

  judgment.evaluations[0].penalties.slideshow_risk = 10;
  judgment.recommended_id = "concept-2";
  assert.deepEqual(validateConceptJudgment(judgment, concepts), { ok: true, errors: [] });
  assert.equal(createCinematicTournament(concepts, judgment).selected_id, "concept-2");
});

test("rejects a judge recommendation that disagrees with deterministic scoring", () => {
  const concepts = sampleConceptSet();
  const judgment = sampleJudgment();
  judgment.recommended_id = "concept-5";
  const validation = validateConceptJudgment(judgment, concepts);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /deterministic top score: concept-1/);
});

test("validates a grounded retention arc with target timing and a midpoint rehook", () => {
  const story = sampleStory();
  const context = storyContext();
  assert.deepEqual(validateCinematicStory(story, context), { ok: true, errors: [] });
  const edit = {
    schema_version: CINEMATIC_STORY_EDIT_VERSION,
    verdict: "ready",
    scores: { hook: 9, compression: 8, curiosity: 9, clarity: 8, proof: 8, payoff: 9, speakability: 8, visuality: 9 },
    findings: [{ category: "compression", severity: "minor", instruction: "Keep the close clipped." }],
    story
  };
  assert.deepEqual(validateCinematicStoryEdit(edit, context), { ok: true, errors: [] });
});

test("fails retention stories with broken pacing, grounding, arc, or transcript authority", () => {
  const story = sampleStory();
  story.narration.beats = story.narration.beats.filter((beat) => !["rehook", "escalation"].includes(beat.role));
  story.narration.beats[1].target_start_seconds = 8;
  story.narration.beats[0].evidence_ids = ["missing-evidence"];
  story.narration.full_text = "A rewritten transcript.";
  story.narration.target_wpm = 20;
  const validation = validateCinematicStory(story, { ...storyContext(), suppliedTranscript: "The exact supplied transcript." });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /midpoint rehook/);
  assert.match(validation.errors.join(" "), /require escalation/);
  assert.match(validation.errors.join(" "), /butt-join/);
  assert.match(validation.errors.join(" "), /missing-evidence/);
  assert.match(validation.errors.join(" "), /preserved exactly/);
  assert.match(validation.errors.join(" "), /must reflect the script pace/);
});

function sampleConceptSet() {
  const engines = ["reveal", "transformation", "investigation", "contrarian-proof", "cause-and-effect"];
  return {
    schema_version: CINEMATIC_CONCEPT_SET_VERSION,
    candidates: engines.map((engine, index) => {
      const number = index + 1;
      return {
        id: `concept-${number}`,
        title: `Treatment ${number}`,
        hook: {
          spoken_line: `This ordinary workflow hides advantage number ${number}.`,
          open_loop: `What creates advantage ${number}?`,
          proof_tease: `Watch the result become visible in treatment ${number}.`,
          promised_payoff: `A repeatable way to turn the input into outcome ${number}.`
        },
        audience_tension: "Useful ideas often become forgettable slides.",
        thesis: `A causal visual world makes idea ${number} memorable.`,
        narrative_engine: engine,
        causal_beats: ["hook", "mechanism", "proof", "payoff"].map((role, beatIndex) => ({
          id: `c${number}-beat-${beatIndex + 1}`,
          role,
          turn: `${role} advances treatment ${number}.`,
          evidence_ids: role === "proof" ? ["evidence-1"] : [],
          resource_ids: role === "proof" ? ["resource-1"] : [],
          visual_opportunity: `Object ${number} transforms during ${role}.`,
          sound_opportunity: `A material ${role} accent.`
        })),
        art_direction_seed: {
          visual_metaphor: `World ${number}`,
          spatial_world: `A distinct spatial system ${number}.`,
          motion_language: "Weighted camera travel and object accumulation.",
          transition_logic: "The causal object becomes the next scene.",
          sound_world: "Tactile mechanics with a restrained pulse."
        },
        differentiators: [`Specificity ${number}`, `Motion system ${number}`],
        risks: ["Needs grounded proof."]
      };
    })
  };
}

function sampleJudgment() {
  const totals = [9, 8, 7, 6, 5];
  return {
    schema_version: CINEMATIC_CONCEPT_JUDGMENT_VERSION,
    evaluations: totals.map((value, index) => ({
      candidate_id: `concept-${index + 1}`,
      scores: { scroll_stop: value, promise_clarity: value, audience_fit: value, causality: value, proof: value, visual_originality: value, motion: value, sound: value, feasibility: value },
      penalties: { genericism: index === 0 ? 1 : 0, slideshow_risk: index === 0 ? 1 : 0, clickbait_or_unsupported: index === 0 ? 2 : 0 },
      rationale: `Treatment ${index + 1} earns its score.`,
      required_improvements: ["Sharpen the first proof reveal."]
    })),
    recommended_id: "concept-1",
    selection_rationale: "Concept 1 has the strongest cinematic retention engine."
  };
}

function sampleStory() {
  const roles = ["hook", "promise", "mechanism", "proof", "rehook", "escalation", "payoff", "cta_or_loop"];
  const spoken = [
    "Most launch videos lose before the idea arrives because every beat looks like the last one.",
    "Here is a cinematic production path that earns attention with a promise and immediate visual proof.",
    "First it turns the source into a causal world where objects accumulate instead of resetting between slides.",
    "The evidence appears inside that world so each claim has a visible source and transformation.",
    "But the real advantage appears halfway through when the same object changes scale and opens a second question.",
    "Music lifts camera velocity increases and each reveal lands against a measured spoken phrase with tactile sound.",
    "That creates a film with a strong hook coherent motion grounded proof and a payoff viewers can remember.",
    "Use LaunchClip cinematic and make the final frame resolve the opening question while inviting the next view."
  ];
  let cursor = 0;
  const beats = roles.map((role, index) => {
    const start = cursor;
    const end = index === roles.length - 1 ? 45 : cursor + [5, 5, 6, 6, 5, 6, 6][index];
    cursor = end;
    return {
      id: `story-${index + 1}`,
      role,
      target_start_seconds: start,
      target_end_seconds: end,
      spoken_text: spoken[index],
      narrative_turn: `${role} changes what the viewer understands.`,
      viewer_question: `What happens after ${role}?`,
      visual_noun: `cinematic-object-${index + 1}`,
      desired_emotion: index < 2 ? "curiosity" : index < 6 ? "momentum" : "satisfaction",
      evidence_ids: role === "proof" ? ["evidence-1"] : [],
      resource_ids: role === "proof" ? ["resource-1"] : []
    };
  });
  const fullText = spoken.join(" ");
  return {
    schema_version: CINEMATIC_STORY_VERSION,
    concept_id: "concept-1",
    project: { title: "One causal world", thesis: "Continuity creates retention.", audience_promise: "See how one idea becomes a cinematic short." },
    format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 45, language: "en" },
    narration: { source: "generated", full_text: fullText, target_wpm: Math.round(fullText.split(/\s+/).length * 60 / 45), delivery: "Fast, precise, curious, with a controlled midpoint lift.", beats },
    open_loop: { question: "How does one idea become a film instead of slides?", resolved_by_beat_id: "story-7", midpoint_rehook_beat_id: "story-5" },
    claims: [{ text: "Each claim has a visible source.", evidence_ids: ["evidence-1"], confidence: "verified", qualifier: null }]
  };
}

function conceptContext() {
  return { candidateCount: 5, evidenceIds: ["evidence-1"], resourceIds: ["resource-1"] };
}

function storyContext() {
  return {
    conceptId: "concept-1",
    expectedDuration: 45,
    expectedFormat: { aspect: "9:16", width: 1080, height: 1920, language: "en" },
    minimumWpm: 165,
    maximumWpm: 180,
    requestedCta: "Use LaunchClip cinematic",
    evidenceIds: ["evidence-1"],
    claimEligibleEvidenceIds: ["evidence-1"],
    resourceIds: ["resource-1"]
  };
}

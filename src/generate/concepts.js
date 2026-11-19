// Keyframe concepts aimed at the audience: with several keyframe candidates,
// each candidate is a different concept for the shot rather than another draw
// of one prompt. One text call per batch (the whole video): it picks one
// direction (setting, people, time of day) so the shots still match, then
// writes `count` concrete takes on each shot's `shows` for who the video is for.
import { refusalReason } from "./brief.js";

/**
 * → async (requests) → Map(request id → [shows]), each list `count` long or
 * empty. context: {prompt, rules} from the run. A failed call or a refused
 * concept falls back to the request's own `shows`, so nothing is lost.
 */
export function audienceConcepts(client, { count, prompt = null, rules = null, notice = () => {} } = {}) {
  return async (requests) => {
    const out = new Map();
    if (!(count > 1) || !requests.length) return out;
    let rows = [];
    try {
      const result = await client.runStructured({
        instructions: `You art-direct the B-roll stills for one short video. First work out who the video is for from the brief. Then choose one visual direction for the whole video (the setting, the kind of people, the time of day and the mood) that this audience would recognise as their own world, so every shot looks like part of one film. Then, for each shot, write ${count} different concrete concepts for its keyframe in that direction: what is in frame and how it is framed, each a single plain sentence in lower case. Make the concepts genuinely different (subject, angle or moment), each one specific to this audience rather than generic stock imagery. Never name a real brand, product, person, place or event, and never ask for text, signs, screens with words or logos.`,
        input: [
          prompt ? `Brief: ${String(prompt).slice(0, 4000)}` : null,
          rules ? `The collection's rules (audience, tone, things it never shows): ${String(rules).slice(0, 4000)}` : null,
          "Shots:",
          ...requests.map((request) => `- ${request.id}: ${request.shows}${request.line ? ` (narration: "${String(request.line).slice(0, 300)}")` : ""}`)
        ].filter(Boolean).join("\n"),
        schema: CONCEPTS_SCHEMA,
        schemaName: "launchclip_keyframe_concepts",
        // Room for a reasoning model to think before it answers.
        maxOutputTokens: 4000
      });
      rows = Array.isArray(result?.value?.shots) ? result.value.shots : [];
      if (result?.value?.direction) notice(`concepts: ${String(result.value.direction).slice(0, 200)}`);
    } catch (error) {
      notice(`concepts: not written (${String(error?.message ?? error).split("\n")[0]}); each candidate uses the shot's own prompt`);
      return out;
    }
    for (const request of requests) {
      const row = rows.find((entry) => entry?.id === request.id);
      const ideas = (Array.isArray(row?.concepts) ? row.concepts : []).map((text) => String(text).trim().replace(/\.$/, "")).filter((shows) => shows && !refusalReason({ shows }));
      // Short or refused concepts are made up with the shot's own shows.
      if (ideas.length) out.set(request.id, Array.from({ length: count }, (_, i) => ideas[i] ?? request.shows));
    }
    return out;
  };
}

const CONCEPTS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["audience", "direction", "shots"],
  properties: {
    audience: { type: "string" },
    direction: { type: "string" },
    shots: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "concepts"], properties: { id: { type: "string" }, concepts: { type: "array", items: { type: "string" } } } } }
  }
});

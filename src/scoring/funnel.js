// Generate wide, keep it varied (docs/SCORING_ROADMAP.md, stage 4).
//
//   writeHooks({topic, brief?, count, model, batchSize?, concurrency?, client?, onBatchError?})
//                                          → [{id, kind: "hook", text, source: "written"}]
//
// Writing is the slow step, so it is many small requests side by side to a
// fast model, each with its own slant so the batches do not repeat each other.
import { mapLimit } from "../concurrency.js";
import { createStructuredClient } from "../model_provider.js";

// What a batch is told to lead with. Batch i takes slant i and, once the
// slants have gone round, the next reader, so no two batches share a brief.
export const HOOK_SLANTS = Object.freeze([
  "lead with a specific number or a counted list",
  "name a mistake the reader is making right now",
  "make a contrarian claim that goes against the usual advice",
  "open on one specific moment of a story, in the first person",
  "ask a question with real stakes for the reader",
  "state a concrete result and how long it took",
  "name who it is for in the first three words",
  "open with a warning about what it costs to ignore this",
  "compare two things the reader assumes are the same",
  "reveal something most people in the field get wrong"
]);
const READERS = Object.freeze(["someone new to the subject", "a sceptic who has heard it all before", "a practitioner short on time", "someone who tried this and failed"]);

const HOOKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hooks"],
  properties: { hooks: { type: "array", items: { type: "string" } } }
};

const sameText = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Items with texts seen before (ignoring case and spacing) left out. `seen` carries over between calls. */
export function dropExactDuplicates(items, seen = new Set()) {
  return items.filter((item) => {
    const key = sameText(item.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * `count` hooks on a topic, asked for in parallel batches of `batchSize`.
 * model: a route as `make` takes it (provider:model); defaults to
 * LAUNCHCLIP_MAKE_MODEL. client: anything with runStructured(), for tests.
 * A batch that fails is left out and reported to onBatchError; only every
 * batch failing throws. Fewer than `count` come back when batches repeat
 * each other or fail.
 */
export async function writeHooks({ topic, brief = "", count, model = process.env.LAUNCHCLIP_MAKE_MODEL, batchSize = 25, concurrency = 8, client, onBatchError } = {}) {
  if (!String(topic ?? "").trim()) throw new Error("writeHooks needs a topic");
  if (!(count >= 1) || !(batchSize >= 1)) throw new Error(`writeHooks needs count and batchSize of 1 or more; got ${count} and ${batchSize}`);
  if (!client && !model) throw new Error("writeHooks needs a writing model: pass --model provider:model or set LAUNCHCLIP_MAKE_MODEL");
  const writer = client ?? createStructuredClient(model);
  const batches = Array.from({ length: Math.ceil(count / batchSize) }, (_, index) => index);
  let firstError = null;
  const written = await mapLimit(batches, concurrency, async (index) => {
    const slant = HOOK_SLANTS[index % HOOK_SLANTS.length];
    const reader = READERS[Math.floor(index / HOOK_SLANTS.length) % READERS.length];
    try {
      const result = await writer.runStructured({
        instructions: `You write opening lines (hooks) for short videos and carousels. Write ${batchSize} distinct hooks on the topic. Each is one sentence a person would say out loud, under 20 words, with no hashtags, emoji or quotation marks. For this batch: ${slant}. Write for ${reader}. No two hooks may share an opening phrase. Invent no statistics about real people or companies.`,
        input: `Topic: ${String(topic).trim()}${brief.trim() ? `\n\nBrief:\n${brief.trim()}` : ""}`,
        schema: HOOKS_SCHEMA,
        schemaName: "launchclip_hook_batch",
        // Variety is the point of this step, so it does not ask for the most likely answer.
        temperature: 1,
        reasoningEffort: "none",
        maxOutputTokens: 60 * batchSize + 200
      });
      return (result?.value?.hooks ?? []).filter((text) => typeof text === "string").map((text) => text.replace(/\s+/g, " ").trim());
    } catch (error) {
      firstError ??= error;
      onBatchError?.(error, index);
      return null;
    }
  });
  if (written.every((batch) => batch === null)) throw firstError;
  return dropExactDuplicates(written.flat().filter(Boolean).map((text) => ({ text })))
    .slice(0, count)
    .map((item, index) => ({ id: `written-${index + 1}`, kind: "hook", text: item.text, source: "written" }));
}

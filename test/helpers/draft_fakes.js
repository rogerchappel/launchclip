// Recorded answers for a fast draft (make --speed draft) and its refine: the
// one streamed script call, the one direction call, and the full plan a
// refine asks for. Nothing here reaches a model, a voice or a renderer.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMake } from "../../src/make/index.js";
import { draftStoryboard } from "../../src/make/draft_plan.js";
import { parseProgressLine } from "../../src/progress.js";
import { getVoiceProvider } from "../../src/voice/index.js";
import { animaticAdapters } from "./finish_offline.js";

export const DRAFT_PROMPT = "A 30-second explainer on why sourdough bread needs a starter";
export const DRAFT_SENTENCES = [
  "Why does sourdough need a starter?",
  "Most people think it is just for the sour taste.",
  "But inside that jar, two tiny workers are busy.",
  "Wild yeast eats the flour and makes gas, and the gas lifts the loaf.",
  "Bacteria make acid, which gives the tang and keeps the bread fresh.",
  "Feed the jar flour and water, and it keeps working for years.",
  "So the starter is a kitchen full of helpers.",
  "Save this before your next bake."
];
export const DRAFT_NARRATION = DRAFT_SENTENCES.join(" ");
// The script as the model streamed it: a title, the beats, the call to action.
export const DRAFT_SCRIPT = { title: "Why sourdough needs a starter", beats: [{ beat: "hook", text: DRAFT_SENTENCES.slice(0, 2).join(" ") }, { beat: "body", text: DRAFT_SENTENCES.slice(2, 7).join(" ") }, { beat: "cta", text: DRAFT_SENTENCES[7] }], call_to_action: DRAFT_SENTENCES[7], title_options: ["Why sourdough needs a starter", "The jar that makes bread rise", "What a starter really does", "Two tiny workers in your bread", "Sourdough starts in a jar"] };
// The direction call's answer: the subject and its part as characters, and the hook acted and reworded.
export const DRAFT_DIRECTION = {
  cast: [{ id: "jar", kind: "cup", plays: "the starter" }, { id: "yeast", kind: "blob", plays: "the wild yeast" }],
  scenes: [{ id: "d1", character: "jar", pose: "shrug", expression: "confused", title: "Why a starter?", kicker: "" }]
};

const usage = { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 };
// unref: a call the draft stopped waiting for does not hold the test process open.
// Only a long wait is unref'd: a short one is awaited by the run, and on Node 22 an awaited unref'd timer lets the test's event loop end.
const wait = (ms) => (ms > 0 ? new Promise((resolve) => { const timer = setTimeout(resolve, ms); if (ms >= 1000) timer.unref(); }) : Promise.resolve());

/**
 * A run of make on the recorded answers.
 * options: {direction (the direction call's answer; a function is called
 * for it), directionMs (how long that call takes), env}
 * → {run(makeOptions, adapters) → {report, lines, events}, calls (schema
 * names in order), voiced (texts the voice was asked for), project, cleanup()}
 */
export async function draftRun({ direction = DRAFT_DIRECTION, directionMs = 0, env = {} } = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-draft-"));
  const project = path.join(cwd, "video");
  const calls = [];
  const requests = [];
  const client = {
    provider: "openai",
    async runStructured(request) {
      calls.push(request.schemaName);
      requests.push(request);
      if (request.schemaName === "launchclip_make_draft_script") {
        // The answer arrives in pieces, as a streamed call's does.
        const json = JSON.stringify(DRAFT_SCRIPT);
        for (let at = 0; at < json.length; at += 37) { request.onDelta?.(json.slice(at, at + 37)); await wait(1); }
        return { model: "gpt-5.6-luna", value: DRAFT_SCRIPT, usage };
      }
      if (request.schemaName === "launchclip_draft_direction") {
        await wait(directionMs);
        return { model: "gpt-5.6-luna", value: typeof direction === "function" ? direction(request) : direction, usage };
      }
      // A refine's full plan: no map (make drafts one), and a storyboard for the narration's own timings.
      if (request.schemaName === "launchclip_direction") return { model: "gpt-5.6-luna", value: { direction_json: "" }, usage };
      if (request.schemaName === "launchclip_storyboard") {
        const words = JSON.parse(await readFile(path.join(project, "NARRATION.json"), "utf8")).words;
        const number = (name) => Number(new RegExp(`"${name}":([\\d.]+)`).exec(request.input)[1]);
        const format = { width: number("width"), height: number("height"), fps: 30, duration: number("duration") };
        const board = draftStoryboard({ words, format, title: "The refined plan" }).storyboard;
        board.scenes = board.scenes.map((scene) => ({ ...scene, id: scene.id.replace(/^d/, "r") }));
        return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(board) }, usage };
      }
      throw new Error(`unexpected schema ${request.schemaName}`);
    }
  };
  const voiced = [];
  const voiceProvider = (name, options) => {
    const provider = getVoiceProvider(name, options);
    return { ...provider, synthesize: (request) => { voiced.push(request.text); return provider.synthesize(request); } };
  };
  const run = async (options = {}, adapters = {}) => {
    const lines = [];
    const report = await runMake(DRAFT_PROMPT, { voice: "test", cwd, out: "video", ...options }, {
      env,
      client: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: true },
      voiceProvider,
      notice: (line) => lines.push(line),
      // The real finish, offline, up to its plan: a renderer or a master fails the test.
      finishAdapters: { ...animaticAdapters(), renderer: () => { throw new Error("a draft renders nothing: it asked for a renderer"); }, withSlot: () => { throw new Error("a draft renders nothing: it asked for a render slot"); }, master: () => { throw new Error("a draft renders nothing: it mastered") } },
      ...adapters
    });
    return { report, lines, events: lines.map(parseProgressLine).filter(Boolean) };
  };
  const read = async (file) => JSON.parse(await readFile(path.join(project, file), "utf8"));
  return { run, calls, requests, voiced, project, cwd, read, cleanup: () => rm(cwd, { recursive: true, force: true }) };
}

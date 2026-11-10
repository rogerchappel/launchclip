// Shared by the `make --animation` tests: a model that answers each call from
// a hand-written fixture in test/fixtures/make-animation/ (no test calls a
// real model), the dialogue join without ffmpeg, and a project to run in.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeAnimatic } from "../../src/animatic.js";
import { runMake } from "../../src/make/index.js";
import { readProjectStory } from "../../src/story_loader.js";
import { dialogueLayout } from "../../src/voice/dialogue.js";
import { synthesizeNarration } from "../../src/voice/narrate.js";

export const PROMPT = "A 21-second animated short: Maya keeps shipping a fix that fails, and Sam shows her the check she skipped";
export const fixture = async (name) => JSON.parse(await readFile(new URL(`../fixtures/make-animation/${name}.json`, import.meta.url), "utf8"));

/**
 * A model that answers each call from a fixture, by schema name. `scripts` is
 * the script call's answers in order (the last one repeats); `storyboards`
 * the storyboard call's, the same way; `bible` the designer's answer.
 */
export async function recordedModel({ scripts = ["script"], storyboards = ["storyboard"], bible = "bible", direction = "direction" } = {}) {
  const calls = [];
  const usage = { input_tokens: 1200, output_tokens: 400, total_tokens: 1600 };
  const answers = {
    launchclip_animation_premise: await fixture("premise"),
    launchclip_animation_loglines: await fixture("loglines"),
    launchclip_animation_bible: typeof bible === "string" ? await fixture(bible) : bible,
    launchclip_direction: { direction_json: JSON.stringify(await fixture(direction)) }
  };
  const plays = await Promise.all(scripts.map(fixture));
  const boards = await Promise.all(storyboards.map((entry) => (typeof entry === "string" ? fixture(entry) : entry)));
  const count = { script: 0, storyboard: 0 };
  const client = {
    provider: "openai",
    async runStructured(request) {
      calls.push(request);
      const reply = (value) => ({ model: "gpt-5.6-luna", value, usage });
      if (request.schemaName === "launchclip_animation_script") return reply(plays[Math.min(count.script++, plays.length - 1)]);
      if (request.schemaName === "launchclip_storyboard") return reply({ storyboard_json: JSON.stringify(boards[Math.min(count.storyboard++, boards.length - 1)]), direction_json: "" });
      if (answers[request.schemaName]) return reply(answers[request.schemaName]);
      throw new Error(`unexpected schema ${request.schemaName}`);
    }
  };
  return { calls, model: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: false } };
}

// synthesizeDialogue without ffmpeg (the CI test jobs have none): every line
// is still synthesised and cached through the narration module and laid out by
// dialogueLayout; only the join of the wav files is left out.
export function dialogueWithoutFfmpeg(takes) {
  return async (entries, { outFile, cacheDir, voiceProvider, gap }) => {
    const gaps = entries.slice(0, -1).map((_, index) => gap[index]);
    const lines = [];
    for (const [index, entry] of entries.entries()) {
      const take = await synthesizeNarration(entry.request, { outFile: `${outFile}.line-${index}.wav`, cacheDir, voiceProvider });
      takes.push({ speaker: entry.speaker, text: entry.request.text, voice: entry.request.voice, cached: take.cached });
      lines.push({ ...entry, take });
    }
    const layout = dialogueLayout(lines, gaps);
    await copyFile(lines[0].take.file, outFile);
    for (const [index] of entries.entries()) await rm(`${outFile}.line-${index}.wav`, { force: true });
    return { file: outFile, words: layout.words, duration: layout.duration, lines: layout.lines, gaps, sampleRate: 24000, loudness: null, cached: lines.every(({ take }) => take.cached) };
  };
}

/**
 * A project and a `make` that runs the animation path in it. The reference
 * sheets are drawn by a stand-in (no Chromium), the character library is an
 * empty folder, and finish is `finish` (by default one that reports a render
 * it did not make, so a test can read the files the earlier stages wrote).
 */
export async function room(options = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-animation-"));
  const { calls, model } = await recordedModel(options);
  const takes = [];
  const notices = [];
  const sheets = [];
  const finished = [];
  const adapters = {
    env: {},
    client: model,
    notice: (line) => notices.push(line),
    synthesizeDialogue: dialogueWithoutFfmpeg(takes),
    home: path.join(cwd, "home"),
    renderSheet: async (html, png) => { sheets.push(png); await writeFile(png, "png"); },
    finish: options.finish ?? (async (project, finishOptions = {}) => {
      finished.push(project);
      // The animatic stage reads ANIMATIC.json back, so the stand-in writes one (and the file it names).
      if (finishOptions.animatic) {
        const loaded = await readProjectStory(project);
        await mkdir(path.join(project, "renders"), { recursive: true });
        await writeFile(path.join(project, "renders/animatic.mp4"), "mp4");
        await writeAnimatic(project, { resolved: loaded.resolved, words: loaded.words, renderer: finishOptions.renderer });
      }
      return { status: "passed", seconds: 0, stages: [], gates: {}, final: null, warnings: [] };
    })
  };
  const project = path.join(cwd, "short");
  // A fixed --seed: the generated style (its frame, its motion) is the same in every run, so the checks see the same geometry.
  const make = (extra = {}) => runMake(PROMPT, { animation: true, voice: "test", cwd, out: "short", ...(extra.style ? {} : { seed: "7f3a91c2" }), ...extra }, adapters);
  const read = async (file) => JSON.parse(await readFile(path.join(project, file), "utf8"));
  return { cwd, project, calls, takes, notices, sheets, finished, adapters, make, read, done: () => rm(cwd, { recursive: true, force: true }) };
}

/** The calls a run made, by short name: premise, loglines, script, bible, direction, storyboard. */
export const schemas = (calls) => calls.map((call) => call.schemaName.replace("launchclip_animation_", "").replace("launchclip_", ""));

// `launchclip voice <project | --text "...">`: synthesise the narration (cached),
// write NARRATION.json and report its real duration, word count and sentence
// timing, without needing scenes. Run it before freezing the storyboard so
// scenes are sized to the measured take; `launchclip finish` then reuses the
// cached take for the same {text, provider, voice, speed}. A dialogue story
// (audio.narration.lines) is voiced line by line, each in its speaker's voice,
// exactly as finish voices it, so finish reuses those takes too.
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getVoiceProvider, listVoiceProviders } from "./voice/index.js";
import { dialogueDocument, dialogueGaps, dialogueRequests, formatDialogueReport, synthesizeDialogue } from "./voice/dialogue.js";
import { formatNarrationReport, narrationDocument, narrationRequest, narrationSentences, synthesizeNarration, voiceCacheDir } from "./voice/narrate.js";
import { normalizeLoudness } from "./voice/supplied.js";

/**
 * options: {text, voice (a provider name, or a voice id such as af_heart),
 * provider, speed, out (NARRATION.json path)}
 * adapters: {voiceProvider, normalizeVoice, env}
 * → {stage: "voice", status, request, duration_seconds, word_count, words_per_minute,
 *    narration, audio, cached, sentences, report (plain text)}
 */
export async function runVoiceCommand(projectPath, options = {}, adapters = {}) {
  const project = projectPath ? path.resolve(projectPath) : null;
  if (project && !(existsSync(project) && statSync(project).isDirectory())) throw new Error(`launchclip voice: ${project} is not a project directory (pass a project, or --text "...")`);
  let narration = {};
  let story = null;
  if (project) {
    const storyFile = path.join(project, "storyboard.json");
    if (existsSync(storyFile)) {
      story = JSON.parse(await readFile(storyFile, "utf8"));
      narration = story?.audio?.narration && typeof story.audio.narration === "object" ? story.audio.narration : {};
    }
  }
  const dialogue = !options.text && Array.isArray(narration.lines);
  if (!options.text && !narration.text && !dialogue) {
    throw new Error(project
      ? `launchclip voice: ${path.join(project, "storyboard.json")} has no audio.narration.text or .lines; add it (scenes can wait) or pass --text "..."`
      : "launchclip voice needs a project with audio.narration.text (or dialogue lines), or --text \"...\"");
  }
  // --voice takes a provider name (like finish's --voice) or a voice id.
  const providers = listVoiceProviders();
  const voiceFlag = options.voice == null ? null : String(options.voice);
  const voiceIsProvider = voiceFlag != null && providers.includes(voiceFlag.toLowerCase());
  const provider = options.provider ?? (voiceIsProvider ? voiceFlag.toLowerCase() : undefined);
  if (provider && !providers.includes(String(provider).toLowerCase())) throw new Error(`Unknown voice provider "${provider}". Available providers: ${providers.join(", ")}`);
  if (String(provider ?? narration.provider ?? "").toLowerCase() === "supplied") throw new Error("launchclip voice synthesises narration; the supplied provider has nothing to synthesise (measure the supplied take's NARRATION.json instead)");
  const overrides = {
    text: options.text,
    provider,
    voice: voiceIsProvider ? undefined : voiceFlag ?? undefined,
    speed: options.speed
  };
  const base = project ?? process.cwd();
  const narrationFile = path.resolve(base, options.out ?? "NARRATION.json");
  const voiceFile = options.out
    ? narrationFile.replace(/\.json$/i, "") + ".wav"
    : project ? path.join(project, "assets", "audio", "narration.wav") : path.resolve(base, "narration.wav");
  const synthesis = {
    outFile: voiceFile,
    cacheDir: voiceCacheDir(project, adapters.env ?? process.env),
    voiceProvider: adapters.voiceProvider ?? ((name, providerOptions) => getVoiceProvider(name, providerOptions)),
    normalizeVoice: adapters.normalizeVoice ?? ((input, output) => normalizeLoudness(input, output))
  };
  if (dialogue) return voiceDialogue(story, overrides, synthesis, { narrationFile, voiceFile });
  const request = narrationRequest(narration, overrides);
  const take = await synthesizeNarration(request, synthesis);
  await mkdir(path.dirname(narrationFile), { recursive: true });
  await writeFile(narrationFile, `${JSON.stringify(narrationDocument(request, take), null, 2)}\n`);
  const sentences = narrationSentences(take.words);
  return {
    stage: "voice",
    status: "ready",
    request: { provider: request.provider, voice: request.voice, speed: request.speed, characters: request.text.length },
    duration_seconds: take.duration,
    word_count: take.words.length,
    words_per_minute: take.duration > 0 ? Math.round(take.words.length / take.duration * 60) : 0,
    narration: narrationFile,
    audio: voiceFile,
    cached: take.cached,
    sentences,
    report: formatNarrationReport({ request, take, narrationFile, voiceFile })
  };
}

// A dialogue story: one take per line (a --voice id stands in for the
// narrator and any character without a voice of its own).
async function voiceDialogue(story, { provider, voice, speed }, synthesis, { narrationFile, voiceFile }) {
  const entries = dialogueRequests(story, { provider, voice, speed });
  const take = await synthesizeDialogue(entries, { ...synthesis, gap: dialogueGaps(story) });
  await mkdir(path.dirname(narrationFile), { recursive: true });
  await writeFile(narrationFile, `${JSON.stringify(dialogueDocument(story, entries, take), null, 2)}\n`);
  const first = entries[0].request;
  return {
    stage: "voice",
    status: "ready",
    request: { provider: first.provider, voice: null, voices: Object.fromEntries(take.lines.map((line) => [line.speaker, line.voice])), speed: first.speed, characters: entries.reduce((sum, entry) => sum + entry.request.text.length, 0), lines: entries.length },
    duration_seconds: take.duration,
    word_count: take.words.length,
    words_per_minute: take.duration > 0 ? Math.round(take.words.length / take.duration * 60) : 0,
    narration: narrationFile,
    audio: voiceFile,
    cached: take.cached,
    sentences: narrationSentences(take.words),
    lines: take.lines,
    report: formatDialogueReport({ request: first, take, narrationFile, voiceFile })
  };
}

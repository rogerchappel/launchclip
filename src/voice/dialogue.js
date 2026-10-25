// Dialogue: a narration told in several voices (docs/VIDEO_QUALITY_RFC.md
// §10.5). audio.narration.lines is [{speaker, text}]: `speaker` is a cast id
// (that character's voice, story.cast.characters[].voice) or "narrator"
// (audio.narration.voice). Each line is synthesised as its own take through
// the narration module (so takes cache and level the same way), the takes
// are joined with a short pause, and every word keeps its speaker, so
// character scenes can open mouths on their own lines (`says: "auto"`).
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NARRATION_DEFAULTS, narrationDocument, narrationRequest, synthesizeNarration } from "./narrate.js";

const execFileAsync = promisify(execFile);
export const DIALOGUE_GAP = 0.3;

function castVoices(story) {
  const characters = Array.isArray(story?.cast) ? story.cast : Array.isArray(story?.cast?.characters) ? story.cast.characters : [];
  return new Map(characters.filter((entry) => entry && typeof entry.id === "string").map((entry) => [entry.id, entry.voice ?? null]));
}

/**
 * One synthesis request per line: {speaker, request}. A character with no
 * voice of its own, or the narrator, speaks in audio.narration's voice.
 * overrides: {provider} (finish --voice).
 */
export function dialogueRequests(story, overrides = {}) {
  const narration = story?.audio?.narration ?? {};
  const lines = Array.isArray(narration.lines) ? narration.lines : [];
  const voices = castVoices(story);
  return lines.map((line, i) => {
    const speaker = String(line?.speaker ?? "narrator");
    if (speaker !== "narrator" && !voices.has(speaker)) throw new Error(`audio.narration.lines[${i}].speaker "${speaker}" is not in the story cast (or "narrator")`);
    const base = narrationRequest({ ...narration, text: line?.text }, overrides);
    const own = speaker === "narrator" ? null : voices.get(speaker);
    // A character's own voice is a Kokoro voice id; other providers keep the narration voice.
    const voice = own && base.provider === "kokoro" ? own : base.voice ?? NARRATION_DEFAULTS[base.provider]?.voice ?? null;
    return { speaker, request: { ...base, voice } };
  });
}

/** The plain narration text of a dialogue (for captions and checks). */
export const dialogueText = (story) => (story?.audio?.narration?.lines ?? []).map((line) => String(line?.text ?? "").trim()).filter(Boolean).join(" ");

/** The NARRATION.json document for a dialogue take: words keep their speaker, plus the per-line spans. */
export function dialogueDocument(story, entries, take) {
  return { ...narrationDocument({ ...entries[0].request, voice: null, text: dialogueText(story) }, take), lines: take.lines };
}

/**
 * Synthesise every line and join them into outFile.
 * options: {outFile, cacheDir, voiceProvider, normalizeVoice, gap}
 * → {file, words: [{text, start, end, speaker}], duration, lines: [{speaker, voice, start, end, cached}]}
 */
export async function synthesizeDialogue(entries, { outFile, cacheDir = null, voiceProvider, normalizeVoice, gap = DIALOGUE_GAP, ffmpeg = "ffmpeg" } = {}) {
  if (!entries.length) throw new Error("the dialogue has no lines");
  const work = `${outFile}.lines`;
  await mkdir(work, { recursive: true });
  const takes = [];
  try {
    for (const [i, entry] of entries.entries()) {
      const take = await synthesizeNarration(entry.request, { outFile: path.join(work, `line-${i}.wav`), cacheDir, voiceProvider, normalizeVoice });
      takes.push({ ...entry, take });
    }
    // Join: each take resampled to mono 24 kHz, then a pause between lines.
    const inputs = takes.flatMap(({ take }) => ["-i", take.file]);
    const filters = takes.map((_, i) => `[${i}:a]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono${i < takes.length - 1 ? `,apad=pad_dur=${gap}` : ""}[a${i}]`);
    const graph = `${filters.join(";")};${takes.map((_, i) => `[a${i}]`).join("")}concat=n=${takes.length}:v=0:a=1[out]`;
    await execFileAsync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[out]", outFile]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const words = [];
  const lines = [];
  let offset = 0;
  for (const { speaker, request, take } of takes) {
    for (const word of take.words) words.push({ text: word.text, start: round3(word.start + offset), end: round3(word.end + offset), speaker });
    lines.push({ speaker, voice: request.voice, text: request.text, start: round3(offset), end: round3(offset + take.duration), cached: take.cached });
    offset += take.duration + gap;
  }
  return { file: outFile, words, duration: round3(offset - gap), lines, sampleRate: 24000, loudness: null, cached: takes.every(({ take }) => take.cached) };
}

/** A plain-text report like the narration one, with one row per line and its speaker. */
export function formatDialogueReport({ request, take, narrationFile, voiceFile }) {
  const voices = [...new Map(take.lines.map((line) => [line.speaker, line.voice])).entries()].map(([speaker, voice]) => `${speaker}:${voice ?? "default"}`);
  const wpm = take.duration > 0 ? Math.round(take.words.length / take.duration * 60) : 0;
  const rows = [
    `voice: ${request.provider} dialogue (${voices.join(", ")}) at speed ${request.speed}${take.cached ? " (cached takes)" : ""}`,
    `duration: ${take.duration.toFixed(2)} s   words: ${take.words.length}   lines: ${take.lines.length}   rate: ${wpm} wpm`,
    `narration: ${narrationFile}`,
    `audio: ${voiceFile}`,
    "",
    "  #  start    end      dur   speaker     anchor              text"
  ];
  take.lines.forEach((line, i) => {
    const first = take.words.find((word) => word.start >= line.start - 0.001 && word.speaker === line.speaker);
    const anchor = first ? `word:${first.text.replace(/[^\p{L}\p{N}'-]/gu, "").toLowerCase()}` : "";
    const text = String(line.text ?? "");
    rows.push(`${String(i + 1).padStart(3)}  ${line.start.toFixed(2).padStart(6)}  ${line.end.toFixed(2).padStart(6)}  ${(line.end - line.start).toFixed(2).padStart(6)}   ${String(line.speaker).padEnd(10)}  ${anchor.padEnd(18)}  ${text.length > 50 ? `${text.slice(0, 47)}...` : text}`);
  });
  rows.push("", "Size format.duration to the duration plus a short tail, give each beat its lines' span, and anchor scene starts and hits to words (word:<text>) rather than seconds.");
  return `${rows.join("\n")}\n`;
}

const round3 = (value) => Math.round(value * 1000) / 1000;

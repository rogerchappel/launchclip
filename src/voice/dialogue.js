// Dialogue: a narration told in several voices (docs/VIDEO_QUALITY_RFC.md
// §10.5). audio.narration.lines is [{speaker, text}]: `speaker` is a cast id
// (that character's voice, story.cast.characters[].voice) or "narrator"
// (audio.narration.voice). Each line is synthesised as its own take through
// the narration module (so takes cache and level the same way), each take is
// trimmed to its speech (the engine's lead and trail silence would otherwise
// add about half a second a line), the takes are joined with a pause of
// `gap` seconds from the end of one line's speech to the start of the next
// (audio.narration.gap, or a line's own gap), and every word keeps its
// speaker, so character scenes can open mouths on their own lines
// (`says: "auto"`).
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NARRATION_DEFAULTS, narrationDocument, narrationRequest, synthesizeNarration } from "./narrate.js";

const execFileAsync = promisify(execFile);
/** The default pause between lines, last word to first word, in seconds. */
export const DIALOGUE_GAP = 0.3;
/** Silence kept around a line's words when its take is trimmed. */
const EDGE = 0.06;

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

/**
 * The pause after each line but the last: the line's own gap, else
 * audio.narration.gap, else DIALOGUE_GAP.
 */
export function dialogueGaps(story) {
  const narration = story?.audio?.narration ?? {};
  const lines = Array.isArray(narration.lines) ? narration.lines : [];
  const base = Number.isFinite(narration.gap) ? narration.gap : DIALOGUE_GAP;
  return lines.slice(0, -1).map((line) => Number.isFinite(line?.gap) ? line.gap : base);
}

/** The plain narration text of a dialogue (for captions and checks). */
export const dialogueText = (story) => (story?.audio?.narration?.lines ?? []).map((line) => String(line?.text ?? "").trim()).filter(Boolean).join(" ");

/** The NARRATION.json document for a dialogue take: words keep their speaker, plus the per-line spans. */
export function dialogueDocument(story, entries, take) {
  return { ...narrationDocument({ ...entries[0].request, voice: null, text: dialogueText(story) }, take), lines: take.lines, gaps: take.gaps };
}

/**
 * Where each take goes in the joined dialogue: trimmed to its words (EDGE
 * seconds of silence kept each side, less when the gap is shorter), then
 * padded so gaps[i] seconds pass from line i's last word to line i+1's first.
 * takes: [{speaker, request, take: {words, duration, cached, sound?: {start, end}}}]
 * → {cuts: [{start, end, pad}], words: [{text, start, end, speaker}], lines, duration}
 */
export function dialogueLayout(takes, gaps) {
  // A take's speech runs from its first word (or first sound, take.sound,
  // when that is earlier) to its last word or last sound: engines time the
  // last word's end early, and trimming there clips a final consonant.
  const spans = takes.map(({ take }) => {
    const first = Math.min(take.words.length ? take.words[0].start : 0, take.sound?.start ?? Infinity);
    const last = Math.max(take.words.length ? take.words.at(-1).end : take.duration, take.sound?.end ?? -Infinity);
    return { first, last, length: Math.max(take.duration, last) };
  });
  const tails = spans.map((span, i) => Math.min(EDGE, span.length - span.last, i < spans.length - 1 ? gaps[i] / 2 : EDGE));
  const leads = spans.map((span, i) => Math.min(EDGE, span.first, i > 0 ? gaps[i - 1] - tails[i - 1] : EDGE));
  const cuts = [];
  const words = [];
  const lines = [];
  let offset = 0;
  for (const [i, { speaker, request, take }] of takes.entries()) {
    const start = round3(spans[i].first - leads[i]);
    const end = round3(spans[i].last + tails[i]);
    const pad = i < takes.length - 1 ? round3(Math.max(0, gaps[i] - tails[i] - leads[i + 1])) : 0;
    cuts.push({ start, end, pad });
    for (const word of take.words) words.push({ text: word.text, start: round3(offset + word.start - start), end: round3(offset + word.end - start), speaker });
    lines.push({ speaker, voice: request.voice, text: request.text, start: round3(offset), end: round3(offset + end - start), cached: take.cached });
    offset += end - start + pad;
  }
  return { cuts, words, lines, duration: lines.at(-1).end };
}

/**
 * Synthesise every line and join the trimmed takes into outFile.
 * options: {outFile, cacheDir, voiceProvider, normalizeVoice, gap (seconds, or one per gap: dialogueGaps)}
 * → {file, words: [{text, start, end, speaker}], duration, lines: [{speaker, voice, text, start, end, cached}], gaps}
 */
export async function synthesizeDialogue(entries, { outFile, cacheDir = null, voiceProvider, normalizeVoice, gap = DIALOGUE_GAP, ffmpeg = "ffmpeg" } = {}) {
  if (!entries.length) throw new Error("the dialogue has no lines");
  const gaps = entries.slice(0, -1).map((_, i) => Math.max(0, Number(Array.isArray(gap) ? gap[i] ?? DIALOGUE_GAP : gap)));
  const work = `${outFile}.lines`;
  await mkdir(work, { recursive: true });
  const takes = [];
  let layout;
  try {
    for (const [i, entry] of entries.entries()) {
      const take = await synthesizeNarration(entry.request, { outFile: path.join(work, `line-${i}.wav`), cacheDir, voiceProvider, normalizeVoice });
      takes.push({ ...entry, take: { ...take, sound: await soundSpan(take.file, take.duration, ffmpeg) } });
    }
    // Join: each take trimmed, resampled to mono 24 kHz, then padded to its gap.
    layout = dialogueLayout(takes, gaps);
    const inputs = takes.flatMap(({ take }) => ["-i", take.file]);
    const filters = layout.cuts.map((cut, i) => `[${i}:a]atrim=start=${cut.start}:end=${cut.end},asetpts=PTS-STARTPTS,aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono${cut.pad > 0 ? `,apad=pad_dur=${cut.pad}` : ""}[a${i}]`);
    const graph = `${filters.join(";")};${takes.map((_, i) => `[a${i}]`).join("")}concat=n=${takes.length}:v=0:a=1[out]`;
    await execFileAsync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[out]", outFile]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return { file: outFile, words: layout.words, duration: layout.duration, lines: layout.lines, gaps, sampleRate: 24000, loudness: null, cached: takes.every(({ take }) => take.cached) };
}

/** Where a take's sound starts and ends (above -50 dB), from ffmpeg's silencedetect; null when it cannot tell. */
async function soundSpan(file, duration, ffmpeg) {
  try {
    const { stderr } = await execFileAsync(ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=noise=-50dB:duration=0.05", "-f", "null", "-"]);
    const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((match) => Number(match[1]));
    const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((match) => Number(match[1]));
    const start = starts.length && starts[0] <= 0.001 ? ends[0] ?? 0 : 0;
    // A trailing silence ends at the end of the file (or has no end).
    const tail = starts.length && (ends.length < starts.length || ends.at(-1) >= duration - 0.02) ? starts.at(-1) : duration;
    return start < tail ? { start: round3(start), end: round3(tail) } : null;
  } catch {
    return null;
  }
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

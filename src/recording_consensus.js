import { spawn } from "node:child_process";

export const RECORDING_CONSENSUS_VERSION = "launchclip.recording-consensus.v1";
export const FRAME_SECONDS = 0.01;
const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = SAMPLE_RATE * FRAME_SECONDS;
const PROBE_SECONDS = 0.05;

/**
 * Merge two local recognisers word by word. Words either model heard are kept;
 * edges within the tolerance agree, and wider disagreements go to the measured
 * RMS envelope. Every timing is one recogniser's own edge, never invented.
 */
export function mergeConsensusTranscripts(primary, secondary, options = {}) {
  const models = options.models ?? ["primary", "secondary"];
  if (!Array.isArray(models) || models.length !== 2 || models.some((model) => typeof model !== "string" || !model.trim())) throw new Error("Consensus transcription requires two model names");
  const tolerance = options.toleranceSeconds ?? 0.08;
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 0.5) throw new Error("Consensus tolerance must be between 0 and 0.5 seconds");
  const margin = options.marginDb ?? 3;
  if (!Number.isFinite(margin) || margin < 0) throw new Error("Consensus envelope margin must be a nonnegative number");
  const levels = options.levels ? checkedLevels(options.levels) : null;
  const left = recogniserWords(primary, models[0]);
  const right = recogniserWords(secondary, models[1]);
  const disagreements = [];
  const merged = [];
  for (const entry of align(left, right)) {
    const a = entry.left === undefined ? null : left[entry.left];
    const b = entry.right === undefined ? null : right[entry.right];
    const timed = [a, b].filter((word) => word?.timed);
    if (!timed.length) {
      disagreements.push(record("untimed", a ?? b, a, b, null, models, "No recogniser gave this word a valid duration; it is not kept."));
      continue;
    }
    if (!a || !b) {
      const only = timed[0];
      merged.push({ word: only.word, candidates: [{ start: only.start, end: only.end, start_source: only.model, end_source: only.model }], disagreement: record("presence", only, a, b, null, models, `Only ${only.model} heard this word; its own timing is kept.`) });
      continue;
    }
    if (entry.kind === "substitution") {
      const chosen = a.timed ? a : b;
      const other = chosen === a ? b : a;
      merged.push({ word: chosen.word, candidates: [{ start: chosen.start, end: chosen.end, start_source: chosen.model, end_source: chosen.model }, ...(other.timed ? [{ word: other.word, start: other.start, end: other.end, start_source: other.model, end_source: other.model }] : [])], disagreement: record("wording", chosen, a, b, null, models, `The recognisers heard "${a.word}" and "${b.word}"; ${chosen.model}'s word is kept.`) });
      continue;
    }
    if (timed.length === 1) {
      const only = timed[0];
      merged.push({ word: only.word, candidates: [{ start: only.start, end: only.end, start_source: only.model, end_source: only.model }], disagreement: record("untimed", only, a, b, null, models, `${only === a ? models[1] : models[0]} heard this word without a valid duration; ${only.model}'s timing is kept.`) });
      continue;
    }
    const start = edge(a.start, b.start, "start");
    const end = edge(a.end, b.end, "end");
    const candidates = [];
    if (start.value < end.value) candidates.push({ start: start.value, end: end.value, start_source: start.source, end_source: end.source });
    // Otherwise the recogniser whose start won keeps its whole timing.
    const whole = [a, b].map((word) => ({ start: word.start, end: word.end, start_source: word.model, end_source: word.model }));
    candidates.push(...(start.source === b.model ? whole.reverse() : whole));
    const timing = start.disagree || end.disagree ? record("timing", a, a, b, { start: start.resolution, end: end.resolution }, models, `Timings differ by more than ${tolerance}s; ${[start, end].map((side) => side.note).filter(Boolean).join(" ")}`) : null;
    merged.push({ word: a.word, candidates, disagreement: timing });
  }

  const words = [];
  for (const entry of merged) {
    const prior = words.at(-1);
    const fits = entry.candidates.find((candidate) => candidate.end > candidate.start && (!prior || candidate.start >= prior.end - 0.001));
    if (!fits) {
      disagreements.push({ ...(entry.disagreement ?? record("overlap", { word: entry.word, ...entry.candidates[0] }, null, null, null, models, "")), kind: "overlap", explanation: `No recogniser timing for "${entry.word}" fits after the previous kept word; it is not kept.` });
      continue;
    }
    // A sub-millisecond touch from rounding takes the previous word's own edge.
    words.push({ word: fits.word ?? entry.word, start: prior && fits.start < prior.end ? prior.end : fits.start, end: fits.end, timing: { start: fits.start_source, end: fits.end_source } });
    if (entry.disagreement) disagreements.push({ ...entry.disagreement, word_index: words.length - 1, chosen: { start: words.at(-1).start, end: fits.end, start_source: fits.start_source, end_source: fits.end_source } });
  }
  if (!words.length) throw new Error("Consensus transcription found no timed words");
  disagreements.sort((x, y) => x.start_seconds - y.start_seconds);
  return {
    text: words.map((word) => word.word).join(" "),
    words,
    consensus: { schema_version: RECORDING_CONSENSUS_VERSION, models, tolerance_seconds: tolerance, envelope: levels ? { step_seconds: FRAME_SECONDS, probe_seconds: PROBE_SECONDS, margin_db: margin } : null, agreed_words: words.filter((word) => word.timing.start === "agree" && word.timing.end === "agree").length, disagreements },
  };

  function edge(first, second, side) {
    if (Math.abs(first - second) <= tolerance) return { value: first, source: "agree", disagree: false };
    const scores = levels ? [first, second].map((time) => edgeScore(levels, time, side)) : [null, null];
    const decided = scores.every(Number.isFinite) && Math.abs(scores[0] - scores[1]) >= margin;
    const pick = decided && scores[1] > scores[0] ? 1 : 0;
    const model = models[pick];
    const resolution = { [models[0]]: first, [models[1]]: second, chosen: model, by: decided ? "envelope" : "primary-fallback", ...(scores.every(Number.isFinite) ? { envelope_scores_db: { [models[0]]: round(scores[0]), [models[1]]: round(scores[1]) } } : {}) };
    const note = decided ? `the envelope ${side === "start" ? "rises" : "falls"} at ${model}'s ${side}.` : `the envelope cannot separate the ${side}s, so ${models[0]}'s is kept.`;
    return { value: pick ? second : first, source: model, disagree: true, resolution, note };
  }
}

/** Onset (start) or offset (end) strength in dB across a 50ms probe either side. */
export function edgeScore(levels, time, side) {
  const before = meanLevel(levels, time - PROBE_SECONDS, time);
  const after = meanLevel(levels, time, time + PROBE_SECONDS);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return side === "start" ? after - before : before - after;
}

export function meanLevel(levels, start, end) {
  const first = Math.max(0, Math.floor(start / levels.step_seconds + 1e-6));
  const last = Math.min(levels.levels_db.length, Math.ceil(end / levels.step_seconds - 1e-6));
  if (last <= first) return null;
  let sum = 0;
  for (let index = first; index < last; index++) sum += levels.levels_db[index];
  return sum / (last - first);
}

/** 10ms RMS levels (dB, floor -120) from mono float PCM at 16 kHz. */
export function pcmFrameLevels(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length % 4) throw new Error("Frame levels require float PCM");
  const frames = Math.floor(pcm.length / 4 / FRAME_SAMPLES);
  const levels = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let energy = 0;
    for (let sample = 0; sample < FRAME_SAMPLES; sample++) {
      const value = pcm.readFloatLE((frame * FRAME_SAMPLES + sample) * 4);
      if (!Number.isFinite(value)) throw new Error("Invalid PCM sample");
      energy += value * value;
    }
    levels[frame] = energy > 0 ? Math.max(-120, 10 * Math.log10(energy / FRAME_SAMPLES)) : -120;
  }
  return { step_seconds: FRAME_SECONDS, levels_db: Array.from(levels, round) };
}

/** Stream the source's first audio track once through local FFmpeg; memory stays at one level per 10ms. */
export async function measureFrameLevels(input, options = {}, adapters = {}) {
  if (adapters.pcm) return pcmFrameLevels(await adapters.pcm(input, options));
  const duration = options.durationSeconds;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Frame levels require a positive source duration");
  return new Promise((resolve, reject) => {
    const child = (adapters.spawn ?? spawn)("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-i", input, "-t", String(duration), "-map", "0:a:0", "-vn", "-af", `aresample=${SAMPLE_RATE},aformat=sample_fmts=flt:channel_layouts=mono`, "-f", "f32le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const levels = [];
    let carry = Buffer.alloc(0);
    let errors = "";
    child.stdout.on("data", (chunk) => {
      const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const usable = data.length - (data.length % (FRAME_SAMPLES * 4));
      if (usable) levels.push(...pcmFrameLevels(data.subarray(0, usable)).levels_db);
      carry = Buffer.from(data.subarray(usable));
    });
    child.stderr.on("data", (chunk) => { if (errors.length < 4096) errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`FFmpeg frame levels failed (${code}): ${errors.trim()}`));
      if (!levels.length) return reject(new Error("FFmpeg returned no audio for frame levels"));
      resolve({ step_seconds: FRAME_SECONDS, levels_db: levels });
    });
  });
}

function recogniserWords(transcript, model) {
  if (transcript?.segments?.some((segment) => !Array.isArray(segment.words))) throw new Error(`${model} transcript segments require word-level timestamps`);
  const entries = Array.isArray(transcript) ? transcript : transcript?.words ?? transcript?.segments?.flatMap((segment) => segment.words ?? []) ?? [];
  const words = [];
  for (const entry of entries) {
    if (entry.type && entry.type !== "word") continue;
    const word = String(entry.word ?? entry.text ?? "").trim();
    if (!word) continue;
    const { start, end } = entry;
    if (![start, end].every((value) => typeof value === "number" && Number.isFinite(value)) || start < 0 || end < start) throw new Error(`${model} transcript has an invalid word timestamp`);
    const timed = end > start;
    const prior = words.findLast((candidate) => candidate.timed);
    if (timed && prior && start < prior.end - 0.001) throw new Error(`${model} transcript word timestamps must be ordered and non-overlapping`);
    words.push({ word, start, end, timed, model });
  }
  if (!words.some((word) => word.timed)) throw new Error(`${model} transcript has no timed words`);
  return words;
}

function align(left, right) {
  // Words more than 2s apart are never the same word, whatever their text;
  // nearer starts pair first when the wording alone ties.
  const cost = (a, b) => {
    const distance = Math.abs(a.start - b.start);
    return distance > 2 ? 3 : (token(a.word) === token(b.word) ? 0 : 1) + Math.min(distance, 1) / 4;
  };
  const rows = Array.from({ length: left.length + 1 }, () => new Float64Array(right.length + 1));
  for (let i = 0; i <= left.length; i++) rows[i][0] = i;
  for (let j = 0; j <= right.length; j++) rows[0][j] = j;
  for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost(left[i - 1], right[j - 1]));
  const result = [];
  let i = left.length, j = right.length;
  while (i || j) {
    const pair = i && j ? cost(left[i - 1], right[j - 1]) : 3;
    if (pair < 3 && Math.abs(rows[i][j] - (rows[i - 1][j - 1] + pair)) < 1e-9) result.push({ kind: pair >= 1 ? "substitution" : "match", left: --i, right: --j });
    else if (i && Math.abs(rows[i][j] - (rows[i - 1][j] + 1)) < 1e-9) result.push({ kind: "presence", left: --i });
    else result.push({ kind: "presence", right: --j });
  }
  return result.reverse();
}

function record(kind, word, a, b, resolution, models, explanation) {
  const timed = [a, b].filter((candidate) => candidate?.timed);
  const start = timed.length ? Math.min(...timed.map((candidate) => candidate.start)) : word.start;
  const end = timed.length ? Math.max(...timed.map((candidate) => candidate.end)) : word.end;
  return { kind, word: word.word, start_seconds: start, end_seconds: end, heard: { [models[0]]: a ? { word: a.word, start: a.start, end: a.end } : null, [models[1]]: b ? { word: b.word, start: b.start, end: b.end } : null }, ...(resolution ? { resolution } : {}), explanation };
}

function checkedLevels(levels) {
  if (levels?.step_seconds !== FRAME_SECONDS || !Array.isArray(levels.levels_db) || levels.levels_db.some((level) => !Number.isFinite(level))) throw new Error("Consensus envelope requires 10ms frame levels");
  return levels;
}
function token(value) { return String(value).toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, ""); }
function round(value) { return Math.round(value * 100) / 100; }

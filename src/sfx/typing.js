// The typing track: one keystroke per visible character of typed code, plus
// soft ticks for kinetic text that reveals word by word.
//
// Sources (from resolved module models):
//   - code-snippet lines with charTimes: character j is visible at
//     charTimes[j]; a keystroke lands exactly there. Spaces use the heavier
//     space-bar key and a line break between typed lines uses the enter key.
//   - `*-typing-start` events (with endTime) whose module exposes no
//     charTimes: keystrokes spread evenly over the typing window.
//   - per-word events (`word-<i>`) and archive-card quote words: a soft click.
// Fast typing is capped (default 25 keystrokes per second) by deterministic
// thinning, keys rotate through the family's variants without immediate
// repeats, and each key gets a small seeded level and pitch jitter. The track
// is rendered to one WAV so the mix needs a single input however many keys
// there are.
import { decodeAudio, writeWavFile, SAMPLE_RATE } from "./process.js";
import { unitHash } from "./library.js";

export const TYPING_DEFAULTS = Object.freeze({
  maxRate: 25,
  pitchSemitones: 1.5,
  levelJitterDb: 1.5,
  keyGain: 0.3,
  spaceGain: 0.36,
  enterGain: 0.4,
  wordGain: 0.12,
  evenRate: 14
});

const round3 = (value) => Math.round(value * 1000) / 1000;

function lineCharacters(line) {
  if (Array.isArray(line.tokens)) return line.tokens.flatMap((token) => Array.isArray(token.chars) ? token.chars : Array.from(String(token.text ?? "")));
  return [];
}

function eventLabel(model, event) {
  if (event.name) return event.name;
  const prefix = `${model?.id ?? ""}-`;
  const id = String(event.id ?? "");
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/**
 * Keystroke and word sources of a story: {chars: [{at, char, shot, line,
 * index}], words: [{at, shot, word}]}. models: (scene) => model, or a map by
 * scene id.
 */
export function collectTyping(story, { models } = {}) {
  const chars = [];
  const words = [];
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    const model = typeof models === "function" ? models(scene) : models?.[scene.id] ?? null;
    if (!model) continue;
    const lines = Array.isArray(model.content?.lines) ? model.content.lines : [];
    const typedLines = lines.filter((line) => Array.isArray(line.charTimes) && line.charTimes.length);
    typedLines.forEach((line, position) => {
      const characters = lineCharacters(line);
      line.charTimes.forEach((at, index) => chars.push({ at: Number(at), char: characters[index] ?? "x", shot: scene.id, line: line.index ?? position, index }));
      const next = typedLines[position + 1];
      if (next) {
        // Return between typed lines: just after this line finishes, before the next starts.
        const end = Number(line.endTime ?? line.charTimes.at(-1));
        const at = Math.min(end + 0.08, Number(next.charTimes[0]) - 0.05);
        if (at > Number(line.charTimes.at(-1))) chars.push({ at, char: "\n", shot: scene.id, line: line.index ?? position, index: line.charTimes.length });
      }
    });
    const events = Array.isArray(model.events) ? model.events : [];
    if (!typedLines.length) {
      for (const event of events) {
        const label = eventLabel(model, event);
        if (!/typing-start$/.test(label) || event.cue) continue;
        const start = Number(event.time);
        const end = Number(event.endTime ?? (Number.isFinite(Number(event.duration)) ? start + Number(event.duration) : NaN));
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const count = Math.max(1, Math.round((end - start) * TYPING_DEFAULTS.evenRate));
        for (let index = 0; index < count; index++) chars.push({ at: start + (index + 1) * (end - start) / count - 0.001, char: "x", shot: scene.id, line: label, index });
      }
    }
    for (const event of events) {
      const label = eventLabel(model, event);
      if (/^word-\d+$/.test(label) && !event.cue && Number.isFinite(Number(event.time))) words.push({ at: Number(event.time), shot: scene.id, word: label });
    }
    for (const word of Array.isArray(model.content?.quote?.words) ? model.content.quote.words : []) {
      if (Number.isFinite(Number(word.time))) words.push({ at: Number(word.time), shot: scene.id, word: String(word.text ?? "") });
    }
  }
  chars.sort((a, b) => a.at - b.at);
  words.sort((a, b) => a.at - b.at);
  return { chars, words };
}

/** "key" | "space" | "enter" for a character. */
export function keyKind(char) {
  if (char === "\n" || char === "\r") return "enter";
  if (/^\s$/.test(char)) return "space";
  return "key";
}

/**
 * Deterministic thinning to at most maxRate keystrokes per second: a key is
 * kept when it is at least 1/maxRate after the last kept key; a space or
 * enter is kept from 0.6 of that spacing, so word breaks survive thinning.
 */
export function thinKeys(chars, maxRate = TYPING_DEFAULTS.maxRate) {
  const spacing = 1 / maxRate;
  const kept = [];
  let last = -Infinity;
  for (const entry of chars) {
    const gap = entry.at - last;
    const heavy = keyKind(entry.char) !== "key";
    if (gap + 1e-9 >= spacing || (heavy && gap + 1e-9 >= spacing * 0.6)) {
      kept.push(entry);
      last = entry.at;
    }
  }
  return kept;
}

/**
 * The schedule: [{at, kind: key|space|enter|word, shot, char, pick, gainDb,
 * semitones, gain}] sorted by time. seed: the story id. Words are thinned to
 * 12 per second and skipped when they fall within 30 ms of a keystroke.
 */
export function typingSchedule({ chars = [], words = [] } = {}, { seed = "", maxRate = TYPING_DEFAULTS.maxRate, words: includeWords = true, pitchSemitones = TYPING_DEFAULTS.pitchSemitones, levelJitterDb = TYPING_DEFAULTS.levelJitterDb } = {}) {
  const schedule = [];
  const jitter = (key, salt) => unitHash(`${seed}|${key}|${salt}`) * 2 - 1;
  for (const entry of thinKeys(chars, maxRate)) {
    const kind = keyKind(entry.char);
    const key = `${entry.shot}|${entry.line}|${entry.index}`;
    schedule.push({
      at: round3(entry.at),
      kind,
      shot: entry.shot,
      char: entry.char,
      pick: unitHash(`${seed}|${key}|variant`),
      gainDb: round3(jitter(key, "level") * levelJitterDb),
      semitones: round3(jitter(key, "pitch") * pitchSemitones)
    });
  }
  if (includeWords) {
    const keyTimes = schedule.map((entry) => entry.at);
    let last = -Infinity;
    for (const word of words) {
      if (word.at - last < 1 / 12 || keyTimes.some((at) => Math.abs(at - word.at) < 0.03)) continue;
      last = word.at;
      const key = `${word.shot}|word|${word.at}`;
      schedule.push({ at: round3(word.at), kind: "word", shot: word.shot, char: null, pick: unitHash(`${seed}|${key}|variant`), gainDb: round3(jitter(key, "level") * levelJitterDb), semitones: round3(jitter(key, "pitch") * pitchSemitones * 0.5) });
    }
  }
  schedule.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));
  return schedule;
}

/**
 * Variant indexes for a schedule: picks rotate through each kind's variants
 * and never repeat the previous variant of that kind back to back.
 */
export function assignVariants(schedule, counts) {
  const previous = {};
  return schedule.map((entry) => {
    const count = counts[entry.kind] ?? 0;
    if (count <= 0) return { ...entry, variant: -1 };
    let index = Math.floor(entry.pick * (count > 1 && previous[entry.kind] !== undefined ? count - 1 : count));
    if (count > 1 && previous[entry.kind] !== undefined && index >= previous[entry.kind]) index++;
    previous[entry.kind] = index;
    return { ...entry, variant: index };
  });
}

/** Resample by a pitch ratio (linear interpolation); duration scales by 1/ratio. */
export function pitchShift(channel, semitones) {
  if (!semitones) return channel;
  const ratio = 2 ** (semitones / 12);
  const length = Math.max(1, Math.floor(channel.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const base = Math.floor(position);
    const fraction = position - base;
    out[i] = (channel[base] ?? 0) * (1 - fraction) + (channel[base + 1] ?? 0) * fraction;
  }
  return out;
}

/**
 * Mix a schedule into stereo channels. sounds: {key|space|enter|word: [{channels:
 * [L, R], onsetMs}]}; a missing kind falls back to "key". Keys are placed so
 * their transient (onsetMs into the file) lands on the scheduled time.
 */
export function mixTyping(schedule, sounds, { duration, sampleRate = SAMPLE_RATE, gains = {} } = {}) {
  const level = { key: TYPING_DEFAULTS.keyGain, space: TYPING_DEFAULTS.spaceGain, enter: TYPING_DEFAULTS.enterGain, word: TYPING_DEFAULTS.wordGain, ...gains };
  const counts = Object.fromEntries(["key", "space", "enter", "word"].map((kind) => [kind, (sounds[kind] ?? sounds.key ?? []).length]));
  const placed = assignVariants(schedule, counts);
  const length = Math.ceil(duration * sampleRate);
  const out = [new Float32Array(length), new Float32Array(length)];
  const keystrokes = [];
  for (const entry of placed) {
    const bank = sounds[entry.kind]?.length ? sounds[entry.kind] : sounds.key;
    if (!bank?.length || entry.variant < 0) continue;
    const sound = bank[entry.variant % bank.length];
    const gain = level[entry.kind] * 10 ** (entry.gainDb / 20);
    const ratio = 2 ** (entry.semitones / 12);
    const start = Math.round((entry.at - (sound.onsetMs ?? 0) / 1000 / ratio) * sampleRate);
    for (let c = 0; c < 2; c++) {
      const source = pitchShift(sound.channels[c] ?? sound.channels[0], entry.semitones);
      for (let i = 0; i < source.length; i++) {
        const index = start + i;
        if (index >= 0 && index < length) out[c][index] += source[i] * gain;
      }
    }
    keystrokes.push({ at: entry.at, kind: entry.kind, variant: entry.variant + 1, semitones: entry.semitones, gain_db: entry.gainDb, shot: entry.shot, char: entry.char });
  }
  return { channels: out, keystrokes };
}

/**
 * Render the typing track to `out`. banks: {key|space|enter|word: [{file,
 * measurements}]}. Returns {file, keystrokes: [...], counts}.
 */
export async function renderTypingTrack(schedule, banks, { out, duration, sampleRate = SAMPLE_RATE, gains } = {}) {
  const sounds = {};
  for (const [kind, files] of Object.entries(banks)) {
    sounds[kind] = [];
    for (const entry of files ?? []) {
      const { channels } = await decodeAudio(entry.file, { sampleRate });
      sounds[kind].push({ channels: channels.length === 2 ? channels : [channels[0], channels[0]], onsetMs: entry.measurements?.onset_ms ?? 0 });
    }
  }
  const { channels, keystrokes } = mixTyping(schedule, sounds, { duration, sampleRate, gains });
  await writeWavFile(out, channels, sampleRate);
  const counts = keystrokes.reduce((acc, entry) => ({ ...acc, [entry.kind]: (acc[entry.kind] ?? 0) + 1 }), {});
  return { file: out, keystrokes, counts };
}

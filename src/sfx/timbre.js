// Timbre guard: SFX sit under narration, so they must be tonal or dry. Two
// shapes ride over a voice and read as white noise, and neither may reach a
// mix:
//   hiss  most of the clip's energy is above 5 kHz (a "click" that is really
//         an air burst, a sparkle that is all top end)
//   wash  the loud part is noise-like (high spectral flatness) and sustained
//         (a filtered-noise riser building for a second)
// Library clips are measured when they are seeded and refused there; finish
// measures every cue file again before mixing and swaps a failing one for a
// variant that passes (another library variant, then the procedural kit), or
// drops the cue. Families that are air by nature (a whoosh, a page turn) may
// be noise-like but still may not be hiss.
import { fft } from "../audio_metrics.js";
import { familySource, pickVariant } from "./library.js";
import { decodeAudio } from "./process.js";

export const TIMBRE_LIMITS = Object.freeze({ hissShare: 0.5, hissHz: 5000, washFlatness: 0.05, washSeconds: 0.4 });
// Families built from noise on purpose: exempt from the wash rule only.
export const AIRY_FAMILIES = Object.freeze(["whoosh", "swipe", "page-turn", "glitch", "camera-shutter", "footstep", "door", "pen-scribble", "tape-stop"]);

const FRAME = 1024;
const HOP = FRAME / 2;
const round = (value, digits = 3) => Number(value.toFixed(digits));

/**
 * {hf_share, flatness, loud_seconds} of float channels: the share of energy
 * above 5 kHz; the median spectral flatness (150 Hz-16 kHz) of the frames
 * within 20 dB of the loudest; how long those frames last.
 */
export function measureTimbre(channels, sampleRate) {
  const length = channels[0]?.length ?? 0;
  const mono = new Float64Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  const window = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1)));
  const binHz = sampleRate / FRAME;
  const hissBin = Math.ceil(TIMBRE_LIMITS.hissHz / binHz);
  const lowBin = Math.ceil(150 / binHz);
  const highBin = Math.min(FRAME / 2, Math.floor(16000 / binHz));
  const frames = [];
  let total = 0;
  let high = 0;
  for (let start = 0; start + FRAME <= length; start += HOP) {
    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    for (let i = 0; i < FRAME; i++) re[i] = mono[start + i] * window[i];
    fft(re, im);
    let energy = 0;
    let logSum = 0;
    let bandSum = 0;
    for (let bin = 1; bin <= FRAME / 2; bin++) {
      const power = re[bin] ** 2 + im[bin] ** 2;
      energy += power;
      if (bin >= hissBin) high += power;
      if (bin >= lowBin && bin <= highBin) {
        logSum += Math.log(power + 1e-20);
        bandSum += power;
      }
    }
    total += energy;
    const bins = highBin - lowBin + 1;
    frames.push({ energy, flatness: bandSum > 0 ? Math.exp(logSum / bins) / (bandSum / bins) : 0 });
  }
  if (!frames.length || total <= 0) return { hf_share: 0, flatness: 0, loud_seconds: 0 };
  const loudest = Math.max(...frames.map((frame) => frame.energy));
  const loud = frames.filter((frame) => frame.energy >= loudest * 0.01).map((frame) => frame.flatness).sort((a, b) => a - b);
  return { hf_share: round(high / total), flatness: round(loud[Math.floor(loud.length / 2)] ?? 0), loud_seconds: round(loud.length * HOP / sampleRate, 2) };
}

/** Why a family's clip may not be mixed under a voice, or null when it may. */
export function timbreProblem(family, timbre) {
  if (!timbre) return null;
  if (timbre.hf_share >= TIMBRE_LIMITS.hissShare) return `hiss: ${Math.round(timbre.hf_share * 100)}% of its energy is above ${TIMBRE_LIMITS.hissHz / 1000} kHz`;
  if (!AIRY_FAMILIES.includes(family) && timbre.flatness >= TIMBRE_LIMITS.washFlatness && timbre.loud_seconds >= TIMBRE_LIMITS.washSeconds) {
    return `noise wash: ${timbre.loud_seconds} s of noise-like sound (flatness ${timbre.flatness})`;
  }
  return null;
}

/** Measure a file (memoised per guard run). */
async function fileTimbre(file, cache) {
  if (!cache.has(file)) cache.set(file, decodeAudio(file).then(({ channels, sampleRate }) => measureTimbre(channels, sampleRate)).catch(() => null));
  return cache.get(file);
}

/**
 * Check every placed cue's file. A failing file is replaced by the first
 * passing variant of its family (the picked source's other variants, then
 * the kit); with none, the cue is dropped. Returns {cues, findings} where a
 * finding is {cue, at, file, problem, replacement|null}.
 */
export async function guardCueTimbre(cues, { libraries = [], kit = null, storyId = "", measure = fileTimbre } = {}) {
  const cache = new Map();
  const verdicts = new Map();
  const problemOf = async (family, file) => {
    const key = `${family}|${file}`;
    if (!verdicts.has(key)) verdicts.set(key, timbreProblem(family, await measure(file, cache)));
    return verdicts.get(key);
  };
  const kept = [];
  const findings = [];
  for (const cue of cues) {
    if (!cue.file || cue.source === "typing") { kept.push(cue); continue; }
    const problem = await problemOf(cue.cue, cue.file);
    if (!problem) { kept.push(cue); continue; }
    const source = familySource(cue.cue, libraries, kit);
    const kitSource = kit ? familySource(cue.cue, [], kit) : null;
    const candidates = [...(source?.files ?? []).map((file) => ({ file, scope: source.scope, origin: source.source })), ...(kitSource && kitSource !== source ? kitSource.files.map((file) => ({ file, scope: "kit", origin: "procedural" })) : [])]
      .filter((entry) => entry.file !== cue.file);
    // Start from the deterministic pick so repeats still vary.
    const offset = candidates.length ? pickVariant(candidates.length, `${storyId}|${cue.cue}|${cue.at}`) : 0;
    let replacement = null;
    for (let i = 0; i < candidates.length && !replacement; i++) {
      const candidate = candidates[(offset + i) % candidates.length];
      if (!(await problemOf(cue.cue, candidate.file))) replacement = candidate;
    }
    findings.push({ cue: cue.cue, at: cue.at, file: cue.file, problem, replacement: replacement?.file ?? null });
    if (replacement) kept.push({ ...cue, file: replacement.file, sfx_source: replacement.scope, sfx_origin: replacement.origin, variant: null });
  }
  return { cues: kept, findings };
}
